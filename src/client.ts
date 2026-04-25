import type { DbConnConfig } from './config.js';
import { compileQuery } from './dialect/compileQuery.js';
import { createDriver } from './driver/factory.js';
import { parseConnectionUrl } from './parseUrl.js';
import type { DbDriver, HealthStatus, MongoDriver, PoolMetrics, SqlDriver } from './driver/types.js';
import { DeleteBuilder } from './builder/delete.js';
import { InsertBuilder } from './builder/insert.js';
import { SelectBuilder } from './builder/select.js';
import { UpdateBuilder } from './builder/update.js';
import { paginate as paginateImpl } from './paginate.js';
import type { CursorPageOptions, PageResult } from './paginate.js';
import { TypedClient } from './typed.js';
import { DbError } from './errors.js';

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
  private readonly driver: DbDriver;

  constructor(driver: DbDriver) {
    this.driver = driver;
  }

  get dialect(): 'postgres' | 'mysql' | 'mongodb' {
    return this.driver.dialect;
  }

  private ensureSqlFeature(feature: string): void {
    if (this.driver.dialect === 'mongodb') {
      throw new DbError(`${feature} is SQL-only and is not supported for MongoDB`);
    }
  }

  private getSqlDriver(): SqlDriver {
    if (this.driver.dialect === 'mongodb') {
      throw new DbError('This operation is SQL-only and is not supported for MongoDB');
    }
    return this.driver;
  }

  private getMongoDriver(): MongoDriver {
    if (this.driver.dialect !== 'mongodb') {
      throw new DbError('MongoDB-specific path called for SQL driver');
    }
    return this.driver;
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

  /**
   * Run a SELECT — or an INSERT/UPDATE/DELETE with a `.returning()` clause —
   * and get the result rows back typed as T.
   */
  async fetch<T extends Row = Row>(
    builder: SelectBuilder | InsertBuilder | UpdateBuilder | DeleteBuilder,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const ast = builder.toAst();
    if (this.driver.dialect === 'mongodb') {
      return withSignal(this.getMongoDriver().query<T>(ast), signal);
    }
    const sqlDriver = this.getSqlDriver();
    const { sql, params } = compileQuery(ast, sqlDriver.dialect);
    return withSignal(sqlDriver.query<T>(sql, params), signal);
  }

  /**
   * Stream a SELECT in batches. Yields rows one at a time without loading the
   * full result set into memory. Respects any LIMIT set on the builder as a cap.
   */
  async *stream<T extends Row = Row>(
    builder: SelectBuilder,
    batchSize = 100,
  ): AsyncIterable<T> {
    this.ensureSqlFeature('db.stream()');
    const ast = builder.toAst();
    const cap = ast.limit;
    let offset = ast.offset ?? 0;
    let fetched = 0;

    while (true) {
      const remaining = cap !== undefined ? cap - fetched : Infinity;
      if (remaining <= 0) break;

      const limit = Math.min(batchSize, remaining === Infinity ? batchSize : remaining);
      const batchAst = { ...ast, limit, offset };
      const sqlDriver = this.getSqlDriver();
      const { sql, params } = compileQuery(batchAst, sqlDriver.dialect);
      const rows = await sqlDriver.query<T>(sql, params);

      for (const row of rows) yield row;

      fetched += rows.length;
      offset += rows.length;

      if (rows.length < limit) break;
    }
  }

  async execute(
    builder: InsertBuilder | UpdateBuilder | DeleteBuilder,
    signal?: AbortSignal,
  ): Promise<ExecuteResult> {
    const ast = builder.toAst();
    if (this.driver.dialect === 'mongodb') {
      return withSignal(this.getMongoDriver().execute(ast), signal);
    }
    const sqlDriver = this.getSqlDriver();
    const { sql, params } = compileQuery(ast, sqlDriver.dialect);
    return withSignal(sqlDriver.execute(sql, params), signal);
  }

  /** Return the number of rows matching the builder's WHERE clause. */
  async count(builder: SelectBuilder): Promise<number> {
    this.ensureSqlFeature('db.count()');
    const ast = builder.toAst();
    const countAst = {
      ...ast,
      columns: [] as string[],
      aggregates: [{ fn: 'count' as const, column: '*' as const, alias: '__n' }],
      orderBy: undefined,
      limit: undefined,
      offset: undefined,
    };
    const sqlDriver = this.getSqlDriver();
    const { sql, params } = compileQuery(countAst, sqlDriver.dialect);
    const rows = await sqlDriver.query<{ __n: string | number }>(sql, params);
    return Number(rows[0]?.__n ?? 0);
  }

  /** Fetch one page using keyset (cursor) pagination. */
  async paginate<T extends Row = Row>(
    builder: SelectBuilder,
    options: CursorPageOptions,
  ): Promise<PageResult<T>> {
    this.ensureSqlFeature('db.paginate()');
    return paginateImpl<T>(this, builder, options);
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    if (this.driver.dialect === 'mongodb') {
      return this.driver.transaction(async (txDriver) => {
        const txClient = new DbClient(txDriver);
        return fn(txClient);
      });
    }
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
    this.ensureSqlFeature('db.sql()');
    if (typeof stringsOrSql === 'string') {
      const params = (rest[0] as unknown[] | undefined) ?? [];
      const signal = rest[1] as AbortSignal | undefined;
      return withSignal(this.getSqlDriver().query<T>(stringsOrSql, params), signal);
    }
    // Tagged template: build dialect-aware SQL from the template parts and values
    const strings = stringsOrSql;
    const values = rest as unknown[];
    let rawSql = strings[0]!;
    const params: unknown[] = [];
    for (let i = 0; i < values.length; i++) {
      params.push(values[i]);
      const placeholder = this.getSqlDriver().dialect === 'postgres' ? `$${params.length}` : '?';
      rawSql += placeholder + strings[i + 1]!;
    }
    return this.getSqlDriver().query<T>(rawSql, params);
  }

  /** Ping the database and return latency + health status. */
  async healthCheck(): Promise<HealthStatus> {
    return this.driver.healthCheck();
  }

  /** Return current connection pool stats. Returns null on MySQL (not exposed by mysql2). */
  poolMetrics(): PoolMetrics | null {
    return this.driver.poolMetrics();
  }

  /**
   * Run EXPLAIN on a query. Returns raw rows as the database produces them.
   * Postgres: each row has a `"QUERY PLAN"` column.
   * MySQL: columns are `id`, `select_type`, `table`, `type`, `key`, etc.
   */
  async explain(builder: SelectBuilder): Promise<Row[]> {
    this.ensureSqlFeature('db.explain()');
    const ast = builder.toAst();
    const sqlDriver = this.getSqlDriver();
    const { sql, params } = compileQuery(ast, sqlDriver.dialect);
    return sqlDriver.query<Row>(`EXPLAIN ${sql}`, params);
  }

  /** Return a type-safe wrapper that constrains table names to keys of Schema. */
  withSchema<Schema extends Record<string, Record<string, unknown>>>(): TypedClient<Schema> {
    return new TypedClient<Schema>(this);
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

export function createClient(config: DbConnConfig | string): DbClient {
  const resolved = typeof config === 'string' ? parseConnectionUrl(config) : config;
  return new DbClient(createDriver(resolved));
}
