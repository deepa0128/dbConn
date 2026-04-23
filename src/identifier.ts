const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const QUALIFIED_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Rejects empty, quoted, dotted, or otherwise injectable identifier fragments. */
export function assertSafeIdentifier(name: string, label = 'identifier'): void {
  if (!IDENT.test(name)) {
    throw new TypeError(
      `${label} must match ${IDENT}: got ${JSON.stringify(name)}`,
    );
  }
}

/** Accepts either a plain identifier or a two-part `table.column` reference. */
export function assertSafeQualifiedIdentifier(name: string, label = 'identifier'): void {
  if (!IDENT.test(name) && !QUALIFIED_IDENT.test(name)) {
    throw new TypeError(
      `${label} must be a valid identifier or table.column reference: got ${JSON.stringify(name)}`,
    );
  }
}

export function assertSafeIdentifiers(names: string[], label = 'identifier'): void {
  for (const n of names) assertSafeIdentifier(n, label);
}
