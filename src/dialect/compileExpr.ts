import type { Expr } from '../ast.js';
import { assertSafeIdentifier } from '../identifier.js';
import type { ParamBuffer } from './params.js';

export type PlaceholderStyle = 'postgres' | 'mysql';

function colFragment(column: string, quoteId: (s: string) => string): string {
  assertSafeIdentifier(column, 'column');
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
      const parts = expr.values.map((v) => {
        const i = params.add(v);
        return ph(style, i);
      });
      return `${colFragment(expr.column, quoteId)} IN (${parts.join(', ')})`;
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
