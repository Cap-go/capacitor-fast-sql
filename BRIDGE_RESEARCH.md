# JS-to-native communication: Expo lessons and Fast SQL opportunities

Research date: November 6, 2026. Scope: this checkout of
`@capgo/capacitor-fast-sql` 8.2.16 and its Capacitor 8 integration.
This is a source-based assessment, not a device benchmark or a completed security audit.

## Recommendation

Apply Expo's boundary-design lessons, not its JNI implementation. First establish
correct transaction ownership and a reproducible baseline. Then prototype a
binary-capable, opt-in transport in Fast SQL, and extract a shared transport SDK
only after validating its usefulness in another plugin.

Do not promise a speedup before measuring the complete JS-to-SQLite round trip.
Do not change the existing Capacitor 8 API or default durability settings to make
benchmarks look better.

## What transfers from Expo

Expo optimizes JNI environment lookup, resource ownership, and conversion calls;
it also encodes JS objects into a binary buffer instead of repeatedly constructing
them across JNI. Its architecture connects a React Native JS runtime through
JSI/C++ to Kotlin. Its JNI microbenchmarks are not measurements of this plugin or
a WebView transport. [E1]

The useful engineering principles for this project are:

- Reduce intermediate representations and repeated parsing.
- Specialize known data types instead of converting everything into generic objects.
- Retain native resources behind explicit handles when their lifetime is controlled.
- Move compound operations to the native side rather than optimizing individual calls alone.
- Measure each conversion and scheduling stage, as well as end-to-end behavior.

Capacitor 8 uses Android message dispatch and an iOS WebKit message handler;
its JS bridge does not provide the Expo module runtime. Adding an NDK library
would not itself make WebView JavaScript able to call SQLite through JSI. [C1]

## What this plugin actually does

`FastSQL.connect()` uses Capacitor for setup and returns a `NativeSQLConnection`
on iOS/Android. Normal operations then use authenticated loopback HTTP. The
browser implementation already uses SQLite Wasm through a Worker.

Evidence: `src/fast-sql.ts:27`, `src/native-sql-connection.ts:39`,
`src/web.ts:49`.

The native fast path is not serialization-free:

- Requests use `JSON.stringify`; responses use `response.json()`.
- Every BLOB parameter/result is converted to/from base64.
- Results are reconstructed as JavaScript row objects.
- Android batch responses stringify a result and immediately parse it back into
  a `JSONObject` before serializing the complete batch.

Evidence: `src/native-sql-connection.ts:39`,
`src/native-sql-connection.ts:220`,
`android/src/main/java/app/capgo/capacitor/fastsql/SQLHTTPServer.java:154`.

Changing the carrier alone does not remove these costs. Conversely, introducing
a binary codec over the existing carrier can be tested separately from replacing
HTTP, making the experiment easier to interpret.

## A reusable transport design

Keep the standard Capacitor bridge for registration, permission checks, setup,
capability negotiation, and small control messages. Add a separate opt-in data
plane for bulk requests and results.

A shared SDK should own:

- A versioned, typed request envelope with service/method and request IDs.
- Raw byte payloads rather than base64 inside JSON; evaluate CBOR or a compact
  metadata envelope plus binary attachments before inventing a large custom codec.
- Batching, bounded result chunks, flow control, cancellation, and deadlines.
- Native resource handles with close/dispose, reload cleanup, and bounded quotas.
- Structured errors, including SQLite codes and batch failure position.
- Session scoping, main-frame/origin checks, explicit method registration, and tracing.

Do not expose arbitrary native method invocation through reflection. A new fast
lane must preserve plugin permissions and lifecycle rules. Do not retry writes
automatically after a timeout: the write may already have committed. Cancellation
of the JS wait also does not prove cancellation of native execution.

### Android candidate

Prototype AndroidX WebKit binary messaging. `WebMessageCompat` accepts
`ArrayBuffer` payloads, and `JavaScriptReplyProxy` can return byte arrays. Gate
each API on its WebView feature support, including `WEB_MESSAGE_ARRAY_BUFFER`;
an Android SDK-level check alone is insufficient. [A1] [A2]

Use origin-scoped injection and verify the sender frame; move database work off
the UI callback thread. Preserve an HTTP/standard-bridge fallback. Neither the
existence of an ArrayBuffer API nor a transferable JS buffer proves an end-to-end
zero-copy path through WebView, JNI, and SQLite.

