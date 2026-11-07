import { afterEach, expect, test } from 'bun:test';

import { IsolationLevel } from '../src/definitions';
import { NativeSQLConnection } from '../src/native-sql-connection';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('unsupported levels fail before starting native work', async () => {
  globalThis.fetch = () => {
    throw new Error('must not send a request');
  };
  const connection = new NativeSQLConnection('test', 9000, 'token');
  for (const level of [IsolationLevel.ReadUncommitted, IsolationLevel.ReadCommitted, IsolationLevel.RepeatableRead]) {
    await expect(connection.beginTransaction(level)).rejects.toThrow('Only SERIALIZABLE');
  }
});

test('default and explicit serializable transactions can begin and rollback', async () => {
  const endpoints: string[] = [];
  globalThis.fetch = async (input) => {
    endpoints.push(String(input));
    return Response.json({});
  };
  const connection = new NativeSQLConnection('test', 9000, 'token');
  await connection.beginTransaction();
  await connection.rollback();
  await connection.beginTransaction(IsolationLevel.Serializable);
  await connection.rollback();
  expect(endpoints.filter((url) => url.endsWith('/transaction/begin'))).toHaveLength(2);
});
