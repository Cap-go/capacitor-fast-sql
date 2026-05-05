import { Capacitor } from '@capacitor/core';

import type { SQLConnectionOptions } from './definitions';
import { NativeSQLConnection } from './native-sql-connection';
import { CapgoCapacitorFastSql } from './plugin';
import type { SQLConnection } from './sql-connection';
import { WebSQLConnection } from './web-sql-connection';

/**
 * FastSQL - High-level API for managing SQL connections
 *
 * This class provides a convenient interface for opening/closing database connections
 * and managing multiple databases simultaneously.
 */
export class FastSQL {
  private static connections: Map<string, SQLConnection> = new Map();
  private static sharedConnections: Set<string> = new Set();
  private static connectionRetainers: Map<string, number> = new Map();
  private static pendingDisconnects: Set<string> = new Set();

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
      this.sharedConnections.add(options.database);
      return existing;
    }

    // Connect via native plugin
    const info = await CapgoCapacitorFastSql.connect(options);

    // Create connection instance appropriate for the current platform
    let connection: SQLConnection;
    const platform = Capacitor.getPlatform();
    if (platform === 'android' || platform === 'ios') {
      connection = new NativeSQLConnection(info.database, info.port, info.token);
    } else {
      connection = new WebSQLConnection(info.database, CapgoCapacitorFastSql);
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

    if ((this.connectionRetainers.get(database) ?? 0) > 0) {
      this.pendingDisconnects.add(database);
      return;
    }

    // Disconnect via native plugin
    await CapgoCapacitorFastSql.disconnect({ database });

    // Remove connection
    this.connections.delete(database);
    this.sharedConnections.delete(database);
    this.connectionRetainers.delete(database);
    this.pendingDisconnects.delete(database);
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
   * Check whether a connection has been handed out more than once.
   */
  static isConnectionShared(database: string): boolean {
    return this.sharedConnections.has(database);
  }

  /**
   * Temporarily retain a connection for helpers that share cached connections.
   */
  static retainConnection(database: string): void {
    if (!this.connections.has(database)) {
      throw new Error(`Database '${database}' is not connected`);
    }
    this.connectionRetainers.set(database, (this.connectionRetainers.get(database) ?? 0) + 1);
  }

  /**
   * Release a retained connection. Returns true when a pending disconnect closed it.
   */
  static async releaseConnection(database: string): Promise<boolean> {
    const retainers = this.connectionRetainers.get(database) ?? 0;
    if (retainers > 1) {
      this.connectionRetainers.set(database, retainers - 1);
      return false;
    }

    this.connectionRetainers.delete(database);
    if (this.pendingDisconnects.has(database)) {
      this.pendingDisconnects.delete(database);
      await this.disconnect(database);
      return true;
    }
    return false;
  }

  /**
   * Close all open connections
   */
  static async disconnectAll(): Promise<void> {
    const databases = Array.from(this.connections.keys());
    await Promise.all(
      databases.map((db) => {
        this.connectionRetainers.delete(db);
        this.pendingDisconnects.delete(db);
        return this.disconnect(db);
      }),
    );
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
