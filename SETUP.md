# Setup Guide

## Plugin Development Setup

### Prerequisites

- Node.js 18+
- npm or bun
- Xcode (for iOS development)
- Android Studio (for Android development)

### Initial Setup

1. Install dependencies:

```bash
cd capacitor-native-sql
npm install
```

2. Build the plugin:

```bash
npm run build
```

### iOS Development

The iOS implementation uses Swift and requires a proper HTTP server library for production use.

#### Recommended HTTP Server Library

Add one of these to your `Package.swift`:

**Option 1: GCDWebServer** (Recommended)
```swift
.package(url: "https://github.com/swisspol/GCDWebServer.git", from: "3.5.4")
```

**Option 2: Telegraph**
```swift
.package(url: "https://github.com/Building42/Telegraph.git", from: "0.30.0")
```

**Option 3: Swifter**
```swift
.package(url: "https://github.com/httpswift/swifter.git", from: "1.5.0")
```

#### iOS Notes

- The current iOS implementation includes placeholder HTTP server code
- For production, integrate one of the recommended libraries in `SQLHTTPServer.swift`
- See comments in the file for GCDWebServer integration example

### Android Development

The Android implementation uses NanoHTTPD which is already configured in `build.gradle`.

#### Testing Android

```bash
npm run verify:android
```

### Web Development

The web implementation uses sql.js (SQLite compiled to WebAssembly) loaded from CDN.

## Example App Setup

1. Navigate to example app:

```bash
cd example-app
npm install
```

2. Run development server:

```bash
npm run dev
```

3. Open browser to `http://localhost:3000`

## Integration into Your App

### Installation

```bash
npm install @capgo/capacitor-native-sql
npx cap sync
```

### iOS Configuration

1. Add to `Info.plist`:

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
</dict>
```

2. If using CocoaPods, the plugin will be automatically linked

3. If using SPM, add to your project's Package Dependencies

### Android Configuration

1. The plugin is automatically linked via Gradle

2. If you need cleartext traffic, add to `AndroidManifest.xml`:

```xml
<application
    android:usesCleartextTraffic="true">
    ...
</application>
```

## Architecture Details

### Communication Protocol

The plugin uses a custom HTTP-based protocol:

1. **JavaScript Layer**: Uses `fetch()` API to communicate with native
2. **Native Layer**: Runs a local HTTP server on `127.0.0.1:PORT`
3. **Authentication**: Bearer token generated per connection
4. **Data Format**: JSON with special handling for binary data (base64)

### Endpoints

- `POST /execute` - Execute single SQL statement
- `POST /batch` - Execute multiple statements
- `POST /transaction/begin` - Begin transaction
- `POST /transaction/commit` - Commit transaction
- `POST /transaction/rollback` - Rollback transaction

### Security

- Server only listens on localhost (127.0.0.1)
- Each connection generates a unique authentication token
- Token must be provided in `Authorization` header
- Database name must be provided in `X-Database` header

## Performance Tuning

### Batch Operations

Always use batch operations for multiple inserts:

```typescript
// Slow - multiple round trips
for (let i = 0; i < 1000; i++) {
  await db.run('INSERT INTO items (name) VALUES (?)', [`Item ${i}`]);
}

// Fast - single batch operation
const operations = [];
for (let i = 0; i < 1000; i++) {
  operations.push({
    statement: 'INSERT INTO items (name) VALUES (?)',
    params: [`Item ${i}`]
  });
}
await db.executeBatch(operations);
```

### Transactions

Use transactions for related operations:

```typescript
await db.transaction(async (tx) => {
  // All operations here are atomic
  await tx.run('...');
  await tx.run('...');
});
```

### Binary Data

Store binary data directly (no base64 encoding needed in your code):

```typescript
const imageData = new Uint8Array([...]);
await db.run('INSERT INTO images (data) VALUES (?)', [imageData]);
```

## Sync System Integration

### Example: CRDTs

```typescript
interface CRDTOperation {
  id: string;
  timestamp: number;
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  data: any;
  vector_clock: Record<string, number>;
}

class CRDTSyncEngine {
  async applyRemoteOperation(op: CRDTOperation) {
    await db.transaction(async (tx) => {
      // Check if operation already applied
      const existing = await tx.query(
        'SELECT * FROM operations WHERE id = ?',
        [op.id]
      );

      if (existing.length > 0) {
        // Resolve conflict using vector clock
        // ...
      }

      // Apply operation
      await tx.run(op.operation, op.data);

      // Record operation
      await tx.run(
        'INSERT INTO operations (id, timestamp, data) VALUES (?, ?, ?)',
        [op.id, op.timestamp, JSON.stringify(op)]
      );
    });
  }
}
```

### Example: Operational Transform

```typescript
class OTSyncEngine {
  async applyOperation(op: Operation) {
    await db.transaction(async (tx) => {
      // Get all operations since this one's parent
      const concurrent = await tx.query(
        'SELECT * FROM operations WHERE timestamp > ? ORDER BY timestamp',
        [op.parentTimestamp]
      );

      // Transform operation against concurrent operations
      let transformed = op;
      for (const concurrentOp of concurrent) {
        transformed = this.transform(transformed, concurrentOp);
      }

      // Apply transformed operation
      await tx.run(transformed.sql, transformed.params);
    });
  }
}
```

## Encryption (Android)

Encryption is optional and uses [SQLCipher](https://www.zetetic.net/sqlcipher/). The plugin ships with SQLCipher as a compile-time dependency only — it is **not** bundled by default.

### Enabling Encryption

Add the SQLCipher runtime dependency to your **app-level** `android/app/build.gradle`:

```gradle
dependencies {
    implementation 'net.zetetic:sqlcipher-android:4.13.0'
}
```

Then connect with encryption:

```typescript
const db = await FastSQL.connect({
  database: 'secure',
  encrypted: true,
  encryptionKey: 'my-secret-key',
});
```

### What Happens Without SQLCipher

If you pass `encrypted: true` without the SQLCipher dependency, the plugin returns a descriptive error:

> Encryption is not available. Add `implementation "net.zetetic:sqlcipher-android:4.13.0"` to your app's build.gradle to enable encryption.

The app will **not** crash — the error is caught gracefully at two levels:

1. **Class check**: Before attempting to load `EncryptedSQLDatabase`, the plugin verifies the SQLCipher class is on the classpath via `Class.forName`.
2. **Native library check**: `EncryptedSQLDatabase` catches `UnsatisfiedLinkError` from `System.loadLibrary("sqlcipher")` and converts it to a descriptive exception.

## Troubleshooting

### iOS: Server Not Starting

- Check that your Info.plist allows local networking
- Verify that a proper HTTP server library is integrated
- Check console logs for port binding errors

### Android: Connection Refused

- Verify cleartext traffic is allowed in AndroidManifest.xml
- Check that NanoHTTPD dependency is properly included
- Check logcat for server startup errors

### Web: sql.js Not Loading

- Check browser console for CDN load errors
- Verify network connectivity
- Consider hosting sql.js locally for offline use

### All Platforms: Slow Performance

- Use batch operations instead of individual statements
- Wrap related operations in transactions
- Consider indexing frequently queried columns
- Profile with browser DevTools or native profilers

## Testing

### Unit Tests

```bash
npm run test
```

### iOS Integration Tests

```bash
npm run verify:ios
```

### Android Integration Tests

```bash
npm run verify:android
```

## Publishing

1. Update version in `package.json`
2. Build the plugin: `npm run build`
3. Publish to npm: `npm publish`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Write tests
5. Submit a pull request

## License

MIT - See LICENSE file for details
