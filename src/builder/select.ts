import type { AggregateColumn, Cte, Expr, JoinClause, JoinType, OrderDirection, SelectAst } from '../ast.js';
import { assertSafeIdentifier, assertSafeQualifiedIdentifier } from '../identifier.js';

export class SelectBuilder {
  private table: string | undefined;
  private tableAlias: string | undefined;
  private isDistinct = false;
  private projection: string[] | '*' = '*';
  private aggregateList: AggregateColumn[] = [];
  private joinList: JoinClause[] = [];
  private whereExpr: Expr | undefined;
  private groupByList: string[] = [];
  private havingExpr: Expr | undefined;
  private order: { column: string; direction: OrderDirection }[] = [];
  private limitN: number | undefined;
  private offsetN: number | undefined;
  private cteList: Cte[] = [];

  with(name: string, builder: SelectBuilder): this {
    assertSafeIdentifier(name, 'CTE name');
    this.cteList.push({ name, query: builder.toAst() });
    return this;
  }

  from(table: string, alias?: string): this {
    assertSafeIdentifier(table, 'table');
    if (alias !== undefined) assertSafeIdentifier(alias, 'alias');
    this.table = table;
    this.tableAlias = alias;
    return this;
  }

  distinct(): this {
    this.isDistinct = true;
    return this;
  }

  selectColumns(...cols: string[]): this {
    if (cols.length === 0) {
      this.projection = '*';
      return this;
    }
    for (const c of cols) assertSafeQualifiedIdentifier(c, 'column');
    this.projection = cols;
    return this;
  }

  join(table: string, on: Expr, type: JoinType = 'inner', alias?: string): this {
    assertSafeIdentifier(table, 'join table');
    if (alias !== undefined) assertSafeIdentifier(alias, 'join alias');
    this.joinList.push({ type, table, alias, on });
    return this;
  }

  leftJoin(table: string, on: Expr, alias?: string): this {
    return this.join(table, on, 'left', alias);
  }

  rightJoin(table: string, on: Expr, alias?: string): this {
    return this.join(table, on, 'right', alias);
  }

  aggregate(fn: AggregateColumn['fn'], column: string | '*', alias?: string): this {
    if (column !== '*') assertSafeIdentifier(column, 'column');
    this.aggregateList.push({ fn, column, alias });
    return this;
  }

  groupBy(...cols: string[]): this {
    for (const c of cols) assertSafeIdentifier(c, 'column');
    this.groupByList.push(...cols);
    return this;
  }

  having(expr: Expr): this {
    this.havingExpr = expr;
    return this;
  }

  where(expr: Expr): this {
    this.whereExpr = expr;
    return this;
  }

  orderBy(column: string, direction: OrderDirection = 'asc'): this {
    assertSafeIdentifier(column, 'column');
    this.order.push({ column, direction });
    return this;
  }

  limit(n: number): this {
    if (!Number.isInteger(n) || n < 0) throw new TypeError('limit must be a non-negative integer');
    this.limitN = n;
    return this;
  }

  offset(n: number): this {
    if (!Number.isInteger(n) || n < 0) throw new TypeError('offset must be a non-negative integer');
    this.offsetN = n;
    return this;
  }

  /**
   * @internal
   * Used by {@link DbClient}; not part of the supported public API surface.
   */
  toAst(): SelectAst {
    if (!this.table) throw new Error('SelectBuilder: call .from(table) before executing');
    return {
      type: 'select',
      from: this.table,
      fromAlias: this.tableAlias,
      ctes: this.cteList.length ? this.cteList : undefined,
      distinct: this.isDistinct || undefined,
      columns: this.projection,
      aggregates: this.aggregateList.length ? this.aggregateList : undefined,
      joins: this.joinList.length ? this.joinList : undefined,
      where: this.whereExpr,
      groupBy: this.groupByList.length ? this.groupByList : undefined,
      having: this.havingExpr,
      orderBy: this.order.length ? this.order : undefined,
      limit: this.limitN,
      offset: this.offsetN,
    };
  }
}
