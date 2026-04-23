import type { Expr } from '../ast.js';
import { assertSafeQualifiedIdentifier } from '../identifier.js';
import type { ParamBuffer } from './params.js';

export type PlaceholderStyle = 'postgres' | 'mysql';

function colFragment(column: string, quoteId: (s: string) => string): string {
  assertSafeQualifiedIdentifier(column, 'column');
  const dot = column.indexOf('.');
  if (dot !== -1) {
    return `${quoteId(column.slice(0, dot))}.${quoteId(column.slice(dot + 1))}`;
  }
  return quoteId(column);
}

function compileExprInner(
  expr: Expr,
  style: PlaceholderStyle,
  params: ParamBuffer,
  quoteId: (s: string) => string,
): string {
  switch (expr.type) {
    case 'eq': {
      const i = params.add(expr.value);
      return `${colFragment(expr.column, quoteId)} = ${ph(style, i)}`;
    }
    case 'ne': {
      const i = params.add(expr.value);
      return `${colFragment(expr.column, quoteId)} <> ${ph(style, i)}`;
    }
    case 'gt': {
      const i = params.add(expr.value);
      return `${colFragment(expr.column, quoteId)} > ${ph(style, i)}`;
    }
    case 'gte': {
      const i = params.add(expr.value);
      return `${colFragment(expr.column, quoteId)} >= ${ph(style, i)}`;
    }
    case 'lt': {
      const i = params.add(expr.value);
      return `${colFragment(expr.column, quoteId)} < ${ph(style, i)}`;
    }
    case 'lte': {
      const i = params.add(expr.value);
      return `${colFragment(expr.column, quoteId)} <= ${ph(style, i)}`;
    }
    case 'in': {
      if (expr.values.length === 0) {
        throw new RangeError('IN list must not be empty');
      }
      const parts = expr.values.map((v) => ph(style, params.add(v)));
      return `${colFragment(expr.column, quoteId)} IN (${parts.join(', ')})`;
    }
    case 'notIn': {
      if (expr.values.length === 0) {
        throw new RangeError('NOT IN list must not be empty');
      }
      const parts = expr.values.map((v) => ph(style, params.add(v)));
      return `${colFragment(expr.column, quoteId)} NOT IN (${parts.join(', ')})`;
    }
    case 'like': {
      const i = params.add(expr.pattern);
      return `${colFragment(expr.column, quoteId)} LIKE ${ph(style, i)}`;
    }
    case 'notLike': {
      const i = params.add(expr.pattern);
      return `${colFragment(expr.column, quoteId)} NOT LIKE ${ph(style, i)}`;
    }
    case 'ilike': {
      const i = params.add(expr.pattern);
      // MySQL LIKE is case-insensitive by default; ILIKE is Postgres-specific
      const op = style === 'postgres' ? 'ILIKE' : 'LIKE';
      return `${colFragment(expr.column, quoteId)} ${op} ${ph(style, i)}`;
    }
    case 'between': {
      const lo = params.add(expr.low);
      const hi = params.add(expr.high);
      return `${colFragment(expr.column, quoteId)} BETWEEN ${ph(style, lo)} AND ${ph(style, hi)}`;
    }
    case 'isNull':
      return `${colFragment(expr.column, quoteId)} IS NULL`;
    case 'isNotNull':
      return `${colFragment(expr.column, quoteId)} IS NOT NULL`;
    case 'and': {
      if (expr.items.length === 0) return 'TRUE';
      return expr.items.map((e) => `(${compileExprInner(e, style, params, quoteId)})`).join(' AND ');
    }
    case 'or': {
      if (expr.items.length === 0) return 'FALSE';
      return expr.items.map((e) => `(${compileExprInner(e, style, params, quoteId)})`).join(' OR ');
    }
    default: {
      const _exhaustive: never = expr;
      return _exhaustive;
    }
  }
}

function ph(style: PlaceholderStyle, index: number): string {
  return style === 'postgres' ? `$${index}` : '?';
}

export function compileExpr(
  expr: Expr,
  style: PlaceholderStyle,
  params: ParamBuffer,
  quoteId: (s: string) => string,
): string {
  return compileExprInner(expr, style, params, quoteId);
}
