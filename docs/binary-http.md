# Experimental binary HTTP v1

This implements the first transport experiment from [the proposal](https://github.com/Cap-go/capacitor-fast-sql/pull/107):
keep loopback HTTP and compare raw binary attachments with the JSON/base64 path.
JSON remains the default. The new mode is opt-in and native-only.

```typescript
const connection = await FastSQL.connect({
  database: 'app',
  transport: 'http-binary',
});
await connection.execute('INSERT INTO files (data) VALUES (?)', [new Uint8Array([0, 1, 255])]);
const rows = await connection.query('SELECT data FROM files');
// rows[0].data is a Uint8Array, including for an empty BLOB.
```

Native connect/server-info responses advertise `binaryProtocolVersion: 1`.
FastSQL rejects unsupported native versions and web usage before sending binary
SQL requests. It does not replay failed writes as JSON or change adapters during
a transaction. Direct NativeSQLConnection construction accepts an optional fourth
argument, `http-json` or `http-binary`; callers using it manage bootstrap/lifetime.

Both SQLite and Android SQLCipher bind raw byte arrays on the binary path. iOS
binds Data and returns Data before framing. JSON retains its base64 representation.
HTTP JSON parameters now go directly through typed validation rather than the
old string/truncating conversion helper. Metadata remains JSON, and implementations
still allocate/copy buffers. This is not an end-to-end zero-copy implementation.

## Frame format

| Byte offset | Field |
| --- | --- |
| 0 | Four ASCII bytes `FSQ1` |
| 4 | Metadata byte length, unsigned 32-bit little endian |
| 8 | Attachment byte length, unsigned 32-bit little endian |
| 12 | UTF-8 JSON metadata |
| 12 + metadata length | Raw attachment bytes |

A BLOB becomes `{"$blob":[offset,length]}` in metadata. Offsets are relative to
the attachment section. Empty BLOBs have length zero; SQL NULL is JSON null.
Execute metadata contains statement and params; batch metadata contains an
operations array. Results retain the existing rows/rowsAffected/insertId shape.
The authenticated `/echo` route accepts one parameter and returns it without
running SQLite, for transport diagnostics.

The codec is independent of SQL envelopes, and one fixture is decoded by all
three implementations. Extraction into a generic multi-plugin router remains
future work, along with AndroidX messaging, native transaction leases, compact
rows, cursors and prepared-many operations. Existing transaction semantics remain;
callers must coordinate access to a shared database during manual transactions.
Batches retain partial-success behavior unless wrapped in a transaction.

## Limits and failure behavior

Frames/request bodies and decoded response bodies are capped at 64 MiB. Binary
metadata is capped at 1 MiB, with 4,096 attachments, 100,000 metadata values and
32 recursive levels from the root. References, UTF-8 and declared lengths are
validated. Decoded BLOBs own their bytes, so holding one result does not retain the
complete frame buffer. Native SQL still materializes results before encoding;
this is not a streaming cursor or a universal memory-use bound. Telegraph reads
request bodies before the iOS route checks the size.

Android's existing SQL HTTP worker now has a bounded 32-request queue and a
600-second wait. Expired queued requests are cancelled before they start; a
running operation can still finish. JavaScript data requests have a 600,000 ms abort deadline.
Aborting the JS wait does not cancel SQLite, and a write can already have
committed when response encoding/delivery fails. No write is retried automatically.
Malformed input is validated before batch execution; SQL errors during a valid
non-atomic batch can still leave earlier writes committed.

Android permits negotiated gzip for both response MIME types. Payload-byte
counters measure decoded entity bytes, excluding headers and HTTP compression,
not bytes on the network. They must not be presented as wire-traffic measurements.

## Validation and measurement

Run `bun test tests`, `bun run benchmark:check`, `bun run fmt`, and `bun run verify`.
Native tests cover the shared golden frame, raw SQLite BLOB binding/results,
empty BLOB versus NULL, decimals/Unicode, malformed frames and an authenticated
Android HTTP socket round trip. iOS tests run with the SwiftPM test target on a
simulator. SQLCipher compilation is checked; encrypted-device runtime testing is
still needed.

The comparison runner uses the same database, SQL, fixtures and actual PRAGMAs,
alternates AB/BA order, and retains each round's samples. Its defaults are four
paired rounds, three warmups and ten measured samples per workload, including
0-byte, 64 KiB and 1 MiB echo/upload/download cases and a 1,000-by-64 vector scan.
It records JS encode/decode time and payload counts alongside end-to-end latency.
Setup, verification and warmup measurements are excluded from measured totals.
The echo path excludes SQLite. Vector results are checked for expected ranking.

Use the native example's comparison checkbox and enter accurate device/build/
revision details. OTA auto-updates are disabled in the example to preserve the
installed benchmark assets. Optional report collection is local-only:

```sh
bun scripts/collect-benchmark.ts benchmarks/results/my-device.json
```

Enter `http://localhost:9876/report` as the export URL. Android emulators need
`adb reverse tcp:9876 tcp:9876`. The collector exits after saving one report or
at ten minutes. The displayed JSON/download remains available without a collector.
Run physical-device release builds before drawing production performance
conclusions; simulator/emulator data is only an implementation validation run.
