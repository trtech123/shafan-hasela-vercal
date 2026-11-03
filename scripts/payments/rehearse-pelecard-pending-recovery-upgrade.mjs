// Rehearse upgrading a database whose first recovery cutoff is already installed.
// Uses disposable in-memory PostgreSQL and never connects to production.
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve,join,dirname} from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'../..');
const modulePath=process.env.PAYPER_PGLITE_MODULE||
  resolve(root,'../../.tmp/payment-db/node_modules/@electric-sql/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const extRoot=join(dirname(modulePath),'contrib');
const {uuid_ossp}=await import(pathToFileURL(join(extRoot,'uuid_ossp.js')).href);
const {pg_trgm}=await import(pathToFileURL(join(extRoot,'pg_trgm.js')).href);
const db=new PGlite({extensions:{uuid_ossp,pg_trgm}});
const read=path=>readFile(join(root,path),'utf8');
const migration='202611030003_pelecard_pending_recovery_epoch.sql';
const actor='94000000-0000-4000-8000-000000000001';
try{
  await db.exec(await read('scripts/payments/fixture.sql'));
  await db.exec(await read('scripts/payments/assertions.sql'));
  for(const name of (await readdir(join(root,'supabase/migrations')))
    .filter(name=>name.endsWith('.sql')&&name<migration).sort())
    await db.exec(await read('supabase/migrations/'+name));
  await db.exec(`INSERT INTO auth.users(id,email)
    VALUES('${actor}','epoch-admin@example.test');
    SELECT set_config('request.jwt.claim.role','service_role',false);
    UPDATE public.profiles SET role='admin' WHERE id='${actor}';`);
  const first=(await db.query(`SELECT public.start_pelecard_pending_recovery('${actor}') AS cutoff`)).rows[0].cutoff;
  await db.query(`SELECT public.stop_pelecard_pending_recovery('${actor}')`);
  await db.exec(await read('supabase/migrations/'+migration));
  const legacy=(await db.query(`SELECT cutoff_utc,origin FROM
    public.pelecard_pending_recovery_epoch_audit`)).rows;
  assert.deepEqual(legacy,[{cutoff_utc:first,origin:'legacy'}]);
  const next=(await db.query(`SELECT public.start_pelecard_pending_recovery('${actor}') AS cutoff`)).rows[0].cutoff;
  assert.ok(new Date(next)>new Date(first));
  assert.equal((await db.query(`SELECT count(*)::integer AS n FROM
    public.pelecard_pending_recovery_epoch_audit`)).rows[0].n,2);
  console.log('PASS pending recovery epoch upgrade: legacy cutoff audited, fresh cutoff created');
}finally{await db.close();}
