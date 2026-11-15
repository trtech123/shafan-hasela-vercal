import { describe, expect, test, vi } from 'vitest';
import { createConnectionCheckHandler } from './handler.ts';

const endpoint = 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/';
const tokenForRole = (role: string) => `${btoa('{}')}.${btoa(JSON.stringify({ role }))}.signature`;
const makeRequest = (body: unknown, authorization = `Bearer ${tokenForRole('service_role')}`) =>
  new Request('https://example.test/check', { method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
const ok = (data: unknown) => new Response(JSON.stringify({ error_code: 0, data }), { status: 200 });

describe('Rivhit read-only connection check', () => {
  test('rejects unauthorised and arbitrary operations without contacting provider', async () => {
    const fetchImpl = vi.fn();
    const handler = createConnectionCheckHandler({ apiToken: 'private-token',
      fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await handler(makeRequest({ mode: 'identity' }, 'Bearer other'))).status).toBe(401);
    expect((await handler(makeRequest({ mode: 'identity' },
      `Bearer ${tokenForRole('anon')}`))).status).toBe(401);
    expect((await handler(makeRequest({ mode: 'identity', operation: 'Accounting.AddJournal' }))).status).toBe(400);
    expect((await handler(makeRequest({ mode: 'journal', date: '2026-11-08', url: 'https://evil.test' }))).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('calls only four fixed read-only endpoints and strips customer details', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, options: RequestInit) => {
      calls.push(url);
      expect(options.method).toBe('POST');
      expect(JSON.parse(String(options.body)).api_token).toBe('private-token');
      if (url.endsWith('Company.Details')) return ok({ name: 'Shafan', company_id: 123, accounting_type: 2,
        phone: 'secret' });
      if (url.endsWith('Accounting.SortCodeList')) return ok([
        { sort_code: 1, description: 'Income' }]);
      if (url.endsWith('Customer.List')) return ok({ customer_list: [
        { customer_id: 10, customer_type: 1, acc_ref: 'A10', first_name: 'Private', email: 'secret' },
      ] });
      if (url.endsWith('Accounting.JournalsReport')) return ok({ journals_report: [
        { reference1: '200002', reference2: 'payment', total_amount: 4,
          journal_year: 2026, journal_month: 11, journal_id: 42, sort_code: 1,
          details: 'Private customer details' },
      ] });
      throw Error('unexpected endpoint');
    });
    const handler = createConnectionCheckHandler({ apiToken: 'private-token',
      fetchImpl: fetchImpl as unknown as typeof fetch });
    const identity = await handler(makeRequest({ mode: 'identity' }));
    expect(identity.headers.get('Content-Type')).toContain('charset=utf-8');
    expect((await identity.json()).company).toEqual({ name: 'Shafan', company_id: 123, accounting_type: 2 });
    const catalog = await handler(makeRequest({ mode: 'catalog', expected_company_id: 123 }));
    expect((await catalog.json()).account_cards).toEqual([]);
    const response = await handler(makeRequest({ mode: 'journal', expected_company_id: 123, date: '2026-11-08' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.company).toEqual({ name: 'Shafan', company_id: 123, accounting_type: 2 });
    expect(body.document_200002.matches).toEqual([{ journal_year: 2026,
      journal_month: 11, journal_id: 42, sort_code: 1, total_amount: 4 }]);
    expect(JSON.stringify(body)).not.toMatch(/private|secret|email|phone/);
    expect(calls).toEqual(['Company.Details', 'Company.Details',
      'Accounting.SortCodeList', 'Company.Details',
      'Accounting.JournalsReport'].map(name => endpoint + name));
    expect(calls.every(url => !/AddJournal|Document\.New|Receipt\.New/.test(url))).toBe(true);
  });

  test('reports provider errors without echoing token or provider body', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error_code: 13,
      client_message: 'private-token rejected' }), { status: 200 }));
    const handler = createConnectionCheckHandler({ apiToken: 'private-token',
      fetchImpl: fetchImpl as unknown as typeof fetch });
    const response = await handler(makeRequest({ mode: 'identity' }));
    expect(response.status).toBe(502);
    expect((await response.clone().json()).stage).toBe('company');
    expect((await response.clone().json()).provider_code).toBe('rivhit_13');
    expect(await response.text()).not.toContain('private-token');
  });

  test('catalog returns sort codes without requesting any customer cards', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('Company.Details')) return ok({ name: 'Shafan', company_id: 123 });
      if (url.endsWith('Accounting.SortCodeList')) return ok([{ sort_code: 7, description: 'Income' }]);
      return new Response('private', { status: 403 });
    });
    const handler = createConnectionCheckHandler({ apiToken: 'private-token',
      fetchImpl: fetchImpl as unknown as typeof fetch });
    const response = await handler(makeRequest({ mode: 'catalog', expected_company_id: 123 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sort_codes).toEqual([{ sort_code: 7, description: 'Income' }]);
    expect(body.account_cards_status).toBe('not_requested');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(body)).not.toContain('private');
  });

  test('wrong expected company stops before chart or journal reads', async () => {
    const fetchImpl = vi.fn(async () => ok({ name: 'Other', company_id: 999 }));
    const handler = createConnectionCheckHandler({ apiToken: 'private-token',
      fetchImpl: fetchImpl as unknown as typeof fetch });
    const response = await handler(makeRequest({ mode: 'journal', expected_company_id: 123,
      date: '2026-11-08' }));
    expect(response.status).toBe(409);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('reads one allowed accounting card type without returning personal fields', async () => {
    const fetchImpl = vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('Company.Details')) return ok({ name: 'Shafan', company_id: 123 });
      expect(url).toBe(endpoint + 'Customer.List');
      expect(JSON.parse(String(options.body)).customer_type).toBe(40);
      return ok({ customer_list: [
        { customer_id: 7, customer_type: 40, acc_ref: '400', first_name: 'Private', email: 'private' },
      ] });
    });
    const handler = createConnectionCheckHandler({ apiToken: 'private-token',
      fetchImpl: fetchImpl as unknown as typeof fetch });
    const response = await handler(makeRequest({ mode: 'account_cards', expected_company_id: 123,
      customer_type: 40 }));
    expect((await response.json()).account_cards).toEqual([
      { customer_id: 7, customer_type: 40, acc_ref: '400' },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await handler(makeRequest({ mode: 'account_cards', expected_company_id: 123,
      customer_type: 1 }))).status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('cuts off an oversized streamed provider response', async () => {
    const chunk = new Uint8Array(1_100_000);
    let cancelled = false;
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(chunk); controller.enqueue(chunk); },
      cancel() { cancelled = true; },
    })));
    const handler = createConnectionCheckHandler({ apiToken: 'private-token',
      fetchImpl: fetchImpl as unknown as typeof fetch });
    const response = await handler(makeRequest({ mode: 'identity' }));
    expect((await response.json()).provider_code).toBe('response_too_large');
    expect(cancelled).toBe(true);
  });

  test('recheck finds references even when an entry amount differs from four', async () => {
    const fetchImpl = vi.fn(async (url: string) => url.endsWith('Company.Details')
      ? ok({ name: 'Shafan', company_id: 123 })
      : ok({ journals_report: [
        { reference1: '200002', total_amount: 3.39, journal_id: 10, journal_year: 2026,
          journal_month: 11, details: 'Private customer' },
        { details: 'Payper 200002', total_amount: 0.61, journal_id: 11, journal_year: 2026,
          journal_month: 11 },
      ] }));
    const handler = createConnectionCheckHandler({ apiToken: 'private-token',
      fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = await (await handler(makeRequest({ mode: 'journal', expected_company_id: 123,
      date: '2026-11-09' }))).json();
    expect(body.document_200002.matches).toHaveLength(2);
    expect(body.document_200002.matches.map((row: { total_amount: number }) => row.total_amount))
      .toEqual([3.39, 0.61]);
    expect(JSON.stringify(body)).not.toContain('Private customer');
  });
});
