import type { AggregateColumn, Expr, OrderDirection, SelectAst } from '../ast.js';
import { assertSafeIdentifier } from '../identifier.js';

export class SelectBuilder {
  private table: string | undefined;
  private projection: string[] | '*' = '*';
  private aggregateList: AggregateColumn[] = [];
  private whereExpr: Expr | undefined;
  private groupByList: string[] = [];
  private havingExpr: Expr | undefined;
  private order: { column: string; direction: OrderDirection }[] = [];
  private limitN: number | undefined;
  private offsetN: number | undefined;

  from(table: string): this {
    assertSafeIdentifier(table, 'table');
    this.table = table;
    return this;
  }

  selectColumns(...cols: string[]): this {
    if (cols.length === 0) {
      this.projection = '*';
      return this;
    }
    for (const c of cols) assertSafeIdentifier(c, 'column');
    this.projection = cols;
    return this;
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
      columns: this.projection,
      aggregates: this.aggregateList.length ? this.aggregateList : undefined,
      where: this.whereExpr,
      groupBy: this.groupByList.length ? this.groupByList : undefined,
      having: this.havingExpr,
      orderBy: this.order.length ? this.order : undefined,
      limit: this.limitN,
      offset: this.offsetN,
    };
  }
}
