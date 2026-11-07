import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { runCurrentBenchmark, summarize } from '../benchmarks/current';
import type { SQLValue } from '../src/definitions';
import { FastSQLVectorStore } from '../src/vector-store';
import { WebSQLConnection } from '../src/web-sql-connection';

const createVectorStore = (connection: Parameters<typeof FastSQLVectorStore.fromConnection>[0]) =>
  FastSQLVectorStore.fromConnection(connection, { store: 'baseline', embeddingDimension: 8 });

const environment = {
  sourceRevision: 'test-only',
  device: 'Bun SQLite test adapter',
  os: 'test',
  webView: 'none',
  nativeBuild: 'none',
  httpPatching: 'unknown',
  transport: 'test adapter, not native HTTP',
} satisfies Parameters<typeof runCurrentBenchmark>[0]['environment'];

test('summary uses nearest-rank percentiles and preserves raw samples', () => {
  const samples = [5, 1, 3, 2, 4];
  expect(summarize(samples)).toEqual({ samplesMs: samples, meanMs: 3, p50Ms: 3, p95Ms: 5, p99Ms: 5 });
  expect(() => summarize([])).toThrow();
});

test('all workloads validate real SQLite fixtures and clean up', async () => {
  const db = new Database(':memory:');
  const plugin = {
    async execute({ statement, params = [] }: { statement: string; params?: SQLValue[] }) {
      const bindings = params.map((value) => (typeof value === 'boolean' ? Number(value) : value));
      const rows = db.query<Record<string, SQLValue>, typeof bindings>(statement).all(...bindings);
      return { rows, rowsAffected: 0 };
    },
    async beginTransaction() {
      db.run('BEGIN');
    },
    async commitTransaction() {
      db.run('COMMIT');
    },
    async rollbackTransaction() {
      db.run('ROLLBACK');
    },
    async connect() {
      return { database: 'fast_sql_benchmark', port: 0, token: '' };
    },
    async disconnect() {},
    async getServerInfo() {
      return { port: 0, token: '' };
    },
    async getPluginVersion() {
      return { version: 'test' };
    },
    async configureWeb() {},
  };
  const connection = new WebSQLConnection('fast_sql_benchmark', plugin);
  try {
    const result = await runCurrentBenchmark({ connection, createVectorStore, environment, iterations: 1, warmups: 0 });
    expect(result.results).toHaveLength(8);
    expect(result.results.every((workload) => workload.samplesMs.length === 1)).toBe(true);
    expect(db.query("SELECT name FROM sqlite_master WHERE name LIKE '__fast_sql_benchmark_%'").all()).toEqual([]);
    await expect(
      runCurrentBenchmark({ connection: new WebSQLConnection('app', plugin), createVectorStore, environment }),
    ).rejects.toThrow('dedicated');
  } finally {
    db.close();
  }
});
