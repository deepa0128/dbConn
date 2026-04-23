import { describe, expect, it } from 'vitest';
import { compileQuery } from '../../../src/dialect/compileQuery.js';
import type { DeleteAst, InsertAst, SelectAst, UpdateAst } from '../../../src/ast.js';

// ─── SELECT ────────────────────────────────────────────────────────────────

describe('compileQuery › SELECT', () => {
  const base: SelectAst = { type: 'select', from: 'users', columns: '*' };

  it('wildcard select (postgres)', () => {
    expect(compileQuery(base, 'postgres')).toEqual({
      sql: 'SELECT * FROM "users"',
      params: [],
    });
  });

  it('wildcard select (mysql)', () => {
    expect(compileQuery(base, 'mysql')).toEqual({
      sql: 'SELECT * FROM `users`',
      params: [],
    });
  });

  it('column projection', () => {
    const ast: SelectAst = { ...base, columns: ['id', 'email'] };
    expect(compileQuery(ast, 'postgres').sql).toBe('SELECT "id", "email" FROM "users"');
    expect(compileQuery(ast, 'mysql').sql).toBe('SELECT `id`, `email` FROM `users`');
  });

  it('where eq — postgres uses $1 placeholder', () => {
    const ast: SelectAst = { ...base, where: { type: 'eq', column: 'id', value: 42 } };
    expect(compileQuery(ast, 'postgres')).toEqual({
      sql: 'SELECT * FROM "users" WHERE "id" = $1',
      params: [42],
    });
  });

  it('where eq — mysql uses ? placeholder', () => {
    const ast: SelectAst = { ...base, where: { type: 'eq', column: 'id', value: 42 } };
    expect(compileQuery(ast, 'mysql')).toEqual({
      sql: 'SELECT * FROM `users` WHERE `id` = ?',
      params: [42],
    });
  });

  it('multiple params are numbered sequentially in postgres', () => {
    const ast: SelectAst = {
      ...base,
      where: {
        type: 'and',
        items: [
          { type: 'eq', column: 'a', value: 1 },
          { type: 'eq', column: 'b', value: 2 },
        ],
      },
    };
    const { sql, params } = compileQuery(ast, 'postgres');
    expect(sql).toBe('SELECT * FROM "users" WHERE ("a" = $1) AND ("b" = $2)');
    expect(params).toEqual([1, 2]);
  });

  it('orderBy single column', () => {
    const ast: SelectAst = {
      ...base,
      orderBy: [{ column: 'created_at', direction: 'desc' }],
    };
    expect(compileQuery(ast, 'postgres').sql).toBe(
      'SELECT * FROM "users" ORDER BY "created_at" DESC',
    );
  });

  it('orderBy multiple columns', () => {
    const ast: SelectAst = {
      ...base,
      orderBy: [
        { column: 'name', direction: 'asc' },
        { column: 'id', direction: 'desc' },
      ],
    };
    expect(compileQuery(ast, 'postgres').sql).toBe(
      'SELECT * FROM "users" ORDER BY "name" ASC, "id" DESC',
    );
  });

  it('limit and offset', () => {
    const ast: SelectAst = { ...base, limit: 10, offset: 20 };
    expect(compileQuery(ast, 'postgres').sql).toBe(
      'SELECT * FROM "users" LIMIT 10 OFFSET 20',
    );
  });

  it('full query', () => {
    const ast: SelectAst = {
      type: 'select',
      from: 'orders',
      columns: ['id', 'total'],
      where: { type: 'eq', column: 'status', value: 'paid' },
      orderBy: [{ column: 'created_at', direction: 'desc' }],
      limit: 5,
      offset: 0,
    };
    const { sql, params } = compileQuery(ast, 'postgres');
    expect(sql).toBe(
      'SELECT "id", "total" FROM "orders" WHERE "status" = $1 ORDER BY "created_at" DESC LIMIT 5 OFFSET 0',
    );
    expect(params).toEqual(['paid']);
  });
});

// ─── EXPRESSIONS ───────────────────────────────────────────────────────────

