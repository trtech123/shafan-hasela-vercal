const baseUrl = 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/';
const operations = ['Company.Details', 'Accounting.SortCodeList',
  'Customer.List', 'Accounting.JournalsReport', 'Customer.JournalReport'] as const;
const pilotPaymentId = 'PRODUCTION_PAYMENT_ID_REDACTED';
const pilotSaleReference = 'RCP-1026';
type Operation = typeof operations[number];

class ProviderReadError extends Error {
  constructor(readonly safeCode: string) { super('provider_failure'); }
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function accountLabel(item: unknown): string {
  const row = record(item);
  return `${String(row?.first_name ?? '')} ${String(row?.last_name ?? '')}`.trim().slice(0, 100);
}

function accountingCategory(item: unknown): string | null {
  const label = accountLabel(item);
  if (/מע.?מ|מס עסקאות|מס ערך|vat/i.test(label)) return 'vat_output';
  if (/אשראי|סליקה|כרטיס/i.test(label)) return 'card_clearing';
  if (/קופה|מכירות|הכנסות|הכנסה/i.test(label)) return 'revenue_or_register';
  return null;
}

function verifiedGatewayRole(authorization: string | null): string | null {
  // The gateway verifies the signature and expiry (verify_jwt=true).
  // This function narrows that verified JWT to service_role only.
  try {
    if (!authorization?.startsWith('Bearer ')) return null;
    const segments = authorization.slice(7).split('.');
    if (segments.length !== 3) return null;
    const encoded = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = record(JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))));
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch { return null; }
}

