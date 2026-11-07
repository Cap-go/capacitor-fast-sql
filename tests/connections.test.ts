import { expect, mock, test } from 'bun:test';

let opens = 0;
let closes = 0;
let failOpen = false;
mock.module('../src/plugin', () => ({
  CapgoCapacitorFastSql: {
    async connect(options: { database: string }) {
      opens++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (failOpen) throw new Error('open failed');
      return { database: options.database, port: 9000, token: 'token' };
    },
    async disconnect() {
      closes++;
    },
  },
}));
const { FastSQL } = await import('../src/fast-sql');

test('concurrent connects open once and share one connection', async () => {
  const [a, b] = await Promise.all([FastSQL.connect({ database: 'same' }), FastSQL.connect({ database: 'same' })]);
  expect(a).toBe(b);
  expect(opens).toBe(1);
  expect(FastSQL.isConnectionShared('same')).toBe(true);
  await expect(FastSQL.connect({ database: 'same', readOnly: true })).rejects.toThrow('different options');
  await FastSQL.disconnect('same');
});

test('failed opens can be retried', async () => {
  failOpen = true;
  await expect(FastSQL.connect({ database: 'retry' })).rejects.toThrow('open failed');
  failOpen = false;
  await FastSQL.connect({ database: 'retry' });
  await FastSQL.disconnect('retry');
});

test('disconnect waits for a pending open', async () => {
  const pending = FastSQL.connect({ database: 'pending' });
  await FastSQL.disconnect('pending');
  await pending;
  expect(FastSQL.getConnection('pending')).toBeNull();
  expect(closes).toBe(3);
});
