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

/**
 * Internal driver for SQL databases (Postgres, MySQL).
 * Receives pre-compiled SQL strings and positional parameters.
 */
export interface SqlDriver {
  readonly dialect: 'postgres' | 'mysql';
  query<T extends DriverRow = DriverRow>(sql: string, params: unknown[]): Promise<T[]>;
  execute(sql: string, params: unknown[]): Promise<{ affectedRows: number }>;
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T>;
  healthCheck(): Promise<HealthStatus>;
  poolMetrics(): PoolMetrics | null;
  close(): Promise<void>;
}

/**
 * Internal driver for MongoDB.
 * Receives QueryAst objects and compiles them to MongoDB operations internally.
 *
 * Key differences from SqlDriver:
 * - query/execute accept AST objects, not SQL strings
 * - aggregate() provides direct access to the aggregation pipeline for operations
 *   the query builder cannot express (JOINs via $lookup, GROUP BY via $group, etc.)
 * - Transactions require a replica set or sharded cluster; a descriptive error is
 *   thrown if the server does not support multi-document transactions.
 */
export interface MongoDriver {
  readonly dialect: 'mongodb';
  query<T extends DriverRow = DriverRow>(query: QueryAst): Promise<T[]>;
  execute(query: InsertAst | UpdateAst | DeleteAst): Promise<{ affectedRows: number }>;
  /**
   * Count documents matching the filter from a SelectAst.
   * Implemented via MongoDB's countDocuments which is more efficient than
   * returning rows and counting in application code.
   */
  count(query: QueryAst): Promise<number>;
  /**
   * Run a raw MongoDB aggregation pipeline on the named collection.
   * This is the primary escape hatch for operations not expressible via the query builder:
   *   - JOINs → use $lookup
   *   - GROUP BY → use $group
   *   - CTEs / multi-branch → use $facet
   *   - Upserts → use $merge
   */
  aggregate<T extends DriverRow = DriverRow>(collection: string, pipeline: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: MongoDriver) => Promise<T>): Promise<T>;
  healthCheck(): Promise<HealthStatus>;
  poolMetrics(): PoolMetrics | null;
  close(): Promise<void>;
}

/** Union of all supported database drivers. */
export type DbDriver = SqlDriver | MongoDriver;
