import { MongoClient } from 'mongodb';
import type { DeleteAst, InsertAst, QueryAst, UpdateAst } from '../ast.js';
import type { MongoDbConfig } from '../config.js';
import { ConnectionError, DbError } from '../errors.js';
import { compileMongoQuery } from '../dialect/compileMongo.js';
import { notifyQuery } from './notify.js';
import { withRetry } from './retry.js';
import type { DriverRow, MongoDriver } from './types.js';

function normalizeError(err: unknown): never {
  if (err instanceof DbError) throw err;
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    if (
      message.includes('failed to connect') ||
      message.includes('econnrefused') ||
      message.includes('authentication failed') ||
      message.includes('querysrv')
    ) {
      throw new ConnectionError(err.message, err);
    }
    throw new DbError(err.message, err);
  }
  throw new DbError(String(err), err);
}

export function createMongoDriver(config: MongoDbConfig): MongoDriver {
  const client = new MongoClient(config.uri, {
    ...(config.maxConnections !== undefined ? { maxPoolSize: config.maxConnections } : {}),
  });
  const dbName = config.database;
  const maxRetries = config.maxRetries ?? 0;
  const retryDelayMs = config.retryDelayMs ?? 100;
  let connected = false;

  async function ensureConnected(): Promise<void> {
    if (connected) return;
    await client.connect();
    connected = true;
  }

  function getDb() {
    const db = client.db(dbName);
    if (!db.databaseName) {
      throw new DbError('MongoDB database is required. Include it in the URI path or config.database');
    }
    return db;
  }

  async function runWithNotify<T>(
    operation: string,
    detail: unknown,
    fn: () => Promise<T>,
  ): Promise<T> {
    return withRetry(async () => {
      const start = Date.now();
      try {
        await ensureConnected();
        const result = await fn();
        notifyQuery(config.onQuery, {
          sql: JSON.stringify({ operation, detail }),
          params: [],
          durationMs: Date.now() - start,
        });
        return result;
      } catch (err) {
        notifyQuery(config.onQuery, {
          sql: JSON.stringify({ operation, detail }),
          params: [],
          durationMs: Date.now() - start,
          error: err,
        });
        throw err;
      }
    }, maxRetries, retryDelayMs);
  }

  async function runQuery<T extends DriverRow = DriverRow>(ast: QueryAst): Promise<T[]> {
    const compiled = compileMongoQuery(ast);
    const db = getDb();
    switch (compiled.kind) {
      case 'select': {
        const cursor = db.collection(compiled.collection)
          .find(compiled.filter, {
            ...(compiled.projection ? { projection: compiled.projection } : {}),
          });
        if (compiled.sort) cursor.sort(compiled.sort);
        if (compiled.limit !== undefined) cursor.limit(compiled.limit);
        if (compiled.skip !== undefined) cursor.skip(compiled.skip);
        return (await cursor.toArray()) as unknown as T[];
      }
      case 'insert':
        unsupportedForFetch('insert');
      case 'update':
        unsupportedForFetch('update');
      case 'delete':
        unsupportedForFetch('delete');
      default: {
        const exhaustive: never = compiled;
        return exhaustive;
      }
    }
  }

  async function runExecute(ast: InsertAst | UpdateAst | DeleteAst): Promise<{ affectedRows: number }> {
    const compiled = compileMongoQuery(ast);
    const db = getDb();
    switch (compiled.kind) {
      case 'insert': {
        const result = await db.collection(compiled.collection).insertMany(compiled.documents);
        return { affectedRows: result.insertedCount };
      }
      case 'update': {
        const result = await db.collection(compiled.collection).updateMany(compiled.filter, compiled.update);
        return { affectedRows: result.modifiedCount };
      }
      case 'delete': {
        const result = await db.collection(compiled.collection).deleteMany(compiled.filter);
        return { affectedRows: result.deletedCount };
      }
      case 'select':
        throw new DbError('db.execute() does not accept select queries');
      default: {
        const exhaustive: never = compiled;
        return exhaustive;
      }
    }
  }

  function unsupportedForFetch(type: string): never {
    throw new DbError(`db.fetch() only supports select queries; received ${type}`);
  }

  const driver: MongoDriver = {
    dialect: 'mongodb',

    async query<T extends DriverRow = DriverRow>(query: QueryAst): Promise<T[]> {
      try {
        return await runWithNotify('query', query, () => runQuery<T>(query));
      } catch (err) {
        return normalizeError(err);
      }
    },

    async execute(query: InsertAst | UpdateAst | DeleteAst): Promise<{ affectedRows: number }> {
      try {
        return await runWithNotify('execute', query, () => runExecute(query));
      } catch (err) {
        return normalizeError(err);
      }
    },

    async transaction<T>(fn: (tx: MongoDriver) => Promise<T>): Promise<T> {
      try {
        return await runWithNotify('transaction', null, async () => {
          const session = client.startSession();
          try {
            let result: T | undefined;
            await session.withTransaction(async () => {
              result = await fn(driver);
            });
            return result as T;
          } finally {
            await session.endSession();
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
      return null;
    },

    async close() {
      await client.close();
      connected = false;
    },
  };

  return driver;
}
