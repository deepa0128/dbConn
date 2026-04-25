import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateDown, migrateUp } from '../../src/migrate.js';
import type { Migration } from '../../src/migrate.js';
import type { DbClient } from '../../src/client.js';

function makeClient(dialect: 'postgres' | 'mysql' = 'postgres') {
  const calls: Array<[string, unknown[]]> = [];
  let storedNames: string[] = [];

  // transaction() runs the callback with the same client (simplified for unit tests)
  const client: DbClient & { _getCalls: () => Array<[string, unknown[]]>; _storedNames: () => string[] } = {
    get dialect() { return dialect; },
    sql: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      if (sql.startsWith('SELECT name FROM')) return storedNames.map((name) => ({ name }));
      if (sql.startsWith('INSERT INTO')) storedNames.push(params[0] as string);
      if (sql.startsWith('DELETE FROM')) storedNames = storedNames.filter((n) => n !== params[0]);
      return [];
    }),
    transaction: vi.fn(async (fn: (tx: DbClient) => Promise<unknown>) => fn(client)),
    _getCalls: () => calls,
    _storedNames: () => storedNames,
  } as unknown as typeof client;

  return client;
}

describe('migrateUp', () => {
  let client: ReturnType<typeof makeClient>;
  const migrations: Migration[] = [
    { name: '001_create_users', up: vi.fn(), down: vi.fn() },
    { name: '002_add_email', up: vi.fn(), down: vi.fn() },
  ];

  beforeEach(() => {
    client = makeClient();
    vi.clearAllMocks();
  });

  it('runs all migrations when none are applied', async () => {
    const ran = await migrateUp(client, migrations);
    expect(ran).toEqual(['001_create_users', '002_add_email']);
    expect(migrations[0].up).toHaveBeenCalledOnce();
    expect(migrations[1].up).toHaveBeenCalledOnce();
  });

  it('each migration runs inside a transaction', async () => {
    await migrateUp(client, migrations);
    expect(client.transaction).toHaveBeenCalledTimes(2);
  });

  it('skips already-applied migrations', async () => {
    await migrateUp(client, migrations);
    vi.clearAllMocks();
    const ran = await migrateUp(client, migrations);
    expect(ran).toEqual([]);
    expect(migrations[0].up).not.toHaveBeenCalled();
  });

  it('runs only new migrations on subsequent calls', async () => {
    await migrateUp(client, [migrations[0]!]);
    vi.clearAllMocks();
    const ran = await migrateUp(client, migrations);
    expect(ran).toEqual(['002_add_email']);
    expect(migrations[0].up).not.toHaveBeenCalled();
    expect(migrations[1].up).toHaveBeenCalledOnce();
  });

  it('creates the migrations table', async () => {
    await migrateUp(client, []);
    const [firstSql] = client._getCalls()[0]!;
    expect(firstSql).toContain('CREATE TABLE IF NOT EXISTS');
    expect(firstSql).toContain('_dbconn_migrations');
  });

  it('uses backtick quoting for mysql', async () => {
    const mysqlClient = makeClient('mysql');
    await migrateUp(mysqlClient, []);
    const [firstSql] = mysqlClient._getCalls()[0]!;
    expect(firstSql).toContain('`_dbconn_migrations`');
  });

  it('halts on failure and does not run subsequent migrations', async () => {
    const boom = new Error('migration failed');
    const failingMigration: Migration = { name: '001_fail', up: vi.fn().mockRejectedValue(boom) };
    const nextMigration: Migration = { name: '002_next', up: vi.fn() };
    await expect(migrateUp(client, [failingMigration, nextMigration])).rejects.toThrow('migration failed');
    expect(nextMigration.up).not.toHaveBeenCalled();
  });
});

describe('migrateDown', () => {
  it('rolls back last migration by default', async () => {
    const client = makeClient();
    const migrations: Migration[] = [
      { name: '001_create_users', up: vi.fn(), down: vi.fn() },
      { name: '002_add_email', up: vi.fn(), down: vi.fn() },
    ];
    await migrateUp(client, migrations);
    vi.clearAllMocks();

    const rolled = await migrateDown(client, migrations);
    expect(rolled).toEqual(['002_add_email']);
    expect(migrations[1].down).toHaveBeenCalledOnce();
    expect(migrations[0].down).not.toHaveBeenCalled();
  });

  it('each rollback runs inside a transaction', async () => {
    const client = makeClient();
    const migrations: Migration[] = [{ name: '001', up: vi.fn(), down: vi.fn() }];
    await migrateUp(client, migrations);
    vi.clearAllMocks();
    await migrateDown(client, migrations);
    expect(client.transaction).toHaveBeenCalledTimes(1);
  });

  it('skips migrations without a down function', async () => {
    const client = makeClient();
    const migrations: Migration[] = [{ name: '001_create_users', up: vi.fn() }];
    await migrateUp(client, migrations);
    const rolled = await migrateDown(client, migrations);
    expect(rolled).toEqual([]);
  });

  it('rolls back multiple steps', async () => {
    const client = makeClient();
    const migrations: Migration[] = [
      { name: '001', up: vi.fn(), down: vi.fn() },
      { name: '002', up: vi.fn(), down: vi.fn() },
      { name: '003', up: vi.fn(), down: vi.fn() },
    ];
    await migrateUp(client, migrations);
    vi.clearAllMocks();
    const rolled = await migrateDown(client, migrations, 2);
    expect(rolled).toEqual(['003', '002']);
  });
});
