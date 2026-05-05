import type { SQLConnectionOptions, SQLRow, SQLValue } from './definitions';
import { FastSQL } from './fast-sql';
import type { SQLConnection } from './sql-connection';

const DEFAULT_STORE = 'default';
const VECTOR_TABLE = '__fast_sql_vector_store';
const VECTOR_META_TABLE = '__fast_sql_vector_store_meta';

export type VectorMetadata = Record<string, unknown>;

export interface VectorEmbeddings {
  load?: () => Promise<unknown> | unknown;
  unload?: () => Promise<unknown> | unknown;
  embed: (text: string) => Promise<number[]> | number[];
}

export interface VectorStoreGetResult {
  id: string;
  document: string;
  embedding: number[];
  metadata?: VectorMetadata;
}

export interface VectorStoreQueryResult extends VectorStoreGetResult {
  similarity: number;
}

export interface VectorStoreAddOptions {
  id?: string;
  document?: string;
  embedding?: number[];
  metadata?: VectorMetadata | null;
}

export interface VectorStoreUpdateOptions {
  id: string;
  document?: string;
  embedding?: number[];
  metadata?: VectorMetadata | null;
}

export interface VectorStoreDeleteOptions {
  predicate: (value: VectorStoreGetResult) => boolean;
}

export interface VectorStoreQueryOptions {
  queryText?: string;
  queryEmbedding?: number[];
  nResults?: number;
  predicate?: (value: VectorStoreQueryResult) => boolean;
}

export interface VectorStoreConnectionOptions {
  /**
   * Logical vector store name inside the database. Use different names to keep
   * multiple RAG collections in the same SQLite database.
   */
  store?: string;

  /**
   * Optional embeddings provider. Required when adding or querying by text.
   */
  embeddings?: VectorEmbeddings;

  /**
   * Optional embedding dimension. Supplying it avoids probing the embeddings
   * model on load and allows precomputed-embedding-only stores.
   */
  embeddingDimension?: number;
}

export interface VectorStoreOptions extends SQLConnectionOptions, VectorStoreConnectionOptions {}

export interface VectorStore {
  load(): Promise<this>;
  unload(): Promise<void>;
  add(params: VectorStoreAddOptions): Promise<string>;
  update(params: VectorStoreUpdateOptions): Promise<void>;
  delete(params: VectorStoreDeleteOptions): Promise<void>;
  query(params: VectorStoreQueryOptions): Promise<VectorStoreQueryResult[]>;
  deleteVectorStore(): Promise<void>;
}

/**
 * SQLite-backed VectorStore for local RAG usage.
 *
 * The helper is optional and dependency-free: pass your own embeddings provider,
 * or use precomputed embeddings with `embeddingDimension`. Multiple stores can
 * share one database by choosing different `store` names.
 */
export class FastSQLVectorStore implements VectorStore {
  private static readonly connectionRefs = new Map<string, number>();
  private static readonly ownedConnections = new Set<string>();

  private readonly connection: SQLConnection;
  private readonly store: string;
  private readonly embeddings?: VectorEmbeddings;
  private readonly configuredEmbeddingDim?: number;
  private embeddingDim?: number;
  private initialized = false;
  private ownsConnection = false;
  private shouldDisconnectConnection = false;
  private closed = false;

  private constructor(connection: SQLConnection, options: VectorStoreConnectionOptions = {}) {
    this.connection = connection;
    this.store = options.store ?? DEFAULT_STORE;
    this.embeddings = options.embeddings;
    this.configuredEmbeddingDim = options.embeddingDimension;
    this.embeddingDim = options.embeddingDimension;
  }

  private static retainConnection(database: string): void {
    this.connectionRefs.set(database, (this.connectionRefs.get(database) ?? 0) + 1);
  }

  private static releaseConnection(database: string): boolean {
    const refs = this.connectionRefs.get(database) ?? 0;
    if (refs > 1) {
      this.connectionRefs.set(database, refs - 1);
      return false;
    }

    this.connectionRefs.delete(database);
    this.ownedConnections.delete(database);
    return true;
  }

