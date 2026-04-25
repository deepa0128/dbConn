import { describe, expect, it } from 'vitest';
import type { DeleteAst, InsertAst, SelectAst, UpdateAst } from '../../../src/ast.js';
import { compileMongoQuery } from '../../../src/dialect/compileMongo.js';
import { DbError } from '../../../src/errors.js';

describe('compileMongoQuery', () => {
  it('compiles simple select with where/order/limit/offset', () => {
    const ast: SelectAst = {
      type: 'select',
      from: 'users',
      columns: ['email'],
      where: { type: 'eq', column: 'active', value: true },
      orderBy: [{ column: 'created_at', direction: 'desc' }],
      limit: 5,
      offset: 10,
    };
    expect(compileMongoQuery(ast)).toEqual({
      kind: 'select',
      collection: 'users',
      filter: { active: true },
      projection: { email: 1 },
      sort: { created_at: -1 },
      limit: 5,
      skip: 10,
    });
  });

  it('compiles insert documents', () => {
    const ast: InsertAst = {
      type: 'insert',
      into: 'users',
      columns: ['email'],
      rows: [{ email: 'alice@example.com' }],
    };
    expect(compileMongoQuery(ast)).toEqual({
      kind: 'insert',
      collection: 'users',
      documents: [{ email: 'alice@example.com' }],
    });
  });

  it('compiles update into $set operation', () => {
    const ast: UpdateAst = {
      type: 'update',
      table: 'users',
      set: [{ column: 'active', value: false }],
      where: { type: 'eq', column: 'id', value: 42 },
    };
    expect(compileMongoQuery(ast)).toEqual({
      kind: 'update',
      collection: 'users',
      filter: { id: 42 },
      update: { $set: { active: false } },
    });
  });

  it('compiles delete filter', () => {
    const ast: DeleteAst = {
      type: 'delete',
      from: 'users',
      where: { type: 'eq', column: 'id', value: 42 },
    };
    expect(compileMongoQuery(ast)).toEqual({
      kind: 'delete',
      collection: 'users',
      filter: { id: 42 },
    });
  });

  it('throws descriptive DbError for joins', () => {
    const ast: SelectAst = {
      type: 'select',
      from: 'users',
      columns: '*',
      joins: [{ type: 'inner', table: 'teams', on: { type: 'eq', column: 'users.team_id', value: 1 } }],
    };
    expect(() => compileMongoQuery(ast)).toThrow(DbError);
  });
});
