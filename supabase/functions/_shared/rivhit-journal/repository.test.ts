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
});