  /**
   * Open a vector store from database connection options.
   */
  static async open(options: VectorStoreOptions): Promise<FastSQLVectorStore> {
    const existing = FastSQL.getConnection(options.database);
    const ownsExistingVectorConnection = existing && FastSQLVectorStore.connectionRefs.has(options.database);
    const connection = ownsExistingVectorConnection ? existing : await FastSQL.connect(options);
    const vectorStore = new FastSQLVectorStore(connection, options);
    vectorStore.ownsConnection = true;
    vectorStore.shouldDisconnectConnection = !existing || FastSQLVectorStore.ownedConnections.has(options.database);
    FastSQLVectorStore.retainConnection(connection.getDatabaseName());
    FastSQL.retainConnection(connection.getDatabaseName());
    if (vectorStore.shouldDisconnectConnection) {
      FastSQLVectorStore.ownedConnections.add(connection.getDatabaseName());
    }

    try {
      await vectorStore.load();
      return vectorStore;
    } catch (error) {
      await vectorStore.unload();
      throw error;
    }
  }

  /**
   * Create a vector store from an existing SQL connection.
   * The caller keeps ownership of the connection.
   */
  static async fromConnection(
    connection: SQLConnection,
    options: VectorStoreConnectionOptions = {},
  ): Promise<FastSQLVectorStore> {
    const vectorStore = new FastSQLVectorStore(connection, options);
    await vectorStore.load();
    return vectorStore;
  }

  getStoreName(): string {
    return this.store;
  }

  getDatabaseName(): string {
    return this.connection.getDatabaseName();
  }

  async load(): Promise<this> {
    this.assertOpen();
    if (this.initialized) {
      return this;
    }

    await this.embeddings?.load?.();
    await this.ensureSchema();
    await this.ensureStoreDimension();
    this.initialized = true;
    return this;
  }

  async unload(): Promise<void> {
    if (this.closed) {
      return;
    }

    await this.embeddings?.unload?.();
    if (this.ownsConnection) {
      const database = this.connection.getDatabaseName();
      const releasedLastVectorStore = FastSQLVectorStore.releaseConnection(database);
      const closedFromPendingDisconnect = await FastSQL.releaseConnection(database);
      if (
        releasedLastVectorStore &&
        this.shouldDisconnectConnection &&
        !FastSQL.isConnectionShared(database) &&
        !closedFromPendingDisconnect
      ) {
        await FastSQL.disconnect(database);
      }
    }
    this.initialized = false;
    this.closed = true;
  }

  async close(): Promise<void> {
    await this.unload();
  }

