# Changelog

## [0.3.0] - 2026-04-23

### Added
- **JOIN support** — `SelectBuilder.join()`, `.leftJoin()`, `.rightJoin()` with ON expressions; qualified `table.column` references in SELECT list and WHERE
- **Cursor pagination** — `paginate()` helper for stable keyset pagination, returns `nextCursor` / `hasMore`
- **Health check** — `DbClient.healthCheck()` pings the pool and returns `{ healthy, latencyMs, error? }`
- **`count()` shorthand** — `DbClient.count(builder)` returns the matching row count without boilerplate
- **onQuery chaining** — `onQuery` now accepts a single handler *or* an array for composing multiple observers
- **`DbClient.sql()`** — escape hatch for raw parameterized queries

## [0.2.0] - 2026-04-23

### Added
- **SSL flexibility** — `ssl` config now accepts `SslOptions` (`ca`, `cert`, `key`, `rejectUnauthorized`) in addition to `boolean`
- **GROUP BY / aggregates** — `SelectBuilder.groupBy()`, `.having()`, and `.aggregate()` for COUNT / SUM / AVG / MIN / MAX
- **Savepoints** — nested `transaction()` calls use `SAVEPOINT` / `RELEASE` / `ROLLBACK TO` instead of throwing
- **Streaming** — `DbClient.stream()` yields rows in configurable batches without loading the full result set
- **Raw SQL** — `DbClient.sql()` for executing arbitrary parameterized queries
- **Schema migrations** — `migrateUp` / `migrateDown` helpers with automatic `_dbconn_migrations` tracking table

## [0.1.0] - 2026-04-22

### Added
- Postgres and MySQL drivers (`pg`, `mysql2/promise`)
- `SelectBuilder`, `InsertBuilder`, `UpdateBuilder`, `DeleteBuilder`
- Expression helpers: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `and`, `or`, `inList`, `notInList`, `like`, `notLike`, `ilike`, `between`, `isNull`, `isNotNull`
- Typed error hierarchy: `DbError`, `ConnectionError`, `ConstraintError`, `QueryTimeoutError`
- Server-side query timeouts (`queryTimeoutMs`)
- `onQuery` observability hook
- `RETURNING` clause support (Postgres)
- Upsert via `onConflictDoNothing` / `onConflictDoUpdate`
- `parseConnectionUrl` for `DATABASE_URL` strings
- `DbClient.fetch()`, `execute()`, `returning()`, `transaction()`
