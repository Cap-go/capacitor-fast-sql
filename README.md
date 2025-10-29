# @capgo/capacitor-fast-sql
  <a href="https://capgo.app/"><img src='https://raw.githubusercontent.com/Cap-go/capgo/main/assets/capgo_banner.png' alt='Capgo - Instant updates for capacitor'/></a>

<div align="center">
  <h2><a href="https://capgo.app/?ref=plugin"> ➡️ Get Instant updates for your App with Capgo</a></h2>
  <h2><a href="https://capgo.app/consulting/?ref=plugin"> Missing a feature? We'll build the plugin for you 💪</a></h2>
</div>

High-performance native SQLite plugin with HTTP server for efficient sync operations and IndexedDB replacement.

## Documentation

The most complete doc is available here: https://capgo.app/docs/plugins/fast-sql/

## Install

```bash
npm install @capgo/capacitor-fast-sql
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
import { FastSQL } from '@capgo/capacitor-fast-sql';

// Connect to database
const db = await FastSQL.connect({ database: 'myapp' });

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
await FastSQL.disconnect('myapp');
```

### Transaction Example

```typescript
const db = await FastSQL.connect({ database: 'myapp' });

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
const db = await FastSQL.connect({ database: 'myapp' });

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
* [Type Aliases](#type-aliases)
* [Enums](#enums)

</docgen-index>

<docgen-api>
<!--Update the source file JSDoc comments and rerun docgen to update the docs below-->

Fast SQL Plugin for high-performance SQLite database access.

This plugin uses a custom HTTP-based protocol for efficient data transfer,
bypassing Capacitor's standard bridge for better performance with sync operations.

### connect(...)

```typescript
connect(options: SQLConnectionOptions) => Promise<{ port: number; token: string; database: string; }>
```

Initialize the database connection and start the HTTP server.

| Param         | Type                                                                  | Description          |
| ------------- | --------------------------------------------------------------------- | -------------------- |
| **`options`** | <code><a href="#sqlconnectionoptions">SQLConnectionOptions</a></code> | - Connection options |

**Returns:** <code>Promise&lt;{ port: number; token: string; database: string; }&gt;</code>

**Since:** 0.0.1

--------------------


### disconnect(...)

```typescript
disconnect(options: { database: string; }) => Promise<void>
```

Close database connection and stop the HTTP server.

| Param         | Type                               | Description              |
| ------------- | ---------------------------------- | ------------------------ |
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

| Param         | Type                                                                       | Description        |
| ------------- | -------------------------------------------------------------------------- | ------------------ |
| **`options`** | <code>{ database: string; statement: string; params?: SQLValue[]; }</code> | - Query parameters |

**Returns:** <code>Promise&lt;<a href="#sqlresult">SQLResult</a>&gt;</code>

**Since:** 0.0.1

--------------------


### beginTransaction(...)

```typescript
beginTransaction(options: { database: string; isolationLevel?: IsolationLevel; }) => Promise<void>
```

Begin a database transaction.

| Param         | Type                                                                                              | Description           |
| ------------- | ------------------------------------------------------------------------------------------------- | --------------------- |
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

| Prop                | Type                 | Description                                                |
| ------------------- | -------------------- | ---------------------------------------------------------- |
| **`database`**      | <code>string</code>  | Database name (file will be created in app data directory) |
| **`encrypted`**     | <code>boolean</code> | Enable encryption (iOS/Android only)                       |
| **`encryptionKey`** | <code>string</code>  | Encryption key (required if encrypted is true)             |
| **`readOnly`**      | <code>boolean</code> | Read-only mode                                             |


#### SQLResult

Result of a SQL query execution

| Prop               | Type                  | Description                                                             |
| ------------------ | --------------------- | ----------------------------------------------------------------------- |
| **`rows`**         | <code>SQLRow[]</code> | Rows returned by the query (for SELECT statements)                      |
| **`rowsAffected`** | <code>number</code>   | Number of rows affected by the query (for INSERT/UPDATE/DELETE)         |
| **`insertId`**     | <code>number</code>   | ID of the last inserted row (for INSERT statements with auto-increment) |


#### SQLRow

SQL row result - values indexed by column name


#### Uint8Array

A typed array of 8-bit unsigned integer values. The contents are initialized to 0. If the
requested number of bytes could not be allocated an exception is raised.

| Prop                    | Type                                                        | Description                                                                  |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **`BYTES_PER_ELEMENT`** | <code>number</code>                                         | The size in bytes of each element in the array.                              |
| **`buffer`**            | <code><a href="#arraybufferlike">ArrayBufferLike</a></code> | The <a href="#arraybuffer">ArrayBuffer</a> instance referenced by the array. |
| **`byteLength`**        | <code>number</code>                                         | The length in bytes of the array.                                            |
| **`byteOffset`**        | <code>number</code>                                         | The offset in bytes of the array.                                            |
| **`length`**            | <code>number</code>                                         | The length of the array.                                                     |

| Method             | Signature                                                                                                                                                                      | Description                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **copyWithin**     | (target: number, start: number, end?: number \| undefined) =&gt; this                                                                                                          | Returns the this object after copying a section of the array identified by start and end to the same array starting at position target                                                                                                      |
| **every**          | (predicate: (value: number, index: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; unknown, thisArg?: any) =&gt; boolean                                            | Determines whether all the members of an array satisfy the specified test.                                                                                                                                                                  |
| **fill**           | (value: number, start?: number \| undefined, end?: number \| undefined) =&gt; this                                                                                             | Returns the this object after filling the section identified by start and end with value                                                                                                                                                    |
| **filter**         | (predicate: (value: number, index: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; any, thisArg?: any) =&gt; <a href="#uint8array">Uint8Array</a>                   | Returns the elements of an array that meet the condition specified in a callback function.                                                                                                                                                  |
| **find**           | (predicate: (value: number, index: number, obj: <a href="#uint8array">Uint8Array</a>) =&gt; boolean, thisArg?: any) =&gt; number \| undefined                                  | Returns the value of the first element in the array where predicate is true, and undefined otherwise.                                                                                                                                       |
| **findIndex**      | (predicate: (value: number, index: number, obj: <a href="#uint8array">Uint8Array</a>) =&gt; boolean, thisArg?: any) =&gt; number                                               | Returns the index of the first element in the array where predicate is true, and -1 otherwise.                                                                                                                                              |
| **forEach**        | (callbackfn: (value: number, index: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; void, thisArg?: any) =&gt; void                                                 | Performs the specified action for each element in an array.                                                                                                                                                                                 |
| **indexOf**        | (searchElement: number, fromIndex?: number \| undefined) =&gt; number                                                                                                          | Returns the index of the first occurrence of a value in an array.                                                                                                                                                                           |
| **join**           | (separator?: string \| undefined) =&gt; string                                                                                                                                 | Adds all the elements of an array separated by the specified separator string.                                                                                                                                                              |
| **lastIndexOf**    | (searchElement: number, fromIndex?: number \| undefined) =&gt; number                                                                                                          | Returns the index of the last occurrence of a value in an array.                                                                                                                                                                            |
| **map**            | (callbackfn: (value: number, index: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; number, thisArg?: any) =&gt; <a href="#uint8array">Uint8Array</a>               | Calls a defined callback function on each element of an array, and returns an array that contains the results.                                                                                                                              |
| **reduce**         | (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; number) =&gt; number                       | Calls the specified callback function for all the elements in an array. The return value of the callback function is the accumulated result, and is provided as an argument in the next call to the callback function.                      |
| **reduce**         | (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; number, initialValue: number) =&gt; number |                                                                                                                                                                                                                                             |
| **reduce**         | &lt;U&gt;(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; U, initialValue: U) =&gt; U            | Calls the specified callback function for all the elements in an array. The return value of the callback function is the accumulated result, and is provided as an argument in the next call to the callback function.                      |
| **reduceRight**    | (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; number) =&gt; number                       | Calls the specified callback function for all the elements in an array, in descending order. The return value of the callback function is the accumulated result, and is provided as an argument in the next call to the callback function. |
| **reduceRight**    | (callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; number, initialValue: number) =&gt; number |                                                                                                                                                                                                                                             |
| **reduceRight**    | &lt;U&gt;(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; U, initialValue: U) =&gt; U            | Calls the specified callback function for all the elements in an array, in descending order. The return value of the callback function is the accumulated result, and is provided as an argument in the next call to the callback function. |
| **reverse**        | () =&gt; <a href="#uint8array">Uint8Array</a>                                                                                                                                  | Reverses the elements in an Array.                                                                                                                                                                                                          |
| **set**            | (array: <a href="#arraylike">ArrayLike</a>&lt;number&gt;, offset?: number \| undefined) =&gt; void                                                                             | Sets a value or an array of values.                                                                                                                                                                                                         |
| **slice**          | (start?: number \| undefined, end?: number \| undefined) =&gt; <a href="#uint8array">Uint8Array</a>                                                                            | Returns a section of an array.                                                                                                                                                                                                              |
| **some**           | (predicate: (value: number, index: number, array: <a href="#uint8array">Uint8Array</a>) =&gt; unknown, thisArg?: any) =&gt; boolean                                            | Determines whether the specified callback function returns true for any element of an array.                                                                                                                                                |
| **sort**           | (compareFn?: ((a: number, b: number) =&gt; number) \| undefined) =&gt; this                                                                                                    | Sorts an array.                                                                                                                                                                                                                             |
| **subarray**       | (begin?: number \| undefined, end?: number \| undefined) =&gt; <a href="#uint8array">Uint8Array</a>                                                                            | Gets a new <a href="#uint8array">Uint8Array</a> view of the <a href="#arraybuffer">ArrayBuffer</a> store for this array, referencing the elements at begin, inclusive, up to end, exclusive.                                                |
| **toLocaleString** | () =&gt; string                                                                                                                                                                | Converts a number to a string by using the current locale.                                                                                                                                                                                  |
| **toString**       | () =&gt; string                                                                                                                                                                | Returns a string representation of an array.                                                                                                                                                                                                |
| **valueOf**        | () =&gt; <a href="#uint8array">Uint8Array</a>                                                                                                                                  | Returns the primitive value of the specified object.                                                                                                                                                                                        |


#### ArrayLike

| Prop         | Type                |
| ------------ | ------------------- |
| **`length`** | <code>number</code> |


#### ArrayBufferTypes

Allowed <a href="#arraybuffer">ArrayBuffer</a> types for the buffer of an ArrayBufferView and related Typed Arrays.

| Prop              | Type                                                |
| ----------------- | --------------------------------------------------- |
| **`ArrayBuffer`** | <code><a href="#arraybuffer">ArrayBuffer</a></code> |


#### ArrayBuffer

Represents a raw buffer of binary data, which is used to store data for the
different typed arrays. ArrayBuffers cannot be read from or written to directly,
but can be passed to a typed array or DataView Object to interpret the raw
buffer as needed.

| Prop             | Type                | Description                                                                     |
| ---------------- | ------------------- | ------------------------------------------------------------------------------- |
| **`byteLength`** | <code>number</code> | Read-only. The length of the <a href="#arraybuffer">ArrayBuffer</a> (in bytes). |

| Method    | Signature                                                                               | Description                                                     |
| --------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **slice** | (begin: number, end?: number \| undefined) =&gt; <a href="#arraybuffer">ArrayBuffer</a> | Returns a section of an <a href="#arraybuffer">ArrayBuffer</a>. |


### Type Aliases


#### SQLValue

SQL value types supported by the plugin

<code>string | number | boolean | null | <a href="#uint8array">Uint8Array</a></code>


#### ArrayBufferLike

<code>ArrayBufferTypes[keyof ArrayBufferTypes]</code>


### Enums


#### IsolationLevel

| Members               | Value                           |
| --------------------- | ------------------------------- |
| **`ReadUncommitted`** | <code>'READ UNCOMMITTED'</code> |
| **`ReadCommitted`**   | <code>'READ COMMITTED'</code>   |
| **`RepeatableRead`**  | <code>'REPEATABLE READ'</code>  |
| **`Serializable`**    | <code>'SERIALIZABLE'</code>     |

</docgen-api>
