import { eq } from './builder/expr.js';
import type { DbClient, Row } from './client.js';

export type Migration = {
  /** Unique name, used as the primary key in the migrations table / collection. */
  name: string;
  up: (client: DbClient) => Promise<void>;
  down?: (client: DbClient) => Promise<void>;
};

const TABLE = '_dbconn_migrations';

// --- SQL helpers ---

function sqlIdent(client: DbClient, identifier: string): string {
  return client.dialect === 'postgres' ? `"${identifier}"` : `\`${identifier}\``;
}

function sqlPlaceholder(client: DbClient, index: number): string {
  return client.dialect === 'postgres' ? `$${index}` : '?';
}

async function sqlEnsureTable(client: DbClient): Promise<void> {
  const t = sqlIdent(client, TABLE);
  const tsType =
    client.dialect === 'postgres'
      ? 'TIMESTAMPTZ NOT NULL DEFAULT NOW()'
      : 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP';
  await client.sql(`CREATE TABLE IF NOT EXISTS ${t} (name VARCHAR(255) PRIMARY KEY, applied_at ${tsType})`);
}

async function sqlAppliedNames(client: DbClient): Promise<Set<string>> {
  const rows = await client.sql<Row & { name: string }>(
    `SELECT name FROM ${sqlIdent(client, TABLE)} ORDER BY applied_at`,
  );
  return new Set(rows.map((r) => r.name));
}

async function sqlRecordApplied(client: DbClient, name: string): Promise<void> {
  await client.sql(
    `INSERT INTO ${sqlIdent(client, TABLE)} (name) VALUES (${sqlPlaceholder(client, 1)})`,
    [name],
  );
}

async function sqlRemoveRecord(client: DbClient, name: string): Promise<void> {
  await client.sql(
    `DELETE FROM ${sqlIdent(client, TABLE)} WHERE name = ${sqlPlaceholder(client, 1)}`,
    [name],
  );
}

// --- MongoDB helpers (uses builder API; no raw SQL) ---

async function mongoAppliedNames(client: DbClient): Promise<Set<string>> {
  // MongoDB creates the collection automatically on first insert — no setup needed.
  const rows = await client.fetch<{ name: string }>(
    client.selectFrom(TABLE).selectColumns('name'),
  );
  return new Set(rows.map((r) => r.name));
}

async function mongoRecordApplied(client: DbClient, name: string): Promise<void> {
  await client.execute(
    client
      .insertInto(TABLE)
      .columns('name', 'applied_at')
      .values({ name, applied_at: new Date().toISOString() }),
  );
}

async function mongoRemoveRecord(client: DbClient, name: string): Promise<void> {
  await client.execute(
    client.deleteFrom(TABLE).where(eq('name', name)),
  );
}

// --- Dialect-aware wrappers ---

async function ensureTable(client: DbClient): Promise<void> {
  if (client.dialect !== 'mongodb') await sqlEnsureTable(client);
  // MongoDB: collection is created automatically on first insert
}

async function appliedNames(client: DbClient): Promise<Set<string>> {
  return client.dialect === 'mongodb'
    ? mongoAppliedNames(client)
    : sqlAppliedNames(client);
}

async function recordApplied(client: DbClient, name: string): Promise<void> {
  return client.dialect === 'mongodb'
    ? mongoRecordApplied(client, name)
    : sqlRecordApplied(client, name);
}

async function removeRecord(client: DbClient, name: string): Promise<void> {
  return client.dialect === 'mongodb'
    ? mongoRemoveRecord(client, name)
    : sqlRemoveRecord(client, name);
}

/**
 * Apply all pending migrations in order.
 *
 * On SQL dialects: each migration runs inside its own transaction — if it throws,
 * the transaction rolls back and the run halts.
 * Note: on MySQL, DDL statements (CREATE TABLE, ALTER TABLE, etc.) implicitly
 * commit and cannot be rolled back even inside a transaction.
 *
 * On MongoDB: migrations run without a wrapping transaction because multi-document
 * transactions require a replica set. If you need transactional migrations, wrap
 * the body of your `up` function in `client.transaction(async (tx) => { ... })`.
 *
 * Returns names of newly applied migrations.
 */
export async function migrateUp(client: DbClient, migrations: Migration[]): Promise<string[]> {
  await ensureTable(client);
  const applied = await appliedNames(client);
  const pending = migrations.filter((m) => !applied.has(m.name));
  const ran: string[] = [];

  for (const migration of pending) {
    if (client.dialect === 'mongodb') {
      // MongoDB: run without transaction wrapper (transactions require a replica set;
      // most index/collection migrations are not transactional anyway)
      await migration.up(client);
      await recordApplied(client, migration.name);
    } else {
      await client.transaction(async (tx) => {
        await migration.up(tx);
        await recordApplied(tx, migration.name);
      });
    }
    ran.push(migration.name);
  }

  return ran;
}

/**
 * Roll back the last `steps` applied migrations (default: 1).
 *
 * On SQL dialects: each rollback runs inside its own transaction.
 * On MongoDB: rollbacks run without a transaction wrapper.
 * Migrations without a `down` function are skipped.
 *
 * Returns names of rolled-back migrations.
 */
export async function migrateDown(
  client: DbClient,
  migrations: Migration[],
  steps = 1,
): Promise<string[]> {
  await ensureTable(client);
  const applied = await appliedNames(client);

  const toRollback = [...migrations]
    .reverse()
    .filter((m) => applied.has(m.name))
    .slice(0, steps);

  const ran: string[] = [];
  for (const migration of toRollback) {
    if (!migration.down) continue;
    if (client.dialect === 'mongodb') {
      await migration.down(client);
      await removeRecord(client, migration.name);
    } else {
      await client.transaction(async (tx) => {
        await migration.down!(tx);
        await removeRecord(tx, migration.name);
      });
    }
    ran.push(migration.name);
  }

  return ran;
}
