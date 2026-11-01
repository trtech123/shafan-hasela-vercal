// Disposable in-memory PostgreSQL rehearsal. No remote connection or credentials.
// Install once: npm install --prefix .tmp/payment-db --save-exact @electric-sql/pglite@0.5.8
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = new URL('../../', import.meta.url);
const { PGlite } = await import(new URL('.tmp/payment-db/node_modules/@electric-sql/pglite/dist/index.js', root));
const db = new PGlite();
const order = '10000000-0000-4000-8000-000000000001';
const activity = '20000000-0000-4000-8000-000000000001';
const snapshot = (name) => JSON.stringify({ schema_version: 1,
  items: [{ id: order, name, qty: 1, customPrice: 118 }],
  linked_order_info: { order_number: 'ORD-1' } });
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS
      $$ SELECT current_setting('request.jwt.claim.role', true) $$;
    CREATE TABLE public.activities(id uuid PRIMARY KEY,name text);
    CREATE TABLE public.orders(id uuid PRIMARY KEY,order_number text,activity_id uuid);
    CREATE TABLE public.payment_transactions(id uuid PRIMARY KEY,provider text,operation text,
      status text,order_id uuid,checkout_snapshot jsonb);
    CREATE TABLE public.payper_document_ledger(id uuid DEFAULT gen_random_uuid(),payment_id uuid PRIMARY KEY,order_id uuid,
      state text,reconciliation_code text,updated_at timestamptz);
    CREATE FUNCTION public.reserve_payper_dispatch(p_payment_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$
    DECLARE reservation uuid;
    BEGIN
      UPDATE public.payper_document_ledger SET state='dispatch_reserved'
      WHERE payment_id=p_payment_id AND state='source_frozen' RETURNING id INTO reservation;
      IF reservation IS NULL THEN RAISE EXCEPTION 'dispatch_fence'; END IF;
      RETURN reservation;
    END $$;
    CREATE FUNCTION public.capture_payper_eligible_payment() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.status='succeeded' THEN
        INSERT INTO public.payper_document_ledger(payment_id,order_id,state)
        VALUES(NEW.id,NEW.order_id,'eligible') ON CONFLICT DO NOTHING;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER trg_payper_eligible_payment AFTER INSERT OR UPDATE OF status
      ON public.payment_transactions FOR EACH ROW
      EXECUTE FUNCTION public.capture_payper_eligible_payment();
    INSERT INTO public.activities VALUES('${activity}','Climbing service');
    INSERT INTO public.orders VALUES('${order}','ORD-1','${activity}');`);
  await db.query(`INSERT INTO public.payment_transactions VALUES($1,'pelecard','payment','initiated',$2,$3::jsonb)`,
    ['30000000-0000-4000-8000-000000000001', order, snapshot('ORD-1')]);
  await db.exec(await readFile(new URL('supabase/migrations/202611010001_payper_order_service_description.sql', root), 'utf8'));
  const historic = await db.query(`SELECT checkout_snapshot->'items'->0->>'name' AS name FROM public.payment_transactions
    WHERE id='30000000-0000-4000-8000-000000000001'`);
  assert.equal(historic.rows[0].name, 'ORD-1', 'migration changed a historical payment');
  await db.query(`INSERT INTO public.payment_transactions VALUES($1,'pelecard','payment','initiated',$2,$3::jsonb)`,
    ['30000000-0000-4000-8000-000000000002', order, snapshot('ORD-1')]);
  const fresh = await db.query(`SELECT checkout_snapshot->'items'->0->>'name' AS name FROM public.payment_transactions
    WHERE id='30000000-0000-4000-8000-000000000002'`);
  assert.equal(fresh.rows[0].name, 'Climbing service');
  await db.exec(`UPDATE public.payment_transactions SET status='succeeded'
    WHERE id='30000000-0000-4000-8000-000000000002'`);
  assert.equal((await db.query(`SELECT state FROM public.payper_document_ledger
    WHERE payment_id='30000000-0000-4000-8000-000000000002'`)).rows[0].state, 'eligible');
  await db.exec(`UPDATE public.orders SET activity_id=NULL WHERE id='${order}'`);
  await db.query(`INSERT INTO public.payment_transactions VALUES($1,'pelecard','payment','initiated',$2,$3::jsonb)`,
    ['30000000-0000-4000-8000-000000000003', order, snapshot('ORD-1')]);
  const missing = await db.query(`SELECT checkout_snapshot->'items'->0->>'name' AS name FROM public.payment_transactions
    WHERE id='30000000-0000-4000-8000-000000000003'`);
  assert.equal(missing.rows[0].name, 'ORD-1', 'missing description blocked payment reservation');
  await db.exec(`UPDATE public.payment_transactions SET status='succeeded'
    WHERE id='30000000-0000-4000-8000-000000000003'`);
  const held = await db.query(`SELECT state,reconciliation_code FROM public.payper_document_ledger
    WHERE payment_id='30000000-0000-4000-8000-000000000003'`);
  assert.deepEqual(held.rows[0], { state: 'source_blocked', reconciliation_code: 'service_description_required' });
  await db.query(`INSERT INTO public.payment_transactions VALUES($1,'pelecard','payment','initiated',$2,'{}'::jsonb)`,
    ['30000000-0000-4000-8000-000000000004', order]);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.payment_transactions`)).rows[0].n, 4);
  await db.exec(`SELECT set_config('request.jwt.claim.role','service_role',false);
    UPDATE public.payper_document_ledger SET state='source_frozen'
    WHERE payment_id='30000000-0000-4000-8000-000000000002';
    SELECT public.reserve_payper_dispatch('30000000-0000-4000-8000-000000000002','103059585');`);
  assert.deepEqual((await db.query(`SELECT state,provider_trx_record_id FROM public.payper_document_ledger
    WHERE payment_id='30000000-0000-4000-8000-000000000002'`)).rows[0],
    { state: 'dispatch_reserved', provider_trx_record_id: '103059585' });
  await db.exec(`INSERT INTO public.payper_document_ledger(payment_id,order_id,state)
    VALUES('30000000-0000-4000-8000-000000000004','${order}','source_frozen')`);
  await assert.rejects(db.query(`SELECT public.reserve_payper_dispatch(
    '30000000-0000-4000-8000-000000000004','103059585')`));
  await assert.rejects(db.query(`SELECT public.reserve_payper_dispatch(
    '30000000-0000-4000-8000-000000000004')`));
  assert.deepEqual((await db.query(`SELECT state,provider_trx_record_id FROM public.payper_document_ledger
    WHERE payment_id='30000000-0000-4000-8000-000000000004'`)).rows[0],
    { state: 'source_frozen', provider_trx_record_id: null });
  console.log('PASS historical unchanged, description review, atomic transaction reference, cross-payment duplicate fence');
} catch (error) {
  console.error(`FAIL payper description rehearsal: ${error.message} (code ${error.code ?? 'unknown'}, position ${error.position ?? 'unknown'})`);
  process.exitCode = 1;
} finally { await db.close(); }
