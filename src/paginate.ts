import type { DbClient, Row } from './client.js';
import { SelectBuilder } from './builder/select.js';
import { compileQuery } from './dialect/compileQuery.js';
import type { Expr, OrderDirection, SelectAst } from './ast.js';

export type PageResult<T extends Row> = {
  rows: T[];
  /** Opaque token — pass as `after` to fetch the next page. Undefined when no more pages. */
  nextCursor: string | undefined;
  hasMore: boolean;
};

export type CursorPageOptions = {
  /** Unique sortable column that acts as the cursor key (e.g. id or created_at). */
  cursorColumn: string;
  direction?: OrderDirection;
  limit: number;
  /** Opaque cursor returned from a previous call. */
  after?: string;
};

/**
 * Fetch one page using keyset (cursor) pagination.
 * Stable under concurrent writes; more efficient than LIMIT/OFFSET on large tables.
 */
export async function paginate<T extends Row = Row>(
  client: DbClient,
  builder: SelectBuilder,
  options: CursorPageOptions,
): Promise<PageResult<T>> {
  const { cursorColumn, direction = 'asc', limit, after } = options;

  // Read the existing AST so we can merge any existing WHERE with the cursor filter
  const baseAst = builder.toAst();

  let cursorFilter: Expr | undefined;
  if (after !== undefined) {
    const decoded = decodeCursor(after);
    const op = direction === 'asc' ? 'gt' : 'lt';
    cursorFilter = { type: op, column: cursorColumn, value: decoded };
  }

  const mergedWhere: Expr | undefined =
    baseAst.where && cursorFilter
      ? { type: 'and', items: [baseAst.where, cursorFilter] }
      : (cursorFilter ?? baseAst.where);

  const pageAst = {
    ...baseAst,
    where: mergedWhere,
    orderBy: [{ column: cursorColumn, direction }, ...(baseAst.orderBy ?? [])],
    limit: limit + 1, // fetch one extra to detect hasMore
  };

  let rows: T[];
  if (client.dialect === 'mongodb') {
    rows = await client.fetch<T>(astToBuilder(pageAst));
  } else {
    const { sql, params } = compileQuery(pageAst, client.dialect as 'postgres' | 'mysql');
    rows = await client.sql<T>(sql, params);
  }

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow !== undefined
      ? encodeCursor(lastRow[cursorColumn])
      : undefined;

  return { rows: pageRows, nextCursor, hasMore };
}

function encodeCursor(value: unknown): string {
  return Buffer.from(String(value)).toString('base64');
}

function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64').toString('utf8');
}

function astToBuilder(ast: SelectAst): SelectBuilder {
  const b = new SelectBuilder().from(ast.from, ast.fromAlias);
  if (ast.columns !== '*') b.selectColumns(...ast.columns);
  if (ast.distinct) b.distinct();
  if (ast.joins?.length) {
    for (const j of ast.joins) b.join(j.table, j.on, j.type, j.alias);
  }
  if (ast.where) b.where(ast.where);
  if (ast.groupBy?.length) b.groupBy(...ast.groupBy);
  if (ast.having) b.having(ast.having);
  if (ast.orderBy?.length) {
    for (const o of ast.orderBy) b.orderBy(o.column, o.direction);
  }
  if (ast.limit !== undefined) b.limit(ast.limit);
  if (ast.offset !== undefined) b.offset(ast.offset);
  return b;
}
