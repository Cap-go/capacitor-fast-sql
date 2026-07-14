import { WebPlugin } from '@capacitor/core';
import { sqlite3Worker1Promiser } from '@sqlite.org/sqlite-wasm';
import type { Worker1Promiser } from '@sqlite.org/sqlite-wasm';

import type {
  CapgoCapacitorFastSqlPlugin,
  SQLConnectionOptions,
  SQLResult,
  SQLValue,
  IsolationLevel,
  WebConfig,
} from './definitions';

type DbInfo = {
  dbId: string;
  token: string;
  port: number;
  persistent: boolean;
};

type ExecMetaResult = {
  changeCount?: number | bigint;
  lastInsertRowId?: number | bigint;
};

/**
 * Web implementation using the official SQLite Wasm build with OPFS persistence.
 *
 * Databases are stored in the Origin Private File System when available (requires
 * Cross-Origin Isolation: COOP/COEP). No full-database copy is kept in RAM or
 * IndexedDB — SQLite reads/writes the OPFS file directly from a worker.
 */
export class CapgoCapacitorFastSqlWeb extends WebPlugin implements CapgoCapacitorFastSqlPlugin {
  private databases: Map<string, DbInfo> = new Map();
  private promiserPromise: Promise<Worker1Promiser> | null = null;
  private nextPort = 9000;
  private webConfig: WebConfig = {};

  /**
   * Configure web-specific options (no-op on native platforms).
   * Must be called before connect() when overriding the default worker.
   */
  async configureWeb(config: WebConfig): Promise<void> {
    this.webConfig = config;
    this.promiserPromise = null;
  }

  private getPromiser(): Promise<Worker1Promiser> {
    if (!this.promiserPromise) {
      const config = this.webConfig.worker !== undefined ? { worker: this.webConfig.worker } : undefined;
      this.promiserPromise = sqlite3Worker1Promiser.v2(config);
    }
    return this.promiserPromise;
  }

  private dbPath(database: string): string {
    return `/capgo-fast-sql/${database}.sqlite3`;
  }

  async connect(options: SQLConnectionOptions): Promise<{ port: number; token: string; database: string }> {
    if (this.databases.has(options.database)) {
      const existing = this.databases.get(options.database)!;
      return {
        port: existing.port,
        token: existing.token,
        database: options.database,
      };
    }

    const promiser = await this.getPromiser();
    const path = this.dbPath(options.database);
    const useOpfs = this.webConfig.useOpfs !== false;

    let openResult;
    if (useOpfs) {
      try {
        openResult = await promiser('open', {
          filename: `file:${path}?vfs=opfs`,
        });
      } catch (opfsError) {
        console.warn(
          '[CapgoCapacitorFastSql] OPFS unavailable; web database will not persist across reloads. ' +
            'Serve with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.',
          opfsError,
        );
        openResult = await promiser('open', { filename: path });
      }
    } else {
      openResult = await promiser('open', { filename: path });
    }

    const dbId = openResult.result.dbId;
    const persistent = Boolean(openResult.result.persistent);
    if (!dbId) {
      throw new Error('Failed to open SQLite Wasm database: missing dbId');
    }

    await this.applyPerformanceConfig(promiser, dbId, options);

    const token = this.generateToken();
    const port = this.nextPort++;
    this.databases.set(options.database, { dbId, token, port, persistent });

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

    const promiser = await this.getPromiser();
    // OPFS-backed DBs persist automatically; no export/IndexedDB write needed.
    await promiser({ type: 'close', dbId: dbInfo.dbId, args: {} });
    this.databases.delete(options.database);
  }

  async getServerInfo(options: { database: string }): Promise<{ port: number; token: string }> {
    const dbInfo = this.databases.get(options.database);
    if (!dbInfo) {
      throw new Error(`Database '${options.database}' is not connected`);
    }

    return {
      port: dbInfo.port,
      token: dbInfo.token,
    };
  }

  async execute(options: { database: string; statement: string; params?: SQLValue[] }): Promise<SQLResult> {
    const dbInfo = this.databases.get(options.database);
    if (!dbInfo) {
      throw new Error(`Database '${options.database}' is not connected`);
    }

    try {
      const promiser = await this.getPromiser();
      const rows: Record<string, SQLValue>[] = [];

      // countChanges / lastInsertRowId are supported by Worker1 at runtime but
      // omitted from the published Worker1ExecArgs typings.
      const result = await promiser({
        type: 'exec',
        dbId: dbInfo.dbId,
        args: {
          sql: options.statement,
          bind: options.params,
          rowMode: 'object',
          countChanges: true,
          lastInsertRowId: true,
          callback: (msg: { rowNumber: number | null; row?: unknown }) => {
            if (msg.rowNumber != null && msg.row && typeof msg.row === 'object' && !Array.isArray(msg.row)) {
              rows.push(msg.row as Record<string, SQLValue>);
            }
          },
        } as never,
      });

      const execResult = result.result as ExecMetaResult;
      const rowsAffected = Number(execResult.changeCount ?? 0);
      const rawInsertId = execResult.lastInsertRowId;
      const insertId = rawInsertId !== undefined && rawInsertId !== null ? Number(rawInsertId) : undefined;

      return {
        rows,
        rowsAffected,
        insertId: insertId !== undefined && insertId > 0 ? insertId : undefined,
      };
    } catch (error: any) {
      const message = error?.result?.message ?? error?.message ?? String(error);
      throw new Error(`SQL execution failed: ${message}`);
    }
  }

  async beginTransaction(options: { database: string; isolationLevel?: IsolationLevel }): Promise<void> {
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

  private async applyPerformanceConfig(
    promiser: Worker1Promiser,
    dbId: string,
    options: SQLConnectionOptions,
  ): Promise<void> {
    await promiser({ type: 'exec', dbId, args: { sql: 'PRAGMA foreign_keys = ON' } });

    if (options.walMode) {
      await promiser({ type: 'exec', dbId, args: { sql: 'PRAGMA journal_mode = WAL' } });
    }

    if (options.performancePresets) {
      await promiser({ type: 'exec', dbId, args: { sql: 'PRAGMA synchronous = NORMAL' } });
      await promiser({ type: 'exec', dbId, args: { sql: 'PRAGMA busy_timeout = 5000' } });
      await promiser({ type: 'exec', dbId, args: { sql: 'PRAGMA cache_size = -2000' } });
    }
  }

  private generateToken(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async getPluginVersion(): Promise<{ version: string }> {
    return { version: 'web' };
  }
}
