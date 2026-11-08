import type { SQLConnection, SQLValue } from '@capgo/capacitor-fast-sql';
import { runCurrentBenchmark } from './current';
import type { BenchmarkEnvironment, BenchmarkReport, TransportMetrics } from './current';

type Transport = 'http-json' | 'http-binary';
export interface BenchmarkAdapter {
  connection: SQLConnection;
  echo: (value: SQLValue) => Promise<SQLValue>;
  getMetrics: () => TransportMetrics;
}
export interface ComparisonReport {
  schemaVersion: number;
  environment: BenchmarkEnvironment;
  order: Transport[];
  runs: { round: number; transport: Transport; report: BenchmarkReport }[];
}

/** Alternate AB/BA order. Each transport gets the exact same fixtures and PRAGMAs. */
export async function runComparison(options: {
  createAdapter: (transport: Transport) => Promise<BenchmarkAdapter>;
  createVectorStore: Parameters<typeof runCurrentBenchmark>[0]['createVectorStore'];
  environment: BenchmarkEnvironment;
  rounds?: number;
  iterations?: number;
  warmups?: number;
  fixture?: Pick<Parameters<typeof runCurrentBenchmark>[0], 'blobSizes' | 'rowCount' | 'vectorRows' | 'dimensions'>;
  onProgress?: (message: string) => void;
}): Promise<ComparisonReport> {
  const rounds = options.rounds ?? 4;
  if (!Number.isInteger(rounds) || rounds < 2 || rounds > 8 || rounds % 2 !== 0) throw new Error('Use 2, 4, 6 or 8 comparison rounds');
  const order: Transport[] = [];
  const runs: ComparisonReport['runs'] = [];
  const adapters = {
    'http-json': await options.createAdapter('http-json'),
    'http-binary': await options.createAdapter('http-binary'),
  };
  const started = performance.now();
  let configuration: string | undefined;
  for (let round = 0; round < rounds; round++) {
    const sequence: Transport[] = round % 2 === 0 ? ['http-json', 'http-binary'] : ['http-binary', 'http-json'];
    for (const transport of sequence) {
      if (performance.now() - started > 600000) throw new Error('Comparison exceeded ten minutes between runs');
      options.onProgress?.(`Round ${round + 1}/${rounds}: ${transport}`);
      const adapter = adapters[transport];
      const report = await runCurrentBenchmark({ ...options.fixture, connection: adapter.connection,
        echo: adapter.echo, getMetrics: adapter.getMetrics, createVectorStore: options.createVectorStore,
        environment: { ...options.environment, transport }, iterations: options.iterations ?? 10, warmups: options.warmups ?? 3,
        blobSizes: options.fixture?.blobSizes ?? [0, 65536, 1048576], vectorRows: options.fixture?.vectorRows ?? 1000,
        dimensions: options.fixture?.dimensions ?? 64,
      });
      const current = JSON.stringify(report.configuration);
      if (configuration !== undefined && current !== configuration) throw new Error('SQLite configuration changed between transports');
      configuration = current;
      order.push(transport);
      runs.push({ round, transport, report });
    }
  }
  return { schemaVersion: 1, environment: { ...options.environment }, order, runs };
}
