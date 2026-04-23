import mysql from 'mysql2/promise';
import type { ResultSetHeader } from 'mysql2/promise';
import type { MysqlConfig } from '../config.js';
import type { DriverRow, SqlDriver } from './types.js';

export function createMysqlDriver(config: MysqlConfig): SqlDriver {
  const pool = mysql.createPool({
    host: config.host,
    port: config.port ?? 3306,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
    waitForConnections: true,
    connectionLimit: config.maxConnections ?? 10,
  });

  return {
    dialect: 'mysql',

    async query<T extends DriverRow = DriverRow>(sql: string, params: unknown[]): Promise<T[]> {
      const [rows] = await pool.execute(sql, params as never);
      return rows as T[];
    },

    async execute(sql: string, params: unknown[]): Promise<{ affectedRows: number }> {
      const [result] = await pool.execute(sql, params as never);
      const header = result as ResultSetHeader;
      return { affectedRows: header.affectedRows };
    },

    async transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const txDriver: SqlDriver = {
          dialect: 'mysql',
          query: async <T extends DriverRow = DriverRow>(sql: string, params: unknown[]) => {
            const [rows] = await conn.execute(sql, params as never);
            return rows as T[];
          },
          execute: async (sql, params) => {
            const [res] = await conn.execute(sql, params as never);
            const header = res as ResultSetHeader;
            return { affectedRows: header.affectedRows };
          },
          transaction: () => {
            throw new Error('Nested transactions are not supported');
          },
          close: async () => {},
        };
        const out = await fn(txDriver);
        await conn.commit();
        return out;
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
