import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('pg', () => {
  const pool = { query: mockQuery, on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) };
  return { default: { Pool: vi.fn().mockReturnValue(pool) } };
});

vi.mock('mysql2/promise', () => {
  const pool = {
    execute: mockQuery,
    getConnection: vi.fn(),
    on: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return { default: { createPool: vi.fn().mockReturnValue(pool) } };
});

import { createClient } from '../../src/client.js';

beforeEach(() => mockQuery.mockClear());

function makePgClient() {
  return createClient({ dialect: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' });
}

function makeMysqlClient() {
  return createClient({ dialect: 'mysql', host: 'h', user: 'u', password: 'p', database: 'd' });
}

describe('db.sql tagged template', () => {
  it('postgres: generates $N placeholders and passes values', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
    const db = makePgClient();
    const id = 42;
    const name = 'alice';
    await db.sql`SELECT * FROM users WHERE id = ${id} AND name = ${name}`;
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toBe('SELECT * FROM users WHERE id = $1 AND name = $2');
    expect(params).toEqual([42, 'alice']);
  });

  it('postgres: no values — no placeholders', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const db = makePgClient();
    await db.sql`SELECT 1`;
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toBe('SELECT 1');
    expect(params).toEqual([]);
  });

  it('mysql: generates ? placeholders', async () => {
    mockQuery.mockResolvedValue([[{ id: 1 }], []]);
    const db = makeMysqlClient();
    const id = 7;
    await db.sql`SELECT * FROM orders WHERE id = ${id}`;
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toBe('SELECT * FROM orders WHERE id = ?');
    expect(params).toEqual([7]);
  });

  it('mysql: multiple values use ? for each', async () => {
    mockQuery.mockResolvedValue([[{ n: 1 }], []]);
    const db = makeMysqlClient();
    const a = 1, b = 2, c = 3;
    await db.sql`SELECT * FROM t WHERE a = ${a} AND b = ${b} AND c = ${c}`;
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toBe('SELECT * FROM t WHERE a = ? AND b = ? AND c = ?');
    expect(params).toEqual([1, 2, 3]);
  });

  it('returns rows typed as T', async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: '5' }], rowCount: 1 });
    const db = makePgClient();
    const rows = await db.sql<{ count: string }>`SELECT count(*) AS count FROM t`;
    expect(rows[0]?.count).toBe('5');
  });
});

describe('db.sql plain string form', () => {
  it('passes sql and params directly', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
    const db = makePgClient();
    await db.sql('SELECT * FROM t WHERE id = $1', [99]);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toBe('SELECT * FROM t WHERE id = $1');
    expect(params).toEqual([99]);
  });

  it('defaults params to empty array', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const db = makePgClient();
    await db.sql('SELECT 1');
    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([]);
  });
});
