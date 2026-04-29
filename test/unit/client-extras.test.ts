import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockExecute } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockExecute: vi.fn(),
}));

vi.mock('pg', () => {
  const pool = {
    query: mockQuery,
    on: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return { default: { Pool: vi.fn().mockReturnValue(pool) } };
});

import { createClient, createClientFromEnv } from '../../src/client.js';
import { eq } from '../../src/builder/expr.js';

function makeClient() {
  return createClient({ dialect: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' });
}

// ─── fetchOne ───────────────────────────────────────────────────────────────

describe('DbClient.fetchOne()', () => {
  beforeEach(() => mockQuery.mockReset());

  it('returns the first row when results are present', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 });
    const client = makeClient();
    const row = await client.fetchOne(client.selectFrom('users'));
    expect(row).toEqual({ id: 1 });
  });

  it('returns undefined when query returns no rows', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const client = makeClient();
    const row = await client.fetchOne(client.selectFrom('users').where(eq('id', 999)));
    expect(row).toBeUndefined();
  });
});

// ─── batchInsert ────────────────────────────────────────────────────────────

describe('DbClient.batchInsert()', () => {
  beforeEach(() => mockQuery.mockReset());

  it('returns zero affectedRows for empty input', async () => {
    const client = makeClient();
    const result = await client.batchInsert('users', []);
    expect(result.affectedRows).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('inserts all rows in a single statement when under chunkSize', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 2 });
    const client = makeClient();
    const rows = [{ name: 'Alice' }, { name: 'Bob' }];
    const result = await client.batchInsert('users', rows, 10);
    expect(result.affectedRows).toBe(2);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain('INSERT INTO');
    expect(sql).toContain('users');
  });

  it('splits into multiple chunks', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 2 });
    const client = makeClient();
    const rows = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }];
    const result = await client.batchInsert('users', rows, 2);
    // ceil(5/2) = 3 chunks
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(result.affectedRows).toBe(6); // 2+2+2 from mock
  });

  it('sums affectedRows across all chunks', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 3 })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 });
    const client = makeClient();
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const result = await client.batchInsert('items', rows, 3);
    expect(result.affectedRows).toBe(5);
  });
});

// ─── listTables ─────────────────────────────────────────────────────────────

describe('DbClient.listTables()', () => {
  beforeEach(() => mockQuery.mockReset());

  it('queries information_schema on postgres', async () => {
    mockQuery.mockResolvedValue({ rows: [{ table_name: 'orders' }, { table_name: 'users' }], rowCount: 2 });
    const client = makeClient();
    const tables = await client.listTables();
    expect(tables).toEqual(['orders', 'users']);
    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain('information_schema.tables');
  });
});

// ─── createClientFromEnv ─────────────────────────────────────────────────────

describe('createClientFromEnv()', () => {
  it('throws when the env var is not set', () => {
    delete process.env['TEST_DB_URL_MISSING'];
    expect(() => createClientFromEnv('TEST_DB_URL_MISSING')).toThrow(/TEST_DB_URL_MISSING/);
  });

  it('creates a client from the env var value', () => {
    process.env['TEST_DB_URL'] = 'postgres://u:p@localhost:5432/testdb';
    const client = createClientFromEnv('TEST_DB_URL');
    expect(client.dialect).toBe('postgres');
    delete process.env['TEST_DB_URL'];
  });

  it('defaults to DATABASE_URL when no arg provided', () => {
    process.env['DATABASE_URL'] = 'postgres://u:p@localhost:5432/defaultdb';
    const client = createClientFromEnv();
    expect(client.dialect).toBe('postgres');
    delete process.env['DATABASE_URL'];
  });
});

// ─── andWhere / orWhere via DbClient ─────────────────────────────────────────

describe('DbClient andWhere / orWhere SQL generation', () => {
  beforeEach(() => mockQuery.mockReset());

  it('andWhere merges into WHERE clause with AND', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const client = makeClient();
    await client.fetch(
      client.selectFrom('users')
        .where(eq('active', true))
        .andWhere(eq('role', 'admin')),
    );
    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain('AND');
    expect(sql).toContain('active');
    expect(sql).toContain('role');
  });

  it('orWhere merges into WHERE clause with OR', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const client = makeClient();
    await client.fetch(
      client.selectFrom('users')
        .where(eq('role', 'admin'))
        .orWhere(eq('role', 'mod')),
    );
    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain('OR');
  });
});

// ─── TypedClient typed builders ──────────────────────────────────────────────

describe('TypedClient typed builders', () => {
  beforeEach(() => mockQuery.mockReset());

  type Schema = {
    users: { id: number; name: string; active: boolean };
  };

  it('TypedInsertBuilder has columns, values, execute', () => {
    const client = createClient({ dialect: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' });
    const db = client.withSchema<Schema>();
    const builder = db.insertInto('users');
    expect(typeof builder.columns).toBe('function');
    expect(typeof builder.values).toBe('function');
    expect(typeof builder.execute).toBe('function');
  });

  it('TypedUpdateBuilder has set, where, execute', () => {
    const client = createClient({ dialect: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' });
    const db = client.withSchema<Schema>();
    const builder = db.updateTable('users');
    expect(typeof builder.set).toBe('function');
    expect(typeof builder.where).toBe('function');
    expect(typeof builder.execute).toBe('function');
  });

  it('TypedDeleteBuilder has where, execute', () => {
    const client = createClient({ dialect: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' });
    const db = client.withSchema<Schema>();
    const builder = db.deleteFrom('users');
    expect(typeof builder.where).toBe('function');
    expect(typeof builder.execute).toBe('function');
  });
});
