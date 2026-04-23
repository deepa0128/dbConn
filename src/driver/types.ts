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

export interface SqlDriver {
  readonly dialect: 'postgres' | 'mysql';
  query<T extends DriverRow = DriverRow>(sql: string, params: unknown[]): Promise<T[]>;
  execute(sql: string, params: unknown[]): Promise<{ affectedRows: number }>;
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T>;
  healthCheck(): Promise<HealthStatus>;
  poolMetrics(): PoolMetrics;
  close(): Promise<void>;
}
