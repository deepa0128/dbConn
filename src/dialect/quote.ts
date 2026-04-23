import { assertSafeIdentifier } from '../identifier.js';

export function quotePostgresIdent(name: string): string {
  assertSafeIdentifier(name);
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteMysqlIdent(name: string): string {
  assertSafeIdentifier(name);
  return `\`${name.replace(/`/g, '``')}\``;
}
