import { beforeEach, describe, expect, it, vi } from 'vitest';
import { paginate } from '../../src/paginate.js';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('pg', () => {
  const mockPool = { query: mockQuery, on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) };
  return { default: { Pool: vi.fn().mockReturnValue(mockPool) } };
});

import { createClient } from '../../src/client.js';

function makeClient() {
  return createClient({ dialect: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' });
}

describe('paginate()', () => {
  beforeEach(() => mockQuery.mockReset());

  it('returns rows and no nextCursor when fewer than limit', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 });
    const client = makeClient();
    const result = await paginate(client, client.selectFrom('users'), { cursorColumn: 'id', limit: 10 });
    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });

  it('detects hasMore and returns nextCursor when result exceeds limit', async () => {
    // limit=2, return 3 rows (limit+1) to signal hasMore
    mockQuery.mockResolvedValue({
      rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      rowCount: 3,
    });
    const client = makeClient();
    const result = await paginate(client, client.selectFrom('users'), { cursorColumn: 'id', limit: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeDefined();
  });

  it('decodes cursor and appends GT filter on next page', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const cursor = Buffer.from('42').toString('base64');
    const client = makeClient();
    await paginate(client, client.selectFrom('users'), { cursorColumn: 'id', limit: 10, after: cursor });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('"id" > $1');
  });

  it('uses LT filter for desc direction', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const cursor = Buffer.from('99').toString('base64');
    const client = makeClient();
    await paginate(client, client.selectFrom('orders'), {
      cursorColumn: 'id',
      direction: 'desc',
      limit: 5,
      after: cursor,
    });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('"id" < $1');
  });

  it('merges cursor with existing WHERE', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const cursor = Buffer.from('10').toString('base64');
    const client = makeClient();
    await paginate(
      client,
      client.selectFrom('users').where({ type: 'eq', column: 'active', value: true }),
      { cursorColumn: 'id', limit: 5, after: cursor },
    );
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('"active" = $1');
    expect(sql).toContain('"id" > $2');
  });
});
