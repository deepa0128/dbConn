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
