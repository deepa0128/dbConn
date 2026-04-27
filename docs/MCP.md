# @dbconn/core — MCP API Reference

This document is optimized for AI agents and MCP-compatible tooling. It provides a complete, structured reference for `@dbconn/core` — a universal database adapter for Postgres, MySQL, and MongoDB that exposes a unified query-builder API across all dialects.

---

## Quick reference

| Task | SQL (Postgres/MySQL) | MongoDB |
|---|---|---|
| Select rows | `db.fetch(db.selectFrom(...).where(...))` | same |
| Insert | `db.execute(db.insertInto(...).columns(...).values(...))` | same |
| Update | `db.execute(db.updateTable(...).set(...).where(...))` | same |
| Delete | `db.execute(db.deleteFrom(...).where(...))` | same |
| Count | `db.count(db.selectFrom(...).where(...))` | same — uses `countDocuments` |
| Transaction | `db.transaction(async tx => { ... })` | same — requires replica set |
| Raw query | `db.sql\`SELECT ...\`` | `db.aggregate(collection, pipeline)` |
| JOIN | `.join(table, on)` | `db.aggregate(..., [{ $lookup: {...} }])` |
| GROUP BY | `.groupBy(...).aggregate(...)` | `db.aggregate(..., [{ $group: {...} }])` |
| Stream rows | `db.stream(builder, batchSize)` | not supported — use `db.fetch()` |
| Cursor page | `db.paginate(builder, opts)` | not supported — use `db.fetch()` with `.limit().offset()` |
| Raw EXPLAIN | `db.explain(builder)` | not supported — use MongoDB Compass |
| Migrations | `migrateUp(db, migrations)` | same — tracking uses builder API |

---

## Connection

### SQL databases

```ts
import { createClient } from '@dbconn/core';

// Object config
const db = createClient({
  dialect: 'postgres',  // or 'mysql'
  host: 'localhost',
  port: 5432,           // default: 5432 (postgres), 3306 (mysql)
  user: 'app',
  password: 'secret',
  database: 'appdb',
  ssl: true,            // optional: true | false | { ca, cert, key, rejectUnauthorized }
  maxConnections: 10,   // default: 10
  queryTimeoutMs: 5000, // cancel query server-side after N ms
  maxRetries: 2,        // retry on transient ConnectionError (default: 0)
  retryDelayMs: 100,    // exponential backoff base delay
  onQuery: (event) => { // observability hook — fires after every query
    console.log(event.sql, event.durationMs, event.error);
  },
});

// URL string (also supported)
const db = createClient('postgres://user:pass@localhost:5432/appdb?ssl=true&connection_limit=20');
const db = createClient('mysql://user:pass@localhost:3306/appdb?query_timeout=3000');
```

### MongoDB

```ts
const db = createClient({
  dialect: 'mongodb',
  uri: 'mongodb://localhost:27017/appdb',         // mongodb:// or mongodb+srv://
  database: 'appdb',   // optional if database is in the URI path
  maxConnections: 10,  // maps to MongoClient maxPoolSize
  maxRetries: 2,
  retryDelayMs: 100,
  onQuery: (event) => {
    // event.sql is a descriptor like "[mongodb:find:users]" for MongoDB operations
    console.log(event.sql, event.durationMs);
  },
});

// URL string
const db = createClient('mongodb://user:pass@localhost:27017/appdb');
const db = createClient('mongodb+srv://user:pass@cluster.mongodb.net/appdb');
```

---

## Checking the dialect

Always check `db.dialect` before using dialect-specific methods. Methods that are not supported on a given dialect throw `DbError` with a descriptive message including the recommended alternative.

```ts
if (db.dialect === 'mongodb') {
  // use db.aggregate(), avoid db.sql() / db.explain() / db.stream() / db.paginate()
} else {
  // postgres or mysql: full SQL feature set available
}
```

---

## Builders (all dialects)

All builders validate identifiers against `/^[a-zA-Z_][a-zA-Z0-9_]*$/` at call time, preventing SQL injection.

### SELECT

```ts
const builder = db
  .selectFrom('users')              // required
  .selectColumns('id', 'email')     // default: '*'
  .where(eq('active', true))        // optional filter
  .orderBy('created_at', 'desc')    // optional sort
  .limit(20)                        // optional cap
  .offset(0);                       // optional offset

const rows = await db.fetch<{ id: number; email: string }>(builder);
```

