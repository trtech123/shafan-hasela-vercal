import { describe, expect, test } from 'vitest';
import { mapJournalSource } from './mapper.ts';

const source = {
  id: '00000000-0000-4000-8000-000000000001',
  payper_document_number: '200010',
  source_facts: { provider: 'pelecard', site: 'עכו', amount: 118, currency: 'ILS',
    receiptNumber: 'RCP-2000', vatApplicable: true },
  captured_at: '2026-11-22T12:30:00Z',
};
const mapping = {
  version: 'anat-approved-v1', provider: 'pelecard', site: 'עכו', sortCode: 12,
  debitAccount: 101, creditAccount: 201, vatRateBasisPoints: 1800,
  accountingDate: 'capture_israel_date' as const,
};

describe('future-only journal mapper', () => {
  test('builds one deterministic, correlated request from an approved synthetic mapping', async () => {
    const first = await mapJournalSource(source, mapping);
    const second = await mapJournalSource(source, mapping);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ entryKey: 'gross',
      expectedVat: 18, draft: { amount: 118, sort_code: 12,
        customer_id_debit: 101, customer_id_credit: 201,
        reference1: '200010', reference2: 'RCP-2000', reference_date: '22112026' } });
    expect(first.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.mappingVersion).toMatch(/^v1-[0-9a-f]{64}$/);
  });

  test('rejects missing VAT evidence, unsupported provider, and fractional agorot', async () => {
    await expect(mapJournalSource({ ...source, source_facts: {
      ...source.source_facts, vatApplicable: null,
    } }, mapping)).rejects.toThrow('journal_mapping_evidence_incomplete');
    await expect(mapJournalSource({ ...source, source_facts: {
      ...source.source_facts, provider: 'manual_cash',
    } }, mapping)).rejects.toThrow('journal_mapping_not_approved');
    await expect(mapJournalSource({ ...source, source_facts: {
      ...source.source_facts, amount: 118.001,
    } }, mapping)).rejects.toThrow('journal_mapping_evidence_incomplete');
  });

  test('rejects unapproved or malformed account rules before a journal can be staged', async () => {
    await expect(mapJournalSource(source, { ...mapping, debitAccount: 0 }))
      .rejects.toThrow('journal_mapping_invalid');
    await expect(mapJournalSource(source, { ...mapping, vatRateBasisPoints: -1 }))
      .rejects.toThrow('journal_mapping_invalid');
  });

  test('blocks a source without an authoritative site even if a null-site mapping is supplied', async () => {
    await expect(mapJournalSource({ ...source, source_facts: { ...source.source_facts, site: null } },
      { ...mapping, site: null })).rejects.toThrow('journal_mapping_evidence_incomplete');
  });
});
