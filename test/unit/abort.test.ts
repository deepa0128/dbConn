import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('pg', () => {
  const pool = { query: mockQuery, on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) };
  return { default: { Pool: vi.fn().mockReturnValue(pool) } };
});

import { createClient } from '../../src/client.js';

function makeClient() {
  return createClient({ dialect: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' });
}

describe('fetch() with DML builders', () => {
  beforeEach(() => mockQuery.mockClear());

  it('executes INSERT ... RETURNING and returns rows', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, email: 'a@b.com' }], rowCount: 1 });
    const client = makeClient();
    const rows = await client.fetch(
      client.insertInto('users').columns('email').values({ email: 'a@b.com' }).returning('id', 'email'),
    );
    expect(rows).toEqual([{ id: 1, email: 'a@b.com' }]);
    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain('INSERT INTO');
    expect(sql).toContain('RETURNING');
  });

  it('executes UPDATE ... RETURNING and returns rows', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 5 }], rowCount: 1 });
    const client = makeClient();
    const rows = await client.fetch(
      client.updateTable('users').set('name', 'bob').returning('id'),
    );
    expect(rows).toEqual([{ id: 5 }]);
    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain('UPDATE');
    expect(sql).toContain('RETURNING');
  });

  it('executes DELETE ... RETURNING and returns rows', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 3 }], rowCount: 1 });
    const client = makeClient();
    const rows = await client.fetch(
      client.deleteFrom('users').returning('id'),
    );
    expect(rows).toEqual([{ id: 3 }]);
    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain('DELETE FROM');
    expect(sql).toContain('RETURNING');
  });
});

describe('AbortSignal support', () => {
  it('rejects with AbortError when signal is already aborted', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const controller = new AbortController();
    controller.abort();
    const client = makeClient();
    await expect(
      client.fetch(client.selectFrom('t'), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects when signal aborts during a pending query', async () => {
    const controller = new AbortController();
    // query never resolves until we abort
    mockQuery.mockReturnValue(new Promise(() => {}));
    const client = makeClient();
    const promise = client.fetch(client.selectFrom('t'), controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('resolves normally when signal is not aborted', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
    const controller = new AbortController();
    const client = makeClient();
    const rows = await client.fetch(client.selectFrom('t'), controller.signal);
    expect(rows).toEqual([{ id: 1 }]);
  });
});
