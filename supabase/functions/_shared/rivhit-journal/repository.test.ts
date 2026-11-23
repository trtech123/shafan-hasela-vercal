import { describe, expect, test, vi } from 'vitest';
import { SupabaseRivhitJournalStore } from './repository.ts';

describe('Rivhit journal database transitions', () => {
  test('does not dispatch when the atomic reservation loses a race', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const store = new SupabaseRivhitJournalStore({ rpc } as never);
    await expect(store.reserve('entry-1')).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith('reserve_rivhit_journal_entry', { p_entry_id: 'entry-1' });
  });

  test('fails closed when a response cannot be saved', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const store = new SupabaseRivhitJournalStore({ rpc } as never);
    await expect(store.recordResponse('entry-1', { year: 2026, month: 11, line: 42 }))
      .rejects.toThrow('journal_transition_failed');
  });

  test('stages one mapped source through the restricted RPC with no provider token', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'entry-1', error: null });
    const store = new SupabaseRivhitJournalStore({ rpc } as never);
    const id = await store.stage({
      id: '00000000-0000-4000-8000-000000000001',
      payper_document_number: '200010', captured_at: '2026-11-22T12:30:00Z',
      source_facts: { provider: 'pelecard', site: 'עכו', amount: 118, currency: 'ILS',
        receiptNumber: 'RCP-2000', vatApplicable: true },
    }, { version: 'synthetic', provider: 'pelecard', site: 'עכו',
      sortCode: 12, debitAccount: 101, creditAccount: 201,
      vatRateBasisPoints: 1800, accountingDate: 'capture_israel_date' });
    expect(id).toBe('entry-1');
    expect(rpc).toHaveBeenCalledWith('stage_rivhit_journal_entry', expect.objectContaining({
      p_request_payload: expect.objectContaining({ reference1: '200010', reference2: 'RCP-2000' }),
      p_expected_vat: 18,
    }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('api_token');
  });
});
