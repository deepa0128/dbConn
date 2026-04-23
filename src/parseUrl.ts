import type { DbConnConfig } from './config.js';

/**
 * Parse a connection URL into a DbConnConfig object.
 *
 * Supported schemes: postgres://, postgresql://, mysql://
 *
 * Recognised query-string options:
 *   ssl=true | sslmode=require|verify-full|verify-ca  → ssl: true
 *   connection_limit=N | pool_size=N                  → maxConnections: N
 *   query_timeout=N                                   → queryTimeoutMs: N
 */
export function parseConnectionUrl(url: string): DbConnConfig {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(`Invalid connection URL: ${JSON.stringify(url)}`);
  }

  const scheme = parsed.protocol.replace(/:$/, '');
  const host = parsed.hostname;
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const sp = parsed.searchParams;

  const ssl =
    sp.get('ssl') === 'true' ||
    sp.get('ssl') === '1' ||
    ['require', 'verify-full', 'verify-ca'].includes(sp.get('sslmode') ?? '');

  const maxConnRaw = sp.get('connection_limit') ?? sp.get('pool_size');
  const maxConnections = maxConnRaw !== null ? parseInt(maxConnRaw, 10) : undefined;

  const timeoutRaw = sp.get('query_timeout');
  const queryTimeoutMs = timeoutRaw !== null ? parseInt(timeoutRaw, 10) : undefined;

  const base = {
    host,
    user,
    password,
    database,
    ...(ssl ? { ssl } : {}),
    ...(maxConnections !== undefined ? { maxConnections } : {}),
    ...(queryTimeoutMs !== undefined ? { queryTimeoutMs } : {}),
  };

  if (scheme === 'postgres' || scheme === 'postgresql') {
    return {
      dialect: 'postgres',
      port: parsed.port ? parseInt(parsed.port, 10) : 5432,
      ...base,
    };
  }

  if (scheme === 'mysql') {
    return {
      dialect: 'mysql',
      port: parsed.port ? parseInt(parsed.port, 10) : 3306,
      ...base,
    };
  }

  throw new TypeError(
    `Unsupported scheme ${JSON.stringify(scheme)}. Use postgres://, postgresql://, or mysql://`,
  );
}
