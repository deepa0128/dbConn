import type { DbConnConfig } from './config.js';
import { compileQuery } from './dialect/compileQuery.js';
import { createDriver } from './driver/factory.js';
import { parseConnectionUrl } from './parseUrl.js';
import type { HealthStatus, PoolMetrics, SqlDriver } from './driver/types.js';
import { DeleteBuilder } from './builder/delete.js';
import { InsertBuilder } from './builder/insert.js';
import { SelectBuilder } from './builder/select.js';
import { UpdateBuilder } from './builder/update.js';

export type Row = Record<string, unknown>;

export type ExecuteResult = {
  affectedRows: number;
};

function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Query aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Query aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

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
  async fetch<T extends Row = Row>(builder: SelectBuilder, signal?: AbortSignal): Promise<T[]> {
    const ast = builder.toAst();
    const { sql, params } = compileQuery(ast, this.driver.dialect);
    return withSignal(this.driver.query<T>(sql, params), signal);
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
    signal?: AbortSignal,
  ): Promise<ExecuteResult> {
    const ast = builder.toAst();
    const { sql, params } = compileQuery(ast, this.driver.dialect);
    return withSignal(this.driver.execute(sql, params), signal);
  }

  /** Return the number of rows matching the builder's WHERE clause. */
  async count(builder: SelectBuilder): Promise<number> {
    const ast = builder.toAst();
    const countAst = {
      ...ast,
      columns: [] as string[],
      aggregates: [{ fn: 'count' as const, column: '*' as const, alias: '__n' }],
      orderBy: undefined,
      limit: undefined,
      offset: undefined,
    };
    const { sql, params } = compileQuery(countAst, this.driver.dialect);
    const rows = await this.driver.query<{ __n: string | number }>(sql, params);
    return Number(rows[0]?.__n ?? 0);
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.driver.transaction(async (txDriver) => {
      const txClient = new DbClient(txDriver);
      return fn(txClient);
    });
  }

  /**
   * Execute a raw SQL query. Accepts either a tagged template (recommended) or
   * a plain string + params array.
   *
   * Tagged template — dialect-aware, values are never interpolated into the string:
   *   await db.sql`SELECT * FROM users WHERE id = ${userId}`
   *
   * Plain form (use when building SQL programmatically):
   *   await db.sql('SELECT * FROM users WHERE id = $1', [userId])  // Postgres
   *   await db.sql('SELECT * FROM users WHERE id = ?', [userId])   // MySQL
   */
  sql<T extends Row = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  sql<T extends Row = Row>(rawSql: string, params?: unknown[], signal?: AbortSignal): Promise<T[]>;
  sql<T extends Row = Row>(
    stringsOrSql: TemplateStringsArray | string,
    ...rest: unknown[]
  ): Promise<T[]> {
    if (typeof stringsOrSql === 'string') {
      const params = (rest[0] as unknown[] | undefined) ?? [];
      const signal = rest[1] as AbortSignal | undefined;
      return withSignal(this.driver.query<T>(stringsOrSql, params), signal);
    }
    // Tagged template: build dialect-aware SQL from the template parts and values
    const strings = stringsOrSql;
    const values = rest as unknown[];
    let rawSql = strings[0]!;
    const params: unknown[] = [];
    for (let i = 0; i < values.length; i++) {
      params.push(values[i]);
      const placeholder = this.driver.dialect === 'postgres' ? `$${params.length}` : '?';
      rawSql += placeholder + strings[i + 1]!;
    }
    return this.driver.query<T>(rawSql, params);
  }

  /** Ping the database and return latency + health status. */
  async healthCheck(): Promise<HealthStatus> {
    return this.driver.healthCheck();
  }

  /** Return current connection pool stats. Returns null on MySQL (not exposed by mysql2). */
  poolMetrics(): PoolMetrics | null {
    return this.driver.poolMetrics();
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

export function createClient(config: DbConnConfig | string): DbClient {
  const resolved = typeof config === 'string' ? parseConnectionUrl(config) : config;
  return new DbClient(createDriver(resolved));
}
