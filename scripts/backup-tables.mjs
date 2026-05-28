// ============================================================
// backup-tables.mjs — snapshot current Supabase tables to local JSON.
//
// READ-ONLY on the database (SELECT only). Writes JSON files to
// backups/<timestamp>/<table>.json. Run this BEFORE clearing seed or
// importing real data.
//
// Run:  node scripts/backup-tables.mjs
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function readEnvFile(fp) {
  if (!fs.existsSync(fp)) return {};
  const env = {};
  for (const line of fs.readFileSync(fp, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = { ...readEnvFile(path.join(REPO_ROOT, 'app', '.env')), ...readEnvFile(path.join(REPO_ROOT, '.env.local')) };
const URL = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (app/.env + .env.local).'); process.exit(1); }

const TABLES = ['profiles', 'activities', 'instructors', 'leads', 'quotes', 'orders',
  'tasks', 'maintenance_tasks', 'sales', 'pricing_sheets'];

async function fetchAll(table) {
  const res = await fetch(`${URL}/rest/v1/${table}?select=*`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(REPO_ROOT, 'backups', stamp);
fs.mkdirSync(dir, { recursive: true });
console.log('Backup → ' + dir);
let total = 0;
for (const t of TABLES) {
  const rows = await fetchAll(t);
  fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(rows, null, 2));
  console.log(`  ${t.padEnd(18)} ${rows.length} rows`);
  total += rows.length;
}
console.log(`Done. ${total} rows backed up across ${TABLES.length} tables.`);
