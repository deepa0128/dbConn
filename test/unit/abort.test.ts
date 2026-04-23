import { describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('pg', () => {
  const pool = { query: mockQuery, on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) };
  return { default: { Pool: vi.fn().mockReturnValue(pool) } };
});

import { createClient } from '../../src/client.js';

function makeClient() {
  return createClient({ dialect: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' });
}

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
