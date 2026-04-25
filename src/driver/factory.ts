import type { DbConnConfig } from '../config.js';
import { createMongoDriver } from './mongodb.js';
import { createMysqlDriver } from './mysql.js';
import { createPostgresDriver } from './postgres.js';
import type { DbDriver } from './types.js';

export function createDriver(config: DbConnConfig): DbDriver {
  if (config.dialect === 'postgres') return createPostgresDriver(config);
  if (config.dialect === 'mongodb') return createMongoDriver(config);
  return createMysqlDriver(config);
}
