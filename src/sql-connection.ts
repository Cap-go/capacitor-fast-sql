import type { SQLValue, SQLRow, SQLResult, SQLBatchOperation } from './definitions';
import { IsolationLevel } from './definitions';

/**
 * SQL Connection class that uses HTTP protocol for efficient communication
 * with native SQLite databases, bypassing Capacitor's standard bridge.
 *
 * Inspired by capacitor-blob-writer's approach to avoid serialization overhead.
 */
export class SQLConnection {
  private port: number;
  private token: string;
  private database: string;
  private baseUrl: string;
  private inTransaction = false;

  constructor(database: string, port: number, token: string) {
    this.database = database;
    this.port = port;
    this.token = token;
    this.baseUrl = `http://localhost:${port}`;
  }

  /**
   * Get the database name
   */
  getDatabaseName(): string {
    return this.database;
  }

  /**
   * Execute a SQL query via HTTP protocol for optimal performance
   *
   * @param statement - SQL statement to execute
   * @param params - Parameters to bind to the statement
   * @returns Query results
   */
  async execute(statement: string, params?: SQLValue[]): Promise<SQLResult> {
    const response = await fetch(`${this.baseUrl}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        'X-Database': this.database,
      },
      body: JSON.stringify({
        statement,
        params: params ? this.serializeParams(params) : [],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`SQL execution failed: ${error}`);
    }

    const result = await response.json();
    return this.deserializeResult(result);
  }

  /**
   * Execute multiple SQL statements in a batch for better performance
   *
   * @param operations - Array of SQL operations to execute
   * @returns Array of results for each operation
   */
  async executeBatch(operations: SQLBatchOperation[]): Promise<SQLResult[]> {
    const response = await fetch(`${this.baseUrl}/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        'X-Database': this.database,
      },
      body: JSON.stringify({
        operations: operations.map((op) => ({
          statement: op.statement,
          params: op.params ? this.serializeParams(op.params) : [],
        })),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`SQL batch execution failed: ${error}`);
    }

    const results = await response.json();
    return results.map((r: any) => this.deserializeResult(r));
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

    const response = await fetch(`${this.baseUrl}/transaction/begin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        'X-Database': this.database,
      },
      body: JSON.stringify({
        isolationLevel: isolationLevel || IsolationLevel.Serializable,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to begin transaction: ${error}`);
    }

    this.inTransaction = true;
  }

  /**
   * Commit the current transaction
   */
  async commit(): Promise<void> {
    if (!this.inTransaction) {
      throw new Error('No transaction in progress');
    }

    const response = await fetch(`${this.baseUrl}/transaction/commit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'X-Database': this.database,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to commit transaction: ${error}`);
    }

    this.inTransaction = false;
  }

  /**
   * Rollback the current transaction
   */
  async rollback(): Promise<void> {
    if (!this.inTransaction) {
      throw new Error('No transaction in progress');
    }

    const response = await fetch(`${this.baseUrl}/transaction/rollback`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'X-Database': this.database,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to rollback transaction: ${error}`);
    }

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
      await this.rollback();
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

  /**
   * Serialize parameters for transmission
   * Binary data (Uint8Array) is converted to base64 for JSON transport
   */
  private serializeParams(params: SQLValue[]): any[] {
    return params.map((param) => {
      if (param instanceof Uint8Array) {
        return {
          _type: 'binary',
          _data: this.uint8ArrayToBase64(param),
        };
      }
      return param;
    });
  }

  /**
   * Deserialize result from server
   * Base64-encoded binary data is converted back to Uint8Array
   */
  private deserializeResult(result: any): SQLResult {
    return {
      rows: result.rows.map((row: any) => {
        const deserializedRow: SQLRow = {};
        for (const [key, value] of Object.entries(row)) {
          if (value && typeof value === 'object' && (value as any)._type === 'binary') {
            deserializedRow[key] = this.base64ToUint8Array((value as any)._data);
          } else {
            deserializedRow[key] = value as SQLValue;
          }
        }
        return deserializedRow;
      }),
      rowsAffected: result.rowsAffected || 0,
      insertId: result.insertId,
    };
  }

  /**
   * Convert Uint8Array to base64 string
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert base64 string to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
