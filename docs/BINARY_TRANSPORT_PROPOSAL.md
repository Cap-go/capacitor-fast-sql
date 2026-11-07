# Proposal: opt-in binary communication for Fast SQL and other plugins

Status: RFC and experiment plan. This PR implements documentation, not a new
transport or shared SDK. Existing APIs and transport defaults stay in place.

The motivation and pinned source references are in [the research note](../BRIDGE_RESEARCH.md).
The reproducible current-implementation harness is [PR #105](https://github.com/Cap-go/capacitor-fast-sql/pull/105),
with [run instructions](../benchmarks/README.md). This proposal depends on that
baseline PR so the protocol can be evaluated against the same fixtures.

## Delivery index

Each row is a separate fix or feature PR. Parent PRs must merge first. Other PRs
target main and should be rebased as overlapping siblings land. Their individual
verification does not establish that the entire set has been tested together.

| PR | Change | Parent |
| --- | --- | --- |
| [#88](https://github.com/Cap-go/capacitor-fast-sql/pull/88) | Android loopback binding and OS-assigned port | main |
| [#89](https://github.com/Cap-go/capacitor-fast-sql/pull/89) | Browser fetch despite Capacitor HTTP patching | main |
| [#90](https://github.com/Cap-go/capacitor-fast-sql/pull/90) | Concurrent-open deduplication and conflicting cached options | main |
| [#91](https://github.com/Cap-go/capacitor-fast-sql/pull/91) | Android query metadata and typed parameter binding | main |
| [#92](https://github.com/Cap-go/capacitor-fast-sql/pull/92) | Native read-only opens and explicit web rejection | main |
| [#93](https://github.com/Cap-go/capacitor-fast-sql/pull/93) | Per-database Android thread and iOS operation locking | #92 |
| [#94](https://github.com/Cap-go/capacitor-fast-sql/pull/94) | Exclusive high-level callback transaction scopes | #93 |
| [#95](https://github.com/Cap-go/capacitor-fast-sql/pull/95) | Observable web persistence and opt-in requirement | main |
| [#96](https://github.com/Cap-go/capacitor-fast-sql/pull/96) | iOS empty BLOB versus NULL | main |
| [#97](https://github.com/Cap-go/capacitor-fast-sql/pull/97) | Database path containment and web URI escaping | main |
| [#98](https://github.com/Cap-go/capacitor-fast-sql/pull/98) | Android request-body validation and 64 MiB cap | #93 |
| [#99](https://github.com/Cap-go/capacitor-fast-sql/pull/99) | Configured WebView origin policy | #88 |
| [#100](https://github.com/Cap-go/capacitor-fast-sql/pull/100) | Bounded vector deletion batches | main |
| [#101](https://github.com/Cap-go/capacitor-fast-sql/pull/101) | No stale iOS write metadata on reads | main |
| [#102](https://github.com/Cap-go/capacitor-fast-sql/pull/102) | Explicit isolation-level contract | main |
| [#103](https://github.com/Cap-go/capacitor-fast-sql/pull/103) | Opt-in atomic batches, preserving default behavior | #94 |
| [#104](https://github.com/Cap-go/capacitor-fast-sql/pull/104) | Remove Android per-result JSON stringify/parse | main |
| [#105](https://github.com/Cap-go/capacitor-fast-sql/pull/105) | Current HTTP JSON baseline harness | main |
| [#106](https://github.com/Cap-go/capacitor-fast-sql/pull/106) | Preserve decimal HTTP parameters before binding | #91 |

The fixes intentionally leave experimental features below unimplemented. In
particular, high-level transaction scopes do not protect against a caller that
bypasses FastSQL and directly invokes the bridge or raw HTTP. Manual transactions
still require exclusive caller coordination. A generic protocol needs native
leases spanning every entry point, rather than treating statement serialization
as complete transaction ownership.

## Architecture

Borrow Expo's reduction of intermediate representations and explicit ownership.
Its React Native JNI/JSI runtime is different from Capacitor's WebView, so neither
its implementation nor its microbenchmark gains can be transplanted directly.
No zero-copy or speedup claim is made here.

Keep Capacitor registration, permissions, connection setup, and small control
messages. Negotiate an experimental bulk transport for an explicitly registered
service. Start inside Fast SQL. Extract a shared package only after a second
plugin, such as filesystem transfer, validates the abstraction.

One router belongs to each WebView session. It must register a bounded allowlist
of service methods and preserve each plugin's permissions. Do not expose arbitrary
native method names through reflection. A shared package accelerates adopting
plugins; transparently replacing every Capacitor call would require separate
core/upstream work.

Proposed experimental adapters are HTTP JSON, HTTP binary, and AndroidX binary
messages. Negotiate once per session and database transaction. Never switch
adapters in the middle of a transaction or retry a write after a failed transport.
Keep HTTP JSON and the standard bridge available as explicit fallbacks.

## Protocol contract to implement

Use a versioned envelope containing request ID, session ID, service, method,
deadline, optional transaction lease, and declared attachment lengths. Compare
CBOR with compact metadata plus raw attachments before choosing a codec. The
experiment must use identical payload semantics across carriers.

Raw BLOB attachments replace base64 JSON. Preserve empty BLOBs separately from
NULL. An opt-in compact result can carry an ordered column-name list plus row
arrays. Retain existing object rows as a compatibility wrapper. Column lists
must preserve duplicate names; document how the object wrapper resolves them.

Retain today's numeric default for compatibility. Evaluate an explicit int64
mode with tagged values or decimal strings, including JavaScript safe-integer
boundaries. Do not silently change SQLValue to BigInt or stringify every integer.
For the current API, callers needing exact large integers can select them as SQL
TEXT and handle the string explicitly. Define rowsAffected and insertId for
RETURNING, DDL, PRAGMAs, triggers, and each backend in conformance tests.

Errors should include a stable category, native SQLite code where available,
failing batch index, and outcome status. Do not log authentication tokens, keys,
SQL bindings, or full application rows in performance traces.

Initial resource-limit candidates are 64 KiB metadata, 1 MiB frames, 64 KiB result
chunks, 32 queued requests per session, and 2 MiB unread cursor data. These are
proposed limits to validate, not existing guarantees. Bound nesting, attachment
counts, total decoded bytes, native handles, and per-database queues before
allocation. The Android 64 MiB JSON request cap in #98 is a separate legacy-path
limit; iOS Telegraph parser allocation limits remain unresolved.

Use a maximum deadline of 600000 ms. Expiring the JavaScript wait does not prove
native cancellation. Distinguish queued, running, cancellation-requested,
completed, and unknown write outcomes. Cancel queued work before execution when
possible. Do not automatically retry writes whose outcome is unknown.

Native transaction leases must identify the owner on begin, execute, batch,
commit, rollback, and close, across both bridge and bulk entry points. Reject
other owners while the lease is active. Android operations for one database must
stay on one thread. Independent databases should progress independently. Raw SQL
transaction-control statements must be accounted for or rejected in managed
sessions so they cannot bypass lease state.

Prepared statements and cursors need session-scoped handles, explicit disposal,
quotas, and close-on-reload/disconnect cleanup. Cursor reads need a defined
snapshot lifetime. A native close must coordinate with queued/running operations.
Neither a registry mutex nor SQLite FULLMUTEX alone owns a multi-call transaction.

## Platform experiments

First send the same binary codec over the existing loopback HTTP carrier on both
platforms. This separates serialization savings from transport changes. Preserve
session authentication, configured origins, and database ownership.

Then compare AndroidX WebKit binary messaging with the same fixtures and codec.
Verify installed public APIs and gate every capability on WebView feature
support, including ArrayBuffer support. Check the sender frame and configured
origin, schedule SQL off the UI callback thread, and exercise capability fallback.
An ArrayBuffer API does not prove that WebView, JNI, binding, and result delivery
share one buffer. Measure allocations and copies rather than labeling it zero-copy.

The AndroidX shared-memory classes inspected in the research were library-group
restricted at the pinned revision. Recheck public availability before any future
implementation. They are not a production dependency in this proposal.

On iOS, begin with binary HTTP. Custom-scheme bulk reads are a separate experiment
requiring request-body, fetch, cancellation, and configuration-time integration
tests. Do not assume an Android-equivalent binary reply channel or JSI runtime.
Preserve both CocoaPods and SPM integration throughout.

## Separate improvements to measure

Prepared-many execution should prepare one statement, clear bindings, bind each
parameter set, step, and reset. Define failure index, partial/atomic behavior,
RETURNING support, and use inside an existing transaction before adding its API.
Keep preparation savings separate from transport and transaction grouping. This
is not implemented by #103's transaction-wrapped existing batch endpoint.

Bounded cursors and compact rows should reduce result allocation and repeated
column names. Native/Wasm vector top-k should avoid transferring every embedding
and sorting all candidates in JavaScript. Preserve arbitrary JS predicates with
a fallback, or add a separate native-compatible filter contract. #100 reduces
delete requests but intentionally does not implement native top-k or a vector
index.

## Evidence and rollout gates

1. Run #105 on physical iOS and Android release builds, with HTTP patching on/off.
   Record complete source revisions, devices, WebView versions, options, actual
   PRAGMAs, thermal/power state, raw samples, and repeated whole-run results.
2. Expand the baseline with pure transport echo, a direct bridge comparator,
   larger payload/vector scales, cold startup, native stage timing, CPU, peak
   memory, concurrency, reload, disconnect, and cancellation. The current Bun
   smoke test validates fixtures and is not a native performance result.
3. Run shared conformance tests before any timing comparison: scalar/BLOB types,
   decimals, empty/NULL values, large integers, row-producing statements,
   read-only connections, metadata, atomic failure, transaction ownership,
   persistence, stale handles, and malformed/oversized messages.
4. Compare binary HTTP against JSON with identical SQL, indexes, prepared state,
   transactions, encryption, database contents and PRAGMAs. Change one variable
   at a time. Compare AndroidX only after holding the binary codec constant.
5. Pre-register numeric regression budgets and success criteria for small calls
   and bulk workloads before collecting candidate results. Report repeated-run
   variation and raw distributions, including regressions. Do not infer complete
   round-trip gains from one encode or JNI microbenchmark.
6. Keep native stage intervals on each native monotonic clock and JS intervals on
   its own clock. Do not subtract timestamps from unrelated process clocks.
7. Ship only behind explicit opt-in after correctness, lifecycle, bounded-resource,
   permissions, fallback and performance gates pass. Consider default changes
   only in a matching Capacitor major, with the candidate documented in source
   JSDoc. Extract the SDK only after the second plugin passes the same contract.

No new binary transport, prepared-many API, native lease protocol, cursor API,
vector index, or shared SDK is implemented in this documentation PR. Those remain
reviewable follow-up experiments rather than completed performance improvements.
