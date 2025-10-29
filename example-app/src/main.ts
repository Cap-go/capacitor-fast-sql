import type { SQLConnection } from '@capgo/capacitor-native-sql';
import { NativeSQL } from '@capgo/capacitor-native-sql';

let db: SQLConnection | null = null;

// Helper to log output
function log(elementId: string, message: string, isError = false) {
  const element = document.getElementById(elementId);
  if (element) {
    const timestamp = new Date().toLocaleTimeString();
    const className = isError ? 'error' : 'success';
    element.innerHTML = `<span class="${className}">[${timestamp}] ${message}</span>`;
  }
}

// Helper to append to log
function appendLog(elementId: string, message: string) {
  const element = document.getElementById(elementId);
  if (element) {
    const timestamp = new Date().toLocaleTimeString();
    element.innerHTML += `\n[${timestamp}] ${message}`;
    element.scrollTop = element.scrollHeight;
  }
}

// Enable/disable buttons based on connection state
function updateButtonStates(connected: boolean) {
  const buttons = [
    'disconnect', 'insert', 'query', 'clear',
    'transaction', 'batch-insert',
    'sync-init', 'sync-add', 'sync-view'
  ];
  buttons.forEach(id => {
    const btn = document.getElementById(id) as HTMLButtonElement;
    if (btn) btn.disabled = !connected;
  });

  const connectBtn = document.getElementById('connect') as HTMLButtonElement;
  if (connectBtn) connectBtn.disabled = connected;
}

// Connect to database
document.getElementById('connect')?.addEventListener('click', async () => {
  try {
    log('connection-output', 'Connecting to database...');
    db = await NativeSQL.connect({ database: 'example-db' });

    // Create users table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    log('connection-output', 'Connected successfully! Database ready.');
    log('operations-output', 'Database connected. Ready for operations.');
    log('transaction-output', 'Database connected. Ready for transactions.');
    log('batch-output', 'Database connected. Ready for batch operations.');
    log('sync-output', 'Database connected. Ready for sync operations.');

    updateButtonStates(true);
    await updateRowCount();
  } catch (error: any) {
    log('connection-output', `Error: ${error.message}`, true);
  }
});

// Disconnect from database
document.getElementById('disconnect')?.addEventListener('click', async () => {
  try {
    if (!db) return;
    await NativeSQL.disconnect(db.getDatabaseName());
    db = null;
    log('connection-output', 'Disconnected successfully.');
    updateButtonStates(false);
  } catch (error: any) {
    log('connection-output', `Error: ${error.message}`, true);
  }
});

// Insert user
document.getElementById('insert')?.addEventListener('click', async () => {
  if (!db) return;

  const nameInput = document.getElementById('name-input') as HTMLInputElement;
  const emailInput = document.getElementById('email-input') as HTMLInputElement;

  const name = nameInput.value.trim() || `User ${Date.now()}`;
  const email = emailInput.value.trim() || `user${Date.now()}@example.com`;

  try {
    const result = await db.run(
      'INSERT INTO users (name, email) VALUES (?, ?)',
      [name, email]
    );

    log('operations-output',
      `✓ Inserted: ${name} (${email})\nInsert ID: ${result.insertId}`
    );

    nameInput.value = '';
    emailInput.value = '';
    await updateRowCount();
  } catch (error: any) {
    log('operations-output', `Error: ${error.message}`, true);
  }
});

// Query users
document.getElementById('query')?.addEventListener('click', async () => {
  if (!db) return;

  try {
    const users = await db.query('SELECT * FROM users ORDER BY created_at DESC');

    if (users.length === 0) {
      log('operations-output', 'No users found.');
    } else {
      const output = users.map((user, i) =>
        `${i + 1}. ${user.name} (${user.email}) - ID: ${user.id}`
      ).join('\n');
      log('operations-output', `Found ${users.length} users:\n\n${output}`);
    }
  } catch (error: any) {
    log('operations-output', `Error: ${error.message}`, true);
  }
});

// Clear all users
document.getElementById('clear')?.addEventListener('click', async () => {
  if (!db) return;

  try {
    const result = await db.run('DELETE FROM users');
    log('operations-output', `✓ Deleted ${result.rowsAffected} users`);
    await updateRowCount();
  } catch (error: any) {
    log('operations-output', `Error: ${error.message}`, true);
  }
});