### INSERT

```ts
const builder = db
  .insertInto('users')
  .columns('email', 'name')
  .values({ email: 'alice@example.com', name: 'Alice' })
  .values({ email: 'bob@example.com', name: 'Bob' }); // multi-row

await db.execute(builder);

// SQL only: ON CONFLICT
builder.onConflictDoNothing(['email']);  // Postgres: ON CONFLICT DO NOTHING; MySQL: INSERT IGNORE
builder.onConflictDoUpdate(['email'], ['name']); // Postgres: ON CONFLICT DO UPDATE; MySQL: ON DUPLICATE KEY UPDATE

// Postgres only: RETURNING
const rows = await db.fetch(builder.returning('id', 'email'));
```

### UPDATE

```ts
const builder = db
  .updateTable('users')
  .set('active', false)
  .set('updated_at', new Date())
  .where(eq('id', 42));

const { affectedRows } = await db.execute(builder);

// Postgres only: RETURNING
const rows = await db.fetch(builder.returning('id', 'email'));
```

### DELETE

```ts
const builder = db
  .deleteFrom('users')
  .where(eq('id', 42));

await db.execute(builder);

// Postgres only: RETURNING
const rows = await db.fetch(builder.returning('id'));
```

---

## Filter expressions

Import from `@dbconn/core`. All expressions work on both SQL and MongoDB (except `rawExpr`, `subquery`, `exists`, `notExists` which are SQL-only).

```ts
import {
  eq, ne, gt, gte, lt, lte,
  and, or,
  inList, notInList,
  like, notLike, ilike,
  between,
  isNull, isNotNull,
  rawExpr, subquery, exists, notExists,
} from '@dbconn/core';

// Comparisons
eq('status', 'active')       // SQL: status = 'active'    MongoDB: { status: 'active' }
ne('role', 'guest')          // SQL: role <> 'guest'      MongoDB: { role: { $ne: 'guest' } }
gt('age', 18)                // SQL: age > 18             MongoDB: { age: { $gt: 18 } }
gte('score', 100)
lt('price', 50)
lte('qty', 0)

// Boolean combinators
and(eq('active', true), gt('age', 18))
or(eq('role', 'admin'), eq('role', 'mod'))

// Lists
inList('status', ['active', 'pending'])    // SQL: IN (...)   MongoDB: { $in: [...] }
notInList('id', [1, 2, 3])                // SQL: NOT IN (...) MongoDB: { $nin: [...] }

// Pattern matching
like('email', '%@example.com')  // SQL: LIKE              MongoDB: /^.*@example\.com$/
notLike('name', 'test%')        // SQL: NOT LIKE          MongoDB: { $not: /^test.*$/ }
ilike('email', '%ALICE%')       // SQL: ILIKE (case-insensitive)  MongoDB: /^.*ALICE.*$/i
                                 // MySQL: LIKE (already case-insensitive)

// Range
between('age', 18, 65)          // SQL: BETWEEN 18 AND 65  MongoDB: { $gte: 18, $lte: 65 }

// Null checks
isNull('deleted_at')             // SQL: IS NULL    MongoDB: { deleted_at: null }
isNotNull('verified_at')         // SQL: IS NOT NULL  MongoDB: { $ne: null }

// SQL-only (throw DbError on MongoDB)
rawExpr('age > $1', [18])        // raw SQL fragment
subquery(db.selectFrom('banned').selectColumns('id'))
exists(subquery(...))
notExists(subquery(...))
```

### LIKE pattern rules for MongoDB

SQL LIKE wildcards are converted to regex:
- `%` → `.*` (any sequence of characters)
- `_` → `.` (any single character)
- All other regex metacharacters are escaped

Examples:
- `like('name', '%alice%')` → `/^.*alice.*$/`  (contains "alice")
- `like('name', 'alice%')` → `/^alice.*$/`     (starts with "alice")
- `like('name', '%alice')` → `/^.*alice$/`     (ends with "alice")
- `ilike('name', '%ALICE%')` → `/^.*ALICE.*$/i` (case-insensitive)

---

## Aggregates (SQL only)

```ts
// COUNT
const total = await db.count(db.selectFrom('users').where(eq('active', true)));

// SUM, AVG, MIN, MAX
const rows = await db.fetch(
  db.selectFrom('orders')
    .aggregate('sum', 'amount', 'total')
    .aggregate('count', '*', 'n')
    .groupBy('status'),
);
// rows: [{ status: 'shipped', total: 1250, n: 10 }, ...]
```

