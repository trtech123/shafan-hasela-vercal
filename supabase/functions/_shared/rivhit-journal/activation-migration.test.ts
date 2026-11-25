import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const sql = readFileSync(new URL('../../../migrations/202611250001_rivhit_journal_activation_guards.sql', import.meta.url), 'utf8');

describe('prepared Rivhit activation guards', () => {
  test('requires disabled, empty journal state and leaves both gates unchanged', () => {
    expect(sql).toContain('rivhit_journal_activation_preflight_failed');
    expect(sql).toMatch(/WHERE capture_enabled OR posting_enabled OR cutover_at IS NOT NULL/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM public\.rivhit_journal_approved_mappings\)/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM public\.rivhit_journal_sources\)/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM public\.rivhit_journal_entries\)/);
    expect(sql).toMatch(/CHECK \(NOT capture_enabled OR cutover_at IS NOT NULL\)/);
    expect(sql).not.toMatch(/^\s*(?:UPDATE|INSERT|DELETE)\s+/im);
    expect(sql).toMatch(/^BEGIN;[\s\S]*COMMIT;\s*$/m);
  });
});
