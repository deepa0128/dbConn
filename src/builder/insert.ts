import type { ConflictClause, InsertAst } from '../ast.js';
import { assertSafeIdentifier } from '../identifier.js';

export class InsertBuilder {
  private table: string | undefined;
  private cols: string[] = [];
  private rows: Record<string, unknown>[] = [];
  private conflictClause: ConflictClause | undefined;
  private returningCols: string[] | undefined;

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

  /** Postgres: ON CONFLICT (targets) DO NOTHING. MySQL: INSERT IGNORE INTO. */
  onConflictDoNothing(targets?: string[]): this {
    if (targets) for (const t of targets) assertSafeIdentifier(t, 'column');
    this.conflictClause = { action: 'nothing', targets };
    return this;
  }

  /** Postgres: ON CONFLICT (targets) DO UPDATE SET. MySQL: ON DUPLICATE KEY UPDATE. */
  onConflictDoUpdate(targets: string[], updateColumns: string[]): this {
    for (const t of targets) assertSafeIdentifier(t, 'column');
    for (const c of updateColumns) assertSafeIdentifier(c, 'column');
    this.conflictClause = { action: 'update', targets, updateColumns };
    return this;
  }

  returning(...cols: [string, ...string[]]): this {
    for (const c of cols) assertSafeIdentifier(c, 'column');
    this.returningCols = cols;
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
      onConflict: this.conflictClause,
      returning: this.returningCols,
    };
  }
}
