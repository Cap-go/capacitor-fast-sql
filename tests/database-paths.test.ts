import { expect, mock, test } from 'bun:test';

let filename: unknown;
mock.module('@sqlite.org/sqlite-wasm', () => ({
  sqlite3Worker1Promiser: {
    async v2() {
      return async (message: unknown, args: unknown) => {
        if (message === 'open') {
          if (args && typeof args === 'object' && 'filename' in args) filename = args.filename;
          return { result: { dbId: 'db', persistent: true } };
        }
        return { result: {} };
      };
    },
  },
}));
const { CapgoCapacitorFastSqlWeb } = await import('../src/web');

test.each(['', '.', '..', '../outside', 'folder/db', 'folder\\db', 'bad\0name'])(
  'rejects invalid database name %j before open',
  async (database) => {
    const plugin = new CapgoCapacitorFastSqlWeb();
    await expect(plugin.connect({ database })).rejects.toThrow('file name');
  },
);

test('database names cannot inject SQLite URI parameters', async () => {
  const plugin = new CapgoCapacitorFastSqlWeb();
  await plugin.connect({ database: 'db?vfs=memdb#fragment' });
  expect(filename).toBe('file:/capgo-fast-sql/db%3Fvfs%3Dmemdb%23fragment.sqlite3?vfs=opfs');
  await plugin.disconnect({ database: 'db?vfs=memdb#fragment' });
});