For MongoDB use `db.aggregate()`:
```ts
const result = await db.aggregate('orders', [
  { $group: { _id: '$status', total: { $sum: '$amount' }, n: { $count: {} } } },
]);
```

---

## JOINs (SQL only)

```ts
const rows = await db.fetch(
  db.selectFrom('orders', 'o')
    .selectColumns('o.id', 'u.email')
    .leftJoin('users', eq('o.user_id', 'u.id'), 'u')
    .where(eq('o.status', 'shipped')),
);
```

For MongoDB use `$lookup`:
```ts
const rows = await db.aggregate('orders', [
  { $match: { status: 'shipped' } },
  { $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: 'user' } },
  { $unwind: '$user' },
  { $project: { _id: 1, 'user.email': 1 } },
]);
```

---

## CTEs (SQL only)

```ts
const activeUsers = db.selectFrom('users').where(eq('active', true));
const rows = await db.fetch(
  db.selectFrom('orders')
    .with('active_users', activeUsers)
    .join('active_users', eq('orders.user_id', 'active_users.id')),
);
```

For MongoDB use `$facet` or multiple queries:
```ts
const [activeUsers, orders] = await Promise.all([
  db.fetch(db.selectFrom('users').where(eq('active', true))),
  db.fetch(db.selectFrom('orders')),
]);
```

---

## Transactions

```ts
await db.transaction(async (tx) => {
  await tx.execute(tx.updateTable('accounts').set('balance', 900).where(eq('id', 1)));
  await tx.execute(tx.updateTable('accounts').set('balance', 100).where(eq('id', 2)));
});
// Automatically rolled back if any operation throws
```

**MongoDB requirement**: Multi-document transactions require a replica set or sharded cluster. To enable in development:

```sh
# Single-node replica set for local development
mongod --replSet rs0
# In mongosh:
rs.initiate()
```

If the server does not support transactions, a descriptive `ConnectionError` is thrown.

---

## Raw MongoDB aggregation

`db.aggregate(collection, pipeline)` is the escape hatch for operations not expressible via the query builder. It is **MongoDB-only** — calling it on a SQL dialect throws `DbError`.

```ts
// GROUP BY equivalent
const sales = await db.aggregate<{ _id: string; revenue: number }>('orders', [
  { $match: { status: 'completed' } },
  { $group: { _id: '$region', revenue: { $sum: '$amount' } } },
  { $sort: { revenue: -1 } },
]);

// JOIN equivalent
const enriched = await db.aggregate('orders', [
  { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
  { $unwind: '$user' },
  { $project: { orderId: '$_id', email: '$user.email', amount: 1 } },
]);

// Upsert
await db.aggregate('products', [
  { $merge: { into: 'products', on: 'sku', whenMatched: 'merge', whenNotMatched: 'insert' } },
]);
```

---

## Raw SQL

`db.sql` is **SQL-only** — throws `DbError` on MongoDB.

```ts
// Tagged template (recommended — dialect-aware, injection-safe)
const rows = await db.sql<User>`SELECT * FROM users WHERE id = ${userId}`;

// Plain string (use when building SQL dynamically)
const rows = await db.sql<User>('SELECT * FROM users WHERE id = $1', [userId]); // Postgres
const rows = await db.sql<User>('SELECT * FROM users WHERE id = ?', [userId]);  // MySQL
```

---

## Count

Works on all dialects.

```ts
const total = await db.count(db.selectFrom('users').where(eq('active', true)));
// SQL:     SELECT COUNT(*) AS __n FROM users WHERE active = $1
// MongoDB: db.collection('users').countDocuments({ active: true })
```

---

## Stream

SQL only. For MongoDB use `db.fetch()` and process the returned array.

```ts
for await (const row of db.stream(db.selectFrom('events').orderBy('id'), 500)) {
  process(row);
}
```

---

## Cursor pagination

SQL only. For MongoDB, implement skip/limit pagination via `db.fetch()`:

```ts
// SQL
const page = await db.paginate(
  db.selectFrom('users').orderBy('id'),
  { cursorColumn: 'id', limit: 20, after: prevCursor },
);
// page.rows, page.nextCursor, page.hasMore

// MongoDB equivalent
const offset = 0;
const limit = 20;
const rows = await db.fetch(
  db.selectFrom('users').orderBy('id').limit(limit).offset(offset),
);
```

