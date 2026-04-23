import pg from 'pg';
import type { PostgresConfig } from '../config.js';
import type { DriverRow, SqlDriver } from './types.js';

export function createPostgresDriver(config: PostgresConfig): SqlDriver {
  const pool = new pg.Pool({
    host: config.host,
    port: config.port ?? 5432,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
    max: config.maxConnections ?? 10,
  });

  const run = async <T extends DriverRow>(
    sql: string,
    params: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }> => {
    const result = await pool.query<T>(sql, params);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  };

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
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txDriver: SqlDriver = {
          dialect: 'postgres',
          query: <T extends DriverRow = DriverRow>(sql: string, params: unknown[]) =>
            client.query<T>(sql, params).then((r) => r.rows),
          execute: async (sql, params) => {
            const r = await client.query(sql, params);
            return { affectedRows: r.rowCount ?? 0 };
          },
          transaction: () => {
            throw new Error('Nested transactions are not supported');
          },
          close: async () => {},
        };
        const out = await fn(txDriver);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
