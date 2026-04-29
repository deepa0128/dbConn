import { MongoClient } from 'mongodb';
import type { ClientSession } from 'mongodb';
import type { DeleteAst, InsertAst, QueryAst, SelectAst, UpdateAst } from '../ast.js';
import type { MongoDbConfig } from '../config.js';
import { ConnectionError, ConstraintError, DbError, QueryTimeoutError } from '../errors.js';
import { compileMongoQuery } from '../dialect/compileMongo.js';
import type { CompiledMongoSelect } from '../dialect/compileMongo.js';
import { notifyQuery } from './notify.js';
import { withRetry } from './retry.js';
import type { DriverRow, MongoDriver } from './types.js';

function normalizeError(err: unknown): never {
  if (err instanceof DbError) throw err;
  if (err instanceof Error) {
    const code = (err as unknown as Record<string, unknown>)['code'];
    // Duplicate key
    if (code === 11000 || code === 11001) {
      throw new ConstraintError(err.message, 'unique', err);
    }
    const name = err.name;
    const msg = err.message;
    if (
      name === 'MongoServerSelectionError' ||
      name === 'MongoNetworkError' ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('failed to connect') ||
      msg.includes('querysrv') ||
      msg.includes('authentication failed')
    ) {
      throw new ConnectionError(msg, err);
    }
    throw new DbError(msg, err);
  }
  throw new DbError(String(err), err);
}

/**
 * Build a driver instance that routes all collection operations through the
 * provided ClientSession. When session is undefined the driver operates
 * without a session (normal pooled mode).
 *
 * Creating a session-bound copy is the correct pattern for MongoDB
 * multi-document transactions — every operation in the callback must carry
 * the same session object, otherwise MongoDB treats them as outside the
 * transaction.
 */
