import type { DeleteAst, InsertAst, QueryAst, SelectAst, UpdateAst } from '../ast.js';
import { DbError } from '../errors.js';
import { assertSafeIdentifier, assertSafeQualifiedIdentifier } from '../identifier.js';
import { compileExpr } from './compileExpr.js';
import { ParamBuffer } from './params.js';
import type { PlaceholderStyle } from './compileExpr.js';
import { quoteMysqlIdent, quotePostgresIdent } from './quote.js';

export type CompiledSql = { sql: string; params: unknown[] };

function quote(style: PlaceholderStyle): (s: string) => string {
  return style === 'postgres' ? quotePostgresIdent : quoteMysqlIdent;
}

function compileSelect(ast: SelectAst, style: PlaceholderStyle): CompiledSql {
  const params = new ParamBuffer();
  const q = quote(style);
  assertSafeIdentifier(ast.from, 'table');

  const regularCols =
    ast.columns === '*'
      ? (ast.aggregates?.length ? [] : ['*'])
      : ast.columns.map((c) => {
          assertSafeQualifiedIdentifier(c, 'column');
          const dot = c.indexOf('.');
          return dot !== -1 ? `${q(c.slice(0, dot))}.${q(c.slice(dot + 1))}` : q(c);
        });

  const aggCols = (ast.aggregates ?? []).map(({ fn, column, alias }) => {
    const col = column === '*' ? '*' : q(column);
    const expr = `${fn.toUpperCase()}(${col})`;
    return alias ? `${expr} AS ${q(alias)}` : expr;
  });

  const distinct = ast.distinct ? 'DISTINCT ' : '';
  const colList = [...regularCols, ...aggCols].join(', ') || '*';
  const fromRef = ast.fromAlias
    ? `${q(ast.from)} AS ${q(ast.fromAlias)}`
    : q(ast.from);
  let sql = `SELECT ${distinct}${colList} FROM ${fromRef}`;

  if (ast.joins?.length) {
    const JOIN_KEYWORDS: Record<string, string> = {
      inner: 'INNER JOIN',
      left: 'LEFT JOIN',
      right: 'RIGHT JOIN',
      full: 'FULL JOIN',
    };
    for (const join of ast.joins) {
      assertSafeIdentifier(join.table, 'join table');
      const keyword = JOIN_KEYWORDS[join.type]!;
      const tableRef = join.alias ? `${q(join.table)} AS ${q(join.alias)}` : q(join.table);
      const on = compileExpr(join.on, style, params, q);
      sql += ` ${keyword} ${tableRef} ON ${on}`;
    }
  }

  if (ast.where) {
    sql += ` WHERE ${compileExpr(ast.where, style, params, q)}`;
  }

  if (ast.groupBy?.length) {
    for (const c of ast.groupBy) assertSafeIdentifier(c, 'column');
    sql += ` GROUP BY ${ast.groupBy.map(q).join(', ')}`;
  }

  if (ast.having) {
    sql += ` HAVING ${compileExpr(ast.having, style, params, q)}`;
  }

  if (ast.orderBy?.length) {
    const ob = ast.orderBy
      .map(({ column, direction }) => `${q(column)} ${direction.toUpperCase()}`)
      .join(', ');
    sql += ` ORDER BY ${ob}`;
  }

  if (ast.limit !== undefined) {
    if (!Number.isInteger(ast.limit) || ast.limit < 0) {
      throw new TypeError('limit must be a non-negative integer');
    }
    sql += ` LIMIT ${ast.limit}`;
  }

  if (ast.offset !== undefined) {
    if (!Number.isInteger(ast.offset) || ast.offset < 0) {
      throw new TypeError('offset must be a non-negative integer');
    }
    sql += ` OFFSET ${ast.offset}`;
  }

  return { sql, params: params.values };
}

