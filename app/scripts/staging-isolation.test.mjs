import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLOSED_GATES, validateStagingDatabaseUrl, validateStagingIsolation } from './staging-isolation.mjs';

const ref = 'abcdefghijklmnopqrst';
const safe = () => ({
  STAGING_SUPABASE_PROJECT_REF: ref,
  STAGING_VERCEL_PROJECT_ID: 'prj_StagingIsolated',
  VITE_SUPABASE_URL: `https://${ref}.supabase.co`,
  SUPABASE_URL: `https://${ref}.supabase.co`,
  VITE_SUPABASE_ANON_KEY: 'synthetic-public-key',
  ...Object.fromEntries(CLOSED_GATES.map(gate => [gate, 'false'])),
});

test('accepts a separate staging project with every financial gate closed', () => {
  assert.deepEqual(validateStagingIsolation(safe()), { projectRef: ref, vercelProjectId: 'prj_StagingIsolated' });
});

test('rejects the live Supabase project even if labelled staging', () => {
  const env = safe();
  env.STAGING_SUPABASE_PROJECT_REF = 'divzxsynczeifkpnpupl';
  env.VITE_SUPABASE_URL = 'https://divzxsynczeifkpnpupl.supabase.co';
  env.SUPABASE_URL = env.VITE_SUPABASE_URL;
  assert.throws(() => validateStagingIsolation(env), /Production Supabase/);
});

test('rejects the production Vercel project and mismatched backend URL', () => {
  assert.throws(() => validateStagingIsolation({ ...safe(), STAGING_VERCEL_PROJECT_ID: 'prj_6rvjmBAfEUpym5E4JwVPut1HiXQC' }), /Production Vercel/);
  assert.throws(() => validateStagingIsolation(safe(), { actualVercelProjectId: 'prj_6rvjmBAfEUpym5E4JwVPut1HiXQC' }), /linked Vercel project/);
  assert.throws(() => validateStagingIsolation({ ...safe(), SUPABASE_URL: 'https://other.supabase.co' }), /Supabase URL/);
});

test('rejects provider credentials, service-role material and open gates', () => {
  for (const [key, value] of [
    ['META_WHATSAPP_TOKEN', 'live-secret'], ['GMAIL_APP_PASSWORD', 'live-secret'],
    ['PELECARD_LIVE_PASSWORD', 'live-secret'], ['PAYPER_API_KEY', 'live-secret'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'live-secret'], ['POSTGRES_URL', 'postgresql://localhost/postgres'],
    ['VITE_PELECARD_PASSWORD', 'live-secret'], ['PELECARD_POS_PAYMENTS_ENABLED', 'true'],
  ]) {
    assert.throws(() => validateStagingIsolation({ ...safe(), [key]: value }), undefined, key);
  }
});

test('rejects missing closed-gate declarations and unknown enable flags', () => {
  const env = safe();
  delete env.PELECARD_PHYSICAL_ENABLED;
  assert.throws(() => validateStagingIsolation(env), /PELECARD_PHYSICAL_ENABLED/);
  assert.throws(() => validateStagingIsolation({ ...safe(), CHATBOT_DELIVERY_ENABLED: 'true' }), /CHATBOT_DELIVERY_ENABLED/);
});

test('allows only the direct database host of the approved staging project for seeding', () => {
  const target = `postgresql://postgres:synthetic@db.${ref}.supabase.co:5432/postgres`;
  assert.equal(validateStagingDatabaseUrl(target, ref).hostname, `db.${ref}.supabase.co`);
  assert.throws(() => validateStagingDatabaseUrl('postgresql://postgres:x@db.divzxsynczeifkpnpupl.supabase.co/postgres', ref), /staging database host/);
  assert.throws(() => validateStagingDatabaseUrl('postgresql://postgres:x@localhost/postgres', ref), /staging database host/);
  assert.throws(() => validateStagingDatabaseUrl(`postgresql://postgres:x@db.${ref}.supabase.co/other`, ref), /postgres database/);
});

test('the staging example declares every known financial gate closed', () => {
  const example = Object.fromEntries(readFileSync(new URL('../.env.staging.example', import.meta.url), 'utf8')
    .split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split('=', 2)));
  for (const gate of CLOSED_GATES) assert.equal(example[gate], 'false', gate);
  assert.throws(() => validateStagingIsolation(example));
});
