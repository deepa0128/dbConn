export { createClient, DbClient } from './client.js';
export type { ExecuteResult, Row } from './client.js';

export type { DbConnConfig, DatabaseDialect, MysqlConfig, PostgresConfig, QueryEvent, SslOptions } from './config.js';

export { DeleteBuilder } from './builder/delete.js';
export { InsertBuilder } from './builder/insert.js';
export { SelectBuilder } from './builder/select.js';
export { UpdateBuilder } from './builder/update.js';

export {
  and,
  between,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inList,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  notExists,
  notInList,
  notLike,
  or,
  rawExpr,
  subquery,
} from './builder/expr.js';
export type { Subquery } from './ast.js';

export { assertSafeIdentifier } from './identifier.js';
export { parseConnectionUrl } from './parseUrl.js';
export { paginate } from './paginate.js';
export type { CursorPageOptions, PageResult } from './paginate.js';
export { migrateDown, migrateUp } from './migrate.js';
export type { Migration } from './migrate.js';

export { ConnectionError, ConstraintError, DbError, QueryTimeoutError } from './errors.js';
export type { HealthStatus, PoolMetrics } from './driver/types.js';

export type { AggregateColumn, Expr, JoinClause, JoinType, OrderDirection } from './ast.js';
