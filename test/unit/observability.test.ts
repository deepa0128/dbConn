import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock pg before the driver is imported so the Pool never opens a real connection.
vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
  const mockPool = { query: mockQuery, on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) };
  return { default: { Pool: vi.fn().mockReturnValue(mockPool) } };
});

import { createPostgresDriver } from '../../src/driver/postgres.js';
import type { QueryEvent } from '../../src/config.js';

describe('onQuery hook (Postgres driver)', () => {
  let events: QueryEvent[];

  beforeEach(() => {
    events = [];
  });

  function makeDriver() {
    return createPostgresDriver({
      dialect: 'postgres',
      host: 'localhost',
      user: 'u',
      password: 'p',
      database: 'd',
      onQuery: (e) => events.push(e),
    });
  }

  it('fires after a successful query', async () => {
    const driver = makeDriver();
    await driver.query('SELECT 1', []);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sql: 'SELECT 1', params: [] });
    expect(events[0].error).toBeUndefined();
    expect(events[0].durationMs).toBeTypeOf('number');
    expect(events[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('fires with error when the query fails', async () => {
    const { default: pg } = await import('pg');
    const fakeError = new Error('syntax error');
    vi.mocked(pg.Pool).mockReturnValueOnce({
      query: vi.fn().mockRejectedValue(fakeError),
      on: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    } as never);

    const driver = makeDriver();
    await driver.query('BAD SQL', []).catch(() => {});

    expect(events).toHaveLength(1);
    expect(events[0].error).toBe(fakeError);
  });

  it('does not fire when onQuery is not configured', async () => {
    const driver = createPostgresDriver({
      dialect: 'postgres',
      host: 'localhost',
      user: 'u',
      password: 'p',
      database: 'd',
    });
    await driver.query('SELECT 1', []);
    expect(events).toHaveLength(0);
  });
});