  async add(params: VectorStoreAddOptions): Promise<string> {
    await this.ensureReady();
    const { id = this.createId(), document, embedding, metadata } = params;

    if (document === undefined && embedding === undefined) {
      throw new Error('document and embedding cannot both be undefined');
    }

    const existing = await this.connection.query(`SELECT 1 FROM ${VECTOR_TABLE} WHERE store = ? AND id = ? LIMIT 1`, [
      this.store,
      id,
    ]);
    if (existing.length > 0) {
      throw new Error(`id already exists: ${id}`);
    }

    const resolvedEmbedding = embedding ?? (await this.embedDocument(document));
    await this.ensureEmbeddingDimension(resolvedEmbedding);
    const now = Date.now();

    await this.connection.run(
      `INSERT INTO ${VECTOR_TABLE} (store, id, document, embedding, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        this.store,
        id,
        document ?? '',
        this.encodeEmbedding(resolvedEmbedding),
        this.encodeMetadata(metadata),
        now,
        now,
      ],
    );

    return id;
  }

  async update(params: VectorStoreUpdateOptions): Promise<void> {
    await this.ensureReady();
    const rows = await this.connection.query(
      `SELECT id, document, embedding, metadata FROM ${VECTOR_TABLE} WHERE store = ? AND id = ? LIMIT 1`,
      [this.store, params.id],
    );

    if (rows.length === 0) {
      throw new Error(`id not found: ${params.id}`);
    }

    const current = this.rowToGetResult(rows[0]);
    const document = params.document ?? current.document;
    const embedding =
      params.embedding ??
      (params.document !== undefined ? await this.embedDocument(params.document) : current.embedding);
    const metadata = params.metadata === undefined ? current.metadata : params.metadata;

    await this.ensureEmbeddingDimension(embedding);
    await this.connection.run(
      `UPDATE ${VECTOR_TABLE}
       SET document = ?, embedding = ?, metadata = ?, updated_at = ?
       WHERE store = ? AND id = ?`,
      [document, this.encodeEmbedding(embedding), this.encodeMetadata(metadata), Date.now(), this.store, params.id],
    );
  }

  async delete(params: VectorStoreDeleteOptions): Promise<void> {
    await this.ensureReady();
    const rows = await this.getStoreRows();
    const ids = rows
      .map((row) => this.rowToGetResult(row))
      .filter(params.predicate)
      .map((row) => row.id);

    for (const id of ids) {
      await this.connection.run(`DELETE FROM ${VECTOR_TABLE} WHERE store = ? AND id = ?`, [this.store, id]);
    }
  }

  async query(params: VectorStoreQueryOptions): Promise<VectorStoreQueryResult[]> {
    await this.ensureReady();
    const { queryText, queryEmbedding, nResults, predicate } = params;

    if (queryText === undefined && queryEmbedding === undefined) {
      throw new Error('queryText and queryEmbedding cannot both be undefined');
    }
    if (nResults !== undefined && nResults < 0) {
      throw new Error('nResults cannot be negative');
    }

    const searchEmbedding = queryEmbedding ?? (await this.embedDocument(queryText));
    await this.ensureEmbeddingDimension(searchEmbedding);

    const results = (await this.getStoreRows())
      .map((row) => {
        const item = this.rowToGetResult(row);
        return {
          ...item,
          similarity: this.cosineSimilarity(item.embedding, searchEmbedding),
        };
      })
      .filter(predicate ?? (() => true))
      .sort((a, b) => b.similarity - a.similarity);

    return nResults === undefined ? results : results.slice(0, nResults);
  }

  /**
   * Delete only this logical vector store. Other stores in the same database stay intact.
   */
  async deleteVectorStore(): Promise<void> {
    await this.ensureReady();
    await this.connection.run(`DELETE FROM ${VECTOR_TABLE} WHERE store = ?`, [this.store]);
    await this.connection.run(`DELETE FROM ${VECTOR_META_TABLE} WHERE store = ?`, [this.store]);
    this.embeddingDim = this.configuredEmbeddingDim;
    if (this.embeddingDim !== undefined) {
      await this.saveEmbeddingDimension();
    }
  }

  private async ensureReady(): Promise<void> {
    this.assertOpen();
    if (!this.initialized) {
      await this.load();
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Vector store is closed');
    }
  }

  private async ensureSchema(): Promise<void> {
    await this.connection.run(
      `CREATE TABLE IF NOT EXISTS ${VECTOR_TABLE} (
        store TEXT NOT NULL,
        id TEXT NOT NULL,
        document TEXT NOT NULL,
        embedding BLOB NOT NULL,
        metadata TEXT DEFAULT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (store, id)
      )`,
    );
    await this.connection.run(`CREATE INDEX IF NOT EXISTS ${VECTOR_TABLE}_store_idx ON ${VECTOR_TABLE} (store)`);
    await this.connection.run(
      `CREATE TABLE IF NOT EXISTS ${VECTOR_META_TABLE} (
        store TEXT PRIMARY KEY,
        embedding_dim INTEGER NOT NULL
      )`,
    );
  }

  private async ensureStoreDimension(): Promise<void> {
    const rows = await this.connection.query(`SELECT embedding_dim FROM ${VECTOR_META_TABLE} WHERE store = ? LIMIT 1`, [
      this.store,
    ]);
    const storedDim = this.parseStoredDimension(rows[0]);

    if (storedDim !== undefined && this.embeddingDim !== undefined && storedDim !== this.embeddingDim) {
      throw new Error(`embedding dimension ${this.embeddingDim} does not match existing store dimension ${storedDim}`);
    }

    if (this.embeddingDim === undefined) {
      this.embeddingDim = storedDim ?? (this.embeddings ? (await this.embedDocument('dummy')).length : undefined);
    }

    if (this.embeddingDim !== undefined) {
      await this.saveEmbeddingDimension();
    }
  }

  private parseStoredDimension(row?: SQLRow): number | undefined {
    if (!row) {
      return undefined;
    }

    const value = row.embedding_dim;
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private async saveEmbeddingDimension(): Promise<void> {
    if (this.embeddingDim === undefined) {
      return;
    }

    await this.connection.run(`INSERT OR REPLACE INTO ${VECTOR_META_TABLE} (store, embedding_dim) VALUES (?, ?)`, [
      this.store,
      this.embeddingDim,
    ]);
  }

  private async ensureEmbeddingDimension(embedding: number[]): Promise<void> {
    this.validateEmbedding(embedding);

    if (this.embeddingDim === undefined) {
      this.embeddingDim = embedding.length;
      await this.saveEmbeddingDimension();
      return;
    }

    if (embedding.length !== this.embeddingDim) {
      throw new Error(
        `embedding dimension ${embedding.length} does not match vector store dimension ${this.embeddingDim}`,
      );
    }
  }

  private async embedDocument(document: string | undefined): Promise<number[]> {
    if (document === undefined) {
      throw new Error('document is required when embedding is not provided');
    }
    if (!this.embeddings) {
      throw new Error('embeddings provider is required for text operations');
    }

    return this.embeddings.embed(document);
  }

  private validateEmbedding(embedding: number[]): void {
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('embedding must be a non-empty number array');
    }

    for (const value of embedding) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('embedding values must be finite numbers');
      }
    }
  }

  private async getStoreRows(): Promise<SQLRow[]> {
    return this.connection.query(
      `SELECT id, document, embedding, metadata FROM ${VECTOR_TABLE} WHERE store = ? ORDER BY updated_at DESC`,
      [this.store],
    );
  }

  private rowToGetResult(row: SQLRow): VectorStoreGetResult {
    const result: VectorStoreGetResult = {
      id: String(row.id),
      document: row.document === null || row.document === undefined ? '' : String(row.document),
      embedding: this.decodeEmbedding(row.embedding),
    };

    const metadata = this.decodeMetadata(row.metadata);
    if (metadata !== undefined) {
      result.metadata = metadata;
    }

    return result;
  }

  private encodeEmbedding(embedding: number[]): Uint8Array {
    const bytes = new Uint8Array(embedding.length * Float32Array.BYTES_PER_ELEMENT);
    const view = new DataView(bytes.buffer);
    embedding.forEach((value, index) => view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, value, true));
    return bytes;
  }

  private decodeEmbedding(value: SQLValue | undefined): number[] {
    if (!(value instanceof Uint8Array)) {
      throw new Error('stored embedding is not binary data');
    }
    if (value.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw new Error('stored embedding has invalid byte length');
    }

    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    const embedding: number[] = [];
    for (let offset = 0; offset < value.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
      embedding.push(view.getFloat32(offset, true));
    }
    return embedding;
  }

  private encodeMetadata(metadata: VectorMetadata | null | undefined): string | null {
    return metadata ? JSON.stringify(metadata) : null;
  }

  private decodeMetadata(value: SQLValue | undefined): VectorMetadata | undefined {
    if (typeof value !== 'string' || value.length === 0) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error(`embedding dimension ${b.length} does not match stored embedding dimension ${a.length}`);
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private createId(): string {
    const cryptoApi = globalThis.crypto as Crypto | undefined;
    if (typeof cryptoApi?.randomUUID === 'function') {
      return cryptoApi.randomUUID();
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const value = Math.floor(Math.random() * 16);
      const nibble = char === 'x' ? value : (value & 0x3) | 0x8;
      return nibble.toString(16);
    });
  }
}
