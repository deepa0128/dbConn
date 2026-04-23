import { describe, expect, it } from 'vitest';
import { UpdateBuilder } from '../../../src/builder/update.js';
import { eq } from '../../../src/builder/expr.js';

describe('UpdateBuilder', () => {
  it('builds an update AST with where', () => {
    const ast = new UpdateBuilder()
      .tableName('users')
      .set('active', false)
      .where(eq('id', 42))
      .toAst();

    expect(ast).toEqual({
      type: 'update',
      table: 'users',
      set: [{ column: 'active', value: false }],
      where: eq('id', 42),
    });
  });

  it('accumulates multiple set entries', () => {
    const ast = new UpdateBuilder()
      .tableName('users')
      .set('name', 'Alice')
      .set('email', 'alice@example.com')
      .toAst();

    expect(ast.set).toHaveLength(2);
    expect(ast.set[0]).toEqual({ column: 'name', value: 'Alice' });
  });

  it('allows update without where (full-table update)', () => {
    const ast = new UpdateBuilder()
      .tableName('settings')
      .set('maintenance', true)
      .toAst();

    expect(ast.where).toBeUndefined();
  });

  it('throws when .tableName() is not called', () => {
    expect(() =>
      new UpdateBuilder().set('x', 1).toAst()
    ).toThrow(/tableName/i);
  });

  it('throws when .set() is not called', () => {
    expect(() =>
      new UpdateBuilder().tableName('t').toAst()
    ).toThrow(/set/i);
  });

  it('rejects invalid table name', () => {
    expect(() => new UpdateBuilder().tableName('bad table')).toThrow(TypeError);
  });

  it('rejects invalid column name in set()', () => {
    expect(() => new UpdateBuilder().tableName('t').set('bad-col', 1)).toThrow(TypeError);
  });
});
