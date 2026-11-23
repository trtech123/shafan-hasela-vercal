import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const sql = readFileSync(new URL('../../../migrations/202611230002_rivhit_future_site_evidence.sql', import.meta.url), 'utf8');

describe('future accounting site migration safety', () => {
  test('keeps legacy checkout RPCs and all existing financial rows intact', () => {
    expect(sql).toContain('unexpected_site_evidence_baseline');
    expect(sql).toContain('reserve_pos_pelecard_with_site');
    expect(sql).toContain('record_payper_noncard_sale_with_site');
    expect(sql).toContain('trg_require_site_for_quoted_order');
    expect(sql).toContain("pg_catalog.set_config('shafan.accounting_site',p_site,true)");
    expect(sql).toContain("p.checkout_snapshot->>'site'");
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE)\s+public\.(?:sales|orders|payment_transactions|rivhit_journal_sources)\b/i);
    expect(sql).not.toMatch(/\b(?:capture_enabled|posting_enabled)\s*=\s*true\b/i);
    expect(sql).toMatch(/^BEGIN;[\s\S]*COMMIT;\s*$/m);
  });
});
