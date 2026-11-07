# Atomic batches

```typescript
const connection = await FastSQL.connect({ database: 'app' });
await connection.executeBatch([
  { statement: 'INSERT INTO items (name) VALUES (?)', params: ['first'] },
  { statement: 'INSERT INTO items (name) VALUES (?)', params: ['second'] },
], { atomic: true });
```

The flag starts one transaction and rolls it back if an operation fails.
Omitting it retains the existing non-atomic behavior, where earlier statements
can remain committed. Do not include SQL transaction-control statements in an
atomic batch.

Atomic batches require no active transaction. Inside a transaction callback,
call `scoped.executeBatch(operations)` without the flag. The surrounding
transaction already provides atomicity. Nested atomic batches reject before
executing their operations.

This uses the current HTTP batch endpoint. It does not reuse a prepared SQLite
statement across parameter sets, change durability PRAGMAs, or introduce a binary
transport. Measure transaction grouping separately from transport performance.
