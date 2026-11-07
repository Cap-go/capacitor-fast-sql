import { Capacitor } from '@capacitor/core';
import { FastSQL, FastSQLVectorStore, CapgoCapacitorFastSql } from '@capgo/capacitor-fast-sql';
import { runCurrentBenchmark } from './benchmarks/current';

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
      output.textContent = 'Running 8 workloads with 5 warmups and 30 measured samples each...';
      const connection = await FastSQL.connect({ database: 'fast_sql_benchmark', encrypted: false, walMode: false, performancePresets: false });
      try {
        const report = await runCurrentBenchmark({ connection, environment,
          createVectorStore: (scoped) => FastSQLVectorStore.fromConnection(scoped, { store: 'baseline', embeddingDimension: 8 }),
        });
        const version = await CapgoCapacitorFastSql.getPluginVersion();
        const json = JSON.stringify({ ...report, pluginVersion: version.version }, null, 2);
        output.textContent = json;
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `fast-sql-baseline-${Date.now()}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } finally { await FastSQL.disconnect('fast_sql_benchmark'); }
    } catch (error) {
      output.textContent = String(error);
    } finally { button.disabled = false; }
  });
}
