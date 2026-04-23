export type DriverRow = Record<string, unknown>;

export type HealthStatus = {
  healthy: boolean;
  latencyMs: number;
  error?: string;
};

export interface SqlDriver {
  readonly dialect: 'postgres' | 'mysql';
  query<T extends DriverRow = DriverRow>(sql: string, params: unknown[]): Promise<T[]>;
  execute(sql: string, params: unknown[]): Promise<{ affectedRows: number }>;
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T>;
  healthCheck(): Promise<HealthStatus>;
  close(): Promise<void>;
}
