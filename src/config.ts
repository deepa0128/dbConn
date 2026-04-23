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
};

export type DbConnConfig = PostgresConfig | MysqlConfig;