async function readBounded(response: Response): Promise<string> {
  if (!response.body) throw new ProviderReadError('invalid_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new ProviderReadError('response_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function createConnectionCheckHandler(options: {
  apiToken: string | undefined; fetchImpl?: typeof fetch;
}) {
  async function call(operation: Operation, extra: Record<string, unknown> = {}) {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(baseUrl + operation, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...extra, api_token: options.apiToken }),
        redirect: 'error', signal: AbortSignal.timeout(12_000),
      });
    } catch { throw new ProviderReadError('transport'); }
    if (!response.ok) throw new ProviderReadError(`http_${response.status}`);
    if (Number(response.headers.get('Content-Length') ?? 0) > 2_000_000)
      throw new ProviderReadError('response_too_large');
    try {
      const text = await readBounded(response);
      const result = record(JSON.parse(text));
      if (!result) throw new ProviderReadError('invalid_response');
      if (result.error_code !== 0) {
        const code = Number(result.error_code);
        throw new ProviderReadError(Number.isSafeInteger(code) ? `rivhit_${code}` : 'rivhit_error');
      }
      return result.data;
    } catch (error) {
      if (error instanceof ProviderReadError) throw error;
      throw new ProviderReadError('invalid_response');
    }
  }

  return async function handler(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (verifiedGatewayRole(request.headers.get('Authorization')) !== 'service_role')
      return json(401, { error: 'unauthorized' });
    if (!options.apiToken) return json(503, { error: 'probe_unconfigured' });
    let input: unknown;
    try { input = await request.json(); } catch { return json(400, { error: 'invalid_request' }); }
    const body = record(input);
    if (!body || !['identity', 'catalog', 'account_cards', 'account_journal', 'journal'].includes(String(body.mode))
      || (body.mode === 'identity' && Object.keys(body).length !== 1)
      || (body.mode === 'catalog' &&
        (Object.keys(body).length !== 2 || !Number.isSafeInteger(body.expected_company_id)))
      || (body.mode === 'account_cards' &&
        (Object.keys(body).length !== 3 || !Number.isSafeInteger(body.expected_company_id)
          || !Number.isSafeInteger(body.customer_type)
          || Number(body.customer_type) < 40 || Number(body.customer_type) > 59))
      || (body.mode === 'account_journal' &&
        (Object.keys(body).length !== 4 || !Number.isSafeInteger(body.expected_company_id)
          || !Number.isSafeInteger(body.customer_type)
          || Number(body.customer_type) < 40 || Number(body.customer_type) > 59
          || !Number.isSafeInteger(body.customer_id) || Number(body.customer_id) <= 0))
      || (body.mode === 'journal' &&
        (Object.keys(body).length !== 3 || !Number.isSafeInteger(body.expected_company_id)
          || !validDate(body.date))))
      return json(400, { error: 'invalid_request' });

    let stage = 'company';
    try {
      const company = record(await call(operations[0]));
      if (!company || typeof company.name !== 'string' || !Number.isSafeInteger(company.company_id))
        throw new Error('invalid_company');
      const identity = { name: company.name, company_id: company.company_id,
        accounting_type: company.accounting_type };
      if (body.mode === 'identity') return json(200, { company: identity });
      if (body.expected_company_id !== company.company_id)
        return json(409, { error: 'company_mismatch' });

      if (body.mode === 'account_cards') {
        stage = 'account_cards';
        const customers = record(await call(operations[2], { customer_type: body.customer_type }));
        if (!customers || !Array.isArray(customers.customer_list))
          throw new Error('invalid_accounts');
        const relevant = customers.customer_list.filter((item: unknown) => accountingCategory(item));
        return json(200, { company: identity, customer_type: body.customer_type,
          account_cards_total: customers.customer_list.length,
          relevant_cards_total: relevant.length,
          account_cards: relevant.slice(0, 100).map((item: unknown) => {
            const row = record(item);
            return { customer_id: row?.customer_id, customer_type: row?.customer_type,
              acc_ref: row?.acc_ref, category: accountingCategory(item),
              account_label: accountLabel(item) };
          }) });
      }

      if (body.mode === 'account_journal') {
        stage = 'account_cards';
        const customers = record(await call(operations[2], { customer_type: body.customer_type }));
        if (!customers || !Array.isArray(customers.customer_list))
          throw new Error('invalid_accounts');
        const target = customers.customer_list.find((item: unknown) =>
          Number(record(item)?.customer_id) === body.customer_id
          && Number(record(item)?.customer_type) === body.customer_type
          && accountingCategory(item));
        if (!target) return json(404, { error: 'account_not_in_relevant_catalog' });
        stage = 'account_journal';
        const report = record(await call(operations[4], {
          customer_id: body.customer_id, year: 2026, only_open: false, all_years: false,
        }));
        if (!report || !Array.isArray(report.customer_journal))
          throw new Error('invalid_report');
        const matches = report.customer_journal.filter((item: unknown) => {
          const row = record(item);
          return row && [row.reference1, row.reference2, row.details].some(value =>
            String(value ?? '').includes('200002') || String(value ?? '').includes(pilotPaymentId)
            || String(value ?? '').includes(pilotSaleReference));
        });
        return json(200, { company: identity,
          account_journal: { customer_id: body.customer_id, customer_type: body.customer_type,
            searched_rows: report.customer_journal.length, match_count: matches.length,
            matches: matches.slice(0, 20).map((item: unknown) => {
              const row = record(item);
              return { journal_year: row?.journal_year, journal_month: row?.journal_month,
                journal_id: row?.journal_id, sort_code: row?.sort_code,
                debit_amount: row?.debit_amount, credit_amount: row?.credit_amount };
            }) } });
      }

      if (body.mode === 'catalog') {
        stage = 'sort_codes';
        const sortCodes = await call(operations[1], { documents_only: false });
        if (!Array.isArray(sortCodes)) throw new Error('invalid_sort_codes');
        return json(200, { company: identity,
          sort_codes: sortCodes.slice(0, 500).map((item: unknown) => {
          const row = record(item);
          return { sort_code: row?.sort_code, description: row?.description };
        }),
          sort_codes_total: sortCodes.length,
          account_cards: [], account_cards_total: 0,
          account_cards_status: 'not_requested' });
      }

      const date = body.date as string;
      stage = 'journal_report';
      const report = record(await call(operations[3], {
        date: `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`,
      }));
      if (!report || !Array.isArray(report.journals_report)) throw new Error('invalid_report');
      const referenceMatches = report.journals_report.filter((item: unknown) => {
        const row = record(item);
        return row && [row.reference1, row.reference2, row.details].some(value =>
          String(value ?? '').includes('200002') || String(value ?? '').includes(pilotPaymentId)
          || String(value ?? '').includes(pilotSaleReference));
      });
      const matches = referenceMatches.slice(0, 20).map((item: unknown) => {
        const row = record(item)!;
        return { journal_year: row.journal_year, journal_month: row.journal_month,
          journal_id: row.journal_id, sort_code: row.sort_code,
          total_amount: row.total_amount };
      });
      return json(200, { company: identity,
        document_200002: { searched_date: date, expected_amount: 4,
          matches, match_count: referenceMatches.length,
          amount_4_candidates: report.journals_report.filter((item: unknown) =>
            Number(record(item)?.total_amount) === 4).length,
          searched_rows: report.journals_report.length } });
    } catch (error) { return json(502, { error: 'provider_read_failed', stage,
      kind: error instanceof Error && error.message.startsWith('invalid_')
        ? 'response_shape' : 'provider_or_transport',
      provider_code: error instanceof ProviderReadError ? error.safeCode : null }); }
  };
}
