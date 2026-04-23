export type DatabaseDialect = 'postgres' | 'mysql';

export type PostgresConfig = {
  dialect: 'postgres';
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
  maxConnections?: number;
  /** Milliseconds before a query is cancelled server-side via statement_timeout. */
  queryTimeoutMs?: number;
};

export type MysqlConfig = {
  dialect: 'mysql';
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
  maxConnections?: number;
  /**
   * Milliseconds before a query is killed server-side via KILL QUERY.
   * Applies to individual SELECT / DML statements via mysql2's built-in timeout mechanism.
   */
  queryTimeoutMs?: number;
};

export type DbConnConfig = PostgresConfig | MysqlConfig;
