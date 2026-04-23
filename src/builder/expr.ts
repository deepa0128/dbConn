import type { Expr } from '../ast.js';

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

export function inList(column: string, values: unknown[]): Expr {
  return { type: 'in', column, values };
}

export function notInList(column: string, values: unknown[]): Expr {
  return { type: 'notIn', column, values };
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
