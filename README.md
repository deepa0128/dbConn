# @dbconn/core

Type-safe query builder and database client for **Postgres**, **MySQL**, and **MongoDB** in Node.js. No ORM magic — just a fluent builder that compiles to dialect-safe operations at runtime.

## Install

```bash
npm install @dbconn/core
```

`pg`, `mysql2`, and `mongodb` are bundled runtime dependencies — no separate install needed.

---

## Quick start

```ts
import { createClient, eq, and, gt } from '@dbconn/core';

const db = createClient({
  dialect: 'postgres',
  host: 'localhost',
  user: 'app',
  password: 'secret',
  database: 'mydb',
});

// SELECT
const users = await db.fetch(
  db.selectFrom('users')
    .selectColumns('id', 'email', 'created_at')
    .where(and(eq('active', true), gt('score', 0)))
    .orderBy('created_at', 'desc')
    .limit(20),
);

// INSERT
await db.execute(
  db.insertInto('users')
    .columns('email', 'name')
    .values({ email: 'alice@example.com', name: 'Alice' }),
);

await db.close();
```

Switch to MySQL with `dialect: 'mysql'`, or to MongoDB with `dialect: 'mongodb'`.

---

## Configuration

### Connection object

| Field | Type | Default | Description |
|---|---|---|---|
| `dialect` | `'postgres' \| 'mysql' \| 'mongodb'` | — | **Required** |
| `host` | `string` | — | **Required** |
| `port` | `number` | 5432 / 3306 | |
| `user` | `string` | — | **Required** |
| `password` | `string` | — | **Required** |
| `database` | `string` | — | **Required** |
| `ssl` | `boolean \| SslOptions` | `false` | `true` → `rejectUnauthorized: true`; pass `SslOptions` for custom CA/cert/key |
| `maxConnections` | `number` | `10` | Pool size |
| `queryTimeoutMs` | `number` | — | Server-side query kill after N ms |
| `onQuery` | `handler \| handler[]` | — | Observability hook — fires after every query |
| `maxRetries` | `number` | `0` | Retry transient `ConnectionError` up to N times |
| `retryDelayMs` | `number` | `100` | Initial retry delay (doubles each attempt) |

### DATABASE_URL

```ts
const db = createClient('postgres://user:pass@host:5432/mydb?ssl=true&connection_limit=20');
```

Supported query-string params: `ssl` / `sslmode`, `connection_limit`, `query_timeout`.

For MongoDB URLs (`mongodb://` / `mongodb+srv://`), the parser returns:
- `dialect: 'mongodb'`
- `uri`: full connection URI
- `database`: inferred from path when present

### SSL options

```ts
import { readFileSync } from 'node:fs';

const db = createClient({
  dialect: 'postgres',
  host: 'db.prod.example.com',
  // ...
  ssl: {
    ca: readFileSync('./certs/ca.pem', 'utf8'),
    cert: readFileSync('./certs/client.crt', 'utf8'),
    key: readFileSync('./certs/client.key', 'utf8'),
    rejectUnauthorized: true,
  },
});
```

---

## SELECT

```ts
const orders = await db.fetch(
  db.selectFrom('orders', 'o')               // optional alias
    .selectColumns('o.id', 'o.total', 'u.email')
    .join('users', eq('o.user_id', 'u.id'), 'inner', 'u')  // inner join with alias
    .leftJoin('coupons', eq('o.coupon_id', 'c.id'), 'c')
    .where(and(eq('o.status', 'paid'), gt('o.total', 100)))
    .groupBy('o.id', 'u.email')
    .having(gt('o.total', 50))
    .orderBy('o.created_at', 'desc')
    .limit(10)
    .offset(0)
    .distinct(),
);
```

### Aggregates

```ts
const stats = await db.fetch(
  db.selectFrom('orders')
    .selectColumns('status')
    .aggregate('count', '*', 'n')
    .aggregate('sum', 'total', 'revenue')
    .groupBy('status'),
);
// [{ status: 'paid', n: 42, revenue: 9800 }, ...]
```

### Count shorthand

```ts
const total = await db.count(db.selectFrom('users').where(eq('active', true)));
```

### Streaming (large result sets)

```ts
for await (const row of db.stream(db.selectFrom('events').orderBy('id'), 500)) {
  process(row);
}
```

Fetches in batches of `batchSize` (default 100) without loading the full result into memory.

### Cursor pagination

