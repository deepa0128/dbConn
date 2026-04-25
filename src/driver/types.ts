import type { DeleteAst, InsertAst, QueryAst, UpdateAst } from '../ast.js';
export type DriverRow = Record<string, unknown>;

export type HealthStatus = {
  healthy: boolean;
  latencyMs: number;
  error?: string;
};

export type PoolMetrics = {
  /** Total connections open (active + idle). */
  totalConnections: number;
  /** Connections currently idle and available. */
  idleConnections: number;
  /** Requests waiting for a connection from the pool. */
  waitingRequests: number;
};

export interface BaseDriver {
  readonly dialect: 'postgres' | 'mysql' | 'mongodb';
  transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
  healthCheck(): Promise<HealthStatus>;
  poolMetrics(): PoolMetrics | null;
  close(): Promise<void>;
}

export interface SqlDriver extends BaseDriver {
  readonly dialect: 'postgres' | 'mysql';
  query<T extends DriverRow = DriverRow>(sql: string, params: unknown[]): Promise<T[]>;
  execute(sql: string, params: unknown[]): Promise<{ affectedRows: number }>;
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T>;
}

export interface MongoDriver extends BaseDriver {
  readonly dialect: 'mongodb';
  query<T extends DriverRow = DriverRow>(query: QueryAst): Promise<T[]>;
  execute(query: InsertAst | UpdateAst | DeleteAst): Promise<{ affectedRows: number }>;
  transaction<T>(fn: (tx: MongoDriver) => Promise<T>): Promise<T>;
}

export type DbDriver = SqlDriver | MongoDriver;
