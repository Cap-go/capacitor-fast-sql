import type { SQLBatchOperation, SQLResult, SQLRow, SQLConnection, VectorStore } from '@capgo/capacitor-fast-sql';

export interface BenchmarkEnvironment {
  sourceRevision: string;
  device: string;
  os: string;
  webView: string;
  nativeBuild: string;
  httpPatching: 'enabled' | 'disabled' | 'unknown';
  transport: string;
}

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
  results: ({ name: string; unitsPerSample: number; warmupMs: number[] } & LatencySummary)[];
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
}): Promise<BenchmarkReport> {
  const { connection, environment } = options;
  const iterations = options.iterations ?? 30;
  const warmups = options.warmups ?? 5;
  if (connection.getDatabaseName() !== 'fast_sql_benchmark')
    throw new Error('Use the dedicated fast_sql_benchmark database');
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) throw new Error('iterations must be 1..100');
  if (!Number.isInteger(warmups) || warmups < 0 || warmups > 20) throw new Error('warmups must be 0..20');
  if (running) throw new Error('A benchmark is already running');
  running = true;
  const deadline = performance.now() + 600000;
  let store: VectorStore | undefined;
  const rowsTable = '__fast_sql_benchmark_rows';
  const writesTable = '__fast_sql_benchmark_writes';
  const blobsTable = '__fast_sql_benchmark_blobs';
  const blob = Uint8Array.from({ length: 65536 }, (_, index) => index % 251);
  const results: ({ name: string; unitsPerSample: number; warmupMs: number[] } & ReturnType<typeof summarize>)[] = [];
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
    for (let index = 0; index < warmups + iterations; index++) {
      if (performance.now() > deadline) throw new Error('Benchmark exceeded ten minutes between samples');
      await workload.prepare?.();
      const start = performance.now();
      await workload.run();
      const elapsed = performance.now() - start;
      await workload.verify();
      (index < warmups ? warmed : measured).push(elapsed);
    }
    results.push({ name: workload.name, unitsPerSample: workload.units, warmupMs: warmed, ...summarize(measured) });
  };

  try {
    for (const table of [rowsTable, writesTable, blobsTable]) {
      await connection.execute(`DROP TABLE IF EXISTS ${table}`);
      await connection.execute(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, value BLOB)`);
    }
    const fixture = Array.from({ length: 1000 }, (_, id) => ({
      statement: `INSERT INTO ${rowsTable} VALUES (?, ?)`,
      params: [id, `value-${id}`],
    }));
    await connection.transaction((scoped) => scoped.executeBatch(fixture));
    await connection.execute(`INSERT INTO ${blobsTable} VALUES (1, ?)`, [blob]);
    store = await options.createVectorStore(connection);
    await store.deleteVectorStore();
    for (let id = 0; id < 100; id++) {
      await store.add({
        id: String(id),
        embedding: Array.from({ length: 8 }, (_, dimension) => (id + dimension + 1) / 108),
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
      name: 'rows-1000',
      units: 1000,
      run: async () => {
        latest = await connection.execute(`SELECT * FROM ${rowsTable} ORDER BY id`);
      },
      verify: async () => {
        ensure(latest?.rows.length === 1000 && latest.rows[999]?.value === 'value-999', 'Row fixture mismatch');
      },
    });
    await measure({
      name: 'blob-upload-64k',
      units: blob.length,
      run: () => connection.execute(`UPDATE ${blobsTable} SET value = ? WHERE id = 1`, [blob]),
      verify: verifyBlob,
    });
    await measure({
      name: 'blob-download-64k',
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
    let vectorCount = 0;
    await measure({
      name: 'vector-top10-100x8',
      units: 100,
      run: async () => {
        vectorCount = (await vectorStore.query({ queryEmbedding: [1, 1, 1, 1, 1, 1, 1, 1], nResults: 10 })).length;
      },
      verify: async () => {
        ensure(vectorCount === 10, 'Vector result count mismatch');
      },
    });
    return {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      environment: { ...environment },
      iterations,
      warmups,
      requestedOptions: { encrypted: false, walMode: false, performancePresets: false },
      configuration,
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
