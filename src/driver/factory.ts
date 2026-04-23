import type { DbConnConfig } from '../config.js';
import { createMysqlDriver } from './mysql.js';
import { createPostgresDriver } from './postgres.js';
import type { SqlDriver } from './types.js';

export function createDriver(config: DbConnConfig): SqlDriver {
  if (config.dialect === 'postgres') return createPostgresDriver(config);
  return createMysqlDriver(config);
}