function compileInsert(ast: InsertAst, style: PlaceholderStyle): CompiledSql {
  const params = new ParamBuffer();
  const q = quote(style);
  assertSafeIdentifier(ast.into, 'table');
  if (ast.columns.length === 0) throw new TypeError('insert columns must not be empty');
  for (const c of ast.columns) assertSafeIdentifier(c, 'column');
  if (ast.rows.length === 0) throw new TypeError('insert must have at least one row');

  const colList = ast.columns.map((c) => q(c)).join(', ');
  const rowSqls: string[] = [];

  for (const row of ast.rows) {
    const placeholders: string[] = [];
    for (const col of ast.columns) {
      if (!Object.prototype.hasOwnProperty.call(row, col)) {
        throw new TypeError(`row missing value for column ${JSON.stringify(col)}`);
      }
      const i = params.add(row[col]);
      placeholders.push(style === 'postgres' ? `$${i}` : '?');
    }
    rowSqls.push(`(${placeholders.join(', ')})`);
  }

  const ignoreKeyword =
    style === 'mysql' && ast.onConflict?.action === 'nothing' ? ' IGNORE' : '';
  let sql = `INSERT${ignoreKeyword} INTO ${q(ast.into)} (${colList}) VALUES ${rowSqls.join(', ')}`;

  if (ast.onConflict) {
    const { action } = ast.onConflict;
    if (style === 'postgres') {
      const targets = ast.onConflict.targets;
      const targetClause = targets?.length ? ` (${targets.map(q).join(', ')})` : '';
      if (action === 'nothing') {
        sql += ` ON CONFLICT${targetClause} DO NOTHING`;
      } else {
        const setClauses = ast.onConflict.updateColumns
          .map((c) => `${q(c)} = EXCLUDED.${q(c)}`)
          .join(', ');
        sql += ` ON CONFLICT${targetClause} DO UPDATE SET ${setClauses}`;
      }
    } else if (style === 'mysql' && action === 'update') {
      const setClauses = ast.onConflict.updateColumns
        .map((c) => `${q(c)} = VALUES(${q(c)})`)
        .join(', ');
      sql += ` ON DUPLICATE KEY UPDATE ${setClauses}`;
    }
    // mysql + action=nothing handled above via INSERT IGNORE
  }

  if (ast.returning) {
    if (style !== 'postgres') throw new DbError('RETURNING is only supported on PostgreSQL');
    sql += ` RETURNING ${ast.returning.map((c) => q(c)).join(', ')}`;
  }
  return { sql, params: params.values };
}

function compileUpdate(ast: UpdateAst, style: PlaceholderStyle): CompiledSql {
  const params = new ParamBuffer();
  const q = quote(style);
  assertSafeIdentifier(ast.table, 'table');
  if (ast.set.length === 0) throw new TypeError('update set must not be empty');

  const sets = ast.set.map(({ column, value }) => {
    const i = params.add(value);
    return `${q(column)} = ${style === 'postgres' ? `$${i}` : '?'}`;
  });

  let sql = `UPDATE ${q(ast.table)} SET ${sets.join(', ')}`;
  if (ast.where) {
    sql += ` WHERE ${compileExpr(ast.where, style, params, q)}`;
  }
  if (ast.returning) {
    if (style !== 'postgres') throw new DbError('RETURNING is only supported on PostgreSQL');
    sql += ` RETURNING ${ast.returning.map((c) => q(c)).join(', ')}`;
  }
  return { sql, params: params.values };
}

function compileDelete(ast: DeleteAst, style: PlaceholderStyle): CompiledSql {
  const params = new ParamBuffer();
  const q = quote(style);
  assertSafeIdentifier(ast.from, 'table');
  let sql = `DELETE FROM ${q(ast.from)}`;
  if (ast.where) {
    sql += ` WHERE ${compileExpr(ast.where, style, params, q)}`;
  }
  if (ast.returning) {
    if (style !== 'postgres') throw new DbError('RETURNING is only supported on PostgreSQL');
    sql += ` RETURNING ${ast.returning.map((c) => q(c)).join(', ')}`;
  }
  return { sql, params: params.values };
}

export function compileQuery(ast: QueryAst, dialect: 'postgres' | 'mysql'): CompiledSql {
  const style: PlaceholderStyle = dialect === 'postgres' ? 'postgres' : 'mysql';
  switch (ast.type) {
    case 'select':
      return compileSelect(ast, style);
    case 'insert':
      return compileInsert(ast, style);
    case 'update':
      return compileUpdate(ast, style);
    case 'delete':
      return compileDelete(ast, style);
    default: {
      const _e: never = ast;
      return _e;
    }
  }
}
