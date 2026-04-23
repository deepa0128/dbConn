import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  release: vi.fn(),
};

vi.mock('pg', () => {
  const mockPool = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    on: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn(),
  };
  return { default: { Pool: vi.fn().mockReturnValue(mockPool) } };
});

import { createPostgresDriver } from '../../src/driver/postgres.js';

describe('savepoints (Postgres driver)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getPool() {
    const { default: pg } = await import('pg');
    return vi.mocked(pg.Pool).mock.results[0]?.value as typeof mockClient & { connect: ReturnType<typeof vi.fn> };
  }

  it('uses SAVEPOINT for nested transaction', async () => {
    const client = { ...mockClient, query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() };
    const driver = createPostgresDriver({ dialect: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' });
    const pool = await getPool();
    pool.connect = vi.fn().mockResolvedValue(client);

    await driver.transaction(async (tx) => {
      await tx.transaction(async (inner) => {
        await inner.query('SELECT 1', []);
      });
    });

    const calls = client.query.mock.calls.map((c) => c[0] as string);
    expect(calls).toContain('BEGIN');
    expect(calls.some((s) => s.startsWith('SAVEPOINT sp_'))).toBe(true);
    expect(calls.some((s) => s.startsWith('RELEASE SAVEPOINT sp_'))).toBe(true);
    expect(calls).toContain('COMMIT');
  });

  it('rolls back to savepoint on nested failure', async () => {
    const client = { ...mockClient, query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() };
    const driver = createPostgresDriver({ dialect: 'postgres', host: 'h', user: 'u', password: 'p', database: 'd' });
    const pool = await getPool();
    pool.connect = vi.fn().mockResolvedValue(client);

    const boom = new Error('inner fail');
    await expect(
      driver.transaction(async (tx) => {
        await tx.transaction(async () => { throw boom; });
      }),
    ).rejects.toThrow('inner fail');

    const calls = client.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((s) => s.startsWith('ROLLBACK TO SAVEPOINT sp_'))).toBe(true);
  });
});
