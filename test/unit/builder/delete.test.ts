import { describe, expect, it } from 'vitest';
import { DeleteBuilder } from '../../../src/builder/delete.js';
import { eq, lt } from '../../../src/builder/expr.js';

describe('DeleteBuilder', () => {
  it('builds a delete AST with where', () => {
    const ast = new DeleteBuilder()
      .from('sessions')
      .where(eq('user_id', 99))
      .toAst();

    expect(ast).toEqual({
      type: 'delete',
      from: 'sessions',
      where: eq('user_id', 99),
    });
  });

  it('allows delete without where (full-table delete)', () => {
    const ast = new DeleteBuilder().from('tmp').toAst();
    expect(ast.where).toBeUndefined();
  });

  it('accepts complex where expressions', () => {
    const expr = lt('expires_at', new Date('2024-01-01'));
    const ast = new DeleteBuilder().from('tokens').where(expr).toAst();
    expect(ast.where).toEqual(expr);
  });

  it('throws when .from() is not called', () => {
    expect(() => new DeleteBuilder().toAst()).toThrow(/from/i);
  });

  it('rejects invalid table name', () => {
    expect(() => new DeleteBuilder().from('bad table')).toThrow(TypeError);
  });
});
