import type { InsertAst } from '../ast.js';
import { assertSafeIdentifier } from '../identifier.js';

export class InsertBuilder {
  private table: string | undefined;
  private cols: string[] = [];
  private rows: Record<string, unknown>[] = [];

  into(table: string): this {
    assertSafeIdentifier(table, 'table');
    this.table = table;
    return this;
  }

  columns(...cols: string[]): this {
    for (const c of cols) assertSafeIdentifier(c, 'column');
    this.cols = cols;
    return this;
  }

  values(row: Record<string, unknown>): this {
    this.rows.push(row);
    return this;
  }

  /** @internal */
  toAst(): InsertAst {
    if (!this.table) throw new Error('InsertBuilder: call .into(table) before executing');
    if (this.cols.length === 0) throw new Error('InsertBuilder: call .columns(...) before executing');
    if (this.rows.length === 0) throw new Error('InsertBuilder: call .values(...) before executing');
    return {
      type: 'insert',
      into: this.table,
      columns: this.cols,
      rows: this.rows,
    };
  }
}
