import mysql from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type DbClient } from '../../src/client.js';
import { eq } from '../../src/builder/expr.js';
import { ConstraintError, DbError } from '../../src/errors.js';
import {
  CREATE_TABLE_MYSQL,
  DROP_TABLE,
  TEST_TABLE,
  TRUNCATE_TABLE,
  mysqlUrl,
  parseUrl,
} from './helpers.js';

const url = mysqlUrl();

describe.skipIf(!url)('MySQL integration', () => {
  let db: DbClient;
  let pool: mysql.Pool; // used only for DDL in setup

  beforeAll(async () => {
    const cfg = parseUrl(url!);
    // mysql URL ports default to 5432 from parseUrl; correct to 3306 for mysql
    const port = cfg.port === 5432 ? 3306 : cfg.port;
    pool = mysql.createPool({ ...cfg, port });
    db = createClient({ dialect: 'mysql', ...cfg, port });
    await pool.execute(CREATE_TABLE_MYSQL);
  });

  afterAll(async () => {
    await pool.execute(DROP_TABLE);
    await pool.end();
    await db.close();
  });

  beforeEach(async () => {
    await pool.execute(TRUNCATE_TABLE);
  });

  async function insertUser(email: string, name: string) {
    return db.execute(
      db.insertInto(TEST_TABLE)
        .columns('email', 'name')
        .values({ email, name }),
    );
  }

  // ── INSERT ───────────────────────────────────────────────────────────────

  it('inserts a row', async () => {
    const result = await insertUser('alice@example.com', 'Alice');
    expect(result.affectedRows).toBe(1);
  });

  // ── SELECT ───────────────────────────────────────────────────────────────

  it('fetches inserted rows', async () => {
    await insertUser('bob@example.com', 'Bob');
    const rows = await db.fetch(
      db.selectFrom(TEST_TABLE)
        .selectColumns('email', 'name')
        .where(eq('email', 'bob@example.com')),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'bob@example.com', name: 'Bob' });
  });

  it('respects limit', async () => {
    await insertUser('u1@e.com', 'U1');
    await insertUser('u2@e.com', 'U2');
    const rows = await db.fetch(
      db.selectFrom(TEST_TABLE).orderBy('email', 'asc').limit(1),
    );
    expect(rows).toHaveLength(1);
  });

  it('supports generic row type', async () => {
    await insertUser('typed@example.com', 'Typed');
    type User = { email: string; name: string };
    const rows = await db.fetch<User>(
      db.selectFrom(TEST_TABLE)
        .selectColumns('email', 'name')
        .where(eq('email', 'typed@example.com')),
    );
    expect(rows[0].email).toBe('typed@example.com');
  });

  // ── UPDATE ───────────────────────────────────────────────────────────────

  it('updates a row', async () => {
    await insertUser('upd@example.com', 'Before');
    const result = await db.execute(
      db.updateTable(TEST_TABLE)
        .set('name', 'After')
        .where(eq('email', 'upd@example.com')),
    );
    expect(result.affectedRows).toBe(1);
  });

  // ── DELETE ───────────────────────────────────────────────────────────────

  it('deletes a row', async () => {
    await insertUser('del@example.com', 'Del');
    const result = await db.execute(
      db.deleteFrom(TEST_TABLE).where(eq('email', 'del@example.com')),
    );
    expect(result.affectedRows).toBe(1);
  });

  // ── TRANSACTIONS ─────────────────────────────────────────────────────────

  it('commits a transaction', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(
        tx.insertInto(TEST_TABLE)
          .columns('email', 'name')
          .values({ email: 'tx@example.com', name: 'TX' }),
      );
    });
    const rows = await db.fetch(
      db.selectFrom(TEST_TABLE).where(eq('email', 'tx@example.com')),
    );
    expect(rows).toHaveLength(1);
  });

  it('rolls back a transaction on error', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(
          tx.insertInto(TEST_TABLE)
            .columns('email', 'name')
            .values({ email: 'rollback@example.com', name: 'RB' }),
        );
        throw new Error('intentional rollback');
      }),
    ).rejects.toThrow('intentional rollback');

    const rows = await db.fetch(
      db.selectFrom(TEST_TABLE).where(eq('email', 'rollback@example.com')),
    );
    expect(rows).toHaveLength(0);
  });

  it('throws DbError for nested transactions', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.transaction(async () => {});
      }),
    ).rejects.toBeInstanceOf(DbError);
  });

  // ── ERROR TYPES ──────────────────────────────────────────────────────────

  it('throws ConstraintError on unique violation', async () => {
    await insertUser('dup@example.com', 'First');
    await expect(insertUser('dup@example.com', 'Second')).rejects.toBeInstanceOf(ConstraintError);
  });
});