```ts
import { paginate } from '@dbconn/core';

let cursor: string | undefined;
do {
  const page = await paginate(db, db.selectFrom('users').orderBy('id'), {
    cursorColumn: 'id',
    limit: 50,
    after: cursor,
  });
  processPage(page.rows);
  cursor = page.nextCursor;
} while (page.hasMore);
```

More stable than OFFSET under concurrent writes.

---

### MongoDB behavior

MongoDB supports the core query builder flow (`selectFrom` / `where` / `orderBy` / `limit` / `offset`) plus `insertInto`, `updateTable`, and `deleteFrom`.

SQL-only features throw descriptive `DbError`s on MongoDB:
- `join`, CTEs (`with`), `groupBy`/aggregates/having, and subquery expressions
- `db.sql()`, `db.explain()`, `db.stream()`, `db.paginate()`, `db.count()`
- SQL migrations (`migrateUp`/`migrateDown`) and `RETURNING` / `onConflict`

MongoDB `transaction()` uses MongoDB sessions / `withTransaction()` and requires a replica set or mongos deployment.

---

## INSERT

```ts
// Single row
await db.execute(
  db.insertInto('users')
    .columns('email', 'name', 'active')
    .values({ email: 'alice@example.com', name: 'Alice', active: true }),
);

// Multiple rows (single statement)
await db.execute(
  db.insertInto('tags')
    .columns('name')
    .values({ name: 'typescript' })
    .values({ name: 'node' }),
);

// Upsert — do nothing on conflict
await db.execute(
  db.insertInto('users')
    .columns('email', 'name')
    .values({ email: 'alice@example.com', name: 'Alice' })
    .onConflictDoNothing(['email']),
);

// Upsert — update on conflict (Postgres: ON CONFLICT DO UPDATE; MySQL: ON DUPLICATE KEY UPDATE)
await db.execute(
  db.insertInto('users')
    .columns('email', 'name')
    .values({ email: 'alice@example.com', name: 'Alice v2' })
    .onConflictDoUpdate(['email'], ['name']),
);
```

### RETURNING (Postgres only)

```ts
const [newUser] = await db.returning(
  db.insertInto('users')
    .columns('email')
    .values({ email: 'bob@example.com' })
    .returning('id', 'created_at'),
);
```

---

## UPDATE

```ts
await db.execute(
  db.updateTable('users')
    .set('active', false)
    .set('updated_at', new Date())
    .where(eq('id', 42)),
);
```

> Omitting `.where()` updates **every row**.

---

## DELETE

```ts
await db.execute(
  db.deleteFrom('sessions').where(lt('expires_at', new Date())),
);
```

> Omitting `.where()` deletes **every row**.

---

## Expressions

All expressions are composable and passed to `.where()` or `.having()`.

| Function | SQL | Notes |
|---|---|---|
| `eq(col, val)` | `col = $1` | |
| `ne(col, val)` | `col <> $1` | |
| `gt(col, val)` | `col > $1` | |
| `gte(col, val)` | `col >= $1` | |
| `lt(col, val)` | `col < $1` | |
| `lte(col, val)` | `col <= $1` | |
| `inList(col, vals)` | `col IN (…)` | |
| `notInList(col, vals)` | `col NOT IN (…)` | |
| `like(col, pat)` | `col LIKE $1` | |
| `notLike(col, pat)` | `col NOT LIKE $1` | |
| `ilike(col, pat)` | `col ILIKE $1` | Postgres; falls back to LIKE on MySQL |
| `between(col, lo, hi)` | `col BETWEEN $1 AND $2` | |
| `isNull(col)` | `col IS NULL` | |
| `isNotNull(col)` | `col IS NOT NULL` | |
| `and(...exprs)` | `(a) AND (b)` | empty → `TRUE` |
| `or(...exprs)` | `(a) OR (b)` | empty → `FALSE` |
| `rawExpr(sql, params?)` | verbatim SQL | escape hatch; placeholders renumbered automatically |

```ts
.where(and(
  eq('status', 'active'),
  or(gt('score', 90), eq('role', 'admin')),
  rawExpr('age > EXTRACT(year FROM NOW()) - ?', [18]),
))
```

---

## Transactions

```ts
await db.transaction(async (tx) => {
  await tx.execute(tx.updateTable('accounts').set('balance', 900).where(eq('id', 1)));
  await tx.execute(tx.updateTable('accounts').set('balance', 1100).where(eq('id', 2)));
});
// throws → ROLLBACK; returns → COMMIT
```

