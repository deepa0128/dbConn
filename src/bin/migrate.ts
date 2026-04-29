#!/usr/bin/env node
/**
 * CLI: npx dbconn migrate [up|down|status|create] [options]
 *
 * up      Apply all pending migrations from --dir (default: ./migrations)
 * down    Roll back the last N migrations (--steps N, default: 1)
 * status  Show applied and pending migrations without running any
 * create  Scaffold a new migration file: npx dbconn migrate create <name>
 *
 * Each migration file must export `up(client)` and optionally `down(client)`.
 * Reads DATABASE_URL from the environment if --url is not supplied.
 */
import { pathToFileURL } from 'node:url';
import { readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createClient } from '../client.js';
import { migrateDown, migrateUp, migrateStatus } from '../migrate.js';
import { parseConnectionUrl } from '../parseUrl.js';
import type { Migration } from '../migrate.js';

function usage(): never {
  console.error(
    'Usage: dbconn migrate [up|down|status|create] [--dir ./migrations] [--steps N] [--url <DATABASE_URL>] [--dry-run]',
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

function scaffoldMigrationFile(dir: string, name: string): void {
  const absDir = resolve(dir);
  if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true });

  // Prefix with timestamp so files sort lexicographically by creation time
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_');
  const filename = `${ts}_${safeName}.ts`;
  const filepath = join(absDir, filename);

  const content = `import type { DbClient } from '@dbconn/core';

export const name = '${ts}_${safeName}';

export async function up(client: DbClient): Promise<void> {
  // TODO: implement migration
}

export async function down(client: DbClient): Promise<void> {
  // TODO: implement rollback
}
`;

  writeFileSync(filepath, content, 'utf8');
  console.log(`Created: ${filepath}`);
}

async function main() {
  const args = process.argv.slice(2);

  const command = args[0];
  if (!command || command === '--help' || command === '-h') usage();

  // Handle 'create' before connecting to the database
  if (command === 'create') {
    const migrationName = args[1];
    if (!migrationName) {
      console.error('Usage: dbconn migrate create <name>');
      process.exit(1);
    }
    let dir = './migrations';
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--dir' && args[i + 1]) dir = args[++i]!;
    }
    scaffoldMigrationFile(dir, migrationName);
    return;
  }

  const direction = command === 'down' ? 'down' : command === 'status' ? 'status' : 'up';
  let dir = './migrations';
  let steps = 1;
  let url: string | undefined;
  let dryRun = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) { dir = args[++i]!; }
    else if (args[i] === '--steps' && args[i + 1]) { steps = parseInt(args[++i]!, 10); }
    else if (args[i] === '--url' && args[i + 1]) { url = args[++i]; }
    else if (args[i] === '--dry-run') { dryRun = true; }
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
    if (direction === 'status') {
      const status = await migrateStatus(client, migrations);
      console.log(`Applied (${status.applied.length}):`);
      if (status.applied.length === 0) {
        console.log('  (none)');
      } else {
        for (const name of status.applied) console.log(`  ✓ ${name}`);
      }
      console.log(`\nPending (${status.pending.length}):`);
      if (status.pending.length === 0) {
        console.log('  (none)');
      } else {
        for (const name of status.pending) console.log(`  ○ ${name}`);
      }
    } else if (direction === 'up') {
      const ran = await migrateUp(client, migrations, { dryRun });
      const label = dryRun ? 'would apply' : 'applied';
      if (ran.length === 0) {
        console.log('Nothing to migrate — all migrations already applied.');
      } else {
        for (const name of ran) console.log(`  ✓ ${label}: ${name}`);
        console.log(`\n${ran.length} migration(s) ${label}.${dryRun ? ' (dry run — no changes persisted)' : ''}`);
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
