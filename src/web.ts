import { WebPlugin } from '@capacitor/core';

import type {
  CapgoCapacitorNativeSqlPlugin,
  SQLConnectionOptions,
  SQLResult,
  SQLValue,
  IsolationLevel,
} from './definitions';

/**
 * Web implementation using sql.js (SQLite compiled to WebAssembly)
 *
 * This provides a compatible API on the web platform, storing databases
 * in IndexedDB for persistence.
 */
export class CapgoCapacitorNativeSqlWeb
  extends WebPlugin
  implements CapgoCapacitorNativeSqlPlugin
{
  private databases: Map<
    string,
    { db: any; token: string; port: number }
  > = new Map();
  private sqlPromise: Promise<any> | null = null;
  private nextPort = 9000;

  constructor() {
    super();
    this.loadSqlJs();
  }

  /**
   * Load sql.js library
   */
  private async loadSqlJs(): Promise<void> {
    if (this.sqlPromise) return;

    this.sqlPromise = new Promise(async (resolve, reject) => {
      try {
        // Load sql.js from CDN
        const script = document.createElement('script');
        script.src =
          'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js';
        script.onload = async () => {
          const initSqlJs = (window as any).initSqlJs;
          const SQL = await initSqlJs({
            locateFile: (file: string) =>
              `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`,
          });
          resolve(SQL);
        };
        script.onerror = reject;
        document.head.appendChild(script);
      } catch (error) {
        reject(error);
      }
    });
  }

  async connect(
    options: SQLConnectionOptions,
  ): Promise<{ port: number; token: string; database: string }> {
    const SQL = await this.sqlPromise;

    // Check if database already exists in IndexedDB
    const savedData = await this.loadFromIndexedDB(options.database);

    let db;
    if (savedData) {
      db = new SQL.Database(savedData);
    } else {
      db = new SQL.Database();
    }

    const token = this.generateToken();
    const port = this.nextPort++;

    this.databases.set(options.database, { db, token, port });

    return {
      port,
      token,
      database: options.database,
    };
  }

  async disconnect(options: { database: string }): Promise<void> {
    const dbInfo = this.databases.get(options.database);
    if (!dbInfo) {
      throw new Error(`Database '${options.database}' is not connected`);
    }

    // Save to IndexedDB before closing
    const data = dbInfo.db.export();
    await this.saveToIndexedDB(options.database, data);

    dbInfo.db.close();
    this.databases.delete(options.database);
  }

  async getServerInfo(options: {
    database: string;
  }): Promise<{ port: number; token: string }> {
    const dbInfo = this.databases.get(options.database);
    if (!dbInfo) {
      throw new Error(`Database '${options.database}' is not connected`);
    }

    return {
      port: dbInfo.port,
      token: dbInfo.token,
    };
  }

  async execute(options: {
    database: string;
    statement: string;
    params?: SQLValue[];
  }): Promise<SQLResult> {
    const dbInfo = this.databases.get(options.database);
    if (!dbInfo) {
      throw new Error(`Database '${options.database}' is not connected`);
    }

    try {
      const stmt = dbInfo.db.prepare(options.statement);
      if (options.params) {
        stmt.bind(options.params);
      }

      const rows: any[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        rows.push(row);
      }
      stmt.free();

      // Get changes and last insert ID
      const changes = dbInfo.db.getRowsModified();
      const insertId = this.getLastInsertId(dbInfo.db);

      return {
        rows,
        rowsAffected: changes,
        insertId: insertId > 0 ? insertId : undefined,
      };
    } catch (error: any) {
      throw new Error(`SQL execution failed: ${error.message}`);
    }
  }

  async beginTransaction(options: {
    database: string;
    isolationLevel?: IsolationLevel;
  }): Promise<void> {
    await this.execute({
      database: options.database,
      statement: 'BEGIN TRANSACTION',
    });
  }

  async commitTransaction(options: { database: string }): Promise<void> {
    await this.execute({
      database: options.database,
      statement: 'COMMIT',
    });
  }

  async rollbackTransaction(options: { database: string }): Promise<void> {
    await this.execute({
      database: options.database,
      statement: 'ROLLBACK',
    });
  }

  /**
   * Generate a random authentication token
   */
  private generateToken(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Get last insert row ID
   */
  private getLastInsertId(db: any): number {
    try {
      const result = db.exec('SELECT last_insert_rowid()');
      if (result.length > 0 && result[0].values.length > 0) {
        return result[0].values[0][0];
      }
    } catch {
      // Ignore error
    }
    return -1;
  }

  /**
   * Save database to IndexedDB
   */
  private async saveToIndexedDB(
    dbName: string,
    data: Uint8Array,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('CapacitorNativeSQL', 1);

      request.onerror = () => reject(request.error);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('databases')) {
          db.createObjectStore('databases');
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['databases'], 'readwrite');
        const store = transaction.objectStore('databases');
        const putRequest = store.put(data, dbName);

        putRequest.onsuccess = () => {
          db.close();
          resolve();
        };

        putRequest.onerror = () => {
          db.close();
          reject(putRequest.error);
        };
      };
    });
  }

  /**
   * Load database from IndexedDB
   */
  private async loadFromIndexedDB(
    dbName: string,
  ): Promise<Uint8Array | null> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('CapacitorNativeSQL', 1);

      request.onerror = () => reject(request.error);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('databases')) {
          db.createObjectStore('databases');
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['databases'], 'readonly');
        const store = transaction.objectStore('databases');
        const getRequest = store.get(dbName);

        getRequest.onsuccess = () => {
          db.close();
          resolve(getRequest.result || null);
        };

        getRequest.onerror = () => {
          db.close();
          reject(getRequest.error);
        };
      };
    });
  }

  async getPluginVersion(): Promise<{ version: string }> {
    return { version: "web" };
  }
}
