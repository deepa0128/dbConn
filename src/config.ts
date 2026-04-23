export type DatabaseDialect = 'postgres' | 'mysql';

export type SslOptions = {
  ca?: string;
  cert?: string;
  key?: string;
  rejectUnauthorized?: boolean;
};

export type QueryEvent = {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly durationMs: number;
  readonly error?: unknown;
};

export type PostgresConfig = {
  dialect: 'postgres';
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean | SslOptions;
  maxConnections?: number;
  /** Milliseconds before a query is cancelled server-side via statement_timeout. */
  queryTimeoutMs?: number;
  /** Called after every query with timing and optional error information. Accepts one handler or an array. */
  onQuery?: ((event: QueryEvent) => void) | Array<(event: QueryEvent) => void>;
  /** Max number of retries on transient ConnectionError before giving up (default: 0 = no retry). */
  maxRetries?: number;
  /** Initial delay in ms before first retry; doubles each attempt (default: 100). */
  retryDelayMs?: number;
};

export type MysqlConfig = {
  dialect: 'mysql';
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean | SslOptions;
  maxConnections?: number;
  /**
   * Milliseconds before a query is killed server-side via KILL QUERY.
   * Applies to individual SELECT / DML statements via mysql2's built-in timeout mechanism.
   */
  queryTimeoutMs?: number;
  /** Called after every query with timing and optional error information. Accepts one handler or an array. */
  onQuery?: ((event: QueryEvent) => void) | Array<(event: QueryEvent) => void>;
  /** Max number of retries on transient ConnectionError before giving up (default: 0 = no retry). */
  maxRetries?: number;
  /** Initial delay in ms before first retry; doubles each attempt (default: 100). */
  retryDelayMs?: number;
};

export type DbConnConfig = PostgresConfig | MysqlConfig;
