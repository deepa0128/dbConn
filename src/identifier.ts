const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Rejects empty, quoted, dotted, or otherwise injectable identifier fragments. */
export function assertSafeIdentifier(name: string, label = 'identifier'): void {
  if (!IDENT.test(name)) {
    throw new TypeError(
      `${label} must match ${IDENT}: got ${JSON.stringify(name)}`,
    );
  }
}

export function assertSafeIdentifiers(names: string[], label = 'identifier'): void {
  for (const n of names) assertSafeIdentifier(n, label);
}
