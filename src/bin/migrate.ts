#!/usr/bin/env node
/**
 * CLI: npx dbconn migrate [up|down] [--dir ./migrations] [--steps N] [--url DATABASE_URL]
 *
 * Discovers migration files from `--dir` (default: ./migrations).
 * Each file must export `up(client)` and optionally `down(client)`.
 * Reads DATABASE_URL from the environment if --url is not supplied.
 */
import { pathToFileURL } from 'node:url';
import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createClient } from '../client.js';
import { migrateDown, migrateUp } from '../migrate.js';
import { parseConnectionUrl } from '../parseUrl.js';
import type { Migration } from '../migrate.js';

function usage(): never {
  console.error(
    'Usage: dbconn migrate [up|down] [--dir ./migrations] [--steps N] [--url <DATABASE_URL>]',
  );
  process.exit(1);
}

async function loadMigrations(dir: string): Promise<Migration[]> {
  const absDir = resolve(dir);
  let files: string[];
  try {
    files = readdirSync(absDir)
      .filter((f) => /\.(ts|js|mjs|cjs)$/.test(f))
      .sort();
  } catch {
    console.error(`migrations directory not found: ${absDir}`);
    process.exit(1);
  }

  const migrations: Migration[] = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(absDir, file)).toString()) as {
      up?: (client: unknown) => Promise<void>;
      down?: (client: unknown) => Promise<void>;
      name?: string;
    };
    if (typeof mod.up !== 'function') {
      console.error(`${file}: missing exported 'up' function — skipping`);
      continue;
    }
    migrations.push({
      name: mod.name ?? file.replace(/\.(ts|js|mjs|cjs)$/, ''),
      up: mod.up as Migration['up'],
      down: mod.down as Migration['down'],
    });
  }
  return migrations;
}

async function main() {
  const args = process.argv.slice(2);

  const direction = args[0] === 'down' ? 'down' : 'up';
  let dir = './migrations';
  let steps = 1;
  let url: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) { dir = args[++i]!; }
    else if (args[i] === '--steps' && args[i + 1]) { steps = parseInt(args[++i]!, 10); }
    else if (args[i] === '--url' && args[i + 1]) { url = args[++i]; }
    else if (args[i] === '--help' || args[i] === '-h') usage();
  }

  const dbUrl = url ?? process.env['DATABASE_URL'] ?? process.env['POSTGRES_URL'] ?? process.env['MYSQL_URL'];
  if (!dbUrl) {
    console.error('No database URL provided. Set DATABASE_URL or pass --url <url>');
    process.exit(1);
  }

  const config = parseConnectionUrl(dbUrl);
  const client = createClient(config);
  const migrations = await loadMigrations(dir);

  if (migrations.length === 0) {
    console.log('No migration files found.');
    await client.close();
    return;
  }

  try {
    if (direction === 'up') {
      const ran = await migrateUp(client, migrations);
      if (ran.length === 0) {
        console.log('Nothing to migrate — all migrations already applied.');
      } else {
        for (const name of ran) console.log(`  ✓ applied: ${name}`);
        console.log(`\n${ran.length} migration(s) applied.`);
      }
    } else {
      const rolled = await migrateDown(client, migrations, steps);
      if (rolled.length === 0) {
        console.log('Nothing to roll back.');
      } else {
        for (const name of rolled) console.log(`  ✓ rolled back: ${name}`);
        console.log(`\n${rolled.length} migration(s) rolled back.`);
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