Forward-looking: AndroidX source also contains a native/WebView
`SharedArrayBuffer` backed by shared memory and exposed as a direct ByteBuffer.
However, both the inspected class and message constructor are marked
`@RestrictTo(LIBRARY_GROUP)`. They require WebView feature support and
cross-origin isolation. This is worth tracking, not a public production API to
depend on today; it also would not eliminate SQLite's own binding/result copies.
The reference below pins the inspected revision rather than claiming release
availability. [A3]

### iOS candidate

Start with binary requests/responses over a hardened loopback HTTP transport.
Separately evaluate a custom-scheme resource path for bulk reads. WebKit rejects
registering a custom handler for a scheme it already handles. A custom scheme
is therefore not a transparent replacement for HTTP, and request bodies, fetch
compatibility, cancellation, and configuration-time integration need tests. [W1]

Do not assume iOS has the same bidirectional binary channel as AndroidX, or that
WebView exposes an interchangeable JSI runtime.

### Generic does not mean automatic

A shared JS package plus native SDK can serve Fast SQL, filesystem, image, or
other bulk-data plugins that explicitly adopt it. It will not automatically
accelerate every existing `registerPlugin()` call. Transparent acceleration of
all Capacitor plugins would be a separate upstream/core integration project.

Use one session/router per WebView rather than independently opening a server
for each adopting plugin. Keep the existing public APIs usable while capability
negotiation selects a compatible adapter. Do not silently mix adapters in ways
that reorder operations or lose transaction ownership.

## Plugin-specific priorities

### 1. Protect the advertised fast path from HTTP patching

`NativeSQLConnection` uses global `fetch`. Capacitor 8 can patch it; the external
POST branch dispatches through `CapacitorHttp` using `nativePromise`. Test the
loopback URL with HTTP patching both enabled and disabled, and provide a deliberate
browser-network adapter rather than assuming global fetch always bypasses the
bridge. Do not globally disable an application's HTTP plugin. [C1] [C2]

Local evidence: `src/native-sql-connection.ts:40`.

### 2. Fix transaction ownership and native scheduling

`FastSQL` shares a connection by database name. The JS transaction flag prevents
a second begin but does not prevent another caller's `execute()` from joining
the first caller's transaction. Serializing individual statements does not
solve this: ownership must span begin through commit/rollback.

Android HTTP uses one executor across all databases, while direct Capacitor calls
invoke the same database wrappers without that executor. iOS uses FULLMUTEX
SQLite handles, but has no equivalent database-operation queue covering compound
operations and mutable wrapper state. A registry lock is not a transaction lock.

Use per-database native execution ownership across every entry point, a transaction
session/lease, and coordinated disconnect. Independent databases should not block
one another. Account for Android connection/thread affinity when designing this.

Evidence: `src/fast-sql.ts:27`, `src/native-sql-connection.ts:177`,
`android/src/main/java/app/capgo/capacitor/fastsql/SQLHTTPServer.java:28`,
`android/src/main/java/app/capgo/capacitor/fastsql/CapgoCapacitorFastSqlPlugin.java:166`,
`ios/Sources/CapgoCapacitorFastSqlPlugin/SQLDatabase.swift:29`.

### 3. Add explicitly atomic and prepared bulk operations

Both HTTP batch handlers execute a loop without starting a transaction. Earlier
writes can remain committed if a later operation fails. Repeated inserts also
prepare statements individually in the plugin wrapper.

Add an opt-in atomic batch mode and an `executeMany`-style operation that prepares
one SQL statement and binds many parameter sets. Define behavior inside an
existing transaction, including whether savepoints are used. Keep today's batch
semantics backward compatible; document any future-major default candidate in
`src/definitions.ts` rather than silently changing it.

SQLite documents why grouping commits reduces per-transaction overhead. Any
measured improvement must still be reported separately from bridge changes. [S1]

Evidence: `android/src/main/java/app/capgo/capacitor/fastsql/SQLHTTPServer.java:135`,
`ios/Sources/CapgoCapacitorFastSqlPlugin/SQLHTTPServer.swift:264`,
`ios/Sources/CapgoCapacitorFastSqlPlugin/SQLDatabase.swift:98`.

### 4. Fix SQL and API contract mismatches

- Android classifies row-producing SQL by `SELECT`/`PRAGMA`/`EXPLAIN` prefixes.
  `WITH ... SELECT`, leading comments, and supported `RETURNING` forms need a
  real row-producing execution path rather than more prefix exceptions.
- Android SELECT parameters are converted to strings; binary parameters become
  base64 text rather than bound BLOBs. Use typed query binding, including for the
  SQLCipher backend.
