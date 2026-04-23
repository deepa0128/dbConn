import { describe, expect, it } from 'vitest';
import {
  and,
  between,
  eq,
  gt,
  gte,
  ilike,
  inList,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  notInList,
  notLike,
  or,
} from '../../../src/builder/expr.js';

describe('expression helpers', () => {
  it('eq', () => expect(eq('status', 'active')).toEqual({ type: 'eq', column: 'status', value: 'active' }));
  it('ne', () => expect(ne('role', 'admin')).toEqual({ type: 'ne', column: 'role', value: 'admin' }));
  it('gt', () => expect(gt('age', 18)).toEqual({ type: 'gt', column: 'age', value: 18 }));
  it('gte', () => expect(gte('score', 100)).toEqual({ type: 'gte', column: 'score', value: 100 }));
  it('lt', () => expect(lt('priority', 5)).toEqual({ type: 'lt', column: 'priority', value: 5 }));
  it('lte', () => expect(lte('retries', 3)).toEqual({ type: 'lte', column: 'retries', value: 3 }));
  it('isNull', () => expect(isNull('deleted_at')).toEqual({ type: 'isNull', column: 'deleted_at' }));
  it('isNotNull', () => expect(isNotNull('confirmed_at')).toEqual({ type: 'isNotNull', column: 'confirmed_at' }));

  it('inList', () => {
    expect(inList('id', [1, 2, 3])).toEqual({ type: 'in', column: 'id', values: [1, 2, 3] });
  });

  it('and with multiple expressions', () => {
    const result = and(eq('a', 1), eq('b', 2));
    expect(result).toEqual({ type: 'and', items: [eq('a', 1), eq('b', 2)] });
  });

  it('and with no expressions', () => {
    expect(and()).toEqual({ type: 'and', items: [] });
  });

  it('and with one expression', () => {
    expect(and(eq('x', 1))).toEqual({ type: 'and', items: [eq('x', 1)] });
  });

  it('or with multiple expressions', () => {
    expect(or(eq('role', 'admin'), eq('role', 'owner')))
      .toEqual({ type: 'or', items: [eq('role', 'admin'), eq('role', 'owner')] });
  });

  it('or with no expressions', () => {
    expect(or()).toEqual({ type: 'or', items: [] });
  });

  it('notInList', () => {
    expect(notInList('status', ['a', 'b'])).toEqual({ type: 'notIn', column: 'status', values: ['a', 'b'] });
  });

  it('like', () => {
    expect(like('name', '%alice%')).toEqual({ type: 'like', column: 'name', pattern: '%alice%' });
  });

  it('notLike', () => {
    expect(notLike('name', 'admin%')).toEqual({ type: 'notLike', column: 'name', pattern: 'admin%' });
  });

  it('ilike', () => {
    expect(ilike('email', '%@example.com')).toEqual({ type: 'ilike', column: 'email', pattern: '%@example.com' });
  });

  it('between', () => {
    expect(between('age', 18, 65)).toEqual({ type: 'between', column: 'age', low: 18, high: 65 });
  });

  it('nested and inside or', () => {
    const expr = or(and(eq('a', 1), eq('b', 2)), eq('c', 3));
    expect(expr.type).toBe('or');
    if (expr.type === 'or') {
      expect(expr.items).toHaveLength(2);
      expect(expr.items[0]).toEqual(and(eq('a', 1), eq('b', 2)));
    }
  });
});
