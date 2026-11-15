const baseUrl = 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/';
const operations = ['Company.Details', 'Accounting.SortCodeList',
  'Customer.List', 'Accounting.JournalsReport'] as const;
const pilotPaymentId = 'PRODUCTION_PAYMENT_ID_REDACTED';
type Operation = typeof operations[number];

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
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

export function createConnectionCheckHandler(options: {
  serviceKey: string | undefined; apiToken: string | undefined; fetchImpl?: typeof fetch;
}) {
  async function call(operation: Operation, extra: Record<string, unknown> = {}) {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(baseUrl + operation, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...extra, api_token: options.apiToken }),
        redirect: 'error', signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok || Number(response.headers.get('Content-Length') ?? 0) > 2_000_000)
        throw new Error('provider_failure');
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error('provider_failure');
      const result = record(JSON.parse(text));
      if (!result || result.error_code !== 0) throw new Error('provider_failure');
      return result.data;
    } catch { throw new Error('provider_failure'); }
  }

  return async function handler(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (!options.serviceKey || request.headers.get('Authorization') !== `Bearer ${options.serviceKey}`)
      return json(401, { error: 'unauthorized' });
    if (!options.apiToken) return json(503, { error: 'probe_unconfigured' });
    let input: unknown;
    try { input = await request.json(); } catch { return json(400, { error: 'invalid_request' }); }
    const body = record(input);
    if (!body || !['identity', 'catalog', 'journal'].includes(String(body.mode))
      || (body.mode === 'identity' && Object.keys(body).length !== 1)
      || (body.mode === 'catalog' &&
        (Object.keys(body).length !== 2 || !Number.isSafeInteger(body.expected_company_id)))
      || (body.mode === 'journal' &&
        (Object.keys(body).length !== 3 || !Number.isSafeInteger(body.expected_company_id)
          || !validDate(body.date))))
      return json(400, { error: 'invalid_request' });

    try {
      const company = record(await call(operations[0]));
      if (!company || typeof company.name !== 'string' || !Number.isSafeInteger(company.company_id))
        throw new Error('invalid_company');
      const identity = { name: company.name, company_id: company.company_id,
        accounting_type: company.accounting_type };
      if (body.mode === 'identity') return json(200, { company: identity });
      if (body.expected_company_id !== company.company_id)
        return json(409, { error: 'company_mismatch' });

      if (body.mode === 'catalog') {
        const sortCodes = await call(operations[1], { documents_only: false });
        if (!Array.isArray(sortCodes)) throw new Error('invalid_sort_codes');
        const customers = record(await call(operations[2]));
        if (!customers || !Array.isArray(customers.customer_list)) throw new Error('invalid_accounts');
        return json(200, { company: identity,
          sort_codes: sortCodes.slice(0, 500).map((item: unknown) => {
          const row = record(item);
          return { sort_code: row?.sort_code, description: row?.description };
        }),
          sort_codes_total: sortCodes.length,
          account_cards: customers.customer_list.slice(0, 500).map((item: unknown) => {
          const row = record(item);
          return { customer_id: row?.customer_id, customer_type: row?.customer_type,
            acc_ref: row?.acc_ref };
        }),
          account_cards_total: customers.customer_list.length });
      }

      const date = body.date as string;
      const report = record(await call(operations[3], {
        date: `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`,
      }));
      if (!report || !Array.isArray(report.journals_report)) throw new Error('invalid_report');
      const matches = report.journals_report.filter((item: unknown) => {
        const row = record(item);
        return row && (String(row.reference1 ?? '').includes('200002')
          || String(row.reference2 ?? '').includes('200002')
          || String(row.reference1 ?? '').includes(pilotPaymentId)
          || String(row.reference2 ?? '').includes(pilotPaymentId))
          && Number(row.total_amount) === 4;
      }).map((item: unknown) => {
        const row = record(item)!;
        return { journal_year: row.journal_year, journal_month: row.journal_month,
          journal_id: row.journal_id, sort_code: row.sort_code,
          total_amount: row.total_amount };
      });
      return json(200, { company: identity,
        document_200002: { searched_date: date, expected_amount: 4,
          matches, searched_rows: report.journals_report.length } });
    } catch { return json(502, { error: 'provider_read_failed' }); }
  };
}
