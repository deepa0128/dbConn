import { describe, expect, it } from 'vitest';
import { compileQuery } from '../../src/dialect/compileQuery.js';
import { SelectBuilder } from '../../src/builder/select.js';

function select(table: string): SelectBuilder {
  return new SelectBuilder().from(table);
}

describe('CTE compilation', () => {
  it('prepends WITH clause for a single CTE', () => {
    const cte = select('orders').aggregate('sum', 'amount', 'total').groupBy('user_id');
    const q = select('totals').with('totals', cte);
    const { sql } = compileQuery(q.toAst(), 'postgres');
    expect(sql).toMatch(/^WITH "totals" AS \(SELECT .+ FROM "orders" .+\) SELECT \* FROM "totals"$/);
  });

  it('multiple CTEs are comma-separated', () => {
    const cte1 = select('orders').selectColumns('user_id');
    const cte2 = select('users').selectColumns('id', 'name');
    const q = select('combined').with('ord', cte1).with('usr', cte2);
    const { sql } = compileQuery(q.toAst(), 'postgres');
    expect(sql).toContain('"ord" AS (');
    expect(sql).toContain('"usr" AS (');
    expect(sql).toMatch(/^WITH .+, .+ SELECT/);
  });

  it('CTE parameters are numbered before outer query params', () => {
    const cte = select('orders').where({ type: 'eq', column: 'status', value: 'paid' });
    const q = select('result').with('paid_orders', cte).where({ type: 'eq', column: 'id', value: 99 });
    const { sql, params } = compileQuery(q.toAst(), 'postgres');
    // CTEs are compiled first, so CTE param is $1 and outer WHERE is $2
    expect(sql).toContain('"status" = $1');
    expect(sql).toContain('"id" = $2');
    expect(params).toEqual(['paid', 99]);
  });

  it('uses backtick quoting for mysql', () => {
    const cte = select('t').selectColumns('id');
    const q = select('cte_alias').with('cte_alias', cte);
    const { sql } = compileQuery(q.toAst(), 'mysql');
    expect(sql).toContain('`cte_alias` AS (');
    expect(sql).toContain('FROM `cte_alias`');
  });

  it('CTE name is validated as a safe identifier', () => {
    expect(() => select('t').with('bad-name', select('t'))).toThrow();
    expect(() => select('t').with('bad name', select('t'))).toThrow();
  });

  it('query without CTEs compiles normally', () => {
    const { sql } = compileQuery(select('users').toAst(), 'postgres');
    expect(sql).toBe('SELECT * FROM "users"');
    expect(sql).not.toContain('WITH');
  });
});
