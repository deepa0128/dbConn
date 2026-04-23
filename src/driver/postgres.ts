import pg from 'pg';
import type { PostgresConfig } from '../config.js';
import { ConnectionError, ConstraintError, DbError, QueryTimeoutError } from '../errors.js';
import type { DriverRow, HealthStatus, PoolMetrics, SqlDriver } from './types.js';
import { notifyQuery } from './notify.js';
import { withRetry } from './retry.js';

// PostgreSQL SQLSTATE codes
const CONSTRAINT_CODES = new Set(['23000', '23502', '23503', '23505', '23514']);
const TIMEOUT_CODES = new Set(['57014', '57P01']);
const CONNECTION_CODES = new Set([
  '08001', '08004', '08006', '28000', '28P01', '3D000',
  'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE',
]);

function normalizeError(err: unknown): never {
  if (err instanceof DbError) throw err;
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const code = String(e['code'] ?? '');
    const message = String(e['message'] ?? 'unknown database error');
    if (CONSTRAINT_CODES.has(code)) {
      throw new ConstraintError(message, String(e['constraint'] ?? code), err);
    }
    if (TIMEOUT_CODES.has(code)) {
      throw new QueryTimeoutError(message, err);
    }
    if (CONNECTION_CODES.has(code)) {
      throw new ConnectionError(message, err);
    }
  }
  throw new DbError(err instanceof Error ? err.message : String(err), err);
}

export function createPostgresDriver(config: PostgresConfig): SqlDriver {
  const pool = new pg.Pool({
    host: config.host,
    port: config.port ?? 5432,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl === true
      ? { rejectUnauthorized: true }
      : config.ssl === false || config.ssl == null
        ? undefined
        : config.ssl,
    max: config.maxConnections ?? 10,
    statement_timeout: config.queryTimeoutMs,
  });

  // Prevent unhandled 'error' events from crashing the process when an idle
  // client encounters a network failure. The error surfaces on the next query.
  pool.on('error', (_err: Error) => {});

  const maxRetries = config.maxRetries ?? 0;
  const retryDelayMs = config.retryDelayMs ?? 100;

  async function run<T extends DriverRow>(
    sql: string,
    params: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }> {
    return withRetry(async () => {
      const start = Date.now();
      try {
        const result = await pool.query<T>(sql, params);
        notifyQuery(config.onQuery, { sql, params, durationMs: Date.now() - start });
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      } catch (err) {
        notifyQuery(config.onQuery, { sql, params, durationMs: Date.now() - start, error: err });
        return normalizeError(err);
      }
    }, maxRetries, retryDelayMs);
  }

  let savepointCounter = 0;

  function makeTxDriver(client: pg.PoolClient): SqlDriver {
    return {
      dialect: 'postgres',

      async query<T extends DriverRow = DriverRow>(sql: string, params: unknown[]): Promise<T[]> {
        const start = Date.now();
        try {
          const r = await client.query<T>(sql, params);
          notifyQuery(config.onQuery, { sql, params, durationMs: Date.now() - start });
          return r.rows;
        } catch (err) {
          notifyQuery(config.onQuery, { sql, params, durationMs: Date.now() - start, error: err });
          return normalizeError(err);
        }
      },

      async execute(sql: string, params: unknown[]): Promise<{ affectedRows: number }> {
        const start = Date.now();
        try {
          const r = await client.query(sql, params);
          notifyQuery(config.onQuery, { sql, params, durationMs: Date.now() - start });
          return { affectedRows: r.rowCount ?? 0 };
        } catch (err) {
          notifyQuery(config.onQuery, { sql, params, durationMs: Date.now() - start, error: err });
          return normalizeError(err);
        }
      },

      async transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
        const sp = `sp_${++savepointCounter}`;
        await client.query(`SAVEPOINT ${sp}`);
        try {
          const out = await fn(makeTxDriver(client));
          await client.query(`RELEASE SAVEPOINT ${sp}`);
          return out;
        } catch (e) {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
          if (e instanceof DbError) throw e;
          return normalizeError(e);
        }
      },

      close: () => Promise.resolve(),
    };
  }

  return {
    dialect: 'postgres',

    async query<T extends DriverRow = DriverRow>(sql: string, params: unknown[]): Promise<T[]> {
      const { rows } = await run<T>(sql, params);
      return rows;
    },

    async execute(sql: string, params: unknown[]): Promise<{ affectedRows: number }> {
      const { rowCount } = await run(sql, params);
      return { affectedRows: rowCount };
    },

    async transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
      const client = await pool.connect().catch((err) => normalizeError(err));
      try {
        await client.query('BEGIN');
        const out = await fn(makeTxDriver(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        if (e instanceof DbError) throw e;
        return normalizeError(e);
      } finally {
        client.release();
      }
    },

    poolMetrics(): PoolMetrics {
      return {
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
        waitingRequests: pool.waitingCount,
      };
    },

    async healthCheck(): Promise<HealthStatus> {
      const start = Date.now();
      try {
        await pool.query('SELECT 1');
        return { healthy: true, latencyMs: Date.now() - start };
      } catch (err) {
        return {
          healthy: false,
          latencyMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