describe('compileQuery › expressions', () => {
  function sel(where: SelectAst['where']): SelectAst {
    return { type: 'select', from: 'x', columns: '*', where };
  }

  it.each([
    ['eq', { type: 'eq' as const, column: 'a', value: 1 }, '"a" = $1'],
    ['ne', { type: 'ne' as const, column: 'a', value: 1 }, '"a" <> $1'],
    ['gt', { type: 'gt' as const, column: 'a', value: 1 }, '"a" > $1'],
    ['gte', { type: 'gte' as const, column: 'a', value: 1 }, '"a" >= $1'],
    ['lt', { type: 'lt' as const, column: 'a', value: 1 }, '"a" < $1'],
    ['lte', { type: 'lte' as const, column: 'a', value: 1 }, '"a" <= $1'],
  ])('%s operator (postgres)', (_name, expr, expected) => {
    const { sql } = compileQuery(sel(expr), 'postgres');
    expect(sql).toContain(expected);
  });

  it('isNull', () => {
    const { sql } = compileQuery(sel({ type: 'isNull', column: 'deleted_at' }), 'postgres');
    expect(sql).toContain('"deleted_at" IS NULL');
  });

  it('isNotNull', () => {
    const { sql } = compileQuery(sel({ type: 'isNotNull', column: 'confirmed_at' }), 'postgres');
    expect(sql).toContain('"confirmed_at" IS NOT NULL');
  });

  it('inList with multiple values', () => {
    const { sql, params } = compileQuery(
      sel({ type: 'in', column: 'id', values: [1, 2, 3] }),
      'postgres',
    );
    expect(sql).toContain('"id" IN ($1, $2, $3)');
    expect(params).toEqual([1, 2, 3]);
  });

  it('inList with single value', () => {
    const { sql, params } = compileQuery(
      sel({ type: 'in', column: 'id', values: [99] }),
      'postgres',
    );
    expect(sql).toContain('"id" IN ($1)');
    expect(params).toEqual([99]);
  });

  it('inList throws for empty values', () => {
    expect(() =>
      compileQuery(sel({ type: 'in', column: 'id', values: [] }), 'postgres')
    ).toThrow(RangeError);
  });

  it('and with two items wraps each in parens', () => {
    const { sql } = compileQuery(
      sel({ type: 'and', items: [{ type: 'eq', column: 'a', value: 1 }, { type: 'eq', column: 'b', value: 2 }] }),
      'postgres',
    );
    expect(sql).toContain('("a" = $1) AND ("b" = $2)');
  });

  it('and with no items compiles to TRUE', () => {
    const { sql } = compileQuery(sel({ type: 'and', items: [] }), 'postgres');
    expect(sql).toContain('WHERE TRUE');
  });

  it('or with no items compiles to FALSE', () => {
    const { sql } = compileQuery(sel({ type: 'or', items: [] }), 'postgres');
    expect(sql).toContain('WHERE FALSE');
  });

  it('nested and inside or', () => {
    const where: SelectAst['where'] = {
      type: 'or',
      items: [
        { type: 'and', items: [{ type: 'eq', column: 'a', value: 1 }, { type: 'eq', column: 'b', value: 2 }] },
        { type: 'isNull', column: 'c' },
      ],
    };
    const { sql, params } = compileQuery({ type: 'select', from: 'x', columns: '*', where }, 'postgres');
    expect(sql).toContain('(("a" = $1) AND ("b" = $2)) OR ("c" IS NULL)');
    expect(params).toEqual([1, 2]);
  });

  it('params accumulate across nested expressions', () => {
    const where: SelectAst['where'] = {
      type: 'and',
      items: [
        { type: 'in', column: 'status', values: ['a', 'b'] },
        { type: 'gt', column: 'score', value: 10 },
      ],
    };
    const { params } = compileQuery({ type: 'select', from: 'x', columns: '*', where }, 'postgres');
    expect(params).toEqual(['a', 'b', 10]);
  });
});

// ─── INSERT ────────────────────────────────────────────────────────────────

