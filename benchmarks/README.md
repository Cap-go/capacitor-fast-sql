# Native transport benchmarks

The original JSON baseline was introduced in [#105](https://github.com/Cap-go/capacitor-fast-sql/pull/105).
The current runner also compares JSON and experimental binary HTTP with identical
fixtures. It does not change durability settings to make one transport faster.
See [binary HTTP documentation](../docs/binary-http.md) for the protocol and limits.

## Build and run

Use Bun with lockfile-version-2 support, such as Bun 1.4.4:

```sh
bun install --frozen-lockfile
bun run build
cd example-app
bun install --frozen-lockfile
bun run build
bunx cap sync ios
# or: bunx cap sync android
```

Build the native example in release configuration. Enter the full source revision,
device model, OS, build configuration and HTTP-patching setting. Keep "Compare
JSON and binary HTTP" checked for the paired experiment; uncheck it for a single
JSON baseline. Keep the raw downloaded/displayed JSON report. Automatic OTA
updates are disabled in the example so installed benchmark assets remain stable.

The implementation is inside `example-app/src/benchmarks/`, so the packed example
builds without external repository files. `benchmarks/current.ts` re-exports it
for the repository checks. The reserved `fast_sql_benchmark` database and baseline
logical vector store are test fixtures; do not put application data there.

## Paired experiment

Defaults are four paired rounds, alternating AB/BA order, three warmups and ten
measured samples for each of fifteen workloads. JSON and binary use one native
database handle sequentially. Each run rebuilds identical fixtures and records
actual SQLite PRAGMAs; a configuration mismatch rejects the comparison.

Workloads include tiny SELECT, 1,000 rows, separate echo/upload/download for empty,
64 KiB and 1 MiB BLOBs, three 100-write modes, and vector top-10 over 1,000
64-dimensional embeddings. Deterministic xorshift bytes avoid testing only a
highly compressible repeated byte pattern. BLOB bytes, row/write counts, and
vector ranking are verified outside timing. Echo uses authenticated HTTP without
SQLite. Transaction-batch timing includes begin and commit.

Reports retain every round, raw warmup/measured samples, mean and nearest-rank
p50/p95/p99, complete source/build/device metadata, plugin version, and actual
SQLite version/journal/synchronous/foreign-key/busy-timeout/page-size values.
JS codec time and data-request payload-byte totals exclude fixture setup, sample
preparation, verification and warmups. They exclude HTTP headers/compression and
are not network-wire measurements. Native CPU, memory and SQLite stage timing
are not instrumented. Thirty or forty samples do not establish extreme-tail
latency. Keep per-round variation when reporting results.

Requested options are unencrypted, WAL opt-in off and performance presets off.
WAL can persist in a database file, so compare actual PRAGMAs rather than requested
flags. Do not label transaction-grouping gains as transport-only improvements.
Run HTTP patching enabled/disabled in separate native builds. Match encryption,
indexes, SQL, fixtures, prepared state, thermal/power state and actual PRAGMAs.

The single-baseline mode retains eight workloads, five warmups and thirty measured
samples, with a 100-by-8 vector fixture and 64 KiB BLOBs. It measures warmed
end-to-end operations, not cold startup. Comparison helpers allow smaller fixtures
for smoke tests. The ten-minute budget is checked between steps/runs; an in-flight
native write can still finish after the JS wait ends. Writes are never retried.

## Collect reports locally

```sh
bun scripts/collect-benchmark.ts benchmarks/results/my-device.json
```

Set the optional export URL to `http://localhost:9876/report`. On Android use
`adb reverse tcp:9876 tcp:9876`. The local-only collector exits after one report or
ten minutes. A JSON download/text report is also available without the collector.

## Validate the harness

```sh
bun test tests
bun run benchmark:check
bun run fmt
bun run verify
```

The Bun test executes the fixtures and AB/BA orchestration against real in-memory
SQLite through a test adapter. Those timings are not native HTTP measurements.
Cross-language frame and native SQLite/socket tests are separate. Physical-device
release builds are required for production conclusions; simulator/emulator runs
validate the implementation and must be labeled accordingly.
