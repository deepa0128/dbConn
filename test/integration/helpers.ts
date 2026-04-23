/**
 * Integration test helpers.
 *
 * Tests are skipped when the relevant *_URL environment variable is not set,
 * so the unit-test suite always passes in environments without databases.
 */

export function postgresUrl(): string | undefined {
  return process.env['POSTGRES_URL'];
}

export function mysqlUrl(): string | undefined {
  return process.env['MYSQL_URL'];
}

/** Parse a database URL into DbConn config fields. */
export function parseUrl(url: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 5432,
    user: u.username,
    password: u.password,
    database: u.pathname.replace(/^\//, ''),
  };
}

export const TEST_TABLE = 'dbconn_test_users';

export const CREATE_TABLE_PG = `
  CREATE TABLE IF NOT EXISTS ${TEST_TABLE} (
    id      SERIAL PRIMARY KEY,
    email   TEXT NOT NULL UNIQUE,
    name    TEXT NOT NULL,
    active  BOOLEAN NOT NULL DEFAULT TRUE
  )
`;

export const CREATE_TABLE_MYSQL = `
  CREATE TABLE IF NOT EXISTS ${TEST_TABLE} (
    id     INT AUTO_INCREMENT PRIMARY KEY,
    email  VARCHAR(255) NOT NULL UNIQUE,
    name   VARCHAR(255) NOT NULL,
    active TINYINT(1)   NOT NULL DEFAULT 1
  )
`;

export const DROP_TABLE = `DROP TABLE IF EXISTS ${TEST_TABLE}`;
export const TRUNCATE_TABLE = `DELETE FROM ${TEST_TABLE}`;
