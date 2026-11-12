import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { toTestDatabaseUri } from './test-database-uri';

const envFile = join(process.cwd(), '.env');
if (existsSync(envFile)) {
  for (const [name, value] of Object.entries(
    parseEnv(readFileSync(envFile, 'utf8')),
  )) {
    process.env[name] ??= value;
  }
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error(
    'MONGODB_URI is not set. Add it to backend/.env (see .env.example).',
  );
}
process.env.MONGODB_URI = toTestDatabaseUri(uri);
