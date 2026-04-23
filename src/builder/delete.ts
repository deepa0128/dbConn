import type { DeleteAst, Expr } from '../ast.js';
import { assertSafeIdentifier } from '../identifier.js';

export class DeleteBuilder {
  private table: string | undefined;
  private whereExpr: Expr | undefined;

  from(table: string): this {
    assertSafeIdentifier(table, 'table');
    this.table = table;
    return this;
  }

  where(expr: Expr): this {
    this.whereExpr = expr;
    return this;
  }

  /** @internal */
  toAst(): DeleteAst {
    if (!this.table) throw new Error('DeleteBuilder: call .from(table) before executing');
    return {
      type: 'delete',
      from: this.table,
      where: this.whereExpr,
    };
  }
}
