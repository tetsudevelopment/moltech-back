// Runner for prisma/seed/stations-dev.sql
// Invoked by `pnpm seed:stations` (node --env-file=.env loads DATABASE_URL).
// Strips Prisma-specific query params (e.g. ?schema=public) that psql rejects.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlFile = join(__dirname, 'stations-dev.sql');

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  process.stderr.write('ERROR: DATABASE_URL is not set. Make sure .env exists.\n');
  process.exit(1);
}

// psql does not understand Prisma-specific query params like ?schema=public —
// strip everything after the first '?' to get a clean connection URL.
const psqlUrl = databaseUrl.split('?')[0];

const result = spawnSync('psql', [psqlUrl, '-f', sqlFile], { stdio: 'inherit' });
process.exit(result.status ?? 1);
