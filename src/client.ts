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

  /** The active database dialect: 'postgres', 'mysql', or 'mongodb'. */
  get dialect(): 'postgres' | 'mysql' | 'mongodb' {
    return this.driver.dialect;
  }

  private requireSql(feature: string): SqlDriver {
    if (this.driver.dialect === 'mongodb') {
      throw new DbError(`${feature} is not supported on MongoDB. Check db.dialect before calling this method.`);
    }
    return this.driver as SqlDriver;
  }

  private get mongoDriver(): MongoDriver {
    return this.driver as MongoDriver;
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
   *
   * Works on all dialects. For MongoDB, unsupported features (JOINs, CTEs, subqueries,
   * aggregates, DISTINCT) throw a descriptive DbError with the recommended alternative.
   */
  async fetch<T extends Row = Row>(
    builder: SelectBuilder | InsertBuilder | UpdateBuilder | DeleteBuilder,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const ast = builder.toAst();
    if (this.driver.dialect === 'mongodb') {
      return withSignal(this.mongoDriver.query<T>(ast), signal);
    }
    const sqlDriver = this.driver as SqlDriver;
    const { sql, params } = compileQuery(ast, sqlDriver.dialect);
    return withSignal(sqlDriver.query<T>(sql, params), signal);
  }

  /**
   * Stream a SELECT in batches using LIMIT/OFFSET pagination.
   * Yields rows one at a time without loading the full result into memory.
   * Respects any LIMIT set on the builder as an overall cap.
   *
   * SQL only — not supported on MongoDB. For MongoDB, use db.aggregate() with
   * a $skip / $limit pipeline or process results from db.fetch() directly.
   */
  async *stream<T extends Row = Row>(
    builder: SelectBuilder,
    batchSize = 100,
  ): AsyncIterable<T> {
    const sqlDriver = this.requireSql(
      'db.stream() — use db.aggregate(collection, [{ $skip: N }, { $limit: N }]) for MongoDB cursor-based streaming',
    );
    const ast = builder.toAst();
    const cap = ast.limit;
    let offset = ast.offset ?? 0;
    let fetched = 0;

    while (true) {
      const remaining = cap !== undefined ? cap - fetched : Infinity;
      if (remaining <= 0) break;

      const limit = Math.min(batchSize, remaining === Infinity ? batchSize : remaining);
      const batchAst = { ...ast, limit, offset };
      const { sql, params } = compileQuery(batchAst, sqlDriver.dialect);
      const rows = await sqlDriver.query<T>(sql, params);

      for (const row of rows) yield row;

      fetched += rows.length;
      offset += rows.length;

      if (rows.length < limit) break;
    }
  }

  /**
   * Execute an INSERT, UPDATE, or DELETE and return the number of affected rows.
   *
   * Works on all dialects. Note that MongoDB's updateMany returns modifiedCount
   * (documents actually changed), not matchedCount (documents found by the filter).
   */
  async execute(
    builder: InsertBuilder | UpdateBuilder | DeleteBuilder,
    signal?: AbortSignal,
  ): Promise<ExecuteResult> {
    const ast = builder.toAst();
    if (this.driver.dialect === 'mongodb') {
      return withSignal(this.mongoDriver.execute(ast), signal);
    }
    const sqlDriver = this.driver as SqlDriver;
    const { sql, params } = compileQuery(ast, sqlDriver.dialect);
    return withSignal(sqlDriver.execute(sql, params), signal);
  }

  /**
   * Return the number of rows (or documents) matching the builder's WHERE clause.
   *
   * On SQL dialects: compiles to `SELECT COUNT(*) FROM ...`.
   * On MongoDB: uses countDocuments(filter) which is efficient on indexed fields.
   * JOINs, CTEs, and subqueries in the builder are not supported on MongoDB for count.
   */
  async count(builder: SelectBuilder): Promise<number> {
    const ast = builder.toAst();

    if (this.driver.dialect === 'mongodb') {
      return this.mongoDriver.count(ast);
    }

    const sqlDriver = this.driver as SqlDriver;
    const countAst = {
      ...ast,
      columns: [] as string[],
      aggregates: [{ fn: 'count' as const, column: '*' as const, alias: '__n' }],
      orderBy: undefined,
      limit: undefined,
      offset: undefined,
    };
    const { sql, params } = compileQuery(countAst, sqlDriver.dialect);
    const rows = await sqlDriver.query<{ __n: string | number }>(sql, params);
    return Number(rows[0]?.__n ?? 0);
  }

  /**
   * Fetch one page using keyset (cursor) pagination.
   * Stable under concurrent writes; more efficient than LIMIT/OFFSET on large tables.
   *
   * SQL only — not supported on MongoDB. For MongoDB, use db.aggregate() with
   * $match and $sort to implement cursor-based pagination, or use skip/limit via db.fetch().
   */
  async paginate<T extends Row = Row>(
    builder: SelectBuilder,
    options: CursorPageOptions,
  ): Promise<PageResult<T>> {
    this.requireSql(
      'db.paginate() — for MongoDB, implement pagination using db.fetch() with .limit(n).offset(n) ' +
      'or db.aggregate() with $match / $sort for keyset pagination',
    );
    return paginateImpl<T>(this, builder, options);
  }

  /**
   * Wrap a set of operations in a database transaction.
   *
   * On SQL dialects: uses BEGIN / COMMIT / ROLLBACK. Nested calls use SAVEPOINTs.
   * On MongoDB: uses a multi-document transaction session. Requires the MongoDB server
   * to be running as a replica set or sharded cluster. Nested calls throw DbError.
   *
   * The callback receives a new DbClient bound to the transaction connection (SQL) or
   * session (MongoDB). All operations inside must go through this tx client.
   */
  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    if (this.driver.dialect === 'mongodb') {
      return this.mongoDriver.transaction(async (txDriver) => fn(new DbClient(txDriver)));
    }
    return (this.driver as SqlDriver).transaction(async (txDriver) => fn(new DbClient(txDriver)));
  }

  /**
   * Execute a raw SQL query. Accepts either a tagged template (recommended) or
   * a plain string + params array.
   *
   * SQL only — not available on MongoDB. Use db.aggregate(collection, pipeline) instead.
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
    const sqlDriver = this.requireSql(
      'db.sql() — use db.aggregate(collection, pipeline) to run raw MongoDB operations',
    );
    if (typeof stringsOrSql === 'string') {
      const params = (rest[0] as unknown[] | undefined) ?? [];
      const signal = rest[1] as AbortSignal | undefined;
      return withSignal(sqlDriver.query<T>(stringsOrSql, params), signal);
    }
    // Tagged template: build dialect-aware SQL from the template parts and values
    const strings = stringsOrSql;
    const values = rest as unknown[];
    let rawSql = strings[0]!;
    const params: unknown[] = [];
    for (let i = 0; i < values.length; i++) {
      params.push(values[i]);
      const placeholder = sqlDriver.dialect === 'postgres' ? `$${params.length}` : '?';
      rawSql += placeholder + strings[i + 1]!;
    }
    return sqlDriver.query<T>(rawSql, params);
  }

  /**
   * Run a raw MongoDB aggregation pipeline on the named collection.
   *
   * MongoDB only — throws DbError on SQL dialects. This is the primary escape hatch
   * for operations not expressible via the query builder:
   *
   *   JOINs      → { $lookup: { from, localField, foreignField, as } }
   *   GROUP BY   → { $group: { _id: "$field", total: { $sum: "$amount" } } }
   *   CTEs       → { $facet: { branch1: [...], branch2: [...] } }
   *   Upserts    → { $merge: { into, on, whenMatched, whenNotMatched } }
   *
   * Example:
   *   const result = await db.aggregate('orders', [
   *     { $match: { status: 'shipped' } },
   *     { $group: { _id: '$customerId', total: { $sum: '$amount' } } },
   *     { $sort: { total: -1 } },
   *   ]);
   */
  async aggregate<T extends Row = Row>(collection: string, pipeline: unknown[]): Promise<T[]> {
    if (this.driver.dialect !== 'mongodb') {
      throw new DbError(
        `db.aggregate() is only available for MongoDB connections. ` +
        `This client is using dialect "${this.driver.dialect}". ` +
        `Use db.sql() or the query builder for SQL operations.`,
      );
    }
    return this.mongoDriver.aggregate<T>(collection, pipeline);
  }

  /** Ping the database and return latency + health status. Works on all dialects. */
  async healthCheck(): Promise<HealthStatus> {
    return this.driver.healthCheck();
  }

  /**
   * Return current connection pool stats.
   * Returns null on MySQL (mysql2 does not expose pool internals) and MongoDB.
   */
  poolMetrics(): PoolMetrics | null {
    return this.driver.poolMetrics();
  }

  /**
   * Run EXPLAIN on a SELECT query and return the raw plan rows.
   * Postgres: each row has a `"QUERY PLAN"` column.
   * MySQL: columns are `id`, `select_type`, `table`, `type`, `key`, etc.
   *
   * SQL only — not supported on MongoDB. Use the MongoDB Compass query analyzer
   * or db.aggregate(collection, pipeline) with an explain option for query analysis.
   */
  async explain(builder: SelectBuilder): Promise<Row[]> {
    const sqlDriver = this.requireSql(
      'db.explain() — use the MongoDB Compass query analyzer or call collection.find(filter).explain() via the native MongoDB driver',
    );
    const ast = builder.toAst();
    const { sql, params } = compileQuery(ast, sqlDriver.dialect);
    return sqlDriver.query<Row>(`EXPLAIN ${sql}`, params);
  }

  /** Return a type-safe wrapper that constrains table and column names to keys of Schema. */
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
