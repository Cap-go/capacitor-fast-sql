/**
 * SQL value types supported by the plugin
 */
export type SQLValue = string | number | boolean | null | Uint8Array;

/**
 * SQL row result - values indexed by column name
 */
export interface SQLRow {
  [column: string]: SQLValue;
}

/**
 * Result of a SQL query execution
 */
export interface SQLResult {
  /**
   * Rows returned by the query (for SELECT statements)
   */
  rows: SQLRow[];

  /**
   * Number of rows affected by the query (for INSERT/UPDATE/DELETE)
   */
  rowsAffected: number;

  /**
   * ID of the last inserted row (for INSERT statements with auto-increment)
   */
  insertId?: number;
}

/**
 * Batch SQL operation
 */
export interface SQLBatchOperation {
  /**
   * SQL statement to execute
   */
  statement: string;

  /**
   * Parameters to bind to the statement
   */
  params?: SQLValue[];
}

/**
 * Database connection options
 */
export interface SQLConnectionOptions {
  /**
   * Database name (file will be created in app data directory)
   */
  database: string;

  /**
   * Enable encryption (iOS/Android only)
   */
  encrypted?: boolean;

  /**
   * Encryption key (required if encrypted is true)
   */
  encryptionKey?: string;

  /**
   * Read-only mode
   */
  readOnly?: boolean;
}

/**
 * Transaction isolation levels
 */
export enum IsolationLevel {
  ReadUncommitted = 'READ UNCOMMITTED',
  ReadCommitted = 'READ COMMITTED',
  RepeatableRead = 'REPEATABLE READ',
  Serializable = 'SERIALIZABLE',
}

/**
 * Fast SQL Plugin for high-performance SQLite database access.
 *
 * This plugin uses a custom HTTP-based protocol for efficient data transfer,
 * bypassing Capacitor's standard bridge for better performance with sync operations.
 *
 * @since 0.0.1
 */
export interface CapgoCapacitorFastSqlPlugin {
  /**
   * Initialize the database connection and start the HTTP server.
   *
   * @param options - Connection options
   * @returns Connection information including server port and auth token
   * @throws Error if connection fails
   * @since 0.0.1
   * @example
   * ```typescript
   * const conn = await CapgoCapacitorFastSql.connect({ database: 'myapp' });
   * console.log('Connected on port:', conn.port);
   * ```
   */
  connect(options: SQLConnectionOptions): Promise<{
    port: number;
    token: string;
    database: string;
  }>;

  /**
   * Close database connection and stop the HTTP server.
   *
   * @param options - Database name to close
   * @returns Promise that resolves when disconnected
   * @throws Error if database is not connected or disconnect fails
   * @since 0.0.1
   * @example
   * ```typescript
   * await CapgoCapacitorFastSql.disconnect({ database: 'myapp' });
   * ```
   */
  disconnect(options: { database: string }): Promise<void>;

  /**
   * Get the HTTP server port and token for direct communication.
   *
   * @param options - Database name
   * @returns Server port and auth token
   * @throws Error if database is not connected
   * @since 0.0.1
   * @example
   * ```typescript
   * const info = await CapgoCapacitorFastSql.getServerInfo({ database: 'myapp' });
   * console.log('Server port:', info.port);
   * ```
   */
  getServerInfo(options: { database: string }): Promise<{
    port: number;
    token: string;
  }>;

  /**
   * Execute a SQL query via Capacitor bridge (for simple queries).
   * For better performance with large datasets, use the HTTP protocol directly via SQLConnection class.
   *
   * @param options - Query parameters
   * @returns Query results
   * @throws Error if execution fails
   * @since 0.0.1
   * @example
   * ```typescript
   * const result = await CapgoCapacitorFastSql.execute({
   *   database: 'myapp',
   *   statement: 'SELECT * FROM users WHERE age > ?',
   *   params: [18]
   * });
   * console.log('Rows:', result.rows);
   * ```
   */
  execute(options: {
    database: string;
    statement: string;
    params?: SQLValue[];
  }): Promise<SQLResult>;

  /**
   * Begin a database transaction.
   *
   * @param options - Transaction options
   * @returns Promise that resolves when transaction begins
   * @throws Error if transaction fails to start
   * @since 0.0.1
   * @example
   * ```typescript
   * await CapgoCapacitorFastSql.beginTransaction({ database: 'myapp' });
   * // Execute multiple operations
   * await CapgoCapacitorFastSql.commitTransaction({ database: 'myapp' });
   * ```
   */
  beginTransaction(options: {
    database: string;
    isolationLevel?: IsolationLevel;
  }): Promise<void>;

  /**
   * Commit the current transaction.
   *
   * @param options - Database name
   * @returns Promise that resolves when transaction is committed
   * @throws Error if no transaction is active or commit fails
   * @since 0.0.1
   * @example
   * ```typescript
   * await CapgoCapacitorFastSql.commitTransaction({ database: 'myapp' });
   * ```
   */
  commitTransaction(options: { database: string }): Promise<void>;

  /**
   * Rollback the current transaction.
   *
   * @param options - Database name
   * @returns Promise that resolves when transaction is rolled back
   * @throws Error if no transaction is active or rollback fails
   * @since 0.0.1
   * @example
   * ```typescript
   * try {
   *   await CapgoCapacitorFastSql.beginTransaction({ database: 'myapp' });
   *   // Operations...
   *   await CapgoCapacitorFastSql.commitTransaction({ database: 'myapp' });
   * } catch (error) {
   *   await CapgoCapacitorFastSql.rollbackTransaction({ database: 'myapp' });
   * }
   * ```
   */
  rollbackTransaction(options: { database: string }): Promise<void>;

  /**
   * Get the native Capacitor plugin version.
   *
   * @returns Promise that resolves with the plugin version
   * @throws Error if getting the version fails
   * @since 0.0.1
   * @example
   * ```typescript
   * const { version } = await CapgoCapacitorFastSql.getPluginVersion();
   * console.log('Plugin version:', version);
   * ```
   */
  getPluginVersion(): Promise<{ version: string }>;
}
