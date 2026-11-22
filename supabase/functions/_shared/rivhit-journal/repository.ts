import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.106.1';
import type { RivhitJournalDraft, RivhitJournalReportRow, RivhitJournalResult } from '../rivhit/types.ts';

export class SupabaseRivhitJournalStore {
  constructor(private readonly client: SupabaseClient) {}

  async claim(id: string): Promise<{ id: string; draft: RivhitJournalDraft; expectedVat: number } | null> {
    const { data, error } = await this.client.from('rivhit_journal_entries')
      .select('id,request_payload,expected_vat,status').eq('id', id).maybeSingle();
    if (error) throw new Error('journal_read_failed');
    if (!data || data.status !== 'ready') return null;
    return { id: data.id, draft: data.request_payload as RivhitJournalDraft,
      expectedVat: Number(data.expected_vat) };
  }

  async reserve(id: string): Promise<boolean> {
    const { data, error } = await this.client.rpc('reserve_rivhit_journal_entry', { p_entry_id: id });
    if (error) throw new Error('journal_reservation_failed');
    return data !== null && data?.id === id;
  }

  private async transition(name: string, args: Record<string, unknown>): Promise<void> {
    const { data, error } = await this.client.rpc(name, args);
    if (error || data !== true) throw new Error('journal_transition_failed');
  }

  recordResponse(id: string, result: RivhitJournalResult): Promise<void> {
    return this.transition('record_rivhit_journal_response', {
      p_entry_id: id, p_year: result.year, p_month: result.month, p_line: result.line,
    });
  }

  verify(id: string, row: RivhitJournalReportRow): Promise<void> {
    return this.transition('verify_rivhit_journal_entry', {
      p_entry_id: id, p_journal_id: row.journal_id,
    });
  }

  hold(id: string, reason: string): Promise<void> {
    return this.transition('hold_rivhit_journal_entry', { p_entry_id: id, p_reason: reason });
  }
}
