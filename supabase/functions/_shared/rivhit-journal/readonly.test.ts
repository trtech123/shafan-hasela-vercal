import { describe, expect, test, vi } from 'vitest';
import { createRivhitReadOnlyHandler } from './readonly.ts';

const request = (body: unknown, token = 'valid-user') => new Request('https://example.invalid/read', {
  method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {},
  body: JSON.stringify(body),
});

describe('authenticated read-only Rivhit API', () => {
  test('rejects missing, invalid and non-admin sessions before provider access', async () => {
    const provider = { sortCodeList: vi.fn(), journalsReport: vi.fn() };
    const authorize = vi.fn(async (token: string) => token === 'valid-user' ? 'admin'
      : token === 'cashier-user' ? 'cashier' : null);
    const handler = createRivhitReadOnlyHandler({ authorize, provider });
    expect((await handler(request({ operation: 'sort_codes' }, ''))).status).toBe(401);
    expect((await handler(request({ operation: 'sort_codes' }, 'bad'))).status).toBe(401);
    expect((await handler(request({ operation: 'sort_codes' }, 'cashier-user'))).status).toBe(403);
    expect(provider.sortCodeList).not.toHaveBeenCalled();
  });

  test('only approved read operations can reach Rivhit', async () => {
    const provider = { sortCodeList: vi.fn().mockResolvedValue([{ sort_code: 12, description: 'test' }]),
      journalsReport: vi.fn().mockResolvedValue([]) };
    const handler = createRivhitReadOnlyHandler({ authorize: async () => 'admin', provider });
    expect((await handler(request({ operation: 'sort_codes' }))).status).toBe(200);
    expect((await handler(request({ operation: 'journal_report', date: '22112026' }))).status).toBe(200);
    expect((await handler(request({ operation: 'add_journal' }))).status).toBe(400);
    expect(provider.sortCodeList).toHaveBeenCalledOnce();
    expect(provider.journalsReport).toHaveBeenCalledExactlyOnceWith('22112026');
  });
});
