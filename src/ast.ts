/** Internal query/expression AST — not exported from the public package API. */

export type OrderDirection = 'asc' | 'desc';

export type Expr =
  | { type: 'eq'; column: string; value: unknown }
  | { type: 'ne'; column: string; value: unknown }
  | { type: 'gt'; column: string; value: unknown }
  | { type: 'gte'; column: string; value: unknown }
  | { type: 'lt'; column: string; value: unknown }
  | { type: 'lte'; column: string; value: unknown }
  | { type: 'and'; items: Expr[] }
  | { type: 'or'; items: Expr[] }
  | { type: 'in'; column: string; values: unknown[] }
  | { type: 'notIn'; column: string; values: unknown[] }
  | { type: 'like'; column: string; pattern: string }
  | { type: 'notLike'; column: string; pattern: string }
  | { type: 'ilike'; column: string; pattern: string }
  | { type: 'between'; column: string; low: unknown; high: unknown }
  | { type: 'isNull'; column: string }
  | { type: 'isNotNull'; column: string }
  | { type: 'raw'; sql: string; params?: unknown[] }
  | { type: 'inSubquery'; column: string; query: SelectAst }
  | { type: 'notInSubquery'; column: string; query: SelectAst }
  | { type: 'exists'; query: SelectAst }
  | { type: 'notExists'; query: SelectAst };

export type AggregateColumn = {
  fn: 'count' | 'sum' | 'avg' | 'min' | 'max';
  column: string | '*';
  alias?: string;
};

export type JoinType = 'inner' | 'left' | 'right' | 'full';

export type JoinClause = {
  type: JoinType;
  table: string;
  alias?: string;
  on: Expr;
};

export type Cte = {
  name: string;
  query: SelectAst;
};

export type SelectAst = {
  type: 'select';
  from: string;
  fromAlias?: string;
  ctes?: Cte[];
  distinct?: boolean;
  columns: string[] | '*';
  aggregates?: AggregateColumn[];
  joins?: JoinClause[];
  where?: Expr;
  groupBy?: string[];
  having?: Expr;
  orderBy?: { column: string; direction: OrderDirection }[];
  limit?: number;
  offset?: number;
};

export type ConflictClause =
  | { action: 'nothing'; targets?: string[] }
  | { action: 'update'; targets: string[]; updateColumns: string[] };

export type InsertAst = {
  type: 'insert';
  into: string;
  columns: string[];
  rows: Record<string, unknown>[];
  onConflict?: ConflictClause;
  returning?: string[];
};

export type UpdateAst = {
  type: 'update';
  table: string;
  set: { column: string; value: unknown }[];
  where?: Expr;
  returning?: string[];
};

export type DeleteAst = {
  type: 'delete';
  from: string;
  where?: Expr;
  returning?: string[];
};

export type QueryAst = SelectAst | InsertAst | UpdateAst | DeleteAst;

/** Opaque wrapper around a SelectAst for use as a subquery in expressions. */
export type Subquery = { readonly _brand: 'subquery'; readonly ast: SelectAst };