### Nested transactions (savepoints)

```ts
await db.transaction(async (tx) => {
  await tx.execute(tx.insertInto('orders').columns('total').values({ total: 100 }));

  await tx.transaction(async (inner) => {
    // Uses SAVEPOINT sp_1 — can fail independently of the outer transaction
    await inner.execute(inner.insertInto('order_items').columns('order_id').values({ order_id: 1 }));
  });
});
```

---

## Schema migrations

### Programmatic

```ts
import { migrateUp, migrateDown } from '@dbconn/core';

const migrations = [
  {
    name: '001_create_users',
    async up(client) {
      await client.sql(`CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL)`);
    },
    async down(client) {
      await client.sql(`DROP TABLE users`);
    },
  },
];

await migrateUp(db, migrations);   // applies pending
await migrateDown(db, migrations); // rolls back last 1
```

Applied migrations are tracked in `_dbconn_migrations`.

### CLI (file-based)

```bash
# Apply all pending migrations from ./migrations/
npx dbconn migrate up --dir ./migrations --url postgres://...

# Roll back the last 2 migrations
npx dbconn migrate down --steps 2

# DATABASE_URL env var is used if --url is omitted
DATABASE_URL=postgres://... npx dbconn migrate up
```

Each migration file must export an `up(client)` function and optionally a `down(client)` function. Files are sorted lexicographically — use a numeric prefix (`001_`, `002_`) for ordering.

```ts
// migrations/001_create_users.ts
import type { DbClient } from '@dbconn/core';

export const name = '001_create_users'; // optional; defaults to filename

export async function up(client: DbClient) {
  await client.sql(`CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL)`);
}

export async function down(client: DbClient) {
  await client.sql(`DROP TABLE users`);
}
```

---

## Observability

### onQuery hook

```ts
const db = createClient({
  // ...
  onQuery: [
    ({ sql, params, durationMs }) => console.log(`[${durationMs}ms] ${sql}`),
    ({ error }) => { if (error) metrics.increment('db.errors'); },
  ],
});
```

Each handler receives `{ sql, params, durationMs, error? }`.

### Health check

```ts
const status = await db.healthCheck();
// { healthy: true, latencyMs: 2 }
```

### Pool metrics

```ts
const m = db.poolMetrics();
// { totalConnections: 5, idleConnections: 3, waitingRequests: 0 }
```

---

## AbortSignal

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000); // 5s client-side deadline

const rows = await db.fetch(
  db.selectFrom('reports'),
  controller.signal,
);
```

`fetch()`, `execute()`, and `sql()` all accept an optional `AbortSignal`.

---

## Error handling

All driver errors are normalized to a typed hierarchy:

| Class | When |
|---|---|
| `ConnectionError` | Network failure, auth rejected, unknown host |
| `QueryTimeoutError` | Server killed the query (via `queryTimeoutMs`) |
| `ConstraintError` | Unique, not-null, or foreign-key violation |
| `DbError` | Base class — any other database error |

```ts
import { ConstraintError, ConnectionError } from '@dbconn/core';

try {
  await db.execute(db.insertInto('users').columns('email').values({ email: existing }));
} catch (err) {
  if (err instanceof ConstraintError) {
    console.log('duplicate email:', err.constraint);
  } else if (err instanceof ConnectionError) {
    console.log('database unreachable');
  } else {
    throw err;
  }
}
```

---

## Raw SQL

```ts
const rows = await db.sql<{ count: string }>(
  'SELECT COUNT(*) AS count FROM users WHERE created_at > $1',
  [new Date('2024-01-01')],
);
```

Use `rawExpr()` to embed raw fragments inside a builder WHERE clause instead.

---

## Identifier safety

All table and column names are validated against `/^[a-zA-Z_][a-zA-Z0-9_]*$/` (or `table.column` for qualified refs). Invalid names throw a `TypeError` immediately — no injection can reach the driver.

```ts
import { assertSafeIdentifier } from '@dbconn/core';
assertSafeIdentifier(userInput, 'table'); // throws if unsafe
```

---

## Build & test

```bash
npm run build          # tsc → dist/ (ESM + .d.ts)
npm test               # unit tests (vitest)
npm run test:all       # unit + integration tests
npm run typecheck      # tsc --noEmit
```

Requires **Node.js ≥ 18**.
