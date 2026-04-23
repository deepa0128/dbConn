export { createClient, DbClient } from './client.js';
export type { ExecuteResult, Row } from './client.js';

export type { DbConnConfig, DatabaseDialect, MysqlConfig, PostgresConfig } from './config.js';

export { DeleteBuilder } from './builder/delete.js';
export { InsertBuilder } from './builder/insert.js';
export { SelectBuilder } from './builder/select.js';
export { UpdateBuilder } from './builder/update.js';

export {
  and,
  eq,
  gt,
  gte,
  inList,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
} from './builder/expr.js';

export { assertSafeIdentifier } from './identifier.js';

export { ConnectionError, ConstraintError, DbError, QueryTimeoutError } from './errors.js';

export type { Expr, OrderDirection } from './ast.js';
