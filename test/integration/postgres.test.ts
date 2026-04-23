import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type DbClient } from '../../src/client.js';
import { and, eq, gt } from '../../src/builder/expr.js';
import { ConstraintError, DbError } from '../../src/errors.js';
import {
  CREATE_TABLE_PG,
  DROP_TABLE,
  TEST_TABLE,
  TRUNCATE_TABLE,
  parseUrl,
  postgresUrl,
} from './helpers.js';

const url = postgresUrl();

describe.skipIf(!url)('Postgres integration', () => {
  let db: DbClient;
  let pool: pg.Pool; // used only for DDL (CREATE / DROP TABLE) in setup

  beforeAll(async () => {
    const cfg = parseUrl(url!);
    pool = new pg.Pool(cfg);
    db = createClient({ dialect: 'postgres', ...cfg });
    await pool.query(CREATE_TABLE_PG);
  });

  afterAll(async () => {
    await pool.query(DROP_TABLE);
    await pool.end();
    await db.close();
  });

  beforeEach(async () => {
    await pool.query(TRUNCATE_TABLE);
  });

  async function insertUser(email: string, name: string, active = true) {
    return db.execute(
      db.insertInto(TEST_TABLE)
        .columns('email', 'name', 'active')
        .values({ email, name, active }),
    );
  }

  // ── INSERT ───────────────────────────────────────────────────────────────

  it('inserts a single row and returns affectedRows = 1', async () => {
    const result = await insertUser('alice@example.com', 'Alice');
    expect(result.affectedRows).toBe(1);
  });

  it('inserts multiple rows in one statement', async () => {
    const result = await db.execute(
      db.insertInto(TEST_TABLE)
        .columns('email', 'name')
        .values({ email: 'a@b.com', name: 'A' })
        .values({ email: 'c@d.com', name: 'C' }),
    );
    expect(result.affectedRows).toBe(2);
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

  it('returns empty array when no rows match', async () => {
    const rows = await db.fetch(
      db.selectFrom(TEST_TABLE).where(eq('email', 'nobody@example.com')),
    );
    expect(rows).toEqual([]);
  });

  it('respects limit and offset', async () => {
    await insertUser('u1@e.com', 'U1');
    await insertUser('u2@e.com', 'U2');
    await insertUser('u3@e.com', 'U3');

    const rows = await db.fetch(
      db.selectFrom(TEST_TABLE)
        .selectColumns('email')
        .orderBy('email', 'asc')
        .limit(2)
        .offset(1),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ email: 'u2@e.com' });
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

  it('supports complex where with and/gt', async () => {
    await insertUser('active@example.com', 'Active', true);
    await insertUser('inactive@example.com', 'Inactive', false);

    const rows = await db.fetch(
      db.selectFrom(TEST_TABLE).where(and(eq('active', true), gt('id', 0))),
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r['active'] === true)).toBe(true);
  });

  // ── UPDATE ───────────────────────────────────────────────────────────────

  it('updates a row and returns affectedRows', async () => {
    await insertUser('upd@example.com', 'Before');
    const result = await db.execute(
      db.updateTable(TEST_TABLE)
        .set('name', 'After')
        .where(eq('email', 'upd@example.com')),
    );
    expect(result.affectedRows).toBe(1);

    const rows = await db.fetch(
      db.selectFrom(TEST_TABLE).where(eq('email', 'upd@example.com')),
    );
    expect(rows[0]).toMatchObject({ name: 'After' });
  });

  it('returns affectedRows = 0 when where matches nothing', async () => {
    const result = await db.execute(
      db.updateTable(TEST_TABLE).set('name', 'X').where(eq('email', 'ghost@example.com')),
    );
    expect(result.affectedRows).toBe(0);
  });

  // ── DELETE ───────────────────────────────────────────────────────────────

  it('deletes matching rows', async () => {
    await insertUser('del@example.com', 'Del');
    const result = await db.execute(
      db.deleteFrom(TEST_TABLE).where(eq('email', 'del@example.com')),
    );
    expect(result.affectedRows).toBe(1);

    const rows = await db.fetch(
      db.selectFrom(TEST_TABLE).where(eq('email', 'del@example.com')),
    );
    expect(rows).toHaveLength(0);
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

  it('ConstraintError carries the constraint name', async () => {
    await insertUser('con@example.com', 'Con');
    const err = await insertUser('con@example.com', 'Con2').catch((e) => e);
    expect(err).toBeInstanceOf(ConstraintError);
    expect((err as ConstraintError).constraint).toBeTruthy();
  });
});
