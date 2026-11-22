import type { RivhitJournalReportRow } from '../rivhit/types.ts';
import { sameEntry, type ClaimedJournal } from './processor.ts';

export interface ReconciliationClaim extends ClaimedJournal {
  status: string;
  providerYear: number | null;
  providerMonth: number | null;
  providerLine: number | null;
}

/** Readback never calls AddJournal, including after a lost response or process crash. */
export async function reconcileRivhitJournal(id: string, dependencies: {
  store: {
    inspect(id: string): Promise<ReconciliationClaim | null>;
    verify(id: string, row: RivhitJournalReportRow): Promise<void>;
    noteCandidate(id: string, journalId: number, reason: string): Promise<void>;
    hold(id: string, reason: string): Promise<void>;
  };
  provider: { journalsReport(date: string): Promise<RivhitJournalReportRow[]> };
}): Promise<'not_pending' | 'no_match' | 'verified' | 'candidate_requires_review' | 'conflict'> {
  const claim = await dependencies.store.inspect(id);
  if (!claim || !['reserved', 'response_saved', 'reconciliation_required'].includes(claim.status))
    return 'not_pending';
  const rows = await dependencies.provider.journalsReport(claim.draft.reference_date ?? '');
  const related = rows.filter(row => row.reference1 === claim.draft.reference1
    || row.reference2 === claim.draft.reference2);
  if (!related.length) {
    await dependencies.store.hold(id, 'readback_missing');
    return 'no_match';
  }
  const exact = related.filter(row => sameEntry(row, claim));
  if (related.length !== 1 || exact.length !== 1) {
    await dependencies.store.noteCandidate(id, related[0].journal_id, 'readback_conflict');
    return 'conflict';
  }
  if (claim.providerYear === exact[0].journal_year
    && claim.providerMonth === exact[0].journal_month
    && claim.providerLine !== null) {
    await dependencies.store.verify(id, exact[0]);
    return 'verified';
  }
  await dependencies.store.noteCandidate(id, exact[0].journal_id, 'candidate_without_response');
  return 'candidate_requires_review';
}
