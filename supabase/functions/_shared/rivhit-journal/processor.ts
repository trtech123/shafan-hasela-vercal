import type {
  RivhitJournalDraft, RivhitJournalReportRow, RivhitJournalResult,
} from "../rivhit/types.ts";

export interface ClaimedJournal {
  id: string;
  draft: RivhitJournalDraft;
  expectedVat: number;
}

interface JournalStore {
  claim(id: string): Promise<ClaimedJournal | null>;
  reserve(id: string): Promise<boolean>;
  recordResponse(id: string, result: RivhitJournalResult): Promise<void>;
  verify(id: string, row: RivhitJournalReportRow): Promise<void>;
  hold(id: string, reason: string): Promise<void>;
}

interface JournalProvider {
  journalsReport(date: string): Promise<RivhitJournalReportRow[]>;
  addJournal(draft: RivhitJournalDraft): Promise<RivhitJournalResult>;
}

function sameMoney(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.round(a * 100) === Math.round(b * 100);
}

function journalDate(value: string | null | undefined): string | null {
  const match = typeof value === 'string'
    ? /^(\d{2})(\d{2})(\d{4})$/.exec(value)
      ?? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
    : null;
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1
    || date.getUTCFullYear() !== year) return null;
  return `${match[1]}${match[2]}${match[3]}`;
}

export function sameEntry(row: RivhitJournalReportRow, claim: ClaimedJournal): boolean {
  const { draft, expectedVat } = claim;
  const reportDate = journalDate(row.reference_date);
  return row.reference1 === draft.reference1
    && row.reference2 === draft.reference2
    && row.sort_code === draft.sort_code
    && row.debit_customer_id === draft.customer_id_debit
    && row.credit_customer_id === (draft.customer_id_credit ?? null)
    && reportDate !== null && reportDate === journalDate(draft.reference_date)
    && sameMoney(row.total_amount, draft.amount)
    && sameMoney(row.total_vat ?? NaN, expectedVat);
}

function sameReference(row: RivhitJournalReportRow, draft: RivhitJournalDraft): boolean {
  return row.reference1 === draft.reference1 || row.reference2 === draft.reference2;
}

/** One claim can submit at most once. A reserved or uncertain claim must be reconciled, never retried. */
export async function processRivhitJournal(
  eventId: string,
  dependencies: { store: JournalStore; provider: JournalProvider },
): Promise<"already_claimed" | "existing_match" | "verified" | "uncertain" | "reconciliation_required"> {
  const { store, provider } = dependencies;
  const claim = await store.claim(eventId);
  if (!claim) return "already_claimed";
  const date = claim.draft.reference_date;
  if (!date || !claim.draft.reference1 || !claim.draft.reference2
    || !Number.isFinite(claim.expectedVat)) {
    await store.hold(eventId, "source_evidence_incomplete");
    return "reconciliation_required";
  }
  let before: RivhitJournalReportRow[];
  try {
    before = await provider.journalsReport(date);
  } catch {
    await store.hold(eventId, "preflight_unavailable");
    return "reconciliation_required";
  }
  const related = before.filter(row => sameReference(row, claim.draft));
  if (related.length === 1 && sameEntry(related[0], claim)) {
    await store.hold(eventId, "manual_existing_match");
    return "existing_match";
  }
  if (related.length > 0) {
    await store.hold(eventId, "existing_reference_conflict");
    return "reconciliation_required";
  }
  if (!await store.reserve(eventId)) return "already_claimed";
  let result: RivhitJournalResult;
  try {
    result = await provider.addJournal(claim.draft);
  } catch {
    await store.hold(eventId, "provider_outcome_uncertain");
    return "uncertain";
  }
  await store.recordResponse(eventId, result);
  let after: RivhitJournalReportRow[];
  try {
    after = await provider.journalsReport(date);
  } catch {
    await store.hold(eventId, "readback_unavailable");
    return "reconciliation_required";
  }
  const matches = after.filter(row => sameReference(row, claim.draft));
  if (matches.length === 1 && sameEntry(matches[0], claim)
    && matches[0].journal_year === result.year
    && matches[0].journal_month === result.month) {
    await store.verify(eventId, matches[0]);
    return "verified";
  }
  await store.hold(eventId, matches.length === 0 ? "readback_missing" : "readback_conflict");
  return "reconciliation_required";
}
