import { describe, expect, it } from 'vitest';
import { assertSafeIdentifier } from '../../src/identifier.js';

describe('assertSafeIdentifier', () => {
  it.each([
    'users',
    'user_id',
    '_private',
    'CamelCase',
    'col123',
    'A',
  ])('accepts valid identifier: %s', (name) => {
    expect(() => assertSafeIdentifier(name)).not.toThrow();
  });

  it.each([
    ['empty string', ''],
    ['starts with digit', '2fa_users'],
    ['contains space', 'user id'],
    ['dotted path', 'schema.table'],
    ['double-quoted', '"users"'],
    ['backtick', '`users`'],
    ['dash', 'user-id'],
    ['SQL injection', "users; DROP TABLE users--"],
    ['OR injection', "users\" OR \"1\"=\"1"],
    ['wildcard', 'col*'],
  ])('rejects %s', (_label, name) => {
    expect(() => assertSafeIdentifier(name)).toThrow(TypeError);
  });

  it('uses the label in the error message', () => {
    expect(() => assertSafeIdentifier('bad col', 'column'))
      .toThrow(/column/);
  });
});
