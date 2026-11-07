# Current transport baseline

This branch starts at `e9f319de6bf98385ea777e75bdae75b7a79ed21f`, before the
communication fixes. The harness uses existing public APIs and changes no native
transport, SQL settings, production API, or advertised performance claims.
No device benchmark results have been collected or committed.

## Run

Use a Bun version that supports lockfile version 2. This checkout was installed
with Bun 1.4.4. Build the plugin, install the example dependencies with its frozen
lockfile, build the example, and sync the native target:

```sh
bun install --frozen-lockfile
bun run build
cd example-app
bun install --frozen-lockfile
bun run build
bunx cap sync ios
# or: bunx cap sync android
```

Build the native example in release configuration on a physical device. Use Java
21 for Android. Open the example's "Current transport baseline" section, enter
the full source revision, device, OS, native build configuration, and known HTTP
patching setting, then run and retain the JSON report. The report is also shown
as text if the WebView does not support downloading files.

Run HTTP patching disabled and enabled as separate native builds. Do not infer
the setting from the fetch function name. Record the actual WebView version on
Android in addition to its user agent. Preserve device thermal/power state and
repeat complete runs in alternating order when comparing branches.

The reserved `fast_sql_benchmark` database is isolated from the example's user
database. Do not put application data in it. Fixture tables and the baseline
logical vector store are cleared. The database file itself is retained.

## Workloads and interpretation

Each of eight workloads has five warmup iterations and thirty measured samples:
a tiny SELECT, 1,000-row read, separate 64 KiB BLOB upload/download, 100 individual
writes, a non-atomic 100-write batch, a transaction-wrapped batch, and a top-10
vector query over 100 eight-dimensional embeddings.

Fixture creation, per-sample write-table clearing, and correctness checks are
outside timed intervals. Request encoding, transport, native execution, response
parsing, and result reconstruction are inside the end-to-end timings. The write
transaction includes begin and commit. Transaction grouping changes commit cost;
it must not be reported as a transport-only improvement. BLOB bytes and row/write
counts are checked. The vector check validates count, not ranking conformance.

The report includes raw measured and warmup samples, mean and nearest-rank
p50/p95/p99, source/device/build metadata, plugin version, and actual SQLite
journal, synchronous, busy-timeout, foreign-key, page-size and version values.
Requested options are unencrypted, WAL opt-in off, and performance presets off.
WAL can persist in a database file, so compare actual PRAGMAs, not only requested
options. Fresh-install tests must be labeled separately.

These are warmed end-to-end samples, not cold app startup or a pure transport
no-op. Thirty samples cannot establish reliable extreme-tail latency. The tiny
fixture is a reproducibility starting point, not a production-scale vector
benchmark. There is no direct Capacitor bridge comparator, native CPU/memory
instrumentation, or prepared-many operation in this baseline yet. Add those as
separate experiments while preserving this fixture and baseline revision.

The runner checks a ten-minute budget between samples. It cannot interrupt a
stalled native request; it never retries writes. App reload or process termination
can leave a write outcome unknown. Do not treat a JS timeout as database rollback.

## Harness verification

```sh
bun test tests/benchmark.test.ts
bunx tsc -p benchmarks/tsconfig.json
bun run fmt
bun run verify
```

The Bun test runs all workloads against real in-memory SQLite through a test
adapter. It validates fixture handling, results, cleanup and percentile logic.
Its timings are not native HTTP or device performance results and must not be
published as such. Native device runs are still required.
