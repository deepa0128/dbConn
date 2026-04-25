import type { DeleteAst, Expr, InsertAst, QueryAst, SelectAst, UpdateAst } from '../ast.js';
import { DbError } from '../errors.js';

type MongoFilter = Record<string, unknown>;
type MongoProjection = Record<string, 0 | 1>;
type MongoSort = Record<string, 1 | -1>;

export type CompiledMongoSelect = {
  kind: 'select';
  collection: string;
  filter: MongoFilter;
  projection?: MongoProjection;
  sort?: MongoSort;
  limit?: number;
  skip?: number;
};

export type CompiledMongoInsert = {
  kind: 'insert';
  collection: string;
  documents: Record<string, unknown>[];
};

export type CompiledMongoUpdate = {
  kind: 'update';
  collection: string;
  filter: MongoFilter;
  update: { $set: Record<string, unknown> };
};

export type CompiledMongoDelete = {
  kind: 'delete';
  collection: string;
  filter: MongoFilter;
};

export type CompiledMongoQuery =
  | CompiledMongoSelect
  | CompiledMongoInsert
  | CompiledMongoUpdate
  | CompiledMongoDelete;

function unsupported(feature: string): never {
  throw new DbError(`${feature} is SQL-only and is not supported for MongoDB`);
}

function stripLikeWildcards(pattern: string): string {
  return pattern.replaceAll('%', '');
}

function exprToMongo(expr: Expr): MongoFilter {
  switch (expr.type) {
    case 'eq':
      return { [expr.column]: expr.value };
    case 'ne':
      return { [expr.column]: { $ne: expr.value } };
    case 'gt':
      return { [expr.column]: { $gt: expr.value } };
    case 'gte':
      return { [expr.column]: { $gte: expr.value } };
    case 'lt':
      return { [expr.column]: { $lt: expr.value } };
    case 'lte':
      return { [expr.column]: { $lte: expr.value } };
    case 'and':
      return expr.items.length === 0 ? {} : { $and: expr.items.map(exprToMongo) };
    case 'or':
      return expr.items.length === 0 ? { $expr: false } : { $or: expr.items.map(exprToMongo) };
    case 'in':
      if (expr.values.length === 0) throw new RangeError('in list must not be empty');
      return { [expr.column]: { $in: expr.values } };
    case 'notIn':
      if (expr.values.length === 0) throw new RangeError('notIn list must not be empty');
      return { [expr.column]: { $nin: expr.values } };
    case 'like':
      return { [expr.column]: { $regex: stripLikeWildcards(expr.pattern) } };
    case 'notLike':
      return { [expr.column]: { $not: { $regex: stripLikeWildcards(expr.pattern) } } };
    case 'ilike':
      return { [expr.column]: { $regex: stripLikeWildcards(expr.pattern), $options: 'i' } };
    case 'between':
      return { [expr.column]: { $gte: expr.low, $lte: expr.high } };
    case 'isNull':
      return { [expr.column]: null };
    case 'isNotNull':
      return { [expr.column]: { $ne: null } };
    case 'raw':
      unsupported('rawExpr');
    case 'inSubquery':
      unsupported('Subqueries');
    case 'notInSubquery':
      unsupported('Subqueries');
    case 'exists':
      unsupported('EXISTS');
    case 'notExists':
      unsupported('NOT EXISTS');
    default: {
      const exhaustive: never = expr;
      return exhaustive;
    }
  }
}

function compileSelect(ast: SelectAst): CompiledMongoSelect {
  if (ast.ctes?.length) unsupported('CTEs');
  if (ast.joins?.length) unsupported('JOINs');
  if (ast.groupBy?.length) unsupported('GROUP BY');
  if (ast.having) unsupported('HAVING');
  if (ast.aggregates?.length) unsupported('Aggregates');
  if (ast.distinct) unsupported('DISTINCT');
  if (ast.fromAlias) unsupported('Aliases');

  const projection =
    ast.columns === '*'
      ? undefined
      : Object.fromEntries(ast.columns.map((column) => [column, 1 as const]));
  const sort: MongoSort | undefined = ast.orderBy?.length
    ? Object.fromEntries(
      ast.orderBy.map(({ column, direction }) => [column, direction === 'asc' ? 1 as const : -1 as const]),
    )
    : undefined;

  return {
    kind: 'select',
    collection: ast.from,
    filter: ast.where ? exprToMongo(ast.where) : {},
    ...(projection ? { projection } : {}),
    ...(sort ? { sort } : {}),
    ...(ast.limit !== undefined ? { limit: ast.limit } : {}),
    ...(ast.offset !== undefined ? { skip: ast.offset } : {}),
  };
}

function compileInsert(ast: InsertAst): CompiledMongoInsert {
  if (ast.onConflict) unsupported('onConflict');
  if (ast.returning) unsupported('RETURNING');
  return {
    kind: 'insert',
    collection: ast.into,
    documents: ast.rows,
  };
}

function compileUpdate(ast: UpdateAst): CompiledMongoUpdate {
  if (ast.returning) unsupported('RETURNING');
  return {
    kind: 'update',
    collection: ast.table,
    filter: ast.where ? exprToMongo(ast.where) : {},
    update: { $set: Object.fromEntries(ast.set.map(({ column, value }) => [column, value])) },
  };
}

function compileDelete(ast: DeleteAst): CompiledMongoDelete {
  if (ast.returning) unsupported('RETURNING');
  return {
    kind: 'delete',
    collection: ast.from,
    filter: ast.where ? exprToMongo(ast.where) : {},
  };
}

export function compileMongoQuery(ast: QueryAst): CompiledMongoQuery {
  switch (ast.type) {
    case 'select':
      return compileSelect(ast);
    case 'insert':
      return compileInsert(ast);
    case 'update':
      return compileUpdate(ast);
    case 'delete':
      return compileDelete(ast);
    default: {
      const exhaustive: never = ast;
      return exhaustive;
    }
  }
}
