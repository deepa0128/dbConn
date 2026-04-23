import { describe, expect, it } from 'vitest';
import { InsertBuilder } from '../../../src/builder/insert.js';

describe('InsertBuilder', () => {
  it('builds a single-row insert AST', () => {
    const ast = new InsertBuilder()
      .into('users')
      .columns('email', 'name')
      .values({ email: 'a@b.com', name: 'Alice' })
      .toAst();

    expect(ast).toEqual({
      type: 'insert',
      into: 'users',
      columns: ['email', 'name'],
      rows: [{ email: 'a@b.com', name: 'Alice' }],
    });
  });

  it('accumulates multiple rows', () => {
    const ast = new InsertBuilder()
      .into('users')
      .columns('email')
      .values({ email: 'a@b.com' })
      .values({ email: 'c@d.com' })
      .toAst();

    expect(ast.rows).toHaveLength(2);
    expect(ast.rows[1]).toEqual({ email: 'c@d.com' });
  });

  it('throws when .into() is not called', () => {
    expect(() =>
      new InsertBuilder().columns('x').values({ x: 1 }).toAst()
    ).toThrow(/into/i);
  });

  it('throws when .columns() is not called', () => {
    expect(() =>
      new InsertBuilder().into('t').values({ x: 1 }).toAst()
    ).toThrow(/columns/i);
  });

  it('throws when .values() is not called', () => {
    expect(() =>
      new InsertBuilder().into('t').columns('x').toAst()
    ).toThrow(/values/i);
  });

  it('rejects invalid table name', () => {
    expect(() => new InsertBuilder().into('bad table')).toThrow(TypeError);
  });

  it('rejects invalid column name', () => {
    expect(() => new InsertBuilder().into('t').columns('bad-col')).toThrow(TypeError);
  });
});
