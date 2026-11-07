import type { IsolationLevel, SQLBatchOperation, SQLBatchOptions, SQLResult, SQLRow, SQLValue } from './definitions';
import type { SQLConnection } from './sql-connection';

/** Serializes high-level callers and gives transaction callbacks a scoped connection. */
export class ManagedSQLConnection implements SQLConnection {
  private pending: Promise<void> = Promise.resolve();
  private exclusive = false;
  private closed = false;

  constructor(
    private readonly delegate: SQLConnection,
    private readonly options: {
      scoped?: boolean;
      retain?: () => void;
      release?: () => Promise<unknown>;
    } = {},
  ) {}

  getDatabaseName(): string {
    return this.delegate.getDatabaseName();
  }

  private checkAvailable(): void {
    if (this.closed) throw new Error('Transaction connection is no longer active');
    if (this.exclusive) throw new Error('Use the scoped connection passed to the transaction callback');
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async execute(statement: string, params?: SQLValue[]): Promise<SQLResult> {
    this.checkAvailable();
    return this.enqueue(() => this.delegate.execute(statement, params));
  }

  async executeBatch(operations: SQLBatchOperation[], options?: SQLBatchOptions): Promise<SQLResult[]> {
    if (options?.atomic) {
      return this.transaction((connection) => connection.executeBatch(operations));
    }
    this.checkAvailable();
    return this.enqueue(() => this.delegate.executeBatch(operations));
  }

  async query(statement: string, params?: SQLValue[]): Promise<SQLRow[]> {
    return (await this.execute(statement, params)).rows;
  }

  async run(statement: string, params?: SQLValue[]): Promise<{ rowsAffected: number; insertId?: number }> {
    const result = await this.execute(statement, params);
    return { rowsAffected: result.rowsAffected, insertId: result.insertId };
  }

  private checkManualTransaction(): void {
    this.checkAvailable();
    if (this.options.scoped) throw new Error('Transaction boundaries are managed by the callback');
  }

  async beginTransaction(isolationLevel?: IsolationLevel): Promise<void> {
    this.checkManualTransaction();
    return this.enqueue(() => this.delegate.beginTransaction(isolationLevel));
  }

  async commit(): Promise<void> {
    this.checkManualTransaction();
    return this.enqueue(() => this.delegate.commit());
  }

  async rollback(): Promise<void> {
    this.checkManualTransaction();
    return this.enqueue(() => this.delegate.rollback());
  }

  async transaction<T>(
    callback: (connection: SQLConnection) => Promise<T>,
    isolationLevel?: IsolationLevel,
  ): Promise<T> {
    this.checkManualTransaction();
    this.options.retain?.();
    this.exclusive = true;
    try {
      return await this.enqueue(async () => {
        await this.delegate.beginTransaction(isolationLevel);
        const scoped = new ManagedSQLConnection(this.delegate, { scoped: true });
        try {
          const result = await callback(scoped);
          scoped.closed = true;
          await scoped.pending;
          await this.delegate.commit();
          return result;
        } catch (error) {
          scoped.closed = true;
          await scoped.pending;
          try {
            await this.delegate.rollback();
          } catch (rollbackError) {
            throw Object.assign(new Error(`Transaction failed; rollback also failed: ${String(rollbackError)}`), {
              cause: error,
            });
          }
          throw error;
        }
      });
    } finally {
      this.exclusive = false;
      await this.options.release?.();
    }
  }
}
