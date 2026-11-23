import { describe, expect, test, vi } from 'vitest';
import { createRivhitReadOnlyHandler } from './readonly.ts';

const request = (body: unknown, token = 'valid-user') => new Request('https://example.invalid/read', {
  method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {},
  body: JSON.stringify(body),
});

describe('authenticated read-only Rivhit API', () => {
  test('answers browser preflight without invoking authorization or provider', async () => {
    const authorize = vi.fn();
    const provider = { sortCodeList: vi.fn(), journalsReport: vi.fn(),
      projectList: vi.fn(), paymentTypeList: vi.fn(), accountCard: vi.fn(), profitLossAccounts: vi.fn() };
    const handler = createRivhitReadOnlyHandler({ authorize, provider });
    const response = await handler(new Request('https://example.invalid/read', {
      method: 'OPTIONS',
      headers: { origin: 'https://shafan-hasela-vercal.vercel.app',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, apikey, content-type, x-client-info' },
    }));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
    expect(authorize).not.toHaveBeenCalled();
    expect(provider.sortCodeList).not.toHaveBeenCalled();
  });

  test('rejects missing, invalid and non-admin sessions before provider access', async () => {
    const provider = { sortCodeList: vi.fn(), journalsReport: vi.fn(),
      projectList: vi.fn(), paymentTypeList: vi.fn(), accountCard: vi.fn(), profitLossAccounts: vi.fn() };
    const authorize = vi.fn(async (token: string) => token === 'valid-user' ? 'admin'
      : token === 'cashier-user' ? 'cashier' : null);
    const handler = createRivhitReadOnlyHandler({ authorize, provider });
    expect((await handler(request({ operation: 'sort_codes' }, ''))).status).toBe(401);
    expect((await handler(request({ operation: 'sort_codes' }, 'bad'))).status).toBe(401);
    expect((await handler(request({ operation: 'sort_codes' }, 'cashier-user'))).status).toBe(403);
    expect((await handler(request({ operation: 'projects' }, ''))).status).toBe(401);
    expect((await handler(request({ operation: 'payment_types' }, 'cashier-user'))).status).toBe(403);
    expect((await handler(request({ operation: 'account_card', account_id: 1416 }, 'bad'))).status).toBe(401);
    expect((await handler(request({ operation: 'account_card', account_id: 1416 }, 'cashier-user'))).status).toBe(403);
    expect((await handler(request({ operation: 'profit_loss_accounts', year: 2026, from_month: 1, to_month: 11 }, 'cashier-user'))).status).toBe(403);
    expect((await handler(request({ operation: 'sort_codes' }, ''))).headers.get('access-control-allow-origin')).toBe('*');
    expect(provider.sortCodeList).not.toHaveBeenCalled();
    expect(provider.projectList).not.toHaveBeenCalled();
    expect(provider.paymentTypeList).not.toHaveBeenCalled();
    expect(provider.accountCard).not.toHaveBeenCalled();
    expect(provider.profitLossAccounts).not.toHaveBeenCalled();
  });

  test('only approved read operations can reach Rivhit', async () => {
    const provider = { sortCodeList: vi.fn().mockResolvedValue([{ sort_code: 12, description: 'test' }]),
      journalsReport: vi.fn().mockResolvedValue([]),
      projectList: vi.fn().mockResolvedValue([{ project_id: 3, project_name: 'Test' }]),
      paymentTypeList: vi.fn().mockResolvedValue([{ payment_type: 1, payment_name: 'Cash', type_code: 5 }]),
      accountCard: vi.fn().mockResolvedValue({ account_id: 1416, name: 'Account', account_type: 2, project_id: null }),
      profitLossAccounts: vi.fn().mockResolvedValue([{ account_id: 1416, account_name: 'Revenue', pnl_code: 2, pnl_name: 'Income' }]) };
    const handler = createRivhitReadOnlyHandler({ authorize: async () => 'admin', provider });
    expect((await handler(request({ operation: 'sort_codes' }))).status).toBe(200);
    expect((await handler(request({ operation: 'journal_report', date: '22112026' }))).status).toBe(200);
    expect((await handler(request({ operation: 'projects' }))).status).toBe(200);
    expect((await handler(request({ operation: 'payment_types' }))).status).toBe(200);
    const account = await handler(request({ operation: 'account_card', account_id: 1416 }));
    expect(account.status).toBe(200);
    expect(await account.json()).toEqual({ account: { account_id: 1416, name: 'Account', account_type: 2, project_id: null } });
    expect((await handler(request({ operation: 'account_card', account_id: 0 }))).status).toBe(400);
    expect((await handler(request({ operation: 'account_card', account_id: '1416' }))).status).toBe(400);
    expect((await handler(request({ operation: 'profit_loss_accounts', year: 2026, from_month: 1, to_month: 11 }))).status).toBe(200);
    expect((await handler(request({ operation: 'profit_loss_accounts', year: 2026, from_month: 12, to_month: 1 }))).status).toBe(400);
    expect((await handler(request({ operation: 'add_journal' }))).status).toBe(400);
    expect(provider.sortCodeList).toHaveBeenCalledOnce();
    expect(provider.journalsReport).toHaveBeenCalledExactlyOnceWith('22112026');
    expect(provider.accountCard).toHaveBeenCalledExactlyOnceWith(1416);
  });
});
