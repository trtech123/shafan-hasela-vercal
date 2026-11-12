// Disposable loopback PostgreSQL proof; never connects to Supabase Production.
// Install embedded-postgres in the repository's .tmp/pelecard/sql-runtime first.
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const { default: EmbeddedPostgres } = await import(new URL(
  '../../../../.tmp/pelecard/sql-runtime/node_modules/embedded-postgres/dist/index.js', import.meta.url,
));
const pg = new EmbeddedPostgres({
  databaseDir: join(tmpdir(), `shafan-physical-settings-${randomUUID()}`),
  user: 'postgres', password: randomUUID(), port: 56000 + Math.floor(Math.random() * 1000),
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
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text NOT NULL);
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS
      $$ SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin') $$;
    CREATE TABLE public.cash_registers(code text PRIMARY KEY,name text NOT NULL,active boolean NOT NULL);
    INSERT INTO public.profiles VALUES
      ('10000000-0000-4000-8000-000000000001','admin'),
      ('10000000-0000-4000-8000-000000000002','cashier');
    INSERT INTO public.cash_registers VALUES
      ('FRONT','Front desk',true),('BACK','Back desk',true),('CLOSED','Closed',false);
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(),public.is_admin() TO authenticated;
  `);
  await client.query(await readFile(new URL('../../supabase/migrations/202611120001_physical_terminal_settings.sql', import.meta.url), 'utf8'));
  const seeded = await client.query('SELECT register_number,model,enabled,cash_register_code FROM public.physical_terminal_devices ORDER BY register_number');
  assert.deepEqual(seeded.rows, [
    { register_number: '003', model: 'N86', enabled: false, cash_register_code: null },
    ...['004','005','006'].map(register_number => ({ register_number, model: 'CT20', enabled: false, cash_register_code: null })),
  ]);
  await client.query('SET ROLE authenticated');
  await client.query("SET request.jwt.claim.sub='10000000-0000-4000-8000-000000000002'");
  await assert.rejects(client.query('SELECT public.list_physical_terminal_settings()'), /administrator_required/);
  await assert.rejects(client.query("UPDATE public.physical_terminal_devices SET enabled=true WHERE register_number='003'"), /permission denied/);
  await client.query("SET request.jwt.claim.sub='10000000-0000-4000-8000-000000000001'");
  const visible = await client.query('SELECT public.list_physical_terminal_settings() AS settings');
  assert.equal(visible.rows[0].settings.length, 4);
  const saved = await client.query("SELECT public.save_physical_terminal_setting('003','Front N86',true,'FRONT') AS setting");
  assert.deepEqual(saved.rows[0].setting, {
    registerNumber: '003', model: 'N86', label: 'Front N86', enabled: true, cashRegisterCode: 'FRONT',
  });
  await assert.rejects(client.query("SELECT public.save_physical_terminal_setting('004','Duplicate',true,'FRONT')"), /duplicate key/);
  await assert.rejects(client.query("SELECT public.save_physical_terminal_setting('004','Closed',true,'CLOSED')"), /physical_workstation_unavailable/);
  await assert.rejects(client.query("SELECT public.save_physical_terminal_setting('004','No station',true,NULL)"), /physical_setting_invalid/);
  await client.query('RESET ROLE');
  await client.query('SET ROLE service_role');
  const providerView = await client.query("SELECT register_number,cash_register_code FROM public.physical_terminal_devices WHERE enabled=true");
  assert.deepEqual(providerView.rows, [{ register_number: '003', cash_register_code: 'FRONT' }]);
  console.log('PASS physical settings: four disabled seeds, admin-only writes, unique active workstation assignments');
} finally {
  if (client) await client.end();
  await pg.stop();
}
