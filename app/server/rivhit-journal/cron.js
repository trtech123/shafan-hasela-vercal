import { createHash, timingSafeEqual } from 'node:crypto';

function json(body, status) {
  return new Response(JSON.stringify(body), { status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
function equalSecret(left, right) {
  return timingSafeEqual(createHash('sha256').update(left).digest(),
    createHash('sha256').update(right).digest());
}

export function createRivhitJournalCron(env, fetchImpl = fetch) {
  return async request => {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const authorization = request.headers.get('authorization') ?? '';
    if (!env.CRON_SECRET || !authorization.startsWith('Bearer ')
      || !equalSecret(authorization.slice(7), env.CRON_SECRET)) {
      return json({ error: 'authentication_required' }, 401);
    }
    if (env.RIVHIT_JOURNAL_CRON_ENABLED !== 'true')
      return json({ error: 'journal_cron_disabled' }, 503);
    const jwt = env.SUPABASE_EDGE_SERVICE_ROLE_JWT;
    let url;
    try {
      url = new URL(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL);
      if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
        || url.username || url.password || url.port || url.search || url.hash
        || url.pathname !== '/') throw new Error('invalid_url');
    } catch { return json({ error: 'journal_configuration_missing' }, 503); }
    if (!jwt || !/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt))
      return json({ error: 'journal_configuration_missing' }, 503);
    try {
      const response = await fetchImpl(new URL('/functions/v1/rivhit-journal-worker', url), {
        method: 'POST', headers: { authorization: `Bearer ${jwt}`, apikey: jwt,
          'content-type': 'application/json' },
        body: JSON.stringify({ run: 'batch' }), signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) return json({ error: 'journal_worker_unavailable' }, 502);
      const result = await response.json();
      if (![result?.staged, result?.processed, result?.reconciled, result?.blocked].every(
        value => Number.isSafeInteger(value) && value >= 0)
        || result.staged > 20 || result.processed > 1
        || result.reconciled > 1 || result.blocked > 502) {
        return json({ error: 'journal_worker_invalid_response' }, 502);
      }
      const overdue = result.overdue;
      if (!overdue || ![overdue.unbatched, overdue.unverified].every(
        value => Number.isSafeInteger(value) && value >= 0)) {
        return json({ error: 'journal_overdue_check_unavailable' }, 502);
      }
      return json({ staged: result.staged, processed: result.processed,
        reconciled: result.reconciled,
        blocked: result.blocked, overdue },
      overdue.unbatched || overdue.unverified || result.blocked ? 409 : 200);
    } catch { return json({ error: 'journal_worker_unavailable' }, 502); }
  };
}
