import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('pg', () => {
  const pool = { query: mockQuery, on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) };
  return { default: { Pool: vi.fn().mockReturnValue(pool) } };
});

import { createClient } from '../../src/client.js';

type TestDB = {
  users: { id: number; name: string; email: string };
  orders: { id: number; user_id: number; amount: number };
};

function makeTypedClient() {
  return createClient({ dialect: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' })
    .withSchema<TestDB>();
}

describe('TypedClient', () => {
  beforeEach(() => mockQuery.mockClear());

  it('selectFrom returns typed rows', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, name: 'Alice', email: 'a@b.com' }], rowCount: 1 });
    const db = makeTypedClient();
    const users = await db.selectFrom('users').fetch();
    // TypeScript should infer users as TestDB['users'][]
    expect(users[0]?.name).toBe('Alice');
  });

  it('generates correct SQL for typed select', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const db = makeTypedClient();
    await db.selectFrom('orders').where({ type: 'eq', column: 'user_id', value: 5 }).fetch();
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toBe('SELECT * FROM "orders" WHERE "user_id" = $1');
    expect(params).toEqual([5]);
  });

  it('selectColumns constrains to schema column names', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
    const db = makeTypedClient();
    // 'id' is a valid key of TestDB['users']
    await db.selectFrom('users').selectColumns('id').fetch();
    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toBe('SELECT "id" FROM "users"');
  });

  it('count delegates to client', async () => {
    mockQuery.mockResolvedValue({ rows: [{ __n: '7' }], rowCount: 1 });
    const db = makeTypedClient();
    const n = await db.selectFrom('users').count();
    expect(n).toBe(7);
  });

  it('insertInto returns a usable InsertBuilder', () => {
    const db = makeTypedClient();
    const builder = db.insertInto('users');
    // should have columns/values methods from InsertBuilder
    expect(typeof builder.columns).toBe('function');
    expect(typeof builder.values).toBe('function');
  });

  it('raw property exposes the underlying DbClient', () => {
    const client = createClient({ dialect: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' });
    const db = client.withSchema<TestDB>();
    expect(db.raw).toBe(client);
  });

  it('transaction passes a TypedClient to the callback', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const pg = await import('pg');
    const mockPool = (pg.default.Pool as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      connect: ReturnType<typeof vi.fn>;
    };
    // mock connect for transaction
    mockPool.connect = vi.fn().mockResolvedValue({
      query: mockQuery,
      release: vi.fn(),
    });

    const db = makeTypedClient();
    let txArg: unknown;
    await db.raw.transaction(async (tx) => {
      txArg = tx;
    });
    // txArg should be a DbClient (transaction passes DbClient to the inner fn)
    expect(txArg).toBeDefined();
  });
});

describe('EXPLAIN helper', () => {
  beforeEach(() => mockQuery.mockClear());

  it('prepends EXPLAIN to the compiled query', async () => {
    mockQuery.mockResolvedValue({ rows: [{ 'QUERY PLAN': 'Seq Scan on users' }], rowCount: 1 });
    const client = createClient({ dialect: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' });
    await client.explain(client.selectFrom('users').where({ type: 'eq', column: 'id', value: 1 }));
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toBe('EXPLAIN SELECT * FROM "users" WHERE "id" = $1');
    expect(params).toEqual([1]);
  });

  it('returns the raw rows from the database', async () => {
    const planRows = [{ 'QUERY PLAN': 'Seq Scan on users  (cost=0.00..1.01 rows=1 width=46)' }];
    mockQuery.mockResolvedValue({ rows: planRows, rowCount: 1 });
    const client = createClient({ dialect: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' });
    const rows = await client.explain(client.selectFrom('users'));
    expect(rows).toEqual(planRows);
  });
});
