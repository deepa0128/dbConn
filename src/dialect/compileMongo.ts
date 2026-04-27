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

/**
 * Convert a SQL LIKE pattern to a JavaScript RegExp.
 *   %  →  .* (any sequence of characters)
 *   _  →  .  (any single character)
 * All regex metacharacters in the pattern are escaped before substitution.
 */
function sqlLikeToRegex(pattern: string, caseInsensitive: boolean): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex metacharacters (not % or _)
    .replace(/%/g, '.*')                   // SQL % → any sequence
    .replace(/_/g, '.');                   // SQL _ → any single char
  return new RegExp(`^${escaped}$`, caseInsensitive ? 'i' : '');
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
      return expr.items.length === 0 ? { $expr: { $eq: [1, 0] } } : { $or: expr.items.map(exprToMongo) };
    case 'in':
      if (expr.values.length === 0) throw new RangeError('in list must not be empty');
      return { [expr.column]: { $in: expr.values } };
    case 'notIn':
      if (expr.values.length === 0) throw new RangeError('notIn list must not be empty');
      return { [expr.column]: { $nin: expr.values } };
    case 'like':
      return { [expr.column]: sqlLikeToRegex(expr.pattern, false) };
    case 'notLike':
      return { [expr.column]: { $not: sqlLikeToRegex(expr.pattern, false) } };
    case 'ilike':
      // ilike is case-insensitive LIKE — compile to regex with /i flag
      return { [expr.column]: sqlLikeToRegex(expr.pattern, true) };
    case 'between':
      return { [expr.column]: { $gte: expr.low, $lte: expr.high } };
    case 'isNull':
      return { [expr.column]: null };
    case 'isNotNull':
      return { [expr.column]: { $ne: null } };
    case 'raw':
      throw new DbError(
        'rawExpr() is not supported on MongoDB. ' +
        'Use db.aggregate(collection, pipeline) to pass raw MongoDB query stages.',
      );
    case 'inSubquery':
    case 'notInSubquery':
      throw new DbError(
        'Subquery expressions (inList with a subquery) are not supported on MongoDB. ' +
        'Use db.aggregate(collection, [{ $lookup: {...} }, { $match: {...} }]) for cross-collection filtering.',
      );
    case 'exists':
    case 'notExists':
      throw new DbError(
        'EXISTS / NOT EXISTS subqueries are not supported on MongoDB. ' +
        'Use db.aggregate(collection, [{ $lookup: {...} }, { $match: {...} }]) for existence checks across collections.',
      );
    default: {
      const exhaustive: never = expr;
      return exhaustive;
    }
  }
}

function compileSelect(ast: SelectAst): CompiledMongoSelect {
  if (ast.ctes?.length) {
    throw new DbError(
      'CTEs (WITH ... AS) are not supported on MongoDB. ' +
      'Break the query into separate db.fetch() calls, or use db.aggregate(collection, [{ $facet: {...} }]) for multi-branch pipelines.',
    );
  }
  if (ast.joins?.length) {
    throw new DbError(
      'JOINs are not supported on MongoDB. ' +
      'Use db.aggregate(collection, [{ $lookup: { from, localField, foreignField, as } }]) for cross-collection queries.',
    );
  }
  if (ast.groupBy?.length) {
    throw new DbError(
      'GROUP BY is not supported on MongoDB. ' +
      'Use db.aggregate(collection, [{ $group: { _id: "$field", total: { $sum: "$amount" } } }]) for grouping.',
    );
  }
  if (ast.having) {
    throw new DbError(
      'HAVING is not supported on MongoDB. ' +
      'Use db.aggregate(collection, [{ $group: ... }, { $match: ... }]) to filter after grouping.',
    );
  }
  if (ast.aggregates?.length) {
    throw new DbError(
      'SQL aggregate functions (COUNT, SUM, AVG, MIN, MAX) are not supported on MongoDB via the query builder. ' +
      'Use db.aggregate(collection, [{ $group: { _id: null, total: { $sum: "$amount" } } }]) for aggregations. ' +
      'For document counts use db.count(builder) which calls countDocuments internally.',
    );
  }
  if (ast.distinct) {
    throw new DbError(
      'DISTINCT is not supported on MongoDB. ' +
      'Use db.aggregate(collection, [{ $group: { _id: "$field" } }]) for deduplication.',
    );
  }
  if (ast.fromAlias) {
    throw new DbError(
      'Table aliases are not supported on MongoDB. ' +
      'MongoDB collections are referenced by name directly; aliases are only meaningful in SQL JOIN contexts.',
    );
  }

  const projection =
    ast.columns === '*'
      ? undefined
      : Object.fromEntries(ast.columns.map((column) => [column, 1 as const]));
  const sort: MongoSort | undefined = ast.orderBy?.length
    ? Object.fromEntries(
        ast.orderBy.map(({ column, direction }) => [column, direction === 'asc' ? (1 as const) : (-1 as const)]),
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
  if (ast.onConflict) {
    throw new DbError(
      'ON CONFLICT (upsert) is not supported on MongoDB via the query builder. ' +
      'For upserts use db.aggregate(collection, [{ $merge: { into, on, whenMatched, whenNotMatched } }]), ' +
      'or the native MongoDB driver\'s replaceOne / updateOne with { upsert: true }.',
    );
  }
  if (ast.returning) {
    throw new DbError(
      'RETURNING is not supported on MongoDB. ' +
      'Query the collection separately after the insert, or use the native MongoDB driver\'s insertOne which returns the inserted _id.',
    );
  }
  return {
    kind: 'insert',
    collection: ast.into,
    documents: ast.rows,
  };
}

function compileUpdate(ast: UpdateAst): CompiledMongoUpdate {
  if (ast.returning) {
    throw new DbError(
      'RETURNING is not supported on MongoDB. ' +
      'Use db.aggregate(collection, [{ $match: filter }]) to read updated documents separately, ' +
      'or the native MongoDB driver\'s findOneAndUpdate which returns the document before or after the update.',
    );
  }
  return {
    kind: 'update',
    collection: ast.table,
    filter: ast.where ? exprToMongo(ast.where) : {},
    update: { $set: Object.fromEntries(ast.set.map(({ column, value }) => [column, value])) },
  };
}

function compileDelete(ast: DeleteAst): CompiledMongoDelete {
  if (ast.returning) {
    throw new DbError(
      'RETURNING is not supported on MongoDB. ' +
      'Use the native MongoDB driver\'s findOneAndDelete to retrieve the document before deleting it.',
    );
  }
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
