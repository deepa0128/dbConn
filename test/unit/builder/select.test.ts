import { describe, expect, it } from 'vitest';
import { SelectBuilder } from '../../../src/builder/select.js';
import { eq } from '../../../src/builder/expr.js';

describe('SelectBuilder', () => {
  it('builds a wildcard select AST', () => {
    const ast = new SelectBuilder().from('users').toAst();
    expect(ast).toEqual({ type: 'select', from: 'users', columns: '*' });
  });

  it('builds a column projection', () => {
    const ast = new SelectBuilder().from('users').selectColumns('id', 'email').toAst();
    expect(ast.columns).toEqual(['id', 'email']);
  });

  it('selectColumns() with no args resets to wildcard', () => {
    const ast = new SelectBuilder()
      .from('users')
      .selectColumns('id')
      .selectColumns()
      .toAst();
    expect(ast.columns).toBe('*');
  });

  it('adds a where clause', () => {
    const expr = eq('active', true);
    const ast = new SelectBuilder().from('users').where(expr).toAst();
    expect(ast.where).toEqual(expr);
  });

  it('adds orderBy entries', () => {
    const ast = new SelectBuilder()
      .from('users')
      .orderBy('name', 'asc')
      .orderBy('id', 'desc')
      .toAst();
    expect(ast.orderBy).toEqual([
      { column: 'name', direction: 'asc' },
      { column: 'id', direction: 'desc' },
    ]);
  });

  it('orderBy defaults to asc', () => {
    const ast = new SelectBuilder().from('users').orderBy('name').toAst();
    expect(ast.orderBy?.[0].direction).toBe('asc');
  });

  it('sets limit and offset', () => {
    const ast = new SelectBuilder().from('users').limit(10).offset(20).toAst();
    expect(ast.limit).toBe(10);
    expect(ast.offset).toBe(20);
  });

  it('throws for non-integer limit', () => {
    expect(() => new SelectBuilder().from('users').limit(1.5)).toThrow(TypeError);
  });

  it('throws for negative limit', () => {
    expect(() => new SelectBuilder().from('users').limit(-1)).toThrow(TypeError);
  });

  it('throws for negative offset', () => {
    expect(() => new SelectBuilder().from('users').offset(-1)).toThrow(TypeError);
  });

  it('throws when .from() is not called before toAst()', () => {
    expect(() => new SelectBuilder().toAst()).toThrow(/from/i);
  });

  it('rejects invalid table name', () => {
    expect(() => new SelectBuilder().from('bad name')).toThrow(TypeError);
  });

  it('rejects invalid column name', () => {
    expect(() => new SelectBuilder().from('t').selectColumns('bad col')).toThrow(TypeError);
  });

  it('rejects invalid orderBy column', () => {
    expect(() => new SelectBuilder().from('t').orderBy('bad-col')).toThrow(TypeError);
  });

  it('orderBy is undefined when not set', () => {
    const ast = new SelectBuilder().from('users').toAst();
    expect(ast.orderBy).toBeUndefined();
  });

  it('adds aggregate columns', () => {
    const ast = new SelectBuilder()
      .from('orders')
      .aggregate('count', '*', 'total')
      .aggregate('sum', 'amount', 'revenue')
      .toAst();
    expect(ast.aggregates).toEqual([
      { fn: 'count', column: '*', alias: 'total' },
      { fn: 'sum', column: 'amount', alias: 'revenue' },
    ]);
  });

  it('adds groupBy columns', () => {
    const ast = new SelectBuilder().from('orders').groupBy('status', 'region').toAst();
    expect(ast.groupBy).toEqual(['status', 'region']);
  });

  it('adds having expr', () => {
    const expr = eq('status', 'paid');
    const ast = new SelectBuilder().from('t').having(expr).toAst();
    expect(ast.having).toEqual(expr);
  });

  it('rejects invalid aggregate column', () => {
    expect(() => new SelectBuilder().from('t').aggregate('sum', 'bad col')).toThrow(TypeError);
  });

  it('rejects invalid groupBy column', () => {
    expect(() => new SelectBuilder().from('t').groupBy('bad-col')).toThrow(TypeError);
  });

  it('supports full chain', () => {
    const ast = new SelectBuilder()
      .from('orders')
      .selectColumns('id', 'total')
      .where(eq('status', 'paid'))
      .orderBy('created_at', 'desc')
      .limit(5)
      .offset(10)
      .toAst();

    expect(ast).toMatchObject({
      type: 'select',
      from: 'orders',
      columns: ['id', 'total'],
      limit: 5,
      offset: 10,
    });
  });
});
