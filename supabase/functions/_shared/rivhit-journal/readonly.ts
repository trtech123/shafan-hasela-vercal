import type { RivhitJournalReportRow } from '../rivhit/types.ts';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status,
    headers: { ...corsHeaders, 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

/** This handler contains no write operation or general-purpose provider dispatch. */
export function createRivhitReadOnlyHandler(dependencies: {
  authorize: (userJwt: string) => Promise<string | null>;
  provider: {
    sortCodeList: () => Promise<Array<{ sort_code: number; description: string }>>;
    journalsReport: (date: string) => Promise<RivhitJournalReportRow[]>;
    projectList: () => Promise<Array<{ project_id: number; project_name: string }>>;
    paymentTypeList: () => Promise<Array<{ payment_type: number; payment_name: string; type_code: number }>>;
    accountCard: (accountId: number) => Promise<{
      account_id: number; name: string; account_type: number | null; project_id: number | null;
    }>;
    profitLossAccounts: (year: number, fromMonth: number, toMonth: number) => Promise<Array<{
      account_id: number; account_name: string; pnl_code: number; pnl_name: string;
    }>>;
  };
}) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const auth = request.headers.get('authorization');
    if (!auth?.startsWith('Bearer ') || !auth.slice(7).trim())
      return json({ error: 'authentication_required' }, 401);
    let role: string | null;
    try { role = await dependencies.authorize(auth.slice(7)); }
    catch { return json({ error: 'authentication_required' }, 401); }
    if (!role) return json({ error: 'authentication_required' }, 401);
    if (role !== 'admin') return json({ error: 'forbidden' }, 403);
    let input: unknown;
    try {
      const body = await request.text();
      if (body.length > 256) return json({ error: 'invalid_request' }, 400);
      input = JSON.parse(body);
    } catch { return json({ error: 'invalid_request' }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return json({ error: 'invalid_request' }, 400);
    const body = input as Record<string, unknown>;
    try {
      if (Object.keys(body).length === 1 && body.operation === 'sort_codes') {
        const rows = await dependencies.provider.sortCodeList();
        return json({ rows: rows.slice(0, 500) }, 200);
      }
      if (Object.keys(body).length === 1 && body.operation === 'projects') {
        const rows = await dependencies.provider.projectList();
        return json({ rows: rows.slice(0, 500), truncated: rows.length > 500 }, 200);
      }
      if (Object.keys(body).length === 1 && body.operation === 'payment_types') {
        const rows = await dependencies.provider.paymentTypeList();
        return json({ rows: rows.slice(0, 100), truncated: rows.length > 100 }, 200);
      }
      if (Object.keys(body).length === 2 && body.operation === 'account_card'
        && Number.isSafeInteger(body.account_id) && (body.account_id as number) > 0
        && (body.account_id as number) <= 2147483647) {
        const account = await dependencies.provider.accountCard(body.account_id as number);
        return json({ account }, 200);
      }
      if (Object.keys(body).length === 4 && body.operation === 'profit_loss_accounts'
        && Number.isSafeInteger(body.year) && (body.year as number) >= 2000 && (body.year as number) <= 2100
        && Number.isSafeInteger(body.from_month) && Number.isSafeInteger(body.to_month)
        && (body.from_month as number) >= 1 && (body.to_month as number) <= 12
        && (body.from_month as number) <= (body.to_month as number)) {
        const rows = await dependencies.provider.profitLossAccounts(
          body.year as number, body.from_month as number, body.to_month as number);
        return json({ rows: rows.slice(0, 2000), truncated: rows.length > 2000 }, 200);
      }
      if (Object.keys(body).length === 2 && body.operation === 'journal_report'
        && typeof body.date === 'string'
        && /^(?:\d{8}|\d{2}\/\d{2}\/\d{4})$/.test(body.date)) {
        const rows = await dependencies.provider.journalsReport(body.date);
        return json({ rows: rows.slice(0, 2000), truncated: rows.length > 2000 }, 200);
      }
    } catch { return json({ error: 'rivhit_read_unavailable' }, 502); }
    return json({ error: 'invalid_request' }, 400);
  };
}
