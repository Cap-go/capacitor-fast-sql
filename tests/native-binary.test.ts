import { afterEach, expect, test } from 'bun:test';

import { BINARY_CONTENT_TYPE, decodeBinaryFrame, encodeBinaryFrame } from '../src/binary-frame';
import { NativeSQLConnection } from '../src/native-sql-connection';

const originalFetch = globalThis.fetch;
const originalBtoa = globalThis.btoa;
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.btoa = originalBtoa;
});

test('binary client never base64-encodes BLOBs and tracks payload bytes', async () => {
  globalThis.btoa = () => {
    throw new Error('base64 must not run');
  };
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    if (!(init?.body instanceof ArrayBuffer)) throw new Error('Expected raw frame');
    expect(decodeBinaryFrame(new Uint8Array(init.body))).toEqual({
      statement: '',
      params: [new Uint8Array([0, 1, 255])],
    });
    return new Response(encodeBinaryFrame({ rows: [{ value: new Uint8Array([0, 1, 255]) }], rowsAffected: 0 }).buffer, {
      headers: { 'Content-Type': BINARY_CONTENT_TYPE },
    });
  };
  const connection = new NativeSQLConnection('test', 9000, 'token', 'http-binary');
  expect(await connection.echo(new Uint8Array([0, 1, 255]))).toEqual(new Uint8Array([0, 1, 255]));
  expect(calls).toBe(1);
  expect(connection.getTransportMetrics().dataRequests).toBe(1);
  expect(connection.getTransportMetrics().requestBytes).toBeGreaterThan(12);
  expect(connection.getTransportMetrics().responseBytes).toBeGreaterThan(12);
});

test('a failed binary write is never retried as JSON', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('failed', { status: 500 });
  };
  const connection = new NativeSQLConnection('test', 9000, 'token', 'http-binary');
  await expect(connection.run('INSERT INTO sample VALUES (1)')).rejects.toThrow('500');
  expect(calls).toBe(1);
});

test('unsupported responses fail rather than downgrade', async () => {
  globalThis.fetch = async () => Response.json({ rows: [], rowsAffected: 0 });
  const connection = new NativeSQLConnection('test', 9000, 'token', 'http-binary');
  await expect(connection.execute('SELECT 1')).rejects.toThrow('did not return binary');
});
