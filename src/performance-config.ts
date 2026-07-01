import type { SQLConnectionOptions } from './definitions';

/**
 * Apply optional SQLite performance PRAGMAs after opening a database.
 */
export function applyPerformanceConfig(db: { run: (sql: string) => void }, options: SQLConnectionOptions): void {
  db.run('PRAGMA foreign_keys = ON');

  if (options.walMode) {
    db.run('PRAGMA journal_mode = WAL');
  }

  if (options.performancePresets) {
    db.run('PRAGMA synchronous = NORMAL');
    db.run('PRAGMA busy_timeout = 5000');
    db.run('PRAGMA cache_size = -2000');
  }
}