- `readOnly` exists in the public options but is not applied by the native open
  paths. Transaction isolation is accepted by JS but ignored by native begin.
  Implement supported behavior or reject unsupported modes explicitly; do not
  imply SQLite supports every enum value independently.
- Verify consistent `rowsAffected`/`insertId` semantics. iOS reads connection-wide
  changes/last-insert state for every statement, including reads.
- Specify exact integer handling beyond JS safe-integer precision, empty BLOBs,
  nulls, invalid parameters, and duplicate column names without breaking defaults.

Evidence: `src/definitions.ts:68`,
`android/src/main/java/app/capgo/capacitor/fastsql/SQLDatabase.java:39`,
`android/src/main/java/app/capgo/capacitor/fastsql/SQLDatabase.java:139`,
`ios/Sources/CapgoCapacitorFastSqlPlugin/CapgoCapacitorFastSqlPlugin.swift:37`,
`ios/Sources/CapgoCapacitorFastSqlPlugin/SQLHTTPServer.swift:304`,
`ios/Sources/CapgoCapacitorFastSqlPlugin/SQLDatabase.swift:151`.

### 5. Harden the existing HTTP transport

Android calls NanoHTTPD's port-only constructor. In the pinned NanoHTTPD 2.3.1
source that constructor supplies a null hostname, and socket binding uses a
wildcard address. Explicitly bind loopback; iOS already requests `127.0.0.1`.
This does not mean unauthenticated SQL execution: bearer authentication is present.
It does contradict the architecture document's localhost-only description. [N1]

Additionally, replace wildcard CORS with an explicit configured origin policy,
retain session authentication, validate database names/path containment, enforce
request/result/batch limits, and bound queues. Android allocates from
`Content-Length` directly and waits on executor results without an explicit
deadline. JS requests have no AbortSignal/deadline support.

A database busy timeout is not a transport deadline. Keep new deadlines at or
below the repository's ten-minute policy. Treat resume/reload/server restart and
stale connection objects as explicit lifecycle states.

Evidence: `android/src/main/java/app/capgo/capacitor/fastsql/SQLHTTPServer.java:35`,
`android/src/main/java/app/capgo/capacitor/fastsql/SQLHTTPServer.java:49`,
`android/src/main/java/app/capgo/capacitor/fastsql/SQLHTTPServer.java:84`,
`android/src/main/java/app/capgo/capacitor/fastsql/SQLHTTPServer.java:179`,
`ios/Sources/CapgoCapacitorFastSqlPlugin/SQLHTTPServer.swift:68`,
`ARCHITECTURE.md:277`.

### 6. Transfer less data, especially for vector queries

Add bounded cursor/page APIs and an optional compact row format with one column
name list plus row arrays. Define cursor snapshot/transaction lifetime and
cleanup. Existing object-row APIs can remain convenience wrappers.

The vector store currently fetches every embedding, scores and sorts in JS, and
only then applies the result limit. A faster bridge cannot remove this full scan
or its payload volume. Offer native/Wasm top-k scoring and an optional vector
index after benchmarking. Preserve arbitrary JS predicate semantics: such
predicates cannot simply be evaluated in native SQL, so retain a fallback or add
an explicit native-compatible filter API. Vector deletion also currently sends
one delete per selected ID and is a candidate for batching.

Evidence: `src/vector-store.ts:279`, `src/vector-store.ts:292`,
`src/vector-store.ts:453`, `src/native-sql-connection.ts:236`.

### 7. Make persistence and connection lifetime explicit

Expose whether the web database is actually persistent and offer an opt-in
require-persistence mode instead of relying only on a console warning when OPFS
fails. Do not silently change the current fallback behavior in a minor release.
Deduplicate concurrent connects with an in-flight promise; validate conflicting
encryption/read-only/open options when returning cached connections.

Evidence: `src/web.ts:74`, `src/web.ts:93`, `src/fast-sql.ts:27`.

## Proof required before choosing a transport

The example app times a batch insert, but it is not a controlled bridge benchmark.
The architecture document's timing table and README's speed claim are not a
substitute for reproducible results on this implementation.

Create release-build tests on physical iOS and Android devices with:

- A no-op/echo for transport cost and a tiny SELECT for end-to-end latency.
- Repeated writes: individual calls, batches, atomic batches, and prepared-many.
- Large row results and BLOB upload/download independently.
- A representative vector top-k query and a mixed workload.
- Concurrency within/across databases, disconnect during work, reload, and cancellation.
- HTTP patching enabled/disabled and each supported transport capability/fallback.
- An identical database, indexes, SQL, encryption mode, and PRAGMAs across comparisons.

