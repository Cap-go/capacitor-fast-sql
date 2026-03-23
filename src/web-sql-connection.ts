import type {
  CapgoCapacitorFastSqlPlugin,
  SQLValue,
  SQLRow,
  SQLResult,
  SQLBatchOperation,
  IsolationLevel,
} from './definitions';
import type { SQLConnection } from './sql-connection';

/**
 * Web implementation of SQLConnection that calls the Capacitor plugin directly,
 * avoiding HTTP network requests which are not available on the web platform.
 */
export class WebSQLConnection implements SQLConnection {
  private database: string;
  private plugin: CapgoCapacitorFastSqlPlugin;
  private inTransaction = false;

  constructor(database: string, plugin: CapgoCapacitorFastSqlPlugin) {
    this.database = database;
    this.plugin = plugin;
  }

  /**
   * Get the database name
   */
  getDatabaseName(): string {
    return this.database;
  }

  /**
   * Execute a SQL query via the Capacitor plugin
   *
   * @param statement - SQL statement to execute
   * @param params - Parameters to bind to the statement
   * @returns Query results
   */
  async execute(statement: string, params?: SQLValue[]): Promise<SQLResult> {
    return this.plugin.execute({ database: this.database, statement, params });
  }

  /**
   * Execute multiple SQL statements in a batch, sequentially
   *
   * @param operations - Array of SQL operations to execute
   * @returns Array of results for each operation
   */
  async executeBatch(operations: SQLBatchOperation[]): Promise<SQLResult[]> {
    const results: SQLResult[] = [];
    for (const op of operations) {
      results.push(await this.execute(op.statement, op.params));
    }
    return results;
  }

  /**
   * Begin a transaction
   *
   * @param isolationLevel - Optional isolation level
   */
  async beginTransaction(isolationLevel?: IsolationLevel): Promise<void> {
    if (this.inTransaction) {
      throw new Error('Transaction already in progress');
    }

    await this.plugin.beginTransaction({ database: this.database, isolationLevel });
    this.inTransaction = true;
  }

  /**
   * Commit the current transaction
   */
  async commit(): Promise<void> {
    if (!this.inTransaction) {
      throw new Error('No transaction in progress');
    }

    await this.plugin.commitTransaction({ database: this.database });
    this.inTransaction = false;
  }

  /**
   * Rollback the current transaction
   */
  async rollback(): Promise<void> {
    if (!this.inTransaction) {
      throw new Error('No transaction in progress');
    }

    await this.plugin.rollbackTransaction({ database: this.database });
    this.inTransaction = false;
  }

  /**
   * Execute operations within a transaction automatically
   *
   * @param callback - Function containing operations to execute
   * @param isolationLevel - Optional isolation level
   */
  async transaction<T>(callback: (conn: SQLConnection) => Promise<T>, isolationLevel?: IsolationLevel): Promise<T> {
    await this.beginTransaction(isolationLevel);
    try {
      const result = await callback(this);
      await this.commit();
      return result;
    } catch (error) {
      if (this.inTransaction) {
        try {
          await this.rollback();
        } catch (rollbackError) {
          throw new Error(
            `Transaction failed and rollback failed: ${String(rollbackError)}; original error: ${String(error)}`,
          );
        }
      }
      throw error;
    }
  }

  /**
   * Query helper for SELECT statements
   *
   * @param statement - SELECT statement
   * @param params - Query parameters
   * @returns Array of rows
   */
  async query(statement: string, params?: SQLValue[]): Promise<SQLRow[]> {
    const result = await this.execute(statement, params);
    return result.rows;
  }

  /**
   * Execute helper for INSERT/UPDATE/DELETE statements
   *
   * @param statement - SQL statement
   * @param params - Statement parameters
   * @returns Number of affected rows and insert ID if applicable
   */
  async run(statement: string, params?: SQLValue[]): Promise<{ rowsAffected: number; insertId?: number }> {
    const result = await this.execute(statement, params);
    return {
      rowsAffected: result.rowsAffected,
      insertId: result.insertId,
    };
  }
}
