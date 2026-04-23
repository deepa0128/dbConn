import type { DbClient, Row } from './client.js';

export type Migration = {
  /** Unique name, used as the primary key in the migrations table. */
  name: string;
  up: (client: DbClient) => Promise<void>;
  down?: (client: DbClient) => Promise<void>;
};

const TABLE = '_dbconn_migrations';

function q(client: DbClient, identifier: string): string {
  return client.dialect === 'postgres' ? `"${identifier}"` : `\`${identifier}\``;
}

function placeholder(client: DbClient, index: number): string {
  return client.dialect === 'postgres' ? `$${index}` : '?';
}

async function ensureTable(client: DbClient): Promise<void> {
  const t = q(client, TABLE);
  const tsType =
    client.dialect === 'postgres'
      ? 'TIMESTAMPTZ NOT NULL DEFAULT NOW()'
      : 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP';
  await client.sql(`CREATE TABLE IF NOT EXISTS ${t} (name VARCHAR(255) PRIMARY KEY, applied_at ${tsType})`);
}

async function appliedNames(client: DbClient): Promise<Set<string>> {
  const rows = await client.sql<Row & { name: string }>(
    `SELECT name FROM ${q(client, TABLE)} ORDER BY applied_at`,
  );
  return new Set(rows.map((r) => r.name));
}

async function recordApplied(client: DbClient, name: string): Promise<void> {
  await client.sql(
    `INSERT INTO ${q(client, TABLE)} (name) VALUES (${placeholder(client, 1)})`,
    [name],
  );
}

async function removeRecord(client: DbClient, name: string): Promise<void> {
  await client.sql(
    `DELETE FROM ${q(client, TABLE)} WHERE name = ${placeholder(client, 1)}`,
    [name],
  );
}

/** Apply all pending migrations in order. Returns names of newly applied migrations. */
export async function migrateUp(client: DbClient, migrations: Migration[]): Promise<string[]> {
  await ensureTable(client);
  const applied = await appliedNames(client);
  const pending = migrations.filter((m) => !applied.has(m.name));
  const ran: string[] = [];

  for (const migration of pending) {
    await migration.up(client);
    await recordApplied(client, migration.name);
    ran.push(migration.name);
  }

  return ran;
}

/**
 * Roll back the last `steps` applied migrations (default: 1).
 * Migrations without a `down` function are skipped.
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
    await migration.down(client);
    await removeRecord(client, migration.name);
    ran.push(migration.name);
  }

  return ran;
}
