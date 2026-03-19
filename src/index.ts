export * from './definitions';
export { CapgoCapacitorFastSql } from './plugin';

// Re-export helper classes for convenience
export { FastSQL } from './fast-sql';
export type { SQLConnection } from './sql-connection';
export { NativeSQLConnection } from './native-sql-connection';
export { WebSQLConnection } from './web-sql-connection';
export { KeyValueStore } from './key-value';
export type { KeyValueStoreOptions, KeyValueValue } from './key-value';
