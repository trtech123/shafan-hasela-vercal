#!/usr/bin/env node
// Run only after approval and creation of a separate Supabase staging project.
// Never prints the connection string, password, or account credentials.
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { validateStagingDatabaseUrl, validateStagingIsolation } from './staging-isolation.mjs';

const { STAGING_DATABASE_URL, ...publicEnv } = process.env;
const { projectRef } = validateStagingIsolation(publicEnv);
validateStagingDatabaseUrl(STAGING_DATABASE_URL, projectRef);
const client = new pg.Client({ connectionString: STAGING_DATABASE_URL, ssl: { rejectUnauthorized: true } });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.staging_seed_authorized','true',true)");
  await client.query(await readFile(new URL('./staging-seed.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log(`Synthetic operational fixtures seeded in staging project ${projectRef}`);
} catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* Connection may have failed before BEGIN. */ }
  console.error(`Staging seed failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
