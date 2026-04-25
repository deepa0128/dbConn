# MCP Integration Guide

This document is optimized for AI agents and MCP-compatible tooling that need to use `@dbconn/core` safely across SQL and MongoDB dialects.

## Supported Dialects

- `postgres`
- `mysql`
- `mongodb`

## Client Creation

```ts
import { createClient } from '@dbconn/core';

const sqlDb = createClient({
  dialect: 'postgres',
  host: 'localhost',
  user: 'app',
  password: 'secret',
  database: 'appdb',
});

const mongoDb = createClient({
  dialect: 'mongodb',
  uri: 'mongodb://localhost:27017/appdb',
});
```

## Cross-Dialect Safe APIs

These methods are valid across all supported dialects:

- `selectFrom(table).where(...).orderBy(...).limit(...).offset(...)`
- `insertInto(table).columns(...).values(...)`
- `updateTable(table).set(...).where(...)`
- `deleteFrom(table).where(...)`
- `fetch(builder)`
- `execute(builder)`
- `transaction(async (tx) => { ... })`
- `healthCheck()`
- `poolMetrics()` (may return `null`)
- `close()`

## MongoDB Capability Matrix

### Works on MongoDB

- Basic filters: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `inList`, `notInList`
- Pattern filters: `like`, `notLike`, `ilike` (compiled to regex)
- Null checks: `isNull`, `isNotNull`
- Boolean combinators: `and`, `or`
- DML via builders: insert / update / delete

### SQL-Only (throws `DbError` on MongoDB)

- JOINs, CTEs, GROUP BY, HAVING, aggregates
- Subqueries (`inSubquery`, `exists`, etc.)
- Raw SQL (`db.sql`, `rawExpr`)
- `RETURNING`, `onConflict` upserts
- `db.explain`, `db.stream`, `db.paginate`, `db.count`
- `migrateUp` / `migrateDown`

## Agent-Friendly Rules

When generating code automatically:

1. Check `db.dialect` before using SQL-specific methods.
2. Prefer builder APIs over raw SQL.
3. If `db.dialect === 'mongodb'`, avoid JOIN/CTE/subquery APIs entirely.
4. Catch `DbError` and surface the message directly; unsupported features already have descriptive text.

## Recommended Guard Pattern

```ts
import { DbError } from '@dbconn/core';

async function listUsers(db: ReturnType<typeof createClient>) {
  try {
    return await db.fetch(
      db.selectFrom('users')
        .selectColumns('id', 'email')
        .orderBy('id', 'asc')
        .limit(50),
    );
  } catch (err) {
    if (err instanceof DbError) {
      // Preserve unsupported-feature errors for callers and agents.
      throw new Error(`Database operation failed: ${err.message}`);
    }
    throw err;
  }
}
```
