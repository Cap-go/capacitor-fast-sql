import { afterEach, expect, test } from 'bun:test';

import { NativeSQLConnection } from '../src/native-sql-connection';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  Reflect.deleteProperty(globalThis, 'CapacitorWebFetch');
});

test('uses the browser fetch saved by Capacitor instead of patched fetch', async () => {
  globalThis.fetch = () => {
    throw new Error('patched fetch must not be called');
  };
  const calls: string[] = [];
  Reflect.set(globalThis, 'CapacitorWebFetch', async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Response.json({ rows: [{ n: 1 }], rowsAffected: 0 });
  });
  const connection = new NativeSQLConnection('test', 9001, 'token');
  expect(await connection.query('SELECT 1 AS n')).toEqual([{ n: 1 }]);
  expect(calls).toEqual(['http://127.0.0.1:9001/execute']);
});

test('falls back to standard fetch when Capacitor has not patched it', async () => {
  Reflect.deleteProperty(globalThis, 'CapacitorWebFetch');
  globalThis.fetch = async () => Response.json([]);
  const connection = new NativeSQLConnection('test', 9001, 'token');
  expect(await connection.executeBatch([])).toEqual([]);
});
