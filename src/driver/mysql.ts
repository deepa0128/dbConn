import mysql from 'mysql2/promise';
import type { ResultSetHeader } from 'mysql2/promise';
import type { MysqlConfig } from '../config.js';
import { ConnectionError, ConstraintError, DbError, QueryTimeoutError } from '../errors.js';
import type { DriverRow, HealthStatus, PoolMetrics, SqlDriver } from './types.js';
import { notifyQuery } from './notify.js';
import { withRetry } from './retry.js';

const CONSTRAINT_CODES = new Set([
  'ER_DUP_ENTRY',
  'ER_NO_REFERENCED_ROW_2',
  'ER_ROW_IS_REFERENCED_2',
  'ER_BAD_NULL_ERROR',
]);
const TIMEOUT_CODES = new Set([
  'QUERY_INACTIVITY_TIMEOUT',
  'ER_QUERY_INTERRUPTED',
  'ER_LOCK_WAIT_TIMEOUT',
  'PROTOCOL_SEQUENCE_TIMEOUT',
]);
const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_CON_COUNT_ERROR',
]);

function normalizeError(err: unknown): never {
  if (err instanceof DbError) throw err;
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const code = String(e['code'] ?? '');
    const message = String(e['message'] ?? 'unknown database error');
    if (CONSTRAINT_CODES.has(code)) {
      const constraint =
        code === 'ER_DUP_ENTRY' ? 'unique'
        : code === 'ER_BAD_NULL_ERROR' ? 'not_null'
        : 'foreign_key';
      throw new ConstraintError(message, constraint, err);
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

export function createMysqlDriver(config: MysqlConfig): SqlDriver {
  const pool = mysql.createPool({
    host: config.host,
    port: config.port ?? 3306,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl === true
      ? { rejectUnauthorized: true }
      : config.ssl === false || config.ssl == null
        ? undefined
        : config.ssl,
    waitForConnections: true,
    connectionLimit: config.maxConnections ?? 10,
  });

  const maxRetries = config.maxRetries ?? 0;
  const retryDelayMs = config.retryDelayMs ?? 100;

  // mysql2 accepts { sql, values, timeout } to trigger a server-side KILL QUERY
  // after `timeout` ms. When no timeout is set, use the plain (sql, values) form.
  async function runPool(sql: string, params: unknown[]) {
    return withRetry(async () => {
      const start = Date.now();
      try {
        const result = config.queryTimeoutMs !== undefined
          ? await pool.execute({ sql, values: params as never[], timeout: config.queryTimeoutMs })
          : await pool.execute(sql, params as never[]);
        notifyQuery(config.onQuery, { sql, params, durationMs: Date.now() - start });
        return result;
      } catch (err) {
        notifyQuery(config.onQuery, { sql, params, durationMs: Date.now() - start, error: err });
        throw err;
      }
    }, maxRetries, retryDelayMs);
  }

  async function runConn(conn: mysql.PoolConnection, sql: string, params: unknown[]) {
    const start = Date.now();
    try {
      const result = config.queryTimeoutMs !== undefined
        ? await conn.execute({ sql, values: params as never[], timeout: config.queryTimeoutMs })
        : await conn.execute(sql, params as never[]);
      notifyQuery(config.onQuery, { sql, params, durationMs: Date.now() - start });
      return result;
    } catch (err) {
      notifyQuery(config.onQuery, { sql, params, durationMs: Date.now() - start, error: err });
      throw err;
    }
  }

  let savepointCounter = 0;

  function makeTxDriver(conn: mysql.PoolConnection): SqlDriver {
    return {
      dialect: 'mysql',

      async query<T extends DriverRow = DriverRow>(sql: string, params: unknown[]): Promise<T[]> {
        try {
          const [rows] = await runConn(conn, sql, params);
          return rows as T[];
        } catch (err) {
          return normalizeError(err);
        }
      },

      async execute(sql: string, params: unknown[]): Promise<{ affectedRows: number }> {
        try {
          const [res] = await runConn(conn, sql, params);
          return { affectedRows: (res as ResultSetHeader).affectedRows };
        } catch (err) {
          return normalizeError(err);
        }
      },

      async transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
        const sp = `sp_${++savepointCounter}`;
        await conn.execute(`SAVEPOINT ${sp}`);
        try {
          const out = await fn(makeTxDriver(conn));
          await conn.execute(`RELEASE SAVEPOINT ${sp}`);
          return out;
        } catch (e) {
          await conn.execute(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
          if (e instanceof DbError) throw e;
          return normalizeError(e);
        }
      },

      close: () => Promise.resolve(),
    };
  }

  return {
    dialect: 'mysql',

    async query<T extends DriverRow = DriverRow>(sql: string, params: unknown[]): Promise<T[]> {
      try {
        const [rows] = await runPool(sql, params);
        return rows as T[];
      } catch (err) {
        return normalizeError(err);
      }
    },

    async execute(sql: string, params: unknown[]): Promise<{ affectedRows: number }> {
      try {
        const [result] = await runPool(sql, params);
        return { affectedRows: (result as ResultSetHeader).affectedRows };
      } catch (err) {
        return normalizeError(err);
      }
    },

    async transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
      const conn = await pool.getConnection().catch((err) => normalizeError(err));
      try {
        await conn.beginTransaction();
        const out = await fn(makeTxDriver(conn));
        await conn.commit();
        return out;
      } catch (e) {
        await conn.rollback().catch(() => {});
        if (e instanceof DbError) throw e;
        return normalizeError(e);
      } finally {
        conn.release();
      }
    },

    poolMetrics(): null {
      return null;
    },

    async healthCheck(): Promise<HealthStatus> {
      const start = Date.now();
      try {
        await pool.execute('SELECT 1');
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
