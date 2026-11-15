import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const migration = readFileSync(new URL('../../../../supabase/migrations/202611150002_physical_order_collection.sql', import.meta.url), 'utf8');

describe('physical order collection migration contract', () => {
  test('locks the saved order and checks its ledger balance before J4 reservation', () => {
    expect(migration).toMatch(/CREATE FUNCTION public\.reserve_physical_order_payment/);
    expect(migration).toMatch(/FROM public\.orders WHERE id=p_order_id FOR UPDATE/);
    expect(migration).toMatch(/p_amount_minor::numeric\/100>balance/);
    expect(migration).toMatch(/INSERT INTO public\.payment_transactions\([\s\S]*?order_id/);
  });
  test('links the verified sale and blocked document to the existing order', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.finalize_physical_payment/);
    expect(migration).toMatch(/SET payment_status=CASE WHEN/);
    expect(migration).toMatch(/VALUES\(NEW\.id,NEW\.order_id,NEW\.sale_id,'source_blocked'/);
    expect(migration).not.toMatch(/CreatePayperInvoice|DebitRegularType/);
  });
});
