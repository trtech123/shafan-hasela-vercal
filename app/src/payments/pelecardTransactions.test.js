import { describe, expect, test, vi } from 'vitest';
import { requestPelecardTransactions } from './pelecardTransactions';

vi.mock('@/api/supabaseClient', () => ({ supabase: {} }));

const body = { action: 'lookup', transactionId: '12345' };
const client = (token) => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: token ? { access_token: token } : null } }) } });

describe('read-only Pelecard transaction request', () => {
  test('requires a session before calling the server', async () => {
    const fetcher = vi.fn();
    await expect(requestPelecardTransactions(body, undefined, client(null), fetcher)).rejects.toThrow('unauthorized');
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('sends only the selected lookup to the existing admin endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ transactions: [] }) });
    await expect(requestPelecardTransactions(body, undefined, client('synthetic-token'), fetcher)).resolves.toEqual({ transactions: [] });
    expect(fetcher).toHaveBeenCalledWith('/api/pelecard-transactions', expect.objectContaining({
      method: 'POST', cache: 'no-store', body: JSON.stringify(body),
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-token' }),
    }));
  });

  test('does not silently accept oversized provider results', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ transactions: Array(501).fill({}) }) });
    await expect(requestPelecardTransactions(body, undefined, client('synthetic-token'), fetcher)).rejects.toThrow('invalid_provider_response');
  });
});