function makeDriver(
  client: MongoClient,
  dbName: string | undefined,
  config: MongoDbConfig,
  maxRetries: number,
  retryDelayMs: number,
  session?: ClientSession,
  shouldRetry?: (err: unknown) => boolean,
): MongoDriver {
  const connected = { value: false };

  async function ensureConnected(): Promise<void> {
    if (connected.value) return;
    await client.connect();
    connected.value = true;
  }

  function getDb() {
    const db = dbName ? client.db(dbName) : client.db();
    if (!db.databaseName) {
      throw new DbError(
        'MongoDB: could not determine database name. ' +
        'Include the database in the connection URL path (mongodb://host/mydb) ' +
        'or set config.database explicitly.',
      );
    }
    return db;
  }

  async function withNotify<T>(label: string, fn: () => Promise<T>): Promise<T> {
    return withRetry(async () => {
      const start = Date.now();
      try {
        await ensureConnected();
        const result = await fn();
        notifyQuery(config.onQuery, { sql: label, params: [], durationMs: Date.now() - start });
        return result;
      } catch (err) {
        notifyQuery(config.onQuery, { sql: label, params: [], durationMs: Date.now() - start, error: err });
        throw err;
      }
    }, maxRetries, retryDelayMs, shouldRetry);
  }

  async function runQuery<T extends DriverRow>(ast: QueryAst): Promise<T[]> {
    const compiled = compileMongoQuery(ast);
    const db = getDb();

    if (compiled.kind !== 'select') {
      throw new DbError(
        `db.fetch() only accepts SELECT queries; received a ${compiled.kind} AST. ` +
        'Use db.execute() for insert, update, and delete operations.',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cursor = db.collection<T>(compiled.collection).find(compiled.filter as any, { session });
    if (compiled.projection) cursor.project(compiled.projection);
    if (compiled.sort) cursor.sort(compiled.sort);
    if (compiled.skip !== undefined) cursor.skip(compiled.skip);
    if (compiled.limit !== undefined) cursor.limit(compiled.limit);
    return cursor.toArray() as Promise<T[]>;
  }

  async function runExecute(ast: InsertAst | UpdateAst | DeleteAst): Promise<{ affectedRows: number }> {
    const compiled = compileMongoQuery(ast);
    const db = getDb();

    switch (compiled.kind) {
      case 'insert': {
        const result = await db.collection(compiled.collection).insertMany(compiled.documents, { session });
        return { affectedRows: result.insertedCount };
      }
      case 'update': {
        const result = await db.collection(compiled.collection).updateMany(compiled.filter, compiled.update, { session });
        return { affectedRows: result.modifiedCount };
      }
      case 'delete': {
        const result = await db.collection(compiled.collection).deleteMany(compiled.filter, { session });
        return { affectedRows: result.deletedCount };
      }
      case 'select':
        throw new DbError(
          'db.execute() does not accept SELECT queries. Use db.fetch() to retrieve rows.',
        );
      default: {
        const exhaustive: never = compiled;
        return exhaustive;
      }
    }
  }

  async function runCount(ast: QueryAst): Promise<number> {
    if (ast.type !== 'select') {
      throw new DbError('db.count() only accepts SELECT builders.');
    }
    const selectAst = ast as SelectAst;

    if (selectAst.joins?.length) {
      throw new DbError(
        'db.count() with JOINs is not supported on MongoDB. ' +
        'Use db.aggregate(collection, [{ $lookup: ... }, { $count: "n" }]) instead.',
      );
    }
    if (selectAst.ctes?.length) {
      throw new DbError(
        'db.count() with CTEs is not supported on MongoDB. ' +
        'Break the query into separate operations.',
      );
    }

    // Re-use the filter compilation from compileMongoQuery without throwing on aggregates/distinct
    const { filter } = compileMongoQuery({ ...selectAst, aggregates: undefined, distinct: undefined }) as import('../dialect/compileMongo.js').CompiledMongoSelect;
    const db = getDb();
    return db.collection(selectAst.from).countDocuments(filter, { session });
  }

  async function runAggregate<T extends DriverRow>(collection: string, pipeline: unknown[]): Promise<T[]> {
    const db = getDb();
    const result = await db.collection(collection).aggregate(pipeline as object[], { session }).toArray();
    return result as T[];
  }

  async function runExplain(ast: SelectAst): Promise<DriverRow[]> {
    const raw = compileMongoQuery(ast);
    if (raw.kind !== 'select') {
      throw new DbError('db.explain() only accepts SELECT queries on MongoDB.');
    }
    const compiled = raw as CompiledMongoSelect;
    const db = getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cursor = db.collection(compiled.collection).find(compiled.filter as any, { session });
    if (compiled.projection) cursor.project(compiled.projection);
    if (compiled.sort) cursor.sort(compiled.sort);
    if (compiled.skip !== undefined) cursor.skip(compiled.skip);
    if (compiled.limit !== undefined) cursor.limit(compiled.limit);
    const plan = await cursor.explain('executionStats');
    return [plan as unknown as DriverRow];
  }

  async function runListCollections(): Promise<string[]> {
    const db = getDb();
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    return collections.map((c) => c.name).sort();
  }

  function makeStreamIterable<T extends DriverRow>(ast: SelectAst, batchSize: number): AsyncIterable<T> {
    const raw = compileMongoQuery(ast);
    if (raw.kind !== 'select') {
      throw new DbError(
        'db.stream() only accepts SELECT queries on MongoDB. ' +
        'Use db.execute() for insert, update, and delete operations.',
      );
    }
    const compiled = raw as CompiledMongoSelect;

    async function* gen(): AsyncGenerator<T> {
      await ensureConnected();
      const db = getDb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cursor = db.collection<T>(compiled.collection).find(compiled.filter as any, { session });
      cursor.batchSize(batchSize);
      if (compiled.projection) cursor.project(compiled.projection);
      if (compiled.sort) cursor.sort(compiled.sort);
      if (compiled.skip !== undefined) cursor.skip(compiled.skip);
      if (compiled.limit !== undefined) cursor.limit(compiled.limit);
      try {
        for await (const doc of cursor) yield doc as T;
      } finally {
        await cursor.close().catch(() => {});
      }
    }

    return gen();
  }

  const driver: MongoDriver = {
    dialect: 'mongodb',

    async query<T extends DriverRow = DriverRow>(ast: QueryAst): Promise<T[]> {
      try {
        return await withNotify(`[mongodb:find:${(ast as SelectAst).from ?? '?'}]`, () => runQuery<T>(ast));
      } catch (err) {
        return normalizeError(err);
      }
    },

    async execute(ast: InsertAst | UpdateAst | DeleteAst): Promise<{ affectedRows: number }> {
      const label = `[mongodb:${ast.type}:${(ast as InsertAst).into ?? (ast as UpdateAst).table ?? (ast as DeleteAst).from ?? '?'}]`;
      try {
        return await withNotify(label, () => runExecute(ast));
      } catch (err) {
        return normalizeError(err);
      }
    },

    async count(ast: QueryAst): Promise<number> {
      try {
        return await withNotify(`[mongodb:count:${(ast as SelectAst).from ?? '?'}]`, () => runCount(ast));
      } catch (err) {
        return normalizeError(err);
      }
    },

    async aggregate<T extends DriverRow = DriverRow>(collection: string, pipeline: unknown[]): Promise<T[]> {
      try {
        return await withNotify(`[mongodb:aggregate:${collection}]`, () => runAggregate<T>(collection, pipeline));
      } catch (err) {
        return normalizeError(err);
      }
    },

    stream<T extends DriverRow = DriverRow>(ast: SelectAst, batchSize = 100): AsyncIterable<T> {
      return makeStreamIterable<T>(ast, batchSize);
    },

    async explain(ast: SelectAst): Promise<DriverRow[]> {
      try {
        return await withNotify(`[mongodb:explain:${ast.from}]`, async () => {
          await ensureConnected();
          return runExplain(ast);
        });
      } catch (err) {
        return normalizeError(err);
      }
    },

    async listTables(): Promise<string[]> {
      try {
        return await withNotify('[mongodb:listCollections]', async () => {
          await ensureConnected();
          return runListCollections();
        });
      } catch (err) {
        return normalizeError(err);
      }
    },

    async transaction<T>(fn: (tx: MongoDriver) => Promise<T>): Promise<T> {
      if (session) {
        throw new DbError(
          'Nested transactions are not supported on MongoDB. ' +
          'MongoDB does not have savepoints — structure your logic to avoid nesting transaction() calls.',
        );
      }
      try {
        return await withNotify('[mongodb:transaction]', async () => {
          const sess = client.startSession();
          try {
            let result!: T;
            await sess.withTransaction(async () => {
              // Create a session-bound driver so every operation inside fn
              // uses the same session, which is required for atomicity.
              const txDriver = makeDriver(client, dbName, config, 0, 0, sess);
              result = await fn(txDriver);
            });
            return result;
          } catch (err) {
            if (
              err instanceof Error &&
              (err.message.includes('Transaction') || err.message.includes('replica set'))
            ) {
              throw new ConnectionError(
                `MongoDB transaction failed: ${err.message}. ` +
                'Multi-document transactions require a replica set or sharded cluster. ' +
                'Start mongod with --replSet rs0 (and run rs.initiate()) to enable transactions in development.',
                err,
              );
            }
            throw err;
          } finally {
            await sess.endSession();
          }
        });
      } catch (err) {
        return normalizeError(err);
      }
    },

    async healthCheck() {
      const start = Date.now();
      try {
        await ensureConnected();
        await getDb().command({ ping: 1 });
        return { healthy: true, latencyMs: Date.now() - start };
      } catch (err) {
        return {
          healthy: false,
          latencyMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    poolMetrics() {
      // MongoDB driver does not expose pool stats via a public API
      return null;
    },

    async close() {
      await client.close();
      connected.value = false;
    },
  };

  return driver;
}

export function createMongoDriver(config: MongoDbConfig): MongoDriver {
  const client = new MongoClient(config.uri, {
    ...(config.maxConnections !== undefined ? { maxPoolSize: config.maxConnections } : {}),
  });
  const maxRetries = config.maxRetries ?? 0;
  const retryDelayMs = config.retryDelayMs ?? 100;
  const shouldRetry = config.retryTransientTimeouts
    ? (err: unknown) => err instanceof ConnectionError || err instanceof QueryTimeoutError
    : undefined;
  return makeDriver(client, config.database, config, maxRetries, retryDelayMs, undefined, shouldRetry);
}
