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
    expect((await catalog.json()).account_cards).toEqual([{ customer_id: 10, customer_type: 1, acc_ref: 'A10' }]);
    const response = await handler(makeRequest({ mode: 'journal', expected_company_id: 123, date: '2026-11-08' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.company).toEqual({ name: 'Shafan', company_id: 123, accounting_type: 2 });
    expect(body.document_200002.matches).toEqual([{ journal_year: 2026,
      journal_month: 11, journal_id: 42, sort_code: 1, total_amount: 4 }]);
    expect(JSON.stringify(body)).not.toMatch(/private|secret|email|phone/);
    expect(calls).toEqual(['Company.Details', 'Company.Details',
      'Accounting.SortCodeList', 'Customer.List', 'Company.Details',
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

  test('returns sort codes when account-card read is denied, without customer data', async () => {
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
    expect(body.account_cards_status).toBe('unavailable');
    expect(body.account_cards_error_code).toBe('http_403');
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
});
