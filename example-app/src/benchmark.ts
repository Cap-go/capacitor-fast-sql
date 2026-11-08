import { Capacitor } from '@capacitor/core';
import { FastSQLVectorStore, CapgoCapacitorFastSql, NativeSQLConnection } from '@capgo/capacitor-fast-sql';
import { runCurrentBenchmark } from './benchmarks/current';
import { runComparison } from './benchmarks/comparison';

function inputValue(id: string): string {
  const input = document.getElementById(id);
  if (!(input instanceof HTMLInputElement) || !input.value.trim()) throw new Error(`Fill ${id.replace('baseline-', '')}`);
  return input.value.trim();
}

const button = document.getElementById('run-baseline');
const output = document.getElementById('baseline-output');
if (button instanceof HTMLButtonElement && output) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      if (!Capacitor.isNativePlatform()) throw new Error('Run this baseline inside the native example app');
      const patching = document.getElementById('baseline-patching');
      const httpPatching = patching instanceof HTMLSelectElement && (patching.value === 'enabled' || patching.value === 'disabled') ? patching.value : 'unknown';
      const environment = {
        sourceRevision: inputValue('baseline-revision'), device: inputValue('baseline-device'),
        os: inputValue('baseline-os'), nativeBuild: inputValue('baseline-build'), webView: navigator.userAgent,
        httpPatching, transport: `${Capacitor.getPlatform()} current HTTP JSON via global fetch`,
      } satisfies Parameters<typeof runCurrentBenchmark>[0]['environment'];
      const compare = document.getElementById('compare-transports');
      const compareTransports = compare instanceof HTMLInputElement && compare.checked;
      environment.transport = compareTransports ? `${Capacitor.getPlatform()} JSON/binary HTTP comparison` : `${Capacitor.getPlatform()} JSON browser HTTP`;
      output.textContent = compareTransports ? 'Starting paired JSON/binary comparison...' : 'Running current HTTP baseline...';
      const info = await CapgoCapacitorFastSql.connect({ database: 'fast_sql_benchmark', encrypted: false, walMode: false, performancePresets: false });
      try {
        const createVectorStore = (scoped: Parameters<typeof FastSQLVectorStore.fromConnection>[0]) => FastSQLVectorStore.fromConnection(scoped, { store: 'baseline', embeddingDimension: compareTransports ? 64 : 8 });
        let report;
        if (compareTransports) {
          if (info.binaryProtocolVersion !== 1) throw new Error('Native plugin does not support binary HTTP v1; rebuild and sync the example');
          report = await runComparison({ environment, createVectorStore,
            createAdapter: async (transport) => {
              const connection = new NativeSQLConnection(info.database, info.port, info.token, transport);
              return { connection, echo: (value) => connection.echo(value), getMetrics: () => connection.getTransportMetrics() };
            },
            onProgress: (message) => { output.textContent = message; },
          });
        } else {
          const connection = new NativeSQLConnection(info.database, info.port, info.token);
          report = await runCurrentBenchmark({ connection, environment, createVectorStore, getMetrics: () => connection.getTransportMetrics() });
        }
        const version = await CapgoCapacitorFastSql.getPluginVersion();
        const json = JSON.stringify({ ...report, pluginVersion: version.version }, null, 2);
        output.textContent = json;
        const exportInput = document.getElementById('benchmark-export');
        if (exportInput instanceof HTMLInputElement && exportInput.value.trim()) {
          const endpoint = new URL(exportInput.value.trim());
          if (endpoint.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(endpoint.hostname)) throw new Error('Use a local HTTP collector');
          try {
            const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json });
            if (!response.ok) throw new Error(`Collector rejected report (${response.status})`);
          } catch (error) {
            output.textContent = `Report complete. Local export failed: ${String(error)}\n\n${json}`;
          }
        }
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `fast-sql-baseline-${Date.now()}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } finally { await CapgoCapacitorFastSql.disconnect({ database: 'fast_sql_benchmark' }); }
    } catch (error) {
      output.textContent = String(error);
    } finally { button.disabled = false; }
  });
}
