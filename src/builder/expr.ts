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

export function isNull(column: string): Expr {
  return { type: 'isNull', column };
}

export function isNotNull(column: string): Expr {
  return { type: 'isNotNull', column };
}
