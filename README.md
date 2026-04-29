# @dbconn/core

A database client for Node.js that works the same way whether you're using **Postgres**, **MySQL**, or **MongoDB**. Write your queries once using a simple builder API — the library takes care of translating them into the correct format for each database and keeps your values safe from SQL injection.

No ORM magic, no schema files, no code generation. Just a thin, predictable layer between your code and your database.

```bash
npm install @dbconn/core
```

The `pg`, `mysql2`, and `mongodb` packages are included — you don't need to install them separately.

---

## Table of contents

1. [Connecting to a database](#1-connecting-to-a-database)
2. [Reading data](#2-reading-data)
3. [Filtering results](#3-filtering-results)
4. [Writing data](#4-writing-data)
5. [Updating data](#5-updating-data)
6. [Deleting data](#6-deleting-data)
7. [Joins](#7-joins)
8. [Counting and aggregating](#8-counting-and-aggregating)
9. [Transactions](#9-transactions)
10. [Large datasets](#10-large-datasets)
11. [Migrations](#11-migrations)
12. [TypeScript schema types](#12-typescript-schema-types)
13. [Raw SQL](#13-raw-sql)
14. [MongoDB](#14-mongodb)
15. [Error handling](#15-error-handling)
16. [Monitoring and health](#16-monitoring-and-health)
17. [Configuration reference](#17-configuration-reference)

---

## 1. Connecting to a database

### Using a connection URL

The easiest way — paste your database URL directly:

```ts
import { createClient } from '@dbconn/core';

const db = createClient('postgres://alice:secret@localhost:5432/myapp');
```

URLs work for all three databases:

```ts
// Postgres
createClient('postgres://user:pass@host:5432/dbname')
createClient('postgresql://user:pass@host:5432/dbname') // same thing

// MySQL
createClient('mysql://user:pass@host:3306/dbname')

// MongoDB
createClient('mongodb://user:pass@host:27017/dbname')
createClient('mongodb+srv://user:pass@cluster.mongodb.net/dbname') // Atlas
```

### Reading the URL from an environment variable

In production you'll store your database URL in an environment variable. Use `createClientFromEnv` so you get a clear error message immediately if it's missing, rather than a confusing failure on the first query:

```ts
import { createClientFromEnv } from '@dbconn/core';

// Reads process.env.DATABASE_URL — throws immediately if not set
const db = createClientFromEnv();

// Or specify a different variable name
const db = createClientFromEnv('POSTGRES_URL');
```

### Using a config object

When you need fine-grained control over timeouts, pool size, or SSL:

```ts
const db = createClient({
  dialect: 'postgres',  // 'postgres' | 'mysql' | 'mongodb'
  host: 'localhost',
  port: 5432,
  user: 'alice',
  password: 'secret',
  database: 'myapp',
});
```

### Always close the connection when done

```ts
await db.close();
```

In a long-running server you typically create one client at startup and never close it. In scripts or serverless functions, close it when the work is finished.

### Optional URL parameters

You can tune the connection via query-string parameters:

```ts
// Set pool size and enable SSL
createClient('postgres://user:pass@host/db?connection_limit=20&ssl=true')

// Set a server-side query timeout (cancels slow queries after 5 seconds)
createClient('mysql://user:pass@host/db?query_timeout=5000')
```

### SSL certificates

For databases that require a custom certificate (common with managed cloud databases):

```ts
import { readFileSync } from 'node:fs';

const db = createClient({
  dialect: 'postgres',
  host: 'db.prod.example.com',
  user: 'app',
  password: 'secret',
  database: 'myapp',
  ssl: {
    ca: readFileSync('./certs/ca.pem', 'utf8'),
    rejectUnauthorized: true,
  },
});
```

---

## 2. Reading data

Use `db.fetch()` to run a SELECT query and get the results as an array of objects. Every property in the returned objects matches a column in your database.

```ts
// Get all users
const users = await db.fetch(db.selectFrom('users'));

// Get specific columns
const users = await db.fetch(
  db.selectFrom('users').selectColumns('id', 'email', 'created_at')
);

// Sort, limit, and skip
const recent = await db.fetch(
  db.selectFrom('posts')
    .orderBy('created_at', 'desc')
    .limit(10)
    .offset(20),        // skip the first 20 (for page 3 of 10-per-page)
);
```

### Getting a single row

When you expect exactly one result (like looking up a user by ID), use `fetchOne` instead of `fetch`. It returns the first row, or `undefined` if nothing matches — so you don't have to write `rows[0]` everywhere:

```ts
const user = await db.fetchOne(
  db.selectFrom('users').where(eq('id', userId))
);

if (!user) {
  // nothing found
}
```

### Typing the result

TypeScript can't automatically know which columns your query returns, so you can supply a type:

```ts
type User = { id: number; email: string; created_at: Date };

const users = await db.fetch<User>(db.selectFrom('users'));
// users is User[]
```

---

## 3. Filtering results

Import the filter helpers from the package and pass them to `.where()`:

```ts
import { eq, ne, gt, gte, lt, lte, and, or, not,
         inList, notInList, like, ilike, between,
         isNull, isNotNull } from '@dbconn/core';
```

### Basic comparisons

```ts
.where(eq('status', 'active'))        // status = 'active'
.where(ne('role', 'guest'))           // role != 'guest'
.where(gt('age', 18))                 // age > 18
.where(gte('score', 100))             // score >= 100
.where(lt('priority', 5))             // priority < 5
.where(lte('retries', 3))             // retries <= 3
```

### Combining conditions

```ts
// Both must be true
.where(and(eq('active', true), gt('score', 50)))

// Either can be true
.where(or(eq('role', 'admin'), eq('role', 'owner')))

// Negate any condition
.where(not(eq('status', 'banned')))

// Nested logic
.where(and(
  eq('active', true),
  or(gt('score', 90), eq('role', 'admin'))
))
```

### Building up filters incrementally

Sometimes you don't know all the conditions up front. Use `andWhere` to add conditions one at a time without overwriting the previous ones:

```ts
let query = db.selectFrom('products').where(eq('active', true));

if (categoryId) {
  query = query.andWhere(eq('category_id', categoryId));
}

if (minPrice) {
  query = query.andWhere(gte('price', minPrice));
}

const products = await db.fetch(query);
```

### List checks

```ts
// status is one of these values
.where(inList('status', ['active', 'pending', 'trial']))

// id is not in this list
.where(notInList('id', [1, 2, 3]))
```

### Text search

```ts
// Starts with "alice" (case-sensitive)
.where(like('name', 'alice%'))

// Contains "example.com" anywhere (case-insensitive, Postgres)
.where(ilike('email', '%example.com%'))
```

Pattern characters: `%` matches any number of characters, `_` matches exactly one character.

### Range checks

```ts
.where(between('age', 18, 65))        // age BETWEEN 18 AND 65
.where(isNull('deleted_at'))           // deleted_at IS NULL (not deleted)
.where(isNotNull('verified_at'))       // verified_at IS NOT NULL (verified)
```

### Distinct results

Remove duplicate rows from the result:

```ts
const cities = await db.fetch(
  db.selectFrom('users').selectColumns('city').distinct()
);
```

---

## 4. Writing data

### Insert a single row

```ts
await db.execute(
  db.insertInto('users')
    .columns('email', 'name', 'active')
    .values({ email: 'alice@example.com', name: 'Alice', active: true })
);
```

### Insert multiple rows at once

More efficient than inserting one at a time — sends a single statement to the database:

```ts
await db.execute(
  db.insertInto('tags')
    .columns('name', 'slug')
    .values({ name: 'TypeScript', slug: 'typescript' })
    .values({ name: 'Node.js',   slug: 'nodejs' })
    .values({ name: 'Postgres',  slug: 'postgres' })
);
```

### Insert thousands of rows (batch insert)

When you have a large array, `batchInsert` automatically splits it into safe chunks so you don't hit database limits:

```ts
const rows = products.map(p => ({ name: p.name, price: p.price, sku: p.sku }));

await db.batchInsert('products', rows);          // default: 500 rows per chunk
await db.batchInsert('products', rows, 100);     // or specify your own chunk size
```

### Upsert — insert or ignore on conflict

If a row with the same email already exists, do nothing:

```ts
await db.execute(
  db.insertInto('users')
    .columns('email', 'name')
    .values({ email: 'alice@example.com', name: 'Alice' })
    .onConflictDoNothing(['email'])  // ['email'] = which column triggers the conflict
);
```

### Upsert — insert or update on conflict

If the email already exists, update the name instead of failing:

```ts
await db.execute(
  db.insertInto('users')
    .columns('email', 'name')
    .values({ email: 'alice@example.com', name: 'Alice Updated' })
    .onConflictDoUpdate(['email'], ['name'])  // conflict on email → update name
);
```

### Get the inserted row back (Postgres only)

Use `.returning()` and call `db.fetch()` instead of `db.execute()` to get the newly created row, including database-generated values like `id` and `created_at`:

```ts
const [newUser] = await db.fetch(
  db.insertInto('users')
    .columns('email')
    .values({ email: 'bob@example.com' })
    .returning('id', 'email', 'created_at')
);

console.log(newUser.id); // the generated ID
```

---

## 5. Updating data

```ts
await db.execute(
  db.updateTable('users')
    .set('active', false)
    .set('updated_at', new Date())
    .where(eq('id', 42))
);
```

You can chain multiple `.set()` calls to update several columns at once.

> **Warning:** Omitting `.where()` updates **every row** in the table.

### Get the updated row back (Postgres only)

```ts
const [updated] = await db.fetch(
  db.updateTable('users')
    .set('name', 'Alice Smith')
    .where(eq('id', 42))
    .returning('id', 'name', 'updated_at')
);
```

---

## 6. Deleting data

```ts
await db.execute(
  db.deleteFrom('sessions')
    .where(lt('expires_at', new Date()))  // delete all expired sessions
);
```

> **Warning:** Omitting `.where()` deletes **every row** in the table.

### Get the deleted row back (Postgres only)

```ts
const [deleted] = await db.fetch(
  db.deleteFrom('users')
    .where(eq('id', 42))
    .returning('id', 'email')
);
```

---

## 7. Joins

Joins let you combine data from multiple tables in a single query.

```ts
import { eq } from '@dbconn/core';

const orders = await db.fetch(
  db.selectFrom('orders', 'o')                          // 'o' is a table alias
    .selectColumns('o.id', 'o.total', 'u.email')
    .join('users', eq('o.user_id', 'u.id'), 'inner', 'u')
    .where(eq('o.status', 'paid'))
    .orderBy('o.created_at', 'desc')
    .limit(20)
);
```

| Method | SQL equivalent | When to use |
|---|---|---|
| `.join(table, on)` | `INNER JOIN` | Only rows that have a match in both tables |
| `.leftJoin(table, on)` | `LEFT JOIN` | All rows from the left table, matched rows from right (or null) |
| `.rightJoin(table, on)` | `RIGHT JOIN` | All rows from the right table, matched rows from left (or null) |

### CTEs (named subqueries)

CTEs let you name a subquery and reference it later in the same query. Useful for breaking up complex logic into readable steps:

```ts
// First, define the subquery
const activeUsers = db.selectFrom('users').where(eq('active', true));

// Then use it as a named "table" in the main query
const orders = await db.fetch(
  db.selectFrom('orders')
    .with('active_users', activeUsers)                  // give it a name
    .join('active_users', eq('orders.user_id', 'active_users.id'))
    .where(eq('orders.status', 'pending'))
);
```

---

## 8. Counting and aggregating

### Count matching rows

```ts
const total = await db.count(
  db.selectFrom('users').where(eq('active', true))
);
console.log(`${total} active users`);
```

### Sum, average, min, max

```ts
const stats = await db.fetch(
  db.selectFrom('orders')
    .selectColumns('status')
    .aggregate('count', '*', 'order_count')      // COUNT(*) AS order_count
    .aggregate('sum', 'total', 'revenue')         // SUM(total) AS revenue
    .aggregate('avg', 'total', 'avg_order')       // AVG(total) AS avg_order
    .groupBy('status')
    .orderBy('revenue', 'desc')
);
// [{ status: 'paid', order_count: 42, revenue: 9800, avg_order: 233 }, ...]
```

### Filter aggregate results

Use `.having()` to filter after grouping (like a WHERE clause for aggregate results):

```ts
const highValueStatuses = await db.fetch(
  db.selectFrom('orders')
    .selectColumns('status')
    .aggregate('sum', 'total', 'revenue')
    .groupBy('status')
    .having(gt('revenue', 10000))    // only statuses with total revenue > 10,000
);
```

---

## 9. Transactions

A transaction groups multiple operations so they either all succeed or all fail together. If anything goes wrong inside the callback, the database automatically reverts all the changes.

```ts
await db.transaction(async (tx) => {
  // Move $100 from account 1 to account 2
  await tx.execute(
    tx.updateTable('accounts').set('balance', 900).where(eq('id', 1))
  );
  await tx.execute(
    tx.updateTable('accounts').set('balance', 1100).where(eq('id', 2))
  );
  // If either update fails, both are rolled back automatically
});
```

Always use the `tx` client passed into the callback — not the outer `db` — for operations that should be part of the transaction.

### Nested transactions

Nesting a `transaction()` call inside another one automatically uses a database savepoint, so the inner block can fail and be retried without affecting the outer transaction:

```ts
await db.transaction(async (tx) => {
  await tx.execute(tx.insertInto('orders').columns('total').values({ total: 100 }));

  try {
    await tx.transaction(async (inner) => {
      // This can fail without rolling back the order above
      await inner.execute(
        inner.insertInto('inventory').columns('sku').values({ sku: 'ABC' })
      );
    });
  } catch {
    // Inner block failed — the order is still safe
    console.log('Inventory update failed, but order was saved');
  }
});
```

---

## 10. Large datasets

### Stream rows one at a time

When a query might return thousands of rows, streaming lets you process them one at a time instead of loading everything into memory at once:

```ts
for await (const event of db.stream(db.selectFrom('events').orderBy('id'), 500)) {
  await processEvent(event);
}
```

The second argument (500) is how many rows are fetched from the database in each round-trip. Tune it based on row size — bigger batches are more efficient but use more memory.

### Paginate through large result sets

For user-facing lists, cursor pagination is more reliable than page numbers. Page numbers can skip or repeat rows when new data is inserted during navigation; cursor pagination stays stable:

```ts
import { migrateUp } from '@dbconn/core'; // (just showing the import pattern)

let cursor: string | undefined;

do {
  const page = await db.paginate(
    db.selectFrom('users').orderBy('id'),
    {
      cursorColumn: 'id',   // the column used as the cursor (must be unique & sortable)
      limit: 50,             // rows per page
      after: cursor,         // pass undefined for the first page
    }
  );

  showPage(page.rows);
  cursor = page.nextCursor;   // pass this to the next call for the next page
} while (page.hasMore);
```

Works on Postgres, MySQL, and MongoDB.

### Cancel a long-running query

Pass an `AbortSignal` to cancel if the user navigates away or a timeout fires. This rejects the promise on the JavaScript side — it does not cancel the query on the database server (use `queryTimeoutMs` for server-side cancellation):

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000); // give up after 5 seconds

const rows = await db.fetch(
  db.selectFrom('large_reports'),
  controller.signal,
);
```

`fetch()`, `fetchOne()`, `execute()`, `aggregate()`, and `sql()` all accept an optional signal as their last argument.

---

## 11. Migrations

Migrations are versioned scripts that update your database schema over time. They let you evolve your schema alongside your code and roll changes back if something goes wrong.

### Creating a migration file

Use the CLI to scaffold a new migration file with the correct format:

```bash
npx dbconn migrate create add_user_roles --dir ./migrations
```

This creates a timestamped file like `20250429153012_add_user_roles.ts` that you fill in:

```ts
// migrations/20250429153012_add_user_roles.ts
import type { DbClient } from '@dbconn/core';

export const name = '20250429153012_add_user_roles';

export async function up(client: DbClient) {
  await client.sql(`
    ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'
  `);
}

export async function down(client: DbClient) {
  await client.sql(`
    ALTER TABLE users DROP COLUMN role
  `);
}
```

### Running migrations

```bash
# See what's been applied and what's pending
npx dbconn migrate status --url postgres://user:pass@host/db

# Apply all pending migrations
npx dbconn migrate up --url postgres://user:pass@host/db

# Roll back the last migration
npx dbconn migrate down --url postgres://user:pass@host/db

# Roll back the last 3 migrations
npx dbconn migrate down --steps 3

# Use DATABASE_URL from environment instead of --url
DATABASE_URL=postgres://... npx dbconn migrate up

# Validate migrations without applying them (SQL only)
npx dbconn migrate up --dry-run
```

Files are sorted alphabetically, so the timestamp prefix in the filename guarantees correct ordering.

### Migrations in code

You can also run migrations programmatically — useful in test setup or application startup:

```ts
import { migrateUp, migrateDown, migrateStatus } from '@dbconn/core';

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

// Check status without running anything
const { applied, pending } = await migrateStatus(db, migrations);
console.log('Applied:', applied);
console.log('Pending:', pending);

// Apply what's pending
const ran = await migrateUp(db, migrations);
console.log('Ran:', ran); // names of newly applied migrations

// Roll back the last one
await migrateDown(db, migrations, 1);
```

Applied migrations are tracked in a `_dbconn_migrations` table (or collection on MongoDB) that is created automatically.

---

## 12. TypeScript schema types

If you define your database schema as a TypeScript type, you get autocomplete and type errors when you use wrong table or column names:

```ts
type MyDatabase = {
  users: { id: number; email: string; name: string; active: boolean };
  orders: { id: number; user_id: number; total: number; status: string };
};

const tdb = db.withSchema<MyDatabase>();

// TypeScript knows 'users' is a valid table and 'email' is a valid column
const users = await tdb.selectFrom('users').selectColumns('id', 'email').fetch();
//                                                                  ↑ TypeScript error if you typo this

// TypeScript checks column names and value types on insert
await tdb.insertInto('users')
  .columns('email', 'name', 'active')
  .values({ email: 'alice@example.com', name: 'Alice', active: true })
  .execute();

// TypeScript checks the column name on set
await tdb.updateTable('orders')
  .set('status', 'shipped')   // ← error if 'status' isn't in the orders schema
  .where(eq('id', orderId))
  .execute();
```

The typed client has the same methods as the regular `db` object — the only difference is TypeScript's checks at compile time.

---

## 13. Raw SQL

When you need to write SQL that the builder can't express, drop down to raw SQL:

```ts
// Tagged template (recommended) — values are automatically parameterized
const users = await db.sql`SELECT * FROM users WHERE id = ${userId}`;

// With explicit typing
const rows = await db.sql<{ id: number; email: string }>`
  SELECT id, email FROM users WHERE created_at > ${since} LIMIT ${limit}
`;

// Plain string form (useful when building SQL dynamically)
const rows = await db.sql<User>(
  'SELECT * FROM users WHERE id = $1',  // Postgres uses $1, MySQL uses ?
  [userId]
);
```

### Embed raw SQL inside a builder

Use `rawExpr` when you need a raw fragment inside a `.where()` clause but want to keep the rest of the builder:

```ts
import { rawExpr } from '@dbconn/core';

const adults = await db.fetch(
  db.selectFrom('users')
    .where(rawExpr(`age > EXTRACT(year FROM NOW()) - 18`))
    .orderBy('name')
);
```

### Query the schema

List all tables (or MongoDB collections) in the current database:

```ts
const tables = await db.listTables();
// ['orders', 'sessions', 'users']
```

### Debug a slow query

`explain` shows the database's query execution plan — useful for diagnosing why a query is slow:

```ts
const plan = await db.explain(
  db.selectFrom('orders').where(eq('user_id', 42))
);
console.log(plan); // Postgres: [{ "QUERY PLAN": "Index Scan on orders..." }]
```

---

## 14. MongoDB

MongoDB uses the same builder API for basic operations. Just connect with a `mongodb://` URL or a `dialect: 'mongodb'` config and the library routes everything correctly:

```ts
const db = createClient('mongodb://localhost:27017/myapp');
// or
const db = createClient({
  dialect: 'mongodb',
  uri: 'mongodb+srv://user:pass@cluster.mongodb.net/myapp',
  database: 'myapp',
});
```

The core operations work the same as SQL:

```ts
// These work identically on MongoDB
await db.fetch(db.selectFrom('users').where(eq('active', true)).limit(10));
await db.execute(db.insertInto('events').columns('type', 'data').values({ type: 'click', data: '{}' }));
await db.execute(db.updateTable('users').set('active', false).where(eq('id', userId)));
await db.execute(db.deleteFrom('sessions').where(lt('expires_at', new Date())));
await db.count(db.selectFrom('orders').where(eq('status', 'pending')));
await db.stream(db.selectFrom('events').orderBy('_id'), 200); // native cursor, no LIMIT/OFFSET
await db.paginate(db.selectFrom('users').orderBy('_id'), { cursorColumn: '_id', limit: 50 });
```

### MongoDB-specific operations

For operations that don't map cleanly to the SQL builder (aggregations, lookups, grouping), use `db.aggregate()` with the native MongoDB pipeline syntax:

```ts
// GROUP BY equivalent
const salesByRegion = await db.aggregate('orders', [
  { $match: { status: 'completed' } },
  { $group: { _id: '$region', revenue: { $sum: '$amount' } } },
  { $sort: { revenue: -1 } },
]);

// JOIN equivalent (using $lookup)
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

### MongoDB transactions

Transactions on MongoDB require the server to be running as a replica set. For local development:

```bash
# Start MongoDB with replica set support
mongod --replSet rs0

# In the MongoDB shell, run once to initialize:
rs.initiate()
```

Then transactions work the same way as SQL:

```ts
await db.transaction(async (tx) => {
  await tx.execute(tx.updateTable('accounts').set('balance', 900).where(eq('id', 1)));
  await tx.execute(tx.updateTable('accounts').set('balance', 1100).where(eq('id', 2)));
});
```

### What doesn't work on MongoDB

Some SQL features have no direct MongoDB equivalent and will throw a clear error with a suggested alternative:

| Not supported | Use instead |
|---|---|
| `JOIN` in builder | `db.aggregate()` with `$lookup` |
| `groupBy` / `aggregate()` in builder | `db.aggregate()` with `$group` |
| `with()` (CTEs) | Separate `db.fetch()` calls |
| `db.sql()` | `db.aggregate()` with the native pipeline |
| `onConflict` / `RETURNING` | Native MongoDB driver or `db.aggregate()` with `$merge` |

---

## 15. Error handling

Every error thrown by the library is an instance of `DbError`, with more specific subclasses for common cases:

```ts
import { DbError, ConnectionError, ConstraintError, QueryTimeoutError } from '@dbconn/core';

try {
  await db.execute(
    db.insertInto('users').columns('email').values({ email: 'existing@example.com' })
  );
} catch (err) {
  if (err instanceof ConstraintError) {
    // A unique, not-null, or foreign-key constraint was violated
    // err.constraint: 'unique' | 'not_null' | 'foreign_key'
    console.log('Duplicate email');

  } else if (err instanceof ConnectionError) {
    // Network failure, wrong password, host not reachable
    console.log('Could not reach database');

  } else if (err instanceof QueryTimeoutError) {
    // The query ran longer than queryTimeoutMs and was cancelled by the server
    console.log('Query timed out');

  } else if (err instanceof DbError) {
    // Catch-all for any other database error
    // err.message always describes what went wrong
    throw err;
  }
}
```

### Automatic retries

Transient connection failures (network blip, connection reset) can be retried automatically:

```ts
const db = createClient({
  dialect: 'postgres',
  // ...
  maxRetries: 3,         // retry up to 3 times
  retryDelayMs: 100,     // wait 100ms before first retry, doubling each time (with jitter)
  retryTransientTimeouts: true,  // also retry on query timeouts, not just connection failures
});
```

---

## 16. Monitoring and health

### Check if the database is reachable

Good for health-check endpoints or startup validation:

```ts
const { healthy, latencyMs, error } = await db.healthCheck();

if (!healthy) {
  console.error('Database is down:', error);
}
```

### Connection pool stats

See how many connections are active, idle, or waiting (Postgres only — returns `null` on MySQL and MongoDB):

```ts
const metrics = db.poolMetrics();
// { totalConnections: 8, idleConnections: 5, waitingRequests: 0 }
```

### Log every query

The `onQuery` hook fires after every query with timing and error information. You can pass a single function or an array of functions:

```ts
const db = createClient({
  dialect: 'postgres',
  // ...
  onQuery: [
    // Log slow queries
    ({ sql, durationMs }) => {
      if (durationMs > 500) console.warn(`Slow query (${durationMs}ms): ${sql}`);
    },
    // Count errors in your metrics system
    ({ error }) => {
      if (error) metrics.increment('db.query.error');
    },
  ],
});
```

Each handler receives `{ sql, params, durationMs, error? }`. On MongoDB, `sql` is a descriptor like `[mongodb:find:users]`.

---

## 17. Configuration reference

### All options

| Option | Type | Default | Description |
|---|---|---|---|
| `dialect` | `'postgres' \| 'mysql' \| 'mongodb'` | **required** | Which database to connect to |
| `host` | `string` | **required** | Database server hostname |
| `port` | `number` | 5432 / 3306 | Port (uses dialect default if omitted) |
| `user` | `string` | **required** | Login username |
| `password` | `string` | **required** | Login password |
| `database` | `string` | **required** | Database name |
| `ssl` | `boolean \| SslOptions` | `false` | `true` enables SSL; pass an object for custom cert/CA |
| `maxConnections` | `number` | `10` | Connection pool size |
| `queryTimeoutMs` | `number` | none | Cancel queries that take longer than this (milliseconds) |
| `maxRetries` | `number` | `0` | Automatically retry transient failures up to N times |
| `retryDelayMs` | `number` | `100` | Initial delay before first retry; doubles each time |
| `retryTransientTimeouts` | `boolean` | `false` | Also retry on query timeouts, not just connection failures |
| `onQuery` | `function \| function[]` | none | Hook called after every query with timing and error info |

MongoDB uses `uri` instead of `host`/`port`/`user`/`password`:

| Option | Type | Description |
|---|---|---|
| `dialect` | `'mongodb'` | **required** |
| `uri` | `string` | **required** — full `mongodb://` or `mongodb+srv://` connection string |
| `database` | `string` | Database name (can also be in the URI path) |
| `maxConnections` | `number` | Maps to `maxPoolSize` in the MongoDB driver |
| `maxRetries` | `number` | Same as SQL |
| `retryDelayMs` | `number` | Same as SQL |
| `retryTransientTimeouts` | `boolean` | Same as SQL |
| `onQuery` | `function \| function[]` | Same as SQL |

### URL query-string shortcuts

When connecting via URL, these query-string parameters are recognised:

| Parameter | Maps to |
|---|---|
| `ssl=true` or `sslmode=require` | `ssl: true` |
| `connection_limit=N` or `pool_size=N` | `maxConnections: N` |
| `query_timeout=N` | `queryTimeoutMs: N` |
| `maxPoolSize=N` (MongoDB) | `maxConnections: N` |

---

## Build and test

```bash
npm run build        # compile TypeScript to dist/
npm test             # run unit tests
npm run test:all     # unit tests + integration tests (needs a running database)
npm run typecheck    # type-check without building
```

Requires **Node.js 18 or later**.
