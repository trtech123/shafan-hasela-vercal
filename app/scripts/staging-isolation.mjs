#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PRODUCTION_SUPABASE_REF = 'divzxsynczeifkpnpupl';
const PRODUCTION_VERCEL_PROJECT_ID = 'prj_6rvjmBAfEUpym5E4JwVPut1HiXQC';

// A staging browser build is deliberately unable to use a financial provider.
// Keep this list in sync with all payment and document dispatch gates.
export const CLOSED_GATES = [
  'ORDER_CONFIRMATION_RESEND_ENABLED',
  'PAYPER_AUTO_SCAN_ENABLED', 'PAYPER_AUTO_WAKE_ENABLED',
  'PAYPER_CASH_DISPATCH_ENABLED', 'PAYPER_CHECK_DISPATCH_ENABLED',
  'PAYPER_DISPATCH_ENABLED', 'PAYPER_NONCARD_COLLECTION_ENABLED',
  'PELECARD_CONTROLLED_LIVE_ENABLED', 'PELECARD_LIVE_PAYMENTS_ENABLED',
  'PELECARD_PENDING_RECOVERY_ENABLED', 'PELECARD_PHYSICAL_CLOUD_WORKER_ENABLED',
  'PELECARD_PHYSICAL_DIRECT_PAYPER_ENABLED', 'PELECARD_PHYSICAL_DIRECT_UI_ENABLED',
  'PELECARD_PHYSICAL_DISPATCH_ENABLED', 'PELECARD_PHYSICAL_ENABLED',
  'PELECARD_PHYSICAL_HOSTED_ENABLED', 'PELECARD_PHYSICAL_HOSTED_INIT_ENABLED',
  'PELECARD_PHYSICAL_QUEUE_SMOKE_ENABLED', 'PELECARD_POS_PAYMENTS_ENABLED',
  'PELECARD_REFUND_ENABLED', 'PELECARD_RETRIEVAL_ENABLED',
  'PELECARD_TEST_TRANSACTION_ENABLED', 'PAYPER_AUTOMATIC_ENABLED',
];

export function validateStagingIsolation(env, { actualVercelProjectId } = {}) {
  const projectRef = env.STAGING_SUPABASE_PROJECT_REF;
  if (projectRef === PRODUCTION_SUPABASE_REF) throw new Error('Production Supabase project is forbidden in staging');
  if (!/^[a-z0-9]{20}$/.test(projectRef ?? '')) throw new Error('A separate 20-character staging Supabase project ref is required');

  const vercelProjectId = env.STAGING_VERCEL_PROJECT_ID;
  if (vercelProjectId === PRODUCTION_VERCEL_PROJECT_ID) throw new Error('Production Vercel project is forbidden in staging');
  if (!/^prj_[A-Za-z0-9]+$/.test(vercelProjectId ?? '')) throw new Error('A separate staging Vercel project ID is required');
  if (actualVercelProjectId && actualVercelProjectId !== vercelProjectId) {
    throw new Error('The linked Vercel project does not match the approved staging project');
  }

  const expectedUrl = `https://${projectRef}.supabase.co`;
  if (env.VITE_SUPABASE_URL !== expectedUrl || (env.SUPABASE_URL && env.SUPABASE_URL !== expectedUrl)) {
    throw new Error('Supabase URL must exactly match the staging project ref');
  }
  if (!env.VITE_SUPABASE_ANON_KEY) throw new Error('A staging public anon key is required');

  for (const gate of CLOSED_GATES) {
    if (env[gate] !== 'false') throw new Error(`${gate} must be explicitly false`);
  }
  for (const [key, value] of Object.entries(env)) {
    if (value == null || value === '') continue;
    if (/^(META_|GMAIL_|ICREDIT_|RIVHIT_|RESEND_|SMTP_)/.test(key) ||
        /(DATABASE_URL|POSTGRES_URL|SERVICE_ROLE_KEY)$/.test(key) ||
        /^VITE_.*(PELECARD|PAYPER|META|GMAIL)/.test(key) ||
        (/^(PELECARD_|PAYPER_)/.test(key) && !CLOSED_GATES.includes(key))) {
      throw new Error(`${key} must not be present in staging`);
    }
    if (key.endsWith('_ENABLED') && value === 'true') {
      throw new Error(`${key} must not be enabled in staging`);
    }
    if (typeof value === 'string' && value.includes(PRODUCTION_SUPABASE_REF)) {
      throw new Error(`${key} references Production Supabase`);
    }
  }
  return { projectRef, vercelProjectId };
}

export function validateStagingDatabaseUrl(connectionString, projectRef) {
  let url;
  try { url = new URL(connectionString); }
  catch { throw new Error('A valid staging database URL is required'); }
  if (!/^[a-z0-9]{20}$/.test(projectRef ?? '') ||
      url.protocol !== 'postgresql:' || url.hostname !== `db.${projectRef}.supabase.co` ||
      url.username !== 'postgres') {
    throw new Error('Only the approved direct staging database host is allowed');
  }
  if (url.pathname !== '/postgres' || url.search || !url.password) {
    throw new Error('Staging seed requires the postgres database, a password and no URL options');
  }
  return url;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const linked = JSON.parse(readFileSync(resolve(process.cwd(), '.vercel/project.json'), 'utf8'));
    const result = validateStagingIsolation(process.env, { actualVercelProjectId: linked.projectId });
    console.log(`Staging isolation preflight passed for ${result.projectRef} / ${result.vercelProjectId}`);
  } catch (error) {
    console.error(`Staging isolation preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
