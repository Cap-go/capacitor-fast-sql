import { expect, mock, test } from 'bun:test';

let persistent = false;
let failOpfs = false;
let opens = 0;
let closes = 0;
mock.module('@sqlite.org/sqlite-wasm', () => ({
  sqlite3Worker1Promiser: {
    async v2() {
      return async (message: unknown) => {
        if (message === 'open') {
          opens++;
          if (failOpfs) throw new Error('OPFS failed');
          return { result: { dbId: 'db', persistent } };
        }
        if (message && typeof message === 'object' && 'type' in message && message.type === 'close') closes++;
        return { result: {} };
      };
    },
  },
}));
const { CapgoCapacitorFastSqlWeb } = await import('../src/web');

test('strict persistence rejects incompatible configuration and unconfirmed opens', async () => {
  const plugin = new CapgoCapacitorFastSqlWeb();
  await expect(plugin.configureWeb({ useOpfs: false, requirePersistence: true })).rejects.toThrow('requires OPFS');
  await plugin.configureWeb({ requirePersistence: true });
  await expect(plugin.connect({ database: 'strict' })).rejects.toThrow('did not confirm');
  expect(closes).toBe(1);
});

test('strict persistence never falls back after OPFS fails', async () => {
  const plugin = new CapgoCapacitorFastSqlWeb();
  await plugin.configureWeb({ requirePersistence: true });
  failOpfs = true;
  const before = opens;
  await expect(plugin.connect({ database: 'failed' })).rejects.toThrow('OPFS failed');
  expect(opens - before).toBe(1);
  failOpfs = false;
});

test('connect and server info report confirmed persistence', async () => {
  persistent = true;
  const plugin = new CapgoCapacitorFastSqlWeb();
  const info = await plugin.connect({ database: 'persistent' });
  expect(info.persistent).toBe(true);
  expect((await plugin.getServerInfo({ database: 'persistent' })).persistent).toBe(true);
  await expect(plugin.configureWeb({ useOpfs: false })).rejects.toThrow('before opening');
  await plugin.disconnect({ database: 'persistent' });
});

test('read-only opens still reject before creating a Worker database', async () => {
  const plugin = new CapgoCapacitorFastSqlWeb();
  const before = opens;
  await expect(plugin.connect({ database: 'read-only', readOnly: true })).rejects.toThrow(
    'Read-only opens are not supported',
  );
  expect(opens).toBe(before);
});
