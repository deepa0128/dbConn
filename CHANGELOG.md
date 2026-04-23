# Changelog

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
