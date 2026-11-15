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
  test('allows only a correlated physical reservation past the hosted partial guard', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.guard_hosted_after_noncard_partial/);
    expect(migration).toMatch(/NEW\.idempotency_key='physical-'\|\|NEW\.id::text/);
    expect(migration).toMatch(/NEW\.checkout_snapshot->'source_order'->>'orderId'=NEW\.order_id::text/);
  });
  test('blocks ambiguous legacy links and settled order statuses', () => {
    expect(migration).toMatch(/s\.linked_order_info->>'order_number'=o\.order_number/);
    expect(migration).toMatch(/t\.checkout_snapshot->'linked_order_info'->>'order_number'=o\.order_number/);
    expect(migration).toMatch(/o\.payment_status NOT IN \('לא שולם','שולם חלקית'\)/);
  });
  test('matches an already issued physical document after verified approval', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.record_physical_payper_manual_document/);
    expect(migration).toMatch(/p_issued_at < p\.created_at/);
    expect(migration).toMatch(/i\.provider_transaction_id IS DISTINCT FROM p\.provider_transaction_id/);
    expect(migration).toMatch(/'providerIssuedAutomatically',true/);
    expect(migration).not.toMatch(/p_issued_at < p\.verified_at/);
  });
});
