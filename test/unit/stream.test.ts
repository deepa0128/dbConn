import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('pg', () => {
  const mockPool = { query: mockQuery, on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) };
  return { default: { Pool: vi.fn().mockReturnValue(mockPool) } };
});

import { createClient } from '../../src/client.js';

function makeClient() {
  return createClient({ dialect: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' });
}

describe('DbClient.stream()', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('yields all rows across multiple batches', async () => {
    // first batch full (2), second batch partial (1) — stream stops without a 3rd call
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [{ id: 3 }], rowCount: 1 });

    const client = makeClient();
    const rows: unknown[] = [];
    for await (const row of client.stream(client.selectFrom('users'), 2)) {
      rows.push(row);
    }

    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('stops when fewer rows than batchSize are returned', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

    const client = makeClient();
    const rows: unknown[] = [];
    for await (const row of client.stream(client.selectFrom('users'), 10)) {
      rows.push(row);
    }

    expect(rows).toEqual([{ id: 1 }]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('respects builder LIMIT as a cap', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [{ id: 3 }], rowCount: 1 });

    const client = makeClient();
    const rows: unknown[] = [];
    for await (const row of client.stream(client.selectFrom('users').limit(3), 2)) {
      rows.push(row);
    }

    expect(rows).toHaveLength(3);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('passes LIMIT and OFFSET in SQL', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of client.stream(client.selectFrom('t'), 5)) { /* drain */ }

    const firstCall = mockQuery.mock.calls[0][0] as string;
    expect(firstCall).toContain('LIMIT 5');
    expect(firstCall).toContain('OFFSET 0');
  });
});
