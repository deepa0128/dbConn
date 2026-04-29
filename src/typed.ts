import type { AggregateColumn, Expr, JoinType, OrderDirection, SelectAst } from './ast.js';
import type { DbClient, ExecuteResult, Row } from './client.js';
import { SelectBuilder } from './builder/select.js';
import { InsertBuilder } from './builder/insert.js';
import { UpdateBuilder } from './builder/update.js';
import { DeleteBuilder } from './builder/delete.js';
import type { CursorPageOptions, PageResult } from './paginate.js';
import type { HealthStatus, PoolMetrics } from './driver/types.js';

// ---------------------------------------------------------------------------
// Typed insert builder
// ---------------------------------------------------------------------------

export class TypedInsertBuilder<T extends Record<string, unknown>> {
  constructor(
    private readonly builder: InsertBuilder,
    private readonly client: DbClient,
  ) {}

  columns(...cols: (keyof T & string)[]): this {
    this.builder.columns(...cols);
    return this;
  }

  values(row: Partial<T>): this {
    this.builder.values(row as Record<string, unknown>);
    return this;
  }

  onConflictDoNothing(targets?: (keyof T & string)[]): this {
    this.builder.onConflictDoNothing(targets);
    return this;
  }

  onConflictDoUpdate(targets: (keyof T & string)[], updateColumns: (keyof T & string)[]): this {
    this.builder.onConflictDoUpdate(targets, updateColumns);
    return this;
  }

  returning(...cols: (keyof T & string)[]): this {
    if (cols.length === 0) return this;
    this.builder.returning(...(cols as [string, ...string[]]));
    return this;
  }

  execute(signal?: AbortSignal): Promise<ExecuteResult> {
    return this.client.execute(this.builder, signal);
  }

  fetch<R extends Row = Row>(signal?: AbortSignal): Promise<R[]> {
    return this.client.fetch<R>(this.builder, signal);
  }

  fetchOne<R extends Row = Row>(signal?: AbortSignal): Promise<R | undefined> {
    return this.client.fetchOne<R>(this.builder, signal);
  }

  toAst() {
    return this.builder.toAst();
  }
}

// ---------------------------------------------------------------------------
// Typed update builder
// ---------------------------------------------------------------------------

export class TypedUpdateBuilder<T extends Record<string, unknown>> {
  constructor(
    private readonly builder: UpdateBuilder,
    private readonly client: DbClient,
  ) {}

  set<K extends keyof T & string>(column: K, value: T[K]): this {
    this.builder.set(column, value as unknown);
    return this;
  }

  where(expr: Expr): this {
    this.builder.where(expr);
    return this;
  }

  returning(...cols: (keyof T & string)[]): this {
    if (cols.length === 0) return this;
    this.builder.returning(...(cols as [string, ...string[]]));
    return this;
  }

  execute(signal?: AbortSignal): Promise<ExecuteResult> {
    return this.client.execute(this.builder, signal);
  }

  fetch<R extends Row = Row>(signal?: AbortSignal): Promise<R[]> {
    return this.client.fetch<R>(this.builder, signal);
  }

  fetchOne<R extends Row = Row>(signal?: AbortSignal): Promise<R | undefined> {
    return this.client.fetchOne<R>(this.builder, signal);
  }

  toAst() {
    return this.builder.toAst();
  }
}

// ---------------------------------------------------------------------------
// Typed delete builder
// ---------------------------------------------------------------------------

export class TypedDeleteBuilder<T extends Record<string, unknown>> {
  constructor(
    private readonly builder: DeleteBuilder,
    private readonly client: DbClient,
  ) {}

  where(expr: Expr): this {
    this.builder.where(expr);
    return this;
  }

  returning(...cols: (keyof T & string)[]): this {
    if (cols.length === 0) return this;
    this.builder.returning(...(cols as [string, ...string[]]));
    return this;
  }

  execute(signal?: AbortSignal): Promise<ExecuteResult> {
    return this.client.execute(this.builder, signal);
  }

  fetch<R extends Row = Row>(signal?: AbortSignal): Promise<R[]> {
    return this.client.fetch<R>(this.builder, signal);
  }

  fetchOne<R extends Row = Row>(signal?: AbortSignal): Promise<R | undefined> {
    return this.client.fetchOne<R>(this.builder, signal);
  }

  toAst() {
    return this.builder.toAst();
  }
}

export class TypedSelectBuilder<Row extends Record<string, unknown>> {
  constructor(
    private readonly builder: SelectBuilder,
    private readonly client: DbClient,
  ) {}

  with(name: string, cteBuilder: SelectBuilder): this {
    this.builder.with(name, cteBuilder);
    return this;
  }

  selectColumns(...cols: (keyof Row & string)[]): this {
    this.builder.selectColumns(...cols);
    return this;
  }

  distinct(): this {
    this.builder.distinct();
    return this;
  }

  join(table: string, on: Expr, type?: JoinType, alias?: string): this {
    this.builder.join(table, on, type, alias);
    return this;
  }

