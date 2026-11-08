import { BINARY_CONTENT_TYPE, decodeBinaryFrame, encodeBinaryFrame, MAX_FRAME_BYTES } from './binary-frame';
import type { SQLValue, SQLRow, SQLResult, SQLBatchOperation, NativeSQLTransport } from './definitions';
import { IsolationLevel } from './definitions';
import type { SQLConnection } from './sql-connection';
import { assertSupportedIsolation } from './transaction-isolation';

export interface SQLTransportMetrics {
  dataRequests: number;
  requestBytes: number;
  responseBytes: number;
  encodeMs: number;
  decodeMs: number;
}

/**
 * SQL Connection class that uses HTTP protocol for efficient communication
 * with native SQLite databases, bypassing Capacitor's standard bridge.
 *
 * Inspired by capacitor-blob-writer's approach to avoid serialization overhead.
 */
export class NativeSQLConnection implements SQLConnection {
  private port: number;
  private token: string;
  private database: string;
  private baseUrl: string;
  private inTransaction = false;
  private metrics: SQLTransportMetrics = {
    dataRequests: 0,
    requestBytes: 0,
    responseBytes: 0,
    encodeMs: 0,
    decodeMs: 0,
  };

  /** Cumulative data-request payload bytes and JS codec time; excludes HTTP headers/compression. */
  getTransportMetrics(): SQLTransportMetrics {
    return { ...this.metrics };
  }

  constructor(
    database: string,
    port: number,
    token: string,
    private readonly transport: NativeSQLTransport = 'http-json',
  ) {
    this.database = database;
    this.port = port;
    this.token = token;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  private browserFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const savedFetch: unknown = Reflect.get(globalThis, 'CapacitorWebFetch');
    const browserFetch = typeof savedFetch === 'function' ? savedFetch : globalThis.fetch;
    return browserFetch.call(globalThis, input, init);
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
    return this.parseResult(await this.request('/execute', { statement, params: params ?? [] }));
  }

  /**
   * Execute multiple SQL statements in a batch for better performance
   *
   * @param operations - Array of SQL operations to execute
   * @returns Array of results for each operation
   */
  async executeBatch(operations: SQLBatchOperation[]): Promise<SQLResult[]> {
    const result = await this.request('/batch', {
      operations: operations.map((operation) => ({ statement: operation.statement, params: operation.params ?? [] })),
    });
    if (!Array.isArray(result)) throw new Error('Invalid batch response');
    return result.map((item: unknown) => this.parseResult(item));
  }

  /** Authenticated transport round trip without SQLite, for diagnostic benchmarks. */
  async echo(value: SQLValue): Promise<SQLValue> {
    const result = this.parseResult(await this.request('/echo', { statement: '', params: [value] }));
    if (result.rows.length !== 1 || !('value' in result.rows[0])) throw new Error('Invalid echo response');
    return result.rows[0].value;
  }

  private async request(
    path: string,
    payload: { statement: string; params: SQLValue[] } | { operations: { statement: string; params: SQLValue[] }[] },
  ): Promise<unknown> {
    const binary = this.transport === 'http-binary';
    const start = performance.now();
    const body = binary
      ? encodeBinaryFrame(payload)
      : new TextEncoder().encode(
          JSON.stringify(
            'params' in payload
              ? { ...payload, params: this.serializeParams(payload.params) }
              : {
                  operations: payload.operations.map((operation) => ({
                    ...operation,
                    params: this.serializeParams(operation.params),
                  })),
                },
          ),
        );
    if (body.byteLength > MAX_FRAME_BYTES) throw new Error('Request exceeds 64 MiB');
    this.metrics.encodeMs += performance.now() - start;
    this.metrics.dataRequests++;
    this.metrics.requestBytes += body.byteLength;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600000);
    try {
      const response = await this.browserFetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': binary ? BINARY_CONTENT_TYPE : 'application/json',
          Authorization: `Bearer ${this.token}`,
          'X-Database': this.database,
        },
        body: body.buffer,
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorBody = await this.readResponse(response);
        throw new Error(
          `SQL request failed (${response.status}): ${new TextDecoder().decode(errorBody).slice(0, 4096)}`,
        );
      }
      if (binary && response.headers.get('content-type')?.split(';')[0].trim() !== BINARY_CONTENT_TYPE)
        throw new Error('Server did not return binary HTTP v1');
      const bytes = await this.readResponse(response);
      this.metrics.responseBytes += bytes.byteLength;
      const decodeStart = performance.now();
      const result: unknown = binary ? decodeBinaryFrame(bytes) : JSON.parse(new TextDecoder().decode(bytes));
      this.metrics.decodeMs += performance.now() - decodeStart;
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readResponse(response: Response): Promise<Uint8Array<ArrayBuffer>> {
    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) > MAX_FRAME_BYTES) {
      await response.body?.cancel();
      throw new Error('Response exceeds 64 MiB');
    }
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > MAX_FRAME_BYTES) {
          await reader.cancel();
          throw new Error('Response exceeds 64 MiB');
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  private parseResult(result: unknown): SQLResult {
    const start = performance.now();
    if (
      !result ||
      typeof result !== 'object' ||
      !('rows' in result) ||
      !Array.isArray(result.rows) ||
      !('rowsAffected' in result) ||
      typeof result.rowsAffected !== 'number'
    )
      throw new Error('Invalid SQL response');
    const rows = result.rows.map((row: unknown) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid SQL row');
      const parsed: SQLRow = {};
      for (const [key, value] of Object.entries(row)) {
        let scalar: SQLValue;
        if (
          value === null ||
          typeof value === 'string' ||
          typeof value === 'boolean' ||
          value instanceof Uint8Array ||
          (typeof value === 'number' && Number.isFinite(value))
        )
          scalar = value;
        else if (
          value &&
          typeof value === 'object' &&
          '_type' in value &&
          value._type === 'binary' &&
          '_data' in value &&
          typeof value._data === 'string'
        )
          scalar = this.base64ToUint8Array(value._data);
        else throw new Error('Invalid SQL value');
        Object.defineProperty(parsed, key, { value: scalar, enumerable: true, writable: true, configurable: true });
      }
      return parsed;
    });
    const insertId = 'insertId' in result && typeof result.insertId === 'number' ? result.insertId : undefined;
    this.metrics.decodeMs += performance.now() - start;
    return { rows, rowsAffected: result.rowsAffected, insertId };
  }

  /**
   * Begin a transaction
   *
   * @param isolationLevel - Optional isolation level
   */
  async beginTransaction(isolationLevel?: IsolationLevel): Promise<void> {
    assertSupportedIsolation(isolationLevel);
    if (this.inTransaction) {
      throw new Error('Transaction already in progress');
    }

    const response = await this.browserFetch(`${this.baseUrl}/transaction/begin`, {
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

    const response = await this.browserFetch(`${this.baseUrl}/transaction/commit`, {
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

    const response = await this.browserFetch(`${this.baseUrl}/transaction/rollback`, {
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