---

## Typed schema wrapper

Constrains table and column names to TypeScript types at compile time.

```ts
type Schema = {
  users: { id: number; email: string; active: boolean };
  orders: { id: number; user_id: number; amount: number; status: string };
};

const tdb = db.withSchema<Schema>();

// TypeScript error if table or column names are wrong:
const users = await tdb.selectFrom('users').selectColumns('id', 'email').fetch();
//                                                                ↑ typed to keyof Schema['users']
```

---

## Migrations

Works on all dialects. The `_dbconn_migrations` table (SQL) or collection (MongoDB) tracks applied migrations.

```ts
import { migrateUp, migrateDown } from '@dbconn/core';

const migrations = [
  {
    name: '001_create_users',
    async up(db) {
      // SQL
      await db.sql(`CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE)`);
      // MongoDB — use db.aggregate() or the native driver for index creation
      await db.aggregate('users', [{ $out: 'users' }]); // or use native driver
    },
    async down(db) {
      await db.sql(`DROP TABLE users`);
    },
  },
];

const applied = await migrateUp(db, migrations);
// applied: ['001_create_users']

const rolledBack = await migrateDown(db, migrations, 1);
```

**MongoDB note**: Migrations run outside a transaction on MongoDB. Wrap the body of `up`/`down` in `client.transaction()` explicitly if you need atomicity and your server supports it.

---

## Observability hook

The `onQuery` callback fires after every query or operation on all dialects.

```ts
const db = createClient({
  dialect: 'postgres',
  // ...
  onQuery({ sql, params, durationMs, error }) {
    if (error) logger.error({ sql, error });
    else logger.debug({ sql, durationMs });
  },
});
```

For MongoDB, `sql` is a descriptor string such as `[mongodb:find:users]` or `[mongodb:aggregate:orders]`.

---

## Health check and pool metrics

```ts
const { healthy, latencyMs, error } = await db.healthCheck();

const metrics = db.poolMetrics();
// Postgres: { totalConnections, idleConnections, waitingRequests }
// MySQL:    null (not exposed by mysql2)
// MongoDB:  null (not exposed by the driver)
```

---

## Error types

All errors extend `DbError`.

```ts
import { DbError, ConnectionError, ConstraintError, QueryTimeoutError } from '@dbconn/core';

try {
  await db.execute(db.insertInto('users').columns('email').values({ email: 'dup@example.com' }));
} catch (err) {
  if (err instanceof ConstraintError) {
    // err.constraint: 'unique' | 'not_null' | 'foreign_key'
    console.log('Duplicate value:', err.constraint);
  } else if (err instanceof ConnectionError) {
    // Network failure, auth rejection, or MongoDB replica set requirement
    console.log('Connection failed:', err.message);
  } else if (err instanceof QueryTimeoutError) {
    // SQL: server killed the query after queryTimeoutMs
    console.log('Query timed out');
  } else if (err instanceof DbError) {
    // Unsupported feature (e.g. JOIN on MongoDB) or other driver error
    // err.message always describes what went wrong and what to use instead
    console.log('DB error:', err.message);
  }
}
```

---

## AbortSignal support

`fetch()` and `execute()` accept an optional `AbortSignal` as the second argument. The promise rejects with `AbortError` if the signal fires. Note: this does not cancel the in-flight database query — it only rejects the JavaScript promise.

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 2000);

const rows = await db.fetch(builder, controller.signal);
```

---

## Agent decision guide

When generating code for an unknown dialect, follow this pattern:

```ts
if (db.dialect === 'mongodb') {
  // Use: fetch, execute, count, transaction, aggregate, healthCheck, close
  // Avoid: sql, explain, stream, paginate, JOIN builders, CTE builders,
  //        DISTINCT, GROUP BY, aggregates, RETURNING, onConflict, subquery, rawExpr
} else {
  // postgres or mysql: full feature set available
  // mysql-only gaps: no RETURNING, no FULL JOIN, poolMetrics() returns null
  // postgres-only features: RETURNING, ON CONFLICT DO UPDATE with targets, ILIKE
}
```

When a `DbError` is thrown with an "is not supported on MongoDB" message, the message always contains the recommended alternative — surface it directly to the caller.
