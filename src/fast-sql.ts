import { Capacitor } from '@capacitor/core';

import type { SQLConnectionOptions } from './definitions';
import { CapgoCapacitorFastSql } from './plugin';
import type { SQLConnection } from './sql-connection';
import { NativeSQLConnection } from './sql-connection';
import { WebSQLConnection } from './web-sql-connection';

/**
 * FastSQL - High-level API for managing SQL connections
 *
 * This class provides a convenient interface for opening/closing database connections
 * and managing multiple databases simultaneously.
 */
export class FastSQL {
  private static connections: Map<string, SQLConnection> = new Map();

  /**
   * Open a database connection
   *
   * @param options - Connection options
   * @returns SQLConnection instance for executing queries
   */
  static async connect(options: SQLConnectionOptions): Promise<SQLConnection> {
    // Check if already connected
    const existing = this.connections.get(options.database);
    if (existing) {
      return existing;
    }

    // Connect via native plugin
    const info = await CapgoCapacitorFastSql.connect(options);

    // Create connection instance appropriate for the current platform
    let connection: SQLConnection;
    if (Capacitor.getPlatform() === 'web') {
      connection = new WebSQLConnection(info.database, CapgoCapacitorFastSql);
    } else {
      connection = new NativeSQLConnection(info.database, info.port, info.token);
    }

    // Store connection
    this.connections.set(options.database, connection);

    return connection;
  }

  /**
   * Close a database connection
   *
   * @param database - Database name to close
   */
  static async disconnect(database: string): Promise<void> {
    const connection = this.connections.get(database);
    if (!connection) {
      throw new Error(`Database '${database}' is not connected`);
    }

    // Disconnect via native plugin
    await CapgoCapacitorFastSql.disconnect({ database });

    // Remove connection
    this.connections.delete(database);
  }

  /**
   * Get an existing connection
   *
   * @param database - Database name
   * @returns SQLConnection instance or null if not connected
   */
  static getConnection(database: string): SQLConnection | null {
    return this.connections.get(database) || null;
  }

  /**
   * Close all open connections
   */
  static async disconnectAll(): Promise<void> {
    const databases = Array.from(this.connections.keys());
    await Promise.all(databases.map((db) => this.disconnect(db)));
  }

  /**
   * Get list of all open database connections
   *
   * @returns Array of database names
   */
  static getOpenDatabases(): string[] {
    return Array.from(this.connections.keys());
  }
}
