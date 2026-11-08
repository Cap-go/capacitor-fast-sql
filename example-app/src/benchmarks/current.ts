import type { SQLBatchOperation, SQLResult, SQLRow, SQLConnection, VectorStore, NativeSQLConnection, SQLValue } from '@capgo/capacitor-fast-sql';

export interface BenchmarkEnvironment {
  sourceRevision: string;
  device: string;
  os: string;
  webView: string;
  nativeBuild: string;
  httpPatching: 'enabled' | 'disabled' | 'unknown';
  transport: string;
  assetBundle?: string;
}

export type TransportMetrics = ReturnType<NativeSQLConnection['getTransportMetrics']>;

export interface LatencySummary {
  samplesMs: number[];
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface BenchmarkReport {
  schemaVersion: number;
  timestamp: string;
  environment: BenchmarkEnvironment;
  iterations: number;
  warmups: number;
  requestedOptions: { encrypted: boolean; walMode: boolean; performancePresets: boolean };
  configuration: Record<'sqlite' | 'journal' | 'synchronous' | 'foreignKeys' | 'busyTimeout' | 'pageSize', SQLRow[]>;
  fixture: { blobSizes: number[]; rowCount: number; vectorRows: number; dimensions: number };
  results: ({ name: string; unitsPerSample: number; warmupMs: number[]; metrics?: TransportMetrics } & LatencySummary)[];
}

export function summarize(samples: number[]): LatencySummary {
  if (samples.length === 0 || samples.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Expected non-empty finite latency samples');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return {
    samplesMs: samples,
    meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
  };
}

let running = false;

/** Current public API only. Setup, cleanup and correctness checks are outside timing. */
export async function runCurrentBenchmark(options: {
  connection: SQLConnection;
  createVectorStore: (connection: SQLConnection) => Promise<VectorStore>;
  environment: BenchmarkEnvironment;
  iterations?: number;
  warmups?: number;
  blobSizes?: number[];
  rowCount?: number;
  vectorRows?: number;
  dimensions?: number;
  echo?: (value: SQLValue) => Promise<SQLValue>;
  getMetrics?: () => TransportMetrics;
}): Promise<BenchmarkReport> {
  const { connection, environment } = options;
  const iterations = options.iterations ?? 30;
  const warmups = options.warmups ?? 5;
  if (connection.getDatabaseName() !== 'fast_sql_benchmark')
    throw new Error('Use the dedicated fast_sql_benchmark database');
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) throw new Error('iterations must be 1..100');
  if (!Number.isInteger(warmups) || warmups < 0 || warmups > 20) throw new Error('warmups must be 0..20');
  const blobSizes = options.blobSizes ?? [65536];
  const rowCount = options.rowCount ?? 1000;
  const vectorRows = options.vectorRows ?? 100;
  const dimensions = options.dimensions ?? 8;
  if (!blobSizes.length || blobSizes.length > 8 || blobSizes.some((size) => !Number.isInteger(size) || size < 0 || size > 1024 * 1024)) throw new Error('BLOB sizes must be 0..1 MiB');
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > 10000 || !Number.isInteger(vectorRows) || vectorRows < 10 || vectorRows > 10000 || !Number.isInteger(dimensions) || dimensions < 1 || dimensions > 1024) throw new Error('Invalid fixture dimensions');
  if (running) throw new Error('A benchmark is already running');
  running = true;
  const deadline = performance.now() + 600000;
  let store: VectorStore | undefined;
  const rowsTable = '__fast_sql_benchmark_rows';
  const writesTable = '__fast_sql_benchmark_writes';
  const blobsTable = '__fast_sql_benchmark_blobs';
  let blob = deterministicBytes(blobSizes[0]);
  const results: ({ name: string; unitsPerSample: number; warmupMs: number[]; metrics?: TransportMetrics } & ReturnType<typeof summarize>)[] = [];
  let latest: SQLResult | undefined;

  const ensure = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
  };
  const verifyBlob = async () => {
    const rows = await connection.query(`SELECT value FROM ${blobsTable} WHERE id = 1`);
    const value = rows[0]?.value;
    ensure(
      value instanceof Uint8Array && value.length === blob.length && value.every((byte, index) => byte === blob[index]),
      'BLOB round trip failed',
    );
  };
  const measure = async (workload: {
    name: string;
    units: number;
    prepare?: () => Promise<unknown>;
    run: () => Promise<unknown>;
    verify: () => Promise<unknown>;
  }) => {
    const measured: number[] = [];
    const warmed: number[] = [];
    const metrics: TransportMetrics = { dataRequests: 0, requestBytes: 0, responseBytes: 0, encodeMs: 0, decodeMs: 0 };
    for (let index = 0; index < warmups + iterations; index++) {
      if (performance.now() > deadline) throw new Error('Benchmark exceeded ten minutes between samples');
      await workload.prepare?.();
      const before = options.getMetrics?.();
      const start = performance.now();
      await workload.run();
      const elapsed = performance.now() - start;
      const after = options.getMetrics?.();
      if (index >= warmups && before && after) {
        metrics.dataRequests += after.dataRequests - before.dataRequests;
        metrics.requestBytes += after.requestBytes - before.requestBytes;
        metrics.responseBytes += after.responseBytes - before.responseBytes;
        metrics.encodeMs += after.encodeMs - before.encodeMs;
        metrics.decodeMs += after.decodeMs - before.decodeMs;
      }
      await workload.verify();
      (index < warmups ? warmed : measured).push(elapsed);
    }
    results.push({ name: workload.name, unitsPerSample: workload.units, warmupMs: warmed, metrics: options.getMetrics ? metrics : undefined, ...summarize(measured) });
  };

  try {
    for (const table of [rowsTable, writesTable, blobsTable]) {
      await connection.execute(`DROP TABLE IF EXISTS ${table}`);
      await connection.execute(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, value BLOB)`);
    }
    const fixture = Array.from({ length: rowCount }, (_, id) => ({
      statement: `INSERT INTO ${rowsTable} VALUES (?, ?)`,
      params: [id, `value-${id}`],
    }));
    await connection.transaction((scoped) => scoped.executeBatch(fixture));
    await connection.execute(`INSERT INTO ${blobsTable} VALUES (1, ?)`, [blob]);
    store = await options.createVectorStore(connection);
    await store.deleteVectorStore();
    for (let id = 0; id < vectorRows; id++) {
      await store.add({
        id: String(id),
        embedding: Array.from({ length: dimensions }, (_, dimension) => (id + dimension + 1) / (vectorRows + dimensions)),
      });
    }
    const configuration = {
      sqlite: await connection.query('SELECT sqlite_version() AS version'),
      journal: await connection.query('PRAGMA journal_mode'),
      synchronous: await connection.query('PRAGMA synchronous'),
      foreignKeys: await connection.query('PRAGMA foreign_keys'),
      busyTimeout: await connection.query('PRAGMA busy_timeout'),
      pageSize: await connection.query('PRAGMA page_size'),
    };
    await measure({
      name: 'tiny-select',
      units: 1,
      run: async () => {
        latest = await connection.execute('SELECT 1 AS value');
      },
      verify: async () => {
        ensure(latest?.rows[0]?.value === 1, 'Tiny SELECT failed');
      },
    });
    await measure({
      name: `rows-${rowCount}`,
      units: rowCount,
      run: async () => {
        latest = await connection.execute(`SELECT * FROM ${rowsTable} ORDER BY id`);
      },
      verify: async () => {
        ensure(latest?.rows.length === rowCount && latest.rows[rowCount - 1]?.value === `value-${rowCount - 1}`, 'Row fixture mismatch');
      },
    });
    for (const size of blobSizes) {
      blob = deterministicBytes(size);
      if (options.echo) {
        const echo = options.echo;
        let echoed: SQLValue = null;
        await measure({ name: `transport-echo-${size}`, units: size,
          run: async () => { echoed = await echo(blob); },
          verify: async () => { ensure(echoed instanceof Uint8Array && echoed.length === blob.length && echoed.every((value, index) => value === blob[index]), 'Echo mismatch'); },
        });
      }
    await measure({
      name: `blob-upload-${blob.length}`,
      units: blob.length,
      run: () => connection.execute(`UPDATE ${blobsTable} SET value = ? WHERE id = 1`, [blob]),
      verify: verifyBlob,
    });
    await measure({
      name: `blob-download-${blob.length}`,
      units: blob.length,
      run: async () => {
        latest = await connection.execute(`SELECT value FROM ${blobsTable} WHERE id = 1`);
      },
      verify: async () => {
        const value = latest?.rows[0]?.value;
        ensure(
          value instanceof Uint8Array &&
            value.length === blob.length &&
            value.every((byte, index) => byte === blob[index]),
          'BLOB download failed',
        );
      },
    });
    }
    const writes: SQLBatchOperation[] = Array.from({ length: 100 }, (_, id) => ({
      statement: `INSERT INTO ${writesTable} VALUES (?, ?)`,
      params: [id, `write-${id}`],
    }));
    for (const mode of ['individual', 'batch', 'transaction-batch']) {
      await measure({
        name: `writes-100-${mode}`,
        units: writes.length,
        prepare: () => connection.execute(`DELETE FROM ${writesTable}`),
        run: async () => {
          if (mode === 'individual') {
            for (const operation of writes) await connection.execute(operation.statement, operation.params);
          } else if (mode === 'batch') {
            await connection.executeBatch(writes);
          } else {
            await connection.transaction((scoped) => scoped.executeBatch(writes));
          }
        },
        verify: async () => {
          const rows = await connection.query(`SELECT count(*) AS count FROM ${writesTable}`);
          ensure(rows[0]?.count === 100, 'Write count mismatch');
        },
      });
    }
    const vectorStore = store;
    let vectorIds: string[] = [];
    await measure({
      name: `vector-top10-${vectorRows}x${dimensions}`,
      units: vectorRows,
      run: async () => {
        vectorIds = (await vectorStore.query({ queryEmbedding: Array.from({ length: dimensions }, () => 1), nResults: 10 })).map((row) => row.id);
      },
      verify: async () => {
        ensure(vectorIds.length === 10 && (dimensions === 1 || vectorIds.every((id, index) => id === String(vectorRows - 1 - index))), 'Vector ranking mismatch');
      },
    });
    return {
      schemaVersion: 2,
      timestamp: new Date().toISOString(),
      environment: { ...environment },
      iterations,
      warmups,
      requestedOptions: { encrypted: false, walMode: false, performancePresets: false },
      configuration,
      fixture: { blobSizes, rowCount, vectorRows, dimensions },
      results,
    };
  } finally {
    try {
      await store?.deleteVectorStore();
      await store?.unload();
      for (const table of [rowsTable, writesTable, blobsTable])
        await connection.execute(`DROP TABLE IF EXISTS ${table}`);
    } finally {
      running = false;
    }
  }
}

/** Repeatable xorshift bytes avoid benchmarking only highly compressible patterns. */
export function deterministicBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let state = 0x6d2b79f5;
  for (let index = 0; index < size; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 255;
  }
  return bytes;
}
