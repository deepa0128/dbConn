import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateDown, migrateUp } from '../../src/migrate.js';
import type { Migration } from '../../src/migrate.js';
import type { DbClient } from '../../src/client.js';

function makeClient(dialect: 'postgres' | 'mysql' = 'postgres') {
  const calls: Array<[string, unknown[]]> = [];
  // applied_names returned from SELECT query
  let storedNames: string[] = [];

  const client = {
    get dialect() { return dialect; },
    sql: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      if (sql.startsWith('SELECT name FROM')) {
        return storedNames.map((name) => ({ name }));
      }
      if (sql.startsWith('INSERT INTO')) {
        const name = params[0] as string;
        storedNames.push(name);
      }
      if (sql.startsWith('DELETE FROM')) {
        const name = params[0] as string;
        storedNames = storedNames.filter((n) => n !== name);
      }
      return [];
    }),
    _getCalls: () => calls,
    _storedNames: () => storedNames,
  } as unknown as DbClient & { _getCalls: () => Array<[string, unknown[]]>; _storedNames: () => string[] };

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

  it('skips already-applied migrations', async () => {
    // First run
    await migrateUp(client, migrations);
    vi.clearAllMocks();
    // Second run — nothing pending
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

  it('skips migrations without a down function', async () => {
    const client = makeClient();
    const migrations: Migration[] = [
      { name: '001_create_users', up: vi.fn() },
    ];
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
