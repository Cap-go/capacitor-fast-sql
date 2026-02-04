import type { SQLConnectionOptions, SQLRow, SQLValue } from './definitions';
import { FastSQL } from './fast-sql';
import type { SQLConnection } from './sql-connection';

export type KeyValueValue =
  | string
  | number
  | boolean
  | null
  | Uint8Array
  | Record<string, unknown>
  | unknown[];

export interface KeyValueStoreOptions extends SQLConnectionOptions {
  store?: string;
}

type EncodedValue = {
  type: string;
  value: SQLValue | null;
};

/**
 * Key-value storage backed by the FastSQL database connection.
 *
 * This is a lightweight wrapper for mobile-focused secure storage use cases.
 */
export class KeyValueStore {
  private connection: SQLConnection;
  private store: string;
  private initialized = false;

  private constructor(connection: SQLConnection, store: string) {
    this.connection = connection;
    this.store = store;
  }

  /**
   * Open (or create) a key-value store for the given database.
   */
  static async open(options: KeyValueStoreOptions): Promise<KeyValueStore> {
    const connection = await FastSQL.connect(options);
    const store = options.store ?? 'default';
    const kv = new KeyValueStore(connection, store);
    await kv.ensureSchema();
    return kv;
  }

  /**
   * Create a key-value store from an existing SQLConnection.
   */
  static async fromConnection(connection: SQLConnection, store = 'default'): Promise<KeyValueStore> {
    const kv = new KeyValueStore(connection, store);
    await kv.ensureSchema();
    return kv;
  }

  /**
   * Store a value by key.
   */
  async set(key: string, value: KeyValueValue): Promise<void> {
    await this.ensureSchema();
    const encoded = this.encodeValue(value);
    await this.connection.run(
      'INSERT OR REPLACE INTO __kv_store (s, k, t, v) VALUES (?, ?, ?, ?)',
      [this.store, key, encoded.type, encoded.value],
    );
  }

  /**
   * Retrieve a value by key. Returns null if the key is missing.
   */
  async get(key: string): Promise<KeyValueValue | null> {
    await this.ensureSchema();
    const rows = await this.connection.query(
      'SELECT t, v FROM __kv_store WHERE s = ? AND k = ? LIMIT 1',
      [this.store, key],
    );
    if (!rows.length) {
      return null;
    }
    const row = rows[0] as SQLRow;
    const type = row.t as string;
    const value = row.v as SQLValue;
    return this.decodeValue(type, value);
  }

  /**
   * Check if a key exists.
   */
  async has(key: string): Promise<boolean> {
    await this.ensureSchema();
    const rows = await this.connection.query(
      'SELECT 1 as existsFlag FROM __kv_store WHERE s = ? AND k = ? LIMIT 1',
      [this.store, key],
    );
    return rows.length > 0;
  }

  /**
   * Remove a single key.
   */
  async remove(key: string): Promise<void> {
    await this.ensureSchema();
    await this.connection.run('DELETE FROM __kv_store WHERE s = ? AND k = ?', [
      this.store,
      key,
    ]);
  }

  /**
   * Clear all keys for the current store.
   */
  async clear(): Promise<void> {
    await this.ensureSchema();
    await this.connection.run('DELETE FROM __kv_store WHERE s = ?', [this.store]);
  }

  /**
   * List all keys for the current store.
   */
  async keys(): Promise<string[]> {
    await this.ensureSchema();
    const rows = await this.connection.query('SELECT k FROM __kv_store WHERE s = ? ORDER BY k', [
      this.store,
    ]);
    return rows.map((row) => String(row.k));
  }

  private async ensureSchema(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.connection.run(
      'CREATE TABLE IF NOT EXISTS __kv_store (s TEXT NOT NULL, k TEXT NOT NULL, t TEXT NOT NULL, v BLOB, PRIMARY KEY (s, k))',
    );
    await this.connection.run('CREATE INDEX IF NOT EXISTS __kv_store_s_idx ON __kv_store (s)');
    this.initialized = true;
  }

  private encodeValue(value: KeyValueValue): EncodedValue {
    if (value === null || value === undefined) {
      return { type: 'null', value: null };
    }
    if (value instanceof Uint8Array) {
      return { type: 'binary', value };
    }
    if (typeof value === 'string') {
      return { type: 'string', value };
    }
    if (typeof value === 'number') {
      return { type: 'number', value };
    }
    if (typeof value === 'boolean') {
      return { type: 'boolean', value: value ? 1 : 0 };
    }
    return { type: 'json', value: JSON.stringify(value) };
  }

  private decodeValue(type: string, value: SQLValue): KeyValueValue | null {
    switch (type) {
      case 'null':
        return null;
      case 'binary':
        return value instanceof Uint8Array ? value : null;
      case 'string':
        return value != null ? String(value) : '';
      case 'number':
        if (typeof value === 'number') {
          return value;
        }
        if (typeof value === 'string') {
          const parsed = Number(value);
          return Number.isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      case 'boolean':
        if (typeof value === 'number') {
          return value !== 0;
        }
        if (typeof value === 'string') {
          return value === '1' || value.toLowerCase() === 'true';
        }
        return Boolean(value);
      case 'json':
        if (typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        }
        return null;
      default:
        return value as KeyValueValue;
    }
  }
}
