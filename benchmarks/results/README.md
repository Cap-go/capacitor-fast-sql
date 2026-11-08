# iOS simulator binary HTTP experiment

These two completed reports are implementation evidence, not production-device performance claims. The 1 MiB BLOB cases were faster with binary in these runs. Tiny queries, rows, write modes and vector search show overlapping ranges or timer-resolution limits. Keep JSON as the default pending physical-device and Android runtime measurements.

## Reproduction and scope

- Reports: [first](ios27-simulator-release.json), [repeat](ios27-simulator-release-repeat.json). Both contain raw measured/warmup samples, actual SQLite configuration and transport counters.
- [Comparison chart](ios27-simulator-comparison.html) shows the three 1 MiB cases.
- Source revision: 2b661244e0a2edcee4e68ef4f9ef222850085f71; plugin 8.2.17; optimized Release arm64 iOS simulator build. These reports describe that revision. Later review fixes add non-finite response validation and builtin-asset verification; final-head device measurements remain necessary.
- Simulator: capgo-pr89-iphone, iOS 27.0. Host: Apple M5 Pro, 18 CPU cores, 64 GiB memory. The WebView user agent reports a compatibility iOS version; the environment OS field records the actual runtime.
- Two comparisons, each four paired rounds in AB/BA order. Eight runs per transport, three warmups and ten measured samples per workload per run. Values below are median of eight run p50 values; brackets are their minimum and maximum. Each transport has 80 measured samples per workload. These are not pooled percentiles or confidence intervals.
- Same database handle and fixtures, HTTP patching disabled, encryption off, no performance presets. Actual configuration on every run: SQLite 3.54.0, DELETE journal, synchronous=2, foreign_keys=1, busy_timeout=0, page_size=4096. All fixture/byte/ranking checks completed; any failure aborts the runner rather than becoming a timing sample.
- No builds/tests ran during these two captures. macOS background activity remained, including mediaanalysisd. Host load averages observed mid-capture were 6.57/11.80/12.08 and 7.33/10.27/11.42 on 18 cores. AB/BA ordering reduces but cannot remove this noise. An earlier run overlapped builds and failed export; it is excluded.
- Observed browser timer granularity was 1 ms; short codec intervals often register zero. Small latency differences are inconclusive. No native stage profiler, CPU attribution, allocations, memory peaks, concurrency, cold-start or encrypted-runtime measurements were captured. The causal bottleneck is not proven.

## End-to-end observations

| Workload | JSON ms | Binary ms |
| --- | ---: | ---: |
| tiny-select | 3 [2, 3] | 3 [2, 3] |
| rows-1000 | 4 [4, 4] | 4 [4, 4] |
| transport-echo-0 | 3 [2, 3] | 3 [2, 3] |
| blob-upload-0 | 3 [2, 3] | 3 [2, 3] |
| blob-download-0 | 3 [2, 3] | 3 [3, 3] |
| transport-echo-65536 | 4 [3, 4] | 3 [2, 3] |
| blob-upload-65536 | 3 [3, 4] | 3 [3, 3] |
| blob-download-65536 | 3 [3, 3] | 3 [2, 3] |
| transport-echo-1048576 | 18 [17, 23] | 5 [4, 6] |
| blob-upload-1048576 | 18.5 [13, 20] | 4 [4, 5] |
| blob-download-1048576 | 8.5 [8, 9] | 4 [4, 5] |
| writes-100-individual | 292 [285, 296] | 288 [282, 299] |
| writes-100-batch | 28.5 [27, 32] | 28 [27, 29] |
| writes-100-transaction-batch | 8.5 [8, 9] | 9 [8, 9] |
| vector-top10-1000x64 | 7 [7, 8] | 7 [7, 8] |

Measurements include JS encoding, loopback HTTP, native decoding, SQLite when applicable, response encoding and JS result decoding. Echo excludes SQLite. Each individual-write sample performs 100 requests; batch and transaction-batch samples perform 100 writes. Transaction-batch also times begin/commit. Do not attribute transaction grouping gains to the codec.

## Payload and codec observations

For one 1 MiB upload, JSON sends 1,398,221 request entity bytes and binary sends 1,048,697. For a download, JSON returns 1,420,293 decoded entity bytes and binary returns 1,048,663. JSON response escaping contributes beyond base64 expansion. These counters exclude HTTP headers/compression and are not network-wire byte counts.

Across 80 measured 1 MiB uploads, JS encode counters total 796 ms for JSON and 10 ms for binary. Across 80 measured 1 MiB downloads, decode counters total 226 ms and 9 ms. These quantized counters are consistent with removing base64 work, but do not establish the native or end-to-end limiter.

## Remaining validation

Android conformance/socket tests and the optimized release build passed, but the emulator became unavailable: installation timed out, then the advised adb restart left emulator-5554 offline and the retry reported DEVICE_NOT_FOUND. No Android runtime report is claimed. Physical iOS/Android release devices, encrypted SQLite, HTTP patching enabled, and independent process restarts remain necessary before choosing a default. The eight runs here share one app process.
