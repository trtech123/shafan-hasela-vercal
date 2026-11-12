// Disposable PostgreSQL rehearsal only. Never connects to Supabase Production.
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const { default: EmbeddedPostgres } = await import(new URL(
  '../../../../.tmp/pelecard/sql-runtime/node_modules/embedded-postgres/dist/index.js', import.meta.url,
));
const databaseDir = join(tmpdir(), `shafan-physical-intents-${randomUUID()}`);
const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'postgres', password: randomUUID(), port: 57000 + Math.floor(Math.random() * 1000),
  persistent: false, initdbFlags: ['--encoding=UTF8'],
  postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {},
});
let client;
try {
  await pg.initialise(); await pg.start();
  client = pg.getPgClient(); await client.connect();
  await client.query(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT current_setting('request.jwt.claim.role',true) $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text NOT NULL);
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS
      $$ SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin') $$;
    CREATE TABLE public.cash_registers(code text PRIMARY KEY,name text NOT NULL,active boolean NOT NULL);
    CREATE TABLE public.sales(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),method text NOT NULL,
      sale_date date NOT NULL DEFAULT current_date);
    CREATE TABLE public.payment_transactions(id uuid PRIMARY KEY,provider text,operation text,order_id uuid,
      amount numeric,currency text,status text,idempotency_key text,checkout_snapshot jsonb,created_by uuid,
      provider_transaction_id text,approval_id text,sale_id uuid);
    CREATE TABLE public.payper_document_ledger(payment_id uuid UNIQUE,sale_id uuid UNIQUE,order_id uuid,
      state text,reconciliation_code text);
    CREATE FUNCTION public.finalize_pelecard_payment(p_payment_id uuid,p_provider_transaction_id text,
      p_approval_id text,p_provider_status_code text,p_amount numeric,p_currency text)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
      DECLARE sale uuid; p public.payment_transactions%ROWTYPE;
      BEGIN
        INSERT INTO public.sales(method) VALUES('digital') RETURNING id INTO sale;
        UPDATE public.payment_transactions SET status='succeeded',provider_transaction_id=p_provider_transaction_id,
          approval_id=p_approval_id,sale_id=sale WHERE id=p_payment_id RETURNING * INTO p;
        RETURN to_jsonb(p);
      END $$;
    INSERT INTO public.profiles VALUES ('10000000-0000-4000-8000-000000000001','cashier');
    INSERT INTO public.cash_registers VALUES ('FRONT','Front desk',true);
    GRANT USAGE ON SCHEMA public,auth TO service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO service_role;
  `);
  await client.query(await readFile(new URL('../../supabase/migrations/202611120001_physical_terminal_settings.sql', import.meta.url), 'utf8'));
  await client.query("UPDATE public.physical_terminal_devices SET enabled=true,cash_register_code='FRONT' WHERE register_number='004'");
  await client.query(await readFile(new URL('../../supabase/migrations/202611120002_physical_payment_intents.sql', import.meta.url), 'utf8'));
  await client.query('SET ROLE service_role');
  await client.query("SET request.jwt.claim.role='service_role'");
  const actor = '10000000-0000-4000-8000-000000000001';
  const key = randomUUID();
  const snapshot = { items: [{ id: actor, name: 'Ticket', qty: 1, customPrice: 24 }] };
  const reserve = () => client.query('SELECT public.reserve_physical_payment($1,$2,$3,$4,$5,$6) AS result',
    [actor,key,'FRONT',2400,snapshot,{}]);
  const first = (await reserve()).rows[0].result;
  assert.equal(first.registerNumber,'004');
  assert.equal((await reserve()).rows[0].result.paymentId,first.paymentId);
  assert.equal((await client.query('SELECT public.get_physical_payment_by_request($1,$2) AS result',
    [actor,key])).rows[0].result.paymentId,first.paymentId);
  assert.equal((await client.query('SELECT public.get_physical_worker_intent($1) AS result',
    [first.paymentId])).rows[0].result.register,'004');
  await assert.rejects(client.query('SELECT public.reserve_physical_payment($1,$2,$3,$4,$5,$6)',
    [actor,randomUUID(),'FRONT',2400,snapshot,{}]), /physical_one_unresolved_per_register/);
  await assert.rejects(client.query('SELECT public.reserve_physical_payment($1,$2,$3,$4,$5,$6)',
    [actor,randomUUID(),'FRONT',2500,snapshot,{}]), /physical_amount_mismatch/);
  assert.equal((await client.query('SELECT public.claim_physical_dispatch($1) AS claimed',[first.paymentId])).rows[0].claimed,true);
  assert.equal((await client.query('SELECT public.claim_physical_dispatch($1) AS claimed',[first.paymentId])).rows[0].claimed,false);
  await assert.rejects(client.query('SELECT public.finalize_physical_payment($1)',[first.paymentId]), /physical_approval_required/);
  await client.query('SELECT public.mark_physical_uncertain($1)',[first.paymentId]);
  const approved = { intentId:first.paymentId,merchantTerminal:'2814926015',register:'004',
    amountMinor:2400,status:'approved',transactionId:'trx-1',approvalId:'approval-1' };
  await assert.rejects(client.query('SELECT public.observe_physical_result($1,$2)',
    [first.paymentId,{...approved,register:'005'}]), /physical_result_mismatch/);
  await client.query('SELECT public.observe_physical_result($1,$2)',[first.paymentId,approved]);
  const finalized = (await client.query('SELECT public.finalize_physical_payment($1) AS result',[first.paymentId])).rows[0].result;
  assert.equal(finalized.state,'succeeded');
  assert.equal((await client.query('SELECT public.finalize_physical_payment($1) AS result',[first.paymentId])).rows[0].result.saleId,finalized.saleId);
  const declined = (await client.query('SELECT public.reserve_physical_payment($1,$2,$3,$4,$5,$6) AS result',
    [actor,randomUUID(),'FRONT',2400,snapshot,{}])).rows[0].result;
  await client.query('SELECT public.claim_physical_dispatch($1)',[declined.paymentId]);
  await client.query('SELECT public.observe_physical_result($1,$2)',[declined.paymentId,{
    intentId:declined.paymentId,merchantTerminal:'2814926015',register:'004',amountMinor:2400,
    status:'declined',transactionId:'trx-2',
  }]);
  await assert.rejects(client.query('SELECT public.finalize_physical_payment($1)',[declined.paymentId]), /physical_approval_required/);
  await client.query('RESET ROLE');
  assert.equal((await client.query('SELECT count(*)::integer AS n FROM public.sales')).rows[0].n,1);
  const accounting = (await client.query('SELECT payment_id,sale_id,state,reconciliation_code FROM public.payper_document_ledger')).rows;
  assert.deepEqual(accounting,[{payment_id:first.paymentId,sale_id:finalized.saleId,
    state:'source_blocked',reconciliation_code:'physical_provider_confirmation_required'}]);
  console.log('PASS physical intents: one register lock, one dispatch, correlated approval, one sale');
} finally {
  if (client) await client.end();
  // embedded-postgres stop() waits forever for a child exit event on Windows.
  // Terminate this script's disposable child, then remove only its verified temp dir.
  if (pg.process?.pid) {
    const stopped = spawnSync('taskkill', ['/PID', String(pg.process.pid), '/T', '/F'], { timeout: 5000 });
    if (stopped.error) console.error('Embedded PostgreSQL shutdown:', stopped.error.message);
  }
  const target = resolve(databaseDir);
  if (target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith('shafan-physical-intents-'))
    await rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
}
// The Windows embedded-postgres package retains a child-process handle after
// shutdown. Reaching this line means every assertion and cleanup succeeded.
process.exit(0);
