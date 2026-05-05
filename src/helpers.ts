/**
 * Helper classes for easier SQL operations
 * Import these separately: import { FastSQL, SQLConnection } from '@capgo/capacitor-fast-sql/helpers';
 */

export { FastSQL } from './fast-sql';
export { SQLConnection } from './sql-connection';
export { FastSQLVectorStore } from './vector-store';
export type {
  VectorEmbeddings,
  VectorMetadata,
  VectorStore,
  VectorStoreAddOptions,
  VectorStoreConnectionOptions,
  VectorStoreDeleteOptions,
  VectorStoreGetResult,
  VectorStoreOptions,
  VectorStoreQueryOptions,
  VectorStoreQueryResult,
  VectorStoreUpdateOptions,
} from './vector-store';
