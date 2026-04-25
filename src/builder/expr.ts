import type { Expr, SelectAst, Subquery } from '../ast.js';

export function eq(column: string, value: unknown): Expr {
  return { type: 'eq', column, value };
}

export function ne(column: string, value: unknown): Expr {
  return { type: 'ne', column, value };
}

export function gt(column: string, value: unknown): Expr {
  return { type: 'gt', column, value };
}

export function gte(column: string, value: unknown): Expr {
  return { type: 'gte', column, value };
}

export function lt(column: string, value: unknown): Expr {
  return { type: 'lt', column, value };
}

export function lte(column: string, value: unknown): Expr {
  return { type: 'lte', column, value };
}

export function and(...items: Expr[]): Expr {
  return { type: 'and', items };
}

export function or(...items: Expr[]): Expr {
  return { type: 'or', items };
}

export function inList(column: string, values: unknown[] | Subquery): Expr {
  if (Array.isArray(values)) return { type: 'in', column, values };
  return { type: 'inSubquery', column, query: values.ast };
}

export function notInList(column: string, values: unknown[] | Subquery): Expr {
  if (Array.isArray(values)) return { type: 'notIn', column, values };
  return { type: 'notInSubquery', column, query: values.ast };
}

export function like(column: string, pattern: string): Expr {
  return { type: 'like', column, pattern };
}

export function notLike(column: string, pattern: string): Expr {
  return { type: 'notLike', column, pattern };
}

/** Case-insensitive LIKE. Compiles to ILIKE on Postgres; plain LIKE on MySQL (case-insensitive by default). */
export function ilike(column: string, pattern: string): Expr {
  return { type: 'ilike', column, pattern };
}

export function between(column: string, low: unknown, high: unknown): Expr {
  return { type: 'between', column, low, high };
}

export function isNull(column: string): Expr {
  return { type: 'isNull', column };
}

export function isNotNull(column: string): Expr {
  return { type: 'isNotNull', column };
}

/**
 * Embed a raw SQL fragment in a WHERE clause. Placeholders can be written
 * as `?` or `$N` — they are renumbered automatically to fit the surrounding query.
 *
 * Use sparingly; this bypasses the identifier-safety layer.
 */
export function rawExpr(sql: string, params?: unknown[]): Expr {
  return { type: 'raw', sql, params };
}

/** Wrap a builder (or any object with toAst()) as a subquery for use with inList, notInList, exists, notExists. */
export function subquery(builder: { toAst(): SelectAst }): Subquery {
  return { _brand: 'subquery', ast: builder.toAst() };
}

/** WHERE EXISTS (SELECT ...) */
export function exists(sq: Subquery): Expr {
  return { type: 'exists', query: sq.ast };
}

/** WHERE NOT EXISTS (SELECT ...) */
export function notExists(sq: Subquery): Expr {
  return { type: 'notExists', query: sq.ast };
}
