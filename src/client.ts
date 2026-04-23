import type { DbConnConfig } from './config.js';
import { compileQuery } from './dialect/compileQuery.js';
import { createDriver } from './driver/factory.js';
import { parseConnectionUrl } from './parseUrl.js';
import type { SqlDriver } from './driver/types.js';
import { DeleteBuilder } from './builder/delete.js';
import { InsertBuilder } from './builder/insert.js';
import { SelectBuilder } from './builder/select.js';
import { UpdateBuilder } from './builder/update.js';

export type Row = Record<string, unknown>;

export type ExecuteResult = {
  affectedRows: number;
};

export class DbClient {
  private readonly driver: SqlDriver;

  constructor(driver: SqlDriver) {
    this.driver = driver;
  }

  get dialect(): 'postgres' | 'mysql' {
    return this.driver.dialect;
  }

  selectFrom(table: string): SelectBuilder {
    return new SelectBuilder().from(table);
  }

  insertInto(table: string): InsertBuilder {
    return new InsertBuilder().into(table);
  }

  updateTable(table: string): UpdateBuilder {
    return new UpdateBuilder().tableName(table);
  }

  deleteFrom(table: string): DeleteBuilder {
    return new DeleteBuilder().from(table);
  }

  /** Run a SELECT; returns result rows typed as T (defaults to Row). */
  async fetch<T extends Row = Row>(builder: SelectBuilder): Promise<T[]> {
    const ast = builder.toAst();
    const { sql, params } = compileQuery(ast, this.driver.dialect);
    return this.driver.query<T>(sql, params);
  }

  /**
   * Stream a SELECT in batches. Yields rows one at a time without loading the
   * full result set into memory. Respects any LIMIT set on the builder as a cap.
   */
  async *stream<T extends Row = Row>(
    builder: SelectBuilder,
    batchSize = 100,
  ): AsyncIterable<T> {
    const ast = builder.toAst();
    const cap = ast.limit;
    let offset = ast.offset ?? 0;
    let fetched = 0;

    while (true) {
      const remaining = cap !== undefined ? cap - fetched : Infinity;
      if (remaining <= 0) break;

      const limit = Math.min(batchSize, remaining === Infinity ? batchSize : remaining);
      const batchAst = { ...ast, limit, offset };
      const { sql, params } = compileQuery(batchAst, this.driver.dialect);
      const rows = await this.driver.query<T>(sql, params);

      for (const row of rows) yield row;

      fetched += rows.length;
      offset += rows.length;

      if (rows.length < limit) break;
    }
  }

  /**
   * Run an INSERT / UPDATE / DELETE that has a `.returning()` clause and get
   * the affected rows back. Postgres only — throws DbError on MySQL.
   */
  async returning<T extends Row = Row>(
    builder: InsertBuilder | UpdateBuilder | DeleteBuilder,
  ): Promise<T[]> {
    const ast = builder.toAst();
    const { sql, params } = compileQuery(ast, this.driver.dialect);
    return this.driver.query<T>(sql, params);
  }

  async execute(
    builder: InsertBuilder | UpdateBuilder | DeleteBuilder,
  ): Promise<ExecuteResult> {
    const ast = builder.toAst();
    const { sql, params } = compileQuery(ast, this.driver.dialect);
    return this.driver.execute(sql, params);
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.driver.transaction(async (txDriver) => {
      const txClient = new DbClient(txDriver);
      return fn(txClient);
    });
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

export function createClient(config: DbConnConfig | string): DbClient {
  const resolved = typeof config === 'string' ? parseConnectionUrl(config) : config;
  return new DbClient(createDriver(resolved));
}