Record warmed/cold runs, latency distributions, throughput, JS/native CPU,
queue wait, prepare/step time, encode/decode time, transferred bytes, and peak
memory. Do not subtract unrelated process clocks without synchronization. Test
small calls as well as bulk data; there is no established universally faster
transport here.

Add a shared conformance matrix for SQL types, row-producing statements,
transaction isolation/ownership, atomic failure, read-only opens, and persistence.
The current iOS unit test is a placeholder; Android parser tests cover useful
conversion cases but not this whole transport/database contract.

Evidence: `example-app/src/main.ts:176`, `ARCHITECTURE.md:254`, `README.md:80`,
`ios/Tests/CapgoCapacitorFastSqlPluginTests/CapgoCapacitorFastSqlPluginTests.swift:5`,
`android/src/test/java/app/capgo/capacitor/fastsql/HttpRequestJsonParamsTest.java:1`.

## Suggested delivery sequence

1. Correctness/security fixes and transport/database conformance tests.
2. A benchmark harness with per-stage instrumentation and reproducible fixtures.
3. Prepared atomic bulk operations and bounded results on today's transport.
4. A binary HTTP prototype; independently compare AndroidX binary messaging.
5. Extract the shared SDK when a second plugin validates the abstraction.

A shared C/C++ SQLite or vector engine might later improve consistency or native
computation. It is a separate decision from optimizing WebView communication,
with additional SQLCipher, ABI, binary-size, CocoaPods, and SwiftPM obligations.

## Verification of the original research-only change

- `bun run verify`: the iOS build succeeds. Android then fails because
  `:capacitor-android` has no consumable variants with dependencies absent from
  this checkout; the sequential command does not reach the web build.
- `bun install --frozen-lockfile`: blocked because local Bun 1.3.11 cannot parse
  this repository's lockfile version 2. The lockfile was not regenerated.
- No native runtime behavior or performance claim was validated on a device.
- No production source, public API, or configuration was changed.

## Follow-up implementation

The original dependency blocker above was resolved on November 7 using Bun 1.4.4,
without changing the lockfile. Follow-up fix PRs pass `bun run fmt` and the full
`bun run verify`. Simulator XCTest execution was attempted but ran out of disk
space, so added iOS runtime tests are not claimed as passing.

The delivery index, remaining experiments, and protocol proposal are in
[the binary transport proposal](docs/BINARY_TRANSPORT_PROPOSAL.md). The current
baseline is [PR #105](https://github.com/Cap-go/capacitor-fast-sql/pull/105).
No native device performance results or binary-transport speedups are claimed.

## Primary sources

- [E1: Expo Modules 2.0: a new JNI layer](https://expo.dev/blog/expo-modules-2-0-new-jni-layer).
- [C1: Capacitor 8.0.0 native bridge source](https://github.com/ionic-team/capacitor/blob/8.0.0/core/native-bridge.ts), particularly message dispatch and the fetch patch.
- [C2: Capacitor HTTP documentation](https://capacitorjs.com/docs/apis/http), patching configuration.
- [A1: AndroidX WebMessageCompat](https://developer.android.com/reference/androidx/webkit/WebMessageCompat), binary payload and feature requirements.
- [A2: AndroidX JavaScriptReplyProxy](https://developer.android.com/reference/androidx/webkit/JavaScriptReplyProxy), binary replies and buffer-size caveats.
- [A3: AndroidX SharedArrayBuffer source, pinned revision a2d751ee](https://github.com/androidx/androidx/blob/a2d751ee5f7a6fc120215ee7befce0b1f0836e89/webkit/webkit/src/main/java/androidx/webkit/SharedArrayBuffer.java), shared-memory semantics and library-group restriction; the matching `WebMessageCompat.java` revision also restricts its shared-buffer constructors.
- [W1: WebKit WKWebViewConfiguration implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKWebViewConfiguration.mm), `setURLSchemeHandler:forURLScheme:`. Moving upstream source, consulted on the research date; not a pinned OS implementation.
- [N1: NanoHTTPD 2.3.1 source](https://github.com/NanoHttpd/nanohttpd/blob/nanohttpd-project-2.3.1/core/src/main/java/fi/iki/elonen/NanoHTTPD.java), port-only constructor and `ServerRunnable` socket binding.
- [S1: SQLite FAQ, question 19](https://sqlite.org/faq.html#q19), grouping multiple writes into one transaction to amortize commit overhead.