  leftJoin(table: string, on: Expr, alias?: string): this {
    this.builder.leftJoin(table, on, alias);
    return this;
  }

  rightJoin(table: string, on: Expr, alias?: string): this {
    this.builder.rightJoin(table, on, alias);
    return this;
  }

  aggregate(fn: AggregateColumn['fn'], column: string | '*', alias?: string): this {
    this.builder.aggregate(fn, column, alias);
    return this;
  }

  groupBy(...cols: (keyof Row & string)[]): this {
    this.builder.groupBy(...cols);
    return this;
  }

  having(expr: Expr): this {
    this.builder.having(expr);
    return this;
  }

  where(expr: Expr): this {
    this.builder.where(expr);
    return this;
  }

  andWhere(expr: Expr): this {
    this.builder.andWhere(expr);
    return this;
  }

  orWhere(expr: Expr): this {
    this.builder.orWhere(expr);
    return this;
  }

  orderBy(col: keyof Row & string, direction?: OrderDirection): this {
    this.builder.orderBy(col, direction);
    return this;
  }

  limit(n: number): this {
    this.builder.limit(n);
    return this;
  }

  offset(n: number): this {
    this.builder.offset(n);
    return this;
  }

  fetch(signal?: AbortSignal): Promise<Row[]> {
    return this.client.fetch<Row>(this.builder, signal);
  }

  fetchOne(signal?: AbortSignal): Promise<Row | undefined> {
    return this.client.fetchOne<Row>(this.builder, signal);
  }

  count(): Promise<number> {
    return this.client.count(this.builder);
  }

  stream(batchSize?: number): AsyncIterable<Row> {
    return this.client.stream<Row>(this.builder, batchSize);
  }

  paginate(options: CursorPageOptions): Promise<PageResult<Row>> {
    return this.client.paginate<Row>(this.builder, options);
  }

  toAst(): SelectAst {
    return this.builder.toAst();
  }
}

export class TypedClient<Schema extends Record<string, Record<string, unknown>>> {
  constructor(readonly raw: DbClient) {}

  get dialect(): 'postgres' | 'mysql' | 'mongodb' {
    return this.raw.dialect;
  }

  selectFrom<T extends keyof Schema & string>(table: T): TypedSelectBuilder<Schema[T]> {
    return new TypedSelectBuilder<Schema[T]>(this.raw.selectFrom(table), this.raw);
  }

  insertInto<T extends keyof Schema & string>(table: T): TypedInsertBuilder<Schema[T]> {
    return new TypedInsertBuilder<Schema[T]>(this.raw.insertInto(table), this.raw);
  }

  updateTable<T extends keyof Schema & string>(table: T): TypedUpdateBuilder<Schema[T]> {
    return new TypedUpdateBuilder<Schema[T]>(this.raw.updateTable(table), this.raw);
  }

  deleteFrom<T extends keyof Schema & string>(table: T): TypedDeleteBuilder<Schema[T]> {
    return new TypedDeleteBuilder<Schema[T]>(this.raw.deleteFrom(table), this.raw);
  }

  fetch<T extends Row = Row>(
    builder: SelectBuilder | InsertBuilder | UpdateBuilder | DeleteBuilder,
    signal?: AbortSignal,
  ): Promise<T[]> {
    return this.raw.fetch<T>(builder, signal);
  }

  fetchOne<T extends Row = Row>(
    builder: SelectBuilder | InsertBuilder | UpdateBuilder | DeleteBuilder,
    signal?: AbortSignal,
  ): Promise<T | undefined> {
    return this.raw.fetchOne<T>(builder, signal);
  }

  execute(
    builder: InsertBuilder | UpdateBuilder | DeleteBuilder,
    signal?: AbortSignal,
  ): Promise<ExecuteResult> {
    return this.raw.execute(builder, signal);
  }

  count(builder: SelectBuilder): Promise<number> {
    return this.raw.count(builder);
  }

  transaction<T>(fn: (tx: TypedClient<Schema>) => Promise<T>): Promise<T> {
    return this.raw.transaction((txClient) => fn(new TypedClient<Schema>(txClient)));
  }

  sql<T extends Row = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  sql<T extends Row = Row>(rawSql: string, params?: unknown[], signal?: AbortSignal): Promise<T[]>;
  sql<T extends Row = Row>(
    stringsOrSql: TemplateStringsArray | string,
    ...rest: unknown[]
  ): Promise<T[]> {
    return (this.raw.sql as (s: TemplateStringsArray | string, ...r: unknown[]) => Promise<T[]>)(
      stringsOrSql,
      ...rest,
    );
  }

  listTables(): Promise<string[]> {
    return this.raw.listTables();
  }

  healthCheck(): Promise<HealthStatus> {
    return this.raw.healthCheck();
  }

  poolMetrics(): PoolMetrics | null {
    return this.raw.poolMetrics();
  }

  close(): Promise<void> {
    return this.raw.close();
  }
}
