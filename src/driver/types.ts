export type DriverRow = Record<string, unknown>;

export interface SqlDriver {
  readonly dialect: 'postgres' | 'mysql';
  query<T extends DriverRow = DriverRow>(sql: string, params: unknown[]): Promise<T[]>;
  execute(sql: string, params: unknown[]): Promise<{ affectedRows: number }>;
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