describe('compileQuery › INSERT', () => {
  it('single row (postgres)', () => {
    const ast: InsertAst = {
      type: 'insert',
      into: 'users',
      columns: ['email', 'name'],
      rows: [{ email: 'a@b.com', name: 'Alice' }],
    };
    expect(compileQuery(ast, 'postgres')).toEqual({
      sql: 'INSERT INTO "users" ("email", "name") VALUES ($1, $2)',
      params: ['a@b.com', 'Alice'],
    });
  });

  it('single row (mysql)', () => {
    const ast: InsertAst = {
      type: 'insert',
      into: 'users',
      columns: ['email'],
      rows: [{ email: 'a@b.com' }],
    };
    expect(compileQuery(ast, 'mysql')).toEqual({
      sql: 'INSERT INTO `users` (`email`) VALUES (?)',
      params: ['a@b.com'],
    });
  });

  it('multi-row insert (postgres)', () => {
    const ast: InsertAst = {
      type: 'insert',
      into: 'users',
      columns: ['email', 'name'],
      rows: [
        { email: 'a@b.com', name: 'Alice' },
        { email: 'c@d.com', name: 'Bob' },
      ],
    };
    expect(compileQuery(ast, 'postgres')).toEqual({
      sql: 'INSERT INTO "users" ("email", "name") VALUES ($1, $2), ($3, $4)',
      params: ['a@b.com', 'Alice', 'c@d.com', 'Bob'],
    });
  });

  it('multi-row insert (mysql)', () => {
    const ast: InsertAst = {
      type: 'insert',
      into: 'items',
      columns: ['n'],
      rows: [{ n: 1 }, { n: 2 }, { n: 3 }],
    };
    expect(compileQuery(ast, 'mysql')).toEqual({
      sql: 'INSERT INTO `items` (`n`) VALUES (?), (?), (?)',
      params: [1, 2, 3],
    });
  });

  it('throws when a row is missing a declared column', () => {
    const ast: InsertAst = {
      type: 'insert',
      into: 'users',
      columns: ['email', 'name'],
      rows: [{ email: 'a@b.com' }], // missing 'name'
    };
    expect(() => compileQuery(ast, 'postgres')).toThrow(TypeError);
  });
});

// ─── UPDATE ────────────────────────────────────────────────────────────────

describe('compileQuery › UPDATE', () => {
  it('single set with where (postgres)', () => {
    const ast: UpdateAst = {
      type: 'update',
      table: 'users',
      set: [{ column: 'active', value: false }],
      where: { type: 'eq', column: 'id', value: 42 },
    };
    expect(compileQuery(ast, 'postgres')).toEqual({
      sql: 'UPDATE "users" SET "active" = $1 WHERE "id" = $2',
      params: [false, 42],
    });
  });

  it('multiple set columns (postgres)', () => {
    const ast: UpdateAst = {
      type: 'update',
      table: 'users',
      set: [
        { column: 'name', value: 'Alice' },
        { column: 'email', value: 'alice@example.com' },
      ],
      where: { type: 'eq', column: 'id', value: 1 },
    };
    expect(compileQuery(ast, 'postgres')).toEqual({
      sql: 'UPDATE "users" SET "name" = $1, "email" = $2 WHERE "id" = $3',
      params: ['Alice', 'alice@example.com', 1],
    });
  });

  it('without where (mysql)', () => {
    const ast: UpdateAst = {
      type: 'update',
      table: 'settings',
      set: [{ column: 'maintenance', value: true }],
    };
    expect(compileQuery(ast, 'mysql')).toEqual({
      sql: 'UPDATE `settings` SET `maintenance` = ?',
      params: [true],
    });
  });
});

// ─── DELETE ────────────────────────────────────────────────────────────────

describe('compileQuery › DELETE', () => {
  it('delete with where (postgres)', () => {
    const date = new Date('2024-01-01');
    const ast: DeleteAst = {
      type: 'delete',
      from: 'sessions',
      where: { type: 'lt', column: 'expires_at', value: date },
    };
    const { sql, params } = compileQuery(ast, 'postgres');
    expect(sql).toBe('DELETE FROM "sessions" WHERE "expires_at" < $1');
    expect(params).toEqual([date]);
  });

  it('delete without where (mysql)', () => {
    const ast: DeleteAst = { type: 'delete', from: 'tmp' };
    expect(compileQuery(ast, 'mysql')).toEqual({
      sql: 'DELETE FROM `tmp`',
      params: [],
    });
  });
});
