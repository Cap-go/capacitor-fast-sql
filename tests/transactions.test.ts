import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import type { CapgoCapacitorFastSqlPlugin } from '../src/definitions';
import { ManagedSQLConnection } from '../src/managed-sql-connection';
import type { SQLConnection } from '../src/sql-connection';
import { WebSQLConnection } from '../src/web-sql-connection';

function connection() {
  const db = new Database(':memory:');
  db.run('CREATE TABLE sample (value TEXT)');
  const plugin = {
    async execute({ statement }: { statement: string }) {
      db.run(statement);
      return { rows: [], rowsAffected: 0 };
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
  };
  const delegate = new WebSQLConnection(
    'test',
    Object.assign(plugin, {
      async connect() {
        return { database: 'test', port: 0, token: '' };
      },
      async disconnect() {},
      async getServerInfo() {
        return { port: 0, token: '' };
      },
      async getPluginVersion() {
        return { version: 'test' };
      },
      async configureWeb() {},
    }) satisfies CapgoCapacitorFastSqlPlugin,
  );
  return { db, conn: new ManagedSQLConnection(delegate) };
}

test('callback owns the connection and escaped scopes expire', async () => {
  const { db, conn } = connection();
  let escaped: SQLConnection | undefined;
  try {
    await conn.transaction(async (scoped) => {
      escaped = scoped;
      await expect(conn.run("INSERT INTO sample VALUES ('outside')")).rejects.toThrow('scoped connection');
      await scoped.run("INSERT INTO sample VALUES ('inside')");
      await expect(scoped.commit()).rejects.toThrow('managed by the callback');
    });
    expect(db.query('SELECT value FROM sample').all()).toEqual([{ value: 'inside' }]);
    if (!escaped) throw new Error('Missing scope');
    await expect(escaped.run("INSERT INTO sample VALUES ('late')")).rejects.toThrow('no longer active');
  } finally {
    db.close();
  }
});

test('callback failure rolls back and releases the root connection', async () => {
  const { db, conn } = connection();
  try {
    await expect(
      conn.transaction(async (scoped) => {
        await scoped.run("INSERT INTO sample VALUES ('rolled back')");
        throw new Error('callback failed');
      }),
    ).rejects.toThrow('callback failed');
    expect(db.query('SELECT * FROM sample').all()).toEqual([]);
    await conn.run("INSERT INTO sample VALUES ('after')");
    expect(db.query('SELECT value FROM sample').all()).toEqual([{ value: 'after' }]);
  } finally {
    db.close();
  }
});

test('atomic batches roll back earlier operations while default batches preserve partial success', async () => {
  const { db, conn } = connection();
  const operations = [
    { statement: "INSERT INTO sample VALUES ('first')" },
    { statement: 'INSERT INTO missing_table VALUES (1)' },
  ];
  try {
    await expect(conn.executeBatch(operations, { atomic: true })).rejects.toThrow();
    expect(db.query('SELECT * FROM sample').all()).toEqual([]);
    await expect(conn.executeBatch(operations)).rejects.toThrow();
    expect(db.query('SELECT value FROM sample').all()).toEqual([{ value: 'first' }]);
    await conn.transaction(async (scoped) => {
      await expect(scoped.executeBatch([], { atomic: true })).rejects.toThrow('managed by the callback');
    });
  } finally {
    db.close();
  }
});
