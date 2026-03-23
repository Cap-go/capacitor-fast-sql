import type { SQLValue, SQLRow, SQLResult, SQLBatchOperation, IsolationLevel } from './definitions';

/**
 * Common interface for SQL database connections.
 * Implemented by NativeSQLConnection (HTTP protocol) and WebSQLConnection (direct plugin calls).
 */
export interface SQLConnection {
  getDatabaseName(): string;
  execute(statement: string, params?: SQLValue[]): Promise<SQLResult>;
  executeBatch(operations: SQLBatchOperation[]): Promise<SQLResult[]>;
  beginTransaction(isolationLevel?: IsolationLevel): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  transaction<T>(callback: (conn: SQLConnection) => Promise<T>, isolationLevel?: IsolationLevel): Promise<T>;
  query(statement: string, params?: SQLValue[]): Promise<SQLRow[]>;
  run(statement: string, params?: SQLValue[]): Promise<{ rowsAffected: number; insertId?: number }>;
}
