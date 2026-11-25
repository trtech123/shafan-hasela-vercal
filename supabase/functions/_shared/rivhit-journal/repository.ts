import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.106.1';
import type { RivhitJournalDraft, RivhitJournalReportRow, RivhitJournalResult } from '../rivhit/types.ts';
import type { JournalSourceRow, JournalMapping } from './mapper.ts';
import { mapJournalSource } from './mapper.ts';
import { mapDailyJournalBatch } from './daily.ts';
import type { ReconciliationClaim } from './reconcile.ts';

export class SupabaseRivhitJournalStore {
  constructor(private readonly client: SupabaseClient) {}

  async overdueCounts(): Promise<{ unbatched: number; unverified: number }> {
    const { data, error } = await this.client.rpc('rivhit_journal_overdue_counts');
    const row = data?.[0];
    const unbatched = Number(row?.unbatched), unverified = Number(row?.unverified);
    if (error || !Number.isSafeInteger(unbatched) || unbatched < 0
      || !Number.isSafeInteger(unverified) || unverified < 0)
      throw new Error('journal_overdue_check_failed');
    return { unbatched, unverified };
  }

  async closingWindowOpen(): Promise<string | null> {
    const { data, error } = await this.client.from('rivhit_journal_control')
      .select('capture_enabled,posting_cadence,posting_time_israel,cutover_at')
      .eq('singleton', true).single();
    if (error) throw new Error('journal_control_unavailable');
    if (!data?.capture_enabled || data.posting_cadence !== 'daily'
      || !data.posting_time_israel || !data.cutover_at) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const part = (key: string) => parts.find(item => item.type === key)?.value;
    const localTime = `${part('hour')}:${part('minute')}:${part('second')}`;
    if (localTime < data.posting_time_israel) return null;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  async stageDaily(sources: JournalSourceRow[], mapping: JournalMapping,
    batchId: string, postingDay: string): Promise<string> {
    const mapped = await mapDailyJournalBatch(sources, mapping, batchId, postingDay);
    const { data, error } = await this.client.rpc('stage_rivhit_daily_batch', {
      p_batch_id: mapped.batchId, p_posting_day: mapped.postingDay,
      p_source_ids: mapped.sourceIds, p_mapping_version: mapped.mappingVersion,
      p_request_payload: mapped.draft, p_payload_hash: mapped.payloadHash,
      p_expected_vat: mapped.expectedVat,
    });
    if (error || typeof data !== 'string') throw new Error('journal_daily_stage_failed');
    return data;
  }

  async listDailyEligible(limit: number, postingDay: string): Promise<JournalSourceRow[]> {
    const { data, error } = await this.client.rpc('rivhit_daily_eligible_sources', {
      p_day: postingDay, p_limit: limit,
    });
    if (error) throw new Error('journal_source_list_failed');
    return (data ?? []) as JournalSourceRow[];
  }

  async deferMany(ids: string[], reason: string): Promise<number> {
    const { data, error } = await this.client.rpc('defer_rivhit_daily_sources', {
      p_source_ids: ids, p_reason: reason,
    });
    if (error || !Number.isSafeInteger(data) || data < 0 || data > ids.length)
      throw new Error('journal_defer_failed');
    return data;
  }

  async batchForSources(ids: string[]): Promise<string | null> {
    const { data, error } = await this.client.rpc('rivhit_daily_batch_for_sources', {
      p_source_ids: ids,
    });
    if (error || (data !== null && typeof data !== 'string'))
      throw new Error('journal_batch_lookup_failed');
    return data;
  }

  async listUnmapped(limit: number): Promise<JournalSourceRow[]> {
    const { data, error } = await this.client.from('rivhit_journal_sources')
      .select('id,payper_document_number,source_facts,captured_at')
      .eq('state', 'mapping_required')
      .lte('next_mapping_check_at', new Date().toISOString())
      .order('next_mapping_check_at', { ascending: true }).limit(limit);
    if (error) throw new Error('journal_source_list_failed');
    return (data ?? []) as JournalSourceRow[];
  }

  async defer(sourceId: string): Promise<void> {
    await this.transition('defer_rivhit_journal_source', { p_source_id: sourceId });
  }

  async stage(source: JournalSourceRow, mapping: JournalMapping): Promise<string> {
    const mapped = await mapJournalSource(source, mapping);
    const { data, error } = await this.client.rpc('stage_rivhit_journal_entry', {
      p_source_id: source.id, p_entry_key: mapped.entryKey,
      p_mapping_version: mapped.mappingVersion,
      p_request_reference: mapped.requestReference,
      p_request_payload: mapped.draft, p_payload_hash: mapped.payloadHash,
      p_expected_vat: mapped.expectedVat,
    });
    if (error || typeof data !== 'string') throw new Error('journal_stage_failed');
    return data;
  }

  async listReady(limit: number): Promise<string[]> {
    const { data, error } = await this.client.from('rivhit_journal_entries')
      .select('id').eq('status', 'ready').not('batch_id', 'is', null)
      .order('created_at', { ascending: true }).limit(limit);
    if (error) throw new Error('journal_queue_list_failed');
    return (data ?? []).map(row => String(row.id));
  }

  async listPending(limit: number): Promise<string[]> {
    const before = new Date(Date.now() - 120_000).toISOString();
    const { data, error } = await this.client.from('rivhit_journal_entries')
      .select('id').not('batch_id', 'is', null)
      .in('status', ['reserved', 'response_saved', 'reconciliation_required'])
      .lt('dispatch_reserved_at', before)
      .lte('next_reconciliation_check_at', new Date().toISOString())
      .order('next_reconciliation_check_at', { ascending: true }).limit(limit);
    if (error) throw new Error('journal_reconciliation_list_failed');
    return (data ?? []).map(row => String(row.id));
  }

  async inspect(id: string): Promise<ReconciliationClaim | null> {
    const { data, error } = await this.client.from('rivhit_journal_entries')
      .select('id,request_payload,expected_vat,status,provider_year,provider_month,provider_line')
      .eq('id', id).maybeSingle();
    if (error) throw new Error('journal_read_failed');
    if (!data) return null;
    return { id: data.id, draft: data.request_payload as RivhitJournalDraft,
      expectedVat: Number(data.expected_vat), status: data.status,
      providerYear: data.provider_year, providerMonth: data.provider_month,
      providerLine: data.provider_line };
  }

  noteCandidate(id: string, journalId: number, reason: string): Promise<void> {
    return this.transition('record_rivhit_journal_reconciliation', {
      p_entry_id: id, p_report_journal_id: journalId, p_reason: reason,
    });
  }

  async claim(id: string): Promise<{ id: string; draft: RivhitJournalDraft; expectedVat: number } | null> {
    const { data, error } = await this.client.from('rivhit_journal_entries')
      .select('id,batch_id,request_payload,expected_vat,status').eq('id', id).maybeSingle();
    if (error) throw new Error('journal_read_failed');
    if (!data || !data.batch_id || data.status !== 'ready') return null;
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
