import type { RivhitJournalDraft } from '../rivhit/types.ts';

export interface JournalSourceRow {
  id: string;
  payper_document_number: string;
  captured_at: string;
  source_facts: {
    provider?: string; amount?: number; currency?: string; receiptNumber?: string;
    site?: string | null; vatApplicable?: boolean | null;
  };
}

export interface JournalMapping {
  version: string;
  provider: 'pelecard' | 'manual_cash' | 'manual_check';
  site: 'עכו' | 'טבריה' | 'נוף הגליל' | 'שטח' | 'פודטראק' | 'קפה אקסטרים' | 'ויה פרטה';
  sortCode: number;
  debitAccount: number;
  creditAccount: number;
  vatRateBasisPoints: number;
  accountingDate: 'capture_israel_date';
  projectId?: number;
}

function minor(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) && Math.abs(value * 100 - cents) < 1e-7 ? cents : null;
}

function israelDate(iso: string): string {
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant)) throw new Error('journal_mapping_evidence_incomplete');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(instant);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  const day = part('day'), month = part('month'), year = part('year');
  if (!day || !month || !year) throw new Error('journal_mapping_evidence_incomplete');
  return `${day}${month}${year}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** No default accounts or tax rates: a version approved in the DB is required at staging. */
export async function mapJournalSource(source: JournalSourceRow, mapping: JournalMapping) {
  if (!source.source_facts.site?.trim()) throw new Error('journal_mapping_evidence_incomplete');
  if (!mapping.version?.trim() || !['pelecard', 'manual_cash', 'manual_check'].includes(mapping.provider)
    || ![mapping.sortCode, mapping.debitAccount, mapping.creditAccount].every(
      value => Number.isSafeInteger(value) && value > 0)
    || !Number.isSafeInteger(mapping.vatRateBasisPoints)
    || mapping.vatRateBasisPoints < 0 || mapping.vatRateBasisPoints > 10_000
    || !['עכו', 'טבריה', 'נוף הגליל', 'שטח', 'פודטראק', 'קפה אקסטרים', 'ויה פרטה'].includes(mapping.site)
    || (mapping.projectId !== undefined
      && (!Number.isSafeInteger(mapping.projectId) || mapping.projectId < 1))
    || mapping.accountingDate !== 'capture_israel_date') {
    throw new Error('journal_mapping_invalid');
  }
  if (source.source_facts.provider !== mapping.provider
    || (source.source_facts.site ?? null) !== mapping.site)
    throw new Error('journal_mapping_not_approved');
  const amountMinor = minor(source.source_facts.amount);
  const vatApplicable = source.source_facts.vatApplicable;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(source.id)
    || !source.payper_document_number?.trim() || !source.source_facts.receiptNumber?.trim()
    || source.source_facts.currency !== 'ILS' || amountMinor === null
    || typeof vatApplicable !== 'boolean'
    || vatApplicable !== (mapping.vatRateBasisPoints > 0)) {
    throw new Error('journal_mapping_evidence_incomplete');
  }
  const amount = amountMinor / 100;
  const vatMinor = Math.round(amountMinor * mapping.vatRateBasisPoints
    / (10_000 + mapping.vatRateBasisPoints));
  const entryKey = 'gross';
  const requestReference = `shafan:payper:${source.id}:${entryKey}`;
  const draft: RivhitJournalDraft = {
    sort_code: mapping.sortCode, customer_id_debit: mapping.debitAccount,
    customer_id_credit: mapping.creditAccount, amount,
    reference_date: israelDate(source.captured_at),
    reference1: source.payper_document_number,
    reference2: source.source_facts.receiptNumber,
    request_reference: requestReference,
    ...(mapping.projectId === undefined ? {} : { project_id: mapping.projectId }),
  };
  const payloadHash = await sha256(draft);
  const mappingVersion = `v1-${await sha256({ label: mapping.version, provider: mapping.provider,
    sortCode: mapping.sortCode, debitAccount: mapping.debitAccount,
    creditAccount: mapping.creditAccount, vatRateBasisPoints: mapping.vatRateBasisPoints,
    accountingDate: mapping.accountingDate, site: mapping.site,
    projectId: mapping.projectId ?? null })}`;
  return { entryKey, mappingVersion,
    requestReference, draft, payloadHash, expectedVat: vatMinor / 100 };
}