// Transaction example
document.getElementById('transaction')?.addEventListener('click', async () => {
  if (!db) return;

  try {
    log('transaction-output', 'Starting transaction...');

    const result = await db.transaction(async (tx) => {
      // Insert multiple users atomically
      const users = [
        ['Alice', 'alice@example.com'],
        ['Bob', 'bob@example.com'],
        ['Charlie', 'charlie@example.com']
      ];

      const insertIds: number[] = [];
      for (const [name, email] of users) {
        const result = await tx.run(
          'INSERT INTO users (name, email) VALUES (?, ?)',
          [name, email]
        );
        insertIds.push(result.insertId!);
      }

      return insertIds;
    });

    log('transaction-output',
      `✓ Transaction committed successfully!\nInserted IDs: ${result.join(', ')}`
    );
    await updateRowCount();
  } catch (error: any) {
    log('transaction-output', `✗ Transaction rolled back: ${error.message}`, true);
  }
});

// Batch insert (performance test)
document.getElementById('batch-insert')?.addEventListener('click', async () => {
  if (!db) return;

  const countInput = document.getElementById('batch-count') as HTMLInputElement;
  const count = parseInt(countInput.value) || 100;

  try {
    log('batch-output', `Starting batch insert of ${count} rows...`);

    const startTime = performance.now();

    // Create batch operations
    const operations = [];
    for (let i = 0; i < count; i++) {
      operations.push({
        statement: 'INSERT INTO users (name, email) VALUES (?, ?)',
        params: [`Batch User ${i}`, `batch${i}_${Date.now()}@example.com`]
      });
    }

    // Execute batch
    await db.executeBatch(operations);

    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);

    log('batch-output',
      `✓ Inserted ${count} rows in ${duration}ms\nThroughput: ${(count / (parseFloat(duration) / 1000)).toFixed(0)} rows/sec`
    );

    // Update stats
    const timeElement = document.getElementById('batch-time');
    if (timeElement) timeElement.textContent = `${duration}ms`;

    await updateRowCount();
  } catch (error: any) {
    log('batch-output', `Error: ${error.message}`, true);
  }
});

// Initialize sync tables
document.getElementById('sync-init')?.addEventListener('click', async () => {
  if (!db) return;

  try {
    log('sync-output', 'Creating sync tables...');

    await db.execute(`
      CREATE TABLE IF NOT EXISTS sync_operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        table_name TEXT NOT NULL,
        operation TEXT NOT NULL,
        data TEXT NOT NULL,
        synced INTEGER DEFAULT 0
      )
    `);

    log('sync-output', '✓ Sync tables initialized successfully!');
  } catch (error: any) {
    log('sync-output', `Error: ${error.message}`, true);
  }
});

// Add local change
document.getElementById('sync-add')?.addEventListener('click', async () => {
  if (!db) return;

  try {
    await db.transaction(async (tx) => {
      // Simulate a local change
      const user = {
        name: `Local User ${Date.now()}`,
        email: `local${Date.now()}@example.com`
      };

      // Insert the user
      const result = await tx.run(
        'INSERT INTO users (name, email) VALUES (?, ?)',
        [user.name, user.email]
      );

      // Record the operation for sync
      await tx.run(
        'INSERT INTO sync_operations (timestamp, table_name, operation, data) VALUES (?, ?, ?, ?)',
        [Date.now(), 'users', 'INSERT', JSON.stringify({ id: result.insertId, ...user })]
      );
    });

    log('sync-output', '✓ Local change recorded and queued for sync');
    await updateRowCount();
  } catch (error: any) {
    log('sync-output', `Error: ${error.message}`, true);
  }
});

// View pending changes
document.getElementById('sync-view')?.addEventListener('click', async () => {
  if (!db) return;

  try {
    const pending = await db.query(
      'SELECT * FROM sync_operations WHERE synced = 0 ORDER BY timestamp'
    );

    if (pending.length === 0) {
      log('sync-output', 'No pending changes to sync.');
    } else {
      const output = pending.map((op, i) => {
        const date = new Date(op.timestamp as number).toLocaleString();
        return `${i + 1}. [${date}] ${op.operation} on ${op.table_name}`;
      }).join('\n');

      log('sync-output', `${pending.length} pending changes:\n\n${output}`);
    }
  } catch (error: any) {
    log('sync-output', `Error: ${error.message}`, true);
  }
});

// Update row count
async function updateRowCount() {
  if (!db) return;

  try {
    const result = await db.query('SELECT COUNT(*) as count FROM users');
    const count = result[0].count;

    const element = document.getElementById('total-rows');
    if (element) element.textContent = String(count);
  } catch (error) {
    // Ignore errors
  }
}

// Initial state
updateButtonStates(false);
