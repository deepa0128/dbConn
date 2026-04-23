# @dbconn/core

Universal database connector for **Node.js** with a **TypeScript query builder** — callers never write raw SQL strings. Supports Postgres and MySQL, selected via `dialect` in config.

## Install

```bash
npm install @dbconn/core
```

(`pg` and `mysql2` are bundled as dependencies — no separate install needed.)

## Quick start

```ts
import { createClient, eq, and } from '@dbconn/core';

const db = createClient({
  dialect: 'postgres',
  host: 'localhost',
  user: 'app',
  password: 'secret',
  database: 'app',
});

const rows = await db.fetch(
  db.selectFrom('users')
    .selectColumns('id', 'email')
    .where(and(eq('active', true), eq('tenant_id', 't1')))
    .orderBy('id', 'desc')
    .limit(10)
    .offset(0),
);

await db.close();
```

Switch to MySQL by changing `dialect`:

```ts
const db = createClient({
  dialect: 'mysql',
  host: 'localhost',
  user: 'app',
  password: 'secret',
  database: 'app',
});
```

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `dialect` | `'postgres' \| 'mysql'` | — | **Required.** Database engine |
| `host` | `string` | — | **Required.** Host name or IP |
| `port` | `number` | 5432 / 3306 | Port (defaults by dialect) |
| `user` | `string` | — | **Required.** Login user |
| `password` | `string` | — | **Required.** Login password |
| `database` | `string` | — | **Required.** Database name |
| `ssl` | `boolean` | `false` | Enable SSL with `rejectUnauthorized: true` |
| `maxConnections` | `number` | `10` | Connection pool size |

## API

### `createClient(config)` → `DbClient`

Creates a pooled client for the given dialect.

---

### SELECT

```ts
const rows = await db.fetch(
  db.selectFrom('orders')
    .selectColumns('id', 'total', 'status')   // omit → SELECT *
    .where(eq('status', 'pending'))
    .orderBy('created_at', 'desc')
    .limit(20)
    .offset(40),
);
```

`db.fetch(builder)` returns `Promise<Row[]>` where `Row = Record<string, unknown>`.

---

### INSERT

```ts
const result = await db.execute(
  db.insertInto('users')
    .columns('email', 'name', 'active')
    .values({ email: 'alice@example.com', name: 'Alice', active: true })
    .values({ email: 'bob@example.com',   name: 'Bob',   active: false }),
);
// result.affectedRows === 2
```

Multiple `.values()` calls insert multiple rows in a single statement.

---

### UPDATE

```ts
const result = await db.execute(
  db.updateTable('users')
    .set('active', false)
    .set('updated_at', new Date())
    .where(eq('id', 42)),
);
// result.affectedRows === 1
```

> **Warning:** omitting `.where()` updates **every row** in the table.

---

### DELETE

```ts
const result = await db.execute(
  db.deleteFrom('sessions')
    .where(lt('expires_at', new Date())),
);
```

> **Warning:** omitting `.where()` deletes **every row** in the table.

---

### Transactions

```ts
await db.transaction(async (tx) => {
  await tx.execute(
    tx.updateTable('accounts').set('balance', 900).where(eq('id', 1)),
  );
  await tx.execute(
    tx.updateTable('accounts').set('balance', 1100).where(eq('id', 2)),
  );
  // throws → automatic ROLLBACK
});
```

The callback receives a `DbClient` scoped to the transaction. Any thrown error triggers an automatic `ROLLBACK`; otherwise the transaction is `COMMIT`ted. Nested transactions are not supported.

---

### `db.close()`

Drains the connection pool. Call once on application shutdown.

---

## Expressions

Expressions are composable values passed to `.where()`.

| Function | SQL equivalent | Example |
|---|---|---|
| `eq(col, val)` | `col = $1` | `eq('status', 'active')` |
| `ne(col, val)` | `col <> $1` | `ne('role', 'admin')` |
| `gt(col, val)` | `col > $1` | `gt('age', 18)` |
| `gte(col, val)` | `col >= $1` | `gte('score', 100)` |
| `lt(col, val)` | `col < $1` | `lt('priority', 5)` |
| `lte(col, val)` | `col <= $1` | `lte('retries', 3)` |
| `inList(col, vals)` | `col IN ($1, $2, …)` | `inList('id', [1, 2, 3])` |
| `isNull(col)` | `col IS NULL` | `isNull('deleted_at')` |
| `isNotNull(col)` | `col IS NOT NULL` | `isNotNull('confirmed_at')` |
| `and(...exprs)` | `(a) AND (b) AND …` | `and(eq('active', true), gt('score', 0))` |
| `or(...exprs)` | `(a) OR (b) OR …` | `or(eq('role', 'admin'), eq('role', 'owner'))` |

`and()` with no arguments compiles to `TRUE`; `or()` with no arguments compiles to `FALSE`.

---

## Identifier safety

All table and column names are validated against `/^[a-zA-Z_][a-zA-Z0-9_]*$/` before any SQL is generated. Passing a name that fails this check (e.g. containing spaces, dots, quotes, or SQL keywords separated by special chars) throws a `TypeError` immediately — no raw SQL fragments ever reach the database driver.

You can use the exported helper directly:

```ts
import { assertSafeIdentifier } from '@dbconn/core';
assertSafeIdentifier(userSuppliedTableName, 'table');
```

---

## Build

```bash
npm run build   # compiles src/ → dist/ (ESM + .d.ts)
npm run clean   # removes dist/
```

Output is emitted to `dist/` as ESM with full declaration files.

Requires **Node.js ≥ 18**.

---

## Design notes

- **No raw SQL surface.** There is no `db.query(sql)` method. All queries go through builders, keeping SQL injection impossible at the API boundary.
- **Parameterized placeholders.** Postgres uses `$1, $2, …`; MySQL uses `?`. The dialect compiler handles this automatically.
- **Identifier quoting.** Postgres identifiers are double-quoted (`"col"`); MySQL identifiers are backtick-quoted (`` `col` ``).
- **Pooled connections.** Both drivers use connection pools (`pg.Pool` / `mysql2.createPool`), sized by `maxConnections`.
- **Internal AST.** Builders produce a plain-object AST (`SelectAst`, `InsertAst`, etc.) that the dialect compiler traverses — making it straightforward to add new dialects or query features.
