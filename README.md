# @capgo/capacitor-native-sql
  <a href="https://capgo.app/"><img src='https://raw.githubusercontent.com/Cap-go/capgo/main/assets/capgo_banner.png' alt='Capgo - Instant updates for capacitor'/></a>

<div align="center">
  <h2><a href="https://capgo.app/?ref=plugin"> ➡️ Get Instant updates for your App with Capgo</a></h2>
  <h2><a href="https://capgo.app/consulting/?ref=plugin"> Missing a feature? We'll build the plugin for you 💪</a></h2>
</div>

High-performance native SQLite plugin with custom protocol for efficient sync operations and IndexedDB replacement.

## Documentation

The most complete doc is available here: https://capgo.app/docs/plugins/native-sql/

## Install

```bash
npm install @capgo/capacitor-native-sql
npx cap sync
```

## Overview

This plugin provides direct native SQLite database access with a custom communication protocol inspired by [capacitor-blob-writer](https://github.com/diachedelic/capacitor-blob-writer). Instead of using Capacitor's standard bridge (which serializes data inefficiently), it establishes a local HTTP server for optimal performance with large datasets and sync operations.

### Key Features

- **Custom HTTP Protocol**: Bypasses Capacitor's bridge for up to 25x faster performance with large data
- **Direct Native SQLite**: Full SQL support with transactions, batch operations, and binary data
- **Sync-Friendly**: Designed for local sync systems (CRDTs, operational transforms, etc.)
- **IndexedDB Replacement**: Provides reliable alternative to broken/limited IndexedDB implementations
- **Cross-Platform**: iOS, Android, and Web (using sql.js + IndexedDB for persistence)

## iOS Configuration

Add to your `Info.plist` if you encounter any issues:

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
</dict>
```

## Android Configuration

Add to your `AndroidManifest.xml` if needed:

```xml
<application
    android:usesCleartextTraffic="true">
    ...
</application>
```

## Usage

### Basic Example

```typescript
import { NativeSQL } from '@capgo/capacitor-native-sql';

// Connect to database
const db = await NativeSQL.connect({ database: 'myapp' });

// Create table
await db.execute(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE
  )
`);

// Insert data
const result = await db.run(
  'INSERT INTO users (name, email) VALUES (?, ?)',
  ['John Doe', 'john@example.com']
);
console.log('Inserted row ID:', result.insertId);

// Query data
const users = await db.query('SELECT * FROM users WHERE name LIKE ?', ['John%']);
console.log('Users:', users);

// Close connection
await NativeSQL.disconnect('myapp');
```

### Transaction Example

```typescript
const db = await NativeSQL.connect({ database: 'myapp' });

try {
  await db.transaction(async (tx) => {
    await tx.run('INSERT INTO accounts (name, balance) VALUES (?, ?)', ['Alice', 1000]);
    await tx.run('INSERT INTO accounts (name, balance) VALUES (?, ?)', ['Bob', 500]);
    await tx.run('UPDATE accounts SET balance = balance - 100 WHERE name = ?', ['Alice']);
    await tx.run('UPDATE accounts SET balance = balance + 100 WHERE name = ?', ['Bob']);
  });
  console.log('Transaction successful!');
} catch (error) {
  console.error('Transaction failed:', error);
}
```

### Batch Operations

```typescript
const db = await NativeSQL.connect({ database: 'myapp' });

const results = await db.executeBatch([
  { statement: 'INSERT INTO logs (message) VALUES (?)', params: ['Log 1'] },
  { statement: 'INSERT INTO logs (message) VALUES (?)', params: ['Log 2'] },
  { statement: 'INSERT INTO logs (message) VALUES (?)', params: ['Log 3'] },
]);
```

## API

<docgen-index>

* [`connect(...)`](#connect)
* [`disconnect(...)`](#disconnect)
* [`getServerInfo(...)`](#getserverinfo)
* [`execute(...)`](#execute)
* [`beginTransaction(...)`](#begintransaction)
* [`commitTransaction(...)`](#committransaction)
* [`rollbackTransaction(...)`](#rollbacktransaction)
* [`getPluginVersion()`](#getpluginversion)
* [Interfaces](#interfaces)
* [Enums](#enums)

</docgen-index>

<docgen-api>
<!--Update the source file JSDoc comments and rerun docgen to update the docs below-->

Native SQL Plugin for high-performance SQLite database access.

This plugin uses a custom HTTP-based protocol for efficient data transfer,
bypassing Capacitor's standard bridge for better performance with sync operations.

### connect(...)

```typescript
connect(options: SQLConnectionOptions) => Promise<{ port: number; token: string; database: string; }>
```

Initialize the database connection and start the HTTP server.

| Param         | Type                                                                  | Description         |
| ------------- | --------------------------------------------------------------------- | ------------------- |
| **`options`** | <code><a href="#sqlconnectionoptions">SQLConnectionOptions</a></code> | - Connection options |

**Returns:** <code>Promise&lt;{ port: number; token: string; database: string; }&gt;</code>

**Since:** 0.0.1

--------------------


### disconnect(...)

```typescript
disconnect(options: { database: string; }) => Promise<void>
```

Close database connection and stop the HTTP server.

| Param         | Type                               | Description           |
| ------------- | ---------------------------------- | --------------------- |
| **`options`** | <code>{ database: string; }</code> | - Database name to close |

**Since:** 0.0.1

--------------------


### getServerInfo(...)

```typescript
getServerInfo(options: { database: string; }) => Promise<{ port: number; token: string; }>
```

Get the HTTP server port and token for direct communication.

| Param         | Type                               | Description     |
| ------------- | ---------------------------------- | --------------- |
| **`options`** | <code>{ database: string; }</code> | - Database name |

**Returns:** <code>Promise&lt;{ port: number; token: string; }&gt;</code>

**Since:** 0.0.1

--------------------


### execute(...)

```typescript
execute(options: { database: string; statement: string; params?: SQLValue[]; }) => Promise<SQLResult>
```

Execute a SQL query via Capacitor bridge (for simple queries).
For better performance with large datasets, use the HTTP protocol directly via SQLConnection class.

| Param         | Type                                                                                         | Description        |
| ------------- | -------------------------------------------------------------------------------------------- | ------------------ |
| **`options`** | <code>{ database: string; statement: string; params?: <a href="#sqlvalue">SQLValue</a>[]; }</code> | - Query parameters |

**Returns:** <code>Promise&lt;<a href="#sqlresult">SQLResult</a>&gt;</code>

**Since:** 0.0.1

--------------------


### beginTransaction(...)

```typescript
beginTransaction(options: { database: string; isolationLevel?: IsolationLevel; }) => Promise<void>
```

Begin a database transaction.

| Param         | Type                                                                                                   | Description             |
| ------------- | ------------------------------------------------------------------------------------------------------ | ----------------------- |
| **`options`** | <code>{ database: string; isolationLevel?: <a href="#isolationlevel">IsolationLevel</a>; }</code> | - Transaction options |

**Since:** 0.0.1

--------------------


### commitTransaction(...)

```typescript
commitTransaction(options: { database: string; }) => Promise<void>
```

Commit the current transaction.

| Param         | Type                               | Description     |
| ------------- | ---------------------------------- | --------------- |
| **`options`** | <code>{ database: string; }</code> | - Database name |

**Since:** 0.0.1

--------------------


### rollbackTransaction(...)

```typescript
rollbackTransaction(options: { database: string; }) => Promise<void>
```

Rollback the current transaction.

| Param         | Type                               | Description     |
| ------------- | ---------------------------------- | --------------- |
| **`options`** | <code>{ database: string; }</code> | - Database name |

**Since:** 0.0.1

--------------------


### getPluginVersion()

```typescript
getPluginVersion() => Promise<{ version: string; }>
```

Get the native Capacitor plugin version.

**Returns:** <code>Promise&lt;{ version: string; }&gt;</code>

**Since:** 0.0.1

--------------------


### Interfaces


#### SQLConnectionOptions

Database connection options

| Prop                | Type                 | Description                                         |
| ------------------- | -------------------- | --------------------------------------------------- |
| **`database`**      | <code>string</code>  | Database name (file will be created in app data directory) |
| **`encrypted`**     | <code>boolean</code> | Enable encryption (iOS/Android only)                |
| **`encryptionKey`** | <code>string</code>  | Encryption key (required if encrypted is true)      |
| **`readOnly`**      | <code>boolean</code> | Read-only mode                                      |


#### SQLResult

Result of a SQL query execution

| Prop                | Type                                          | Description                                                      |
| ------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| **`rows`**          | <code><a href="#sqlrow">SQLRow</a>[]</code>  | Rows returned by the query (for SELECT statements)               |
| **`rowsAffected`**  | <code>number</code>                           | Number of rows affected by the query (for INSERT/UPDATE/DELETE) |
| **`insertId`**      | <code>number</code>                           | ID of the last inserted row (for INSERT statements with auto-increment) |


#### SQLRow

SQL row result - values indexed by column name


### Enums


#### IsolationLevel

Transaction isolation levels

| Members                | Value                          |
| ---------------------- | ------------------------------ |
| **`ReadUncommitted`**  | <code>'READ UNCOMMITTED'</code> |
| **`ReadCommitted`**    | <code>'READ COMMITTED'</code>   |
| **`RepeatableRead`**   | <code>'REPEATABLE READ'</code>  |
| **`Serializable`**     | <code>'SERIALIZABLE'</code>     |


### Type Aliases


#### SQLValue

<code>string | number | boolean | null | Uint8Array</code>

</docgen-api>
