import type { Expr, UpdateAst } from '../ast.js';
import { assertSafeIdentifier } from '../identifier.js';

export class UpdateBuilder {
  private table: string | undefined;
  private sets: { column: string; value: unknown }[] = [];
  private whereExpr: Expr | undefined;

  tableName(name: string): this {
    assertSafeIdentifier(name, 'table');
    this.table = name;
    return this;
  }

  set(column: string, value: unknown): this {
    assertSafeIdentifier(column, 'column');
    this.sets.push({ column, value });
    return this;
  }

  where(expr: Expr): this {
    this.whereExpr = expr;
    return this;
  }

  /** @internal */
  toAst(): UpdateAst {
    if (!this.table) throw new Error('UpdateBuilder: call .tableName(name) before executing');
    if (this.sets.length === 0) throw new Error('UpdateBuilder: call .set(...) before executing');
    return {
      type: 'update',
      table: this.table,
      set: this.sets,
      where: this.whereExpr,
    };
  }
}
