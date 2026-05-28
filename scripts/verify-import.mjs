// verify-import.mjs — READ-ONLY post-import checks. No writes.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const __d = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__d, '..');
function readEnv(fp){ if(!fs.existsSync(fp))return{}; const e={}; for(const l of fs.readFileSync(fp,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if(m)e[m[1]]=m[2].replace(/^['"]|['"]$/g,'');} return e; }
const env={...readEnv(path.join(R,'app','.env')),...readEnv(path.join(R,'.env.local'))};
const U=env.VITE_SUPABASE_URL, K=env.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:K,Authorization:`Bearer ${K}`,Prefer:'count=exact'};
async function get(qs){ const r=await fetch(`${U}/rest/v1/${qs}`,{headers:H}); if(!r.ok) throw new Error(`${qs} → HTTP ${r.status}: ${await r.text()}`); return { rows: await r.json(), count: Number(r.headers.get('content-range')?.split('/')?.[1]||'0') }; }
async function count(table, filter=''){ const r=await fetch(`${U}/rest/v1/${table}?select=id${filter?'&'+filter:''}`,{headers:{...H,Prefer:'count=exact',Range:'0-0'}}); return Number(r.headers.get('content-range')?.split('/')?.[1]||'0'); }

const out=[]; const log=(...a)=>out.push(a.join(' '));
const TBL=['profiles','activities','instructors','leads','quotes','orders','tasks','maintenance_tasks','sales','pricing_sheets'];
log('='.repeat(64));
log('POST-IMPORT VERIFICATION (read-only)');
log('='.repeat(64));

log('\n# Row counts');
for(const t of TBL){ log(`  ${t.padEnd(18)} ${(await count(t)).toString().padStart(4)}`); }

log('\n# profiles untouched (was 3)');
const prof=await get('profiles?select=id,email,role');
log(`  profiles ${prof.count} rows, emails: ${prof.rows.map(r=>r.email).join(', ')}`);

log('\n# legacy_id coverage (should equal real import = source count)');
for(const t of ['activities','instructors','leads','quotes','orders','tasks','maintenance_tasks','sales','pricing_sheets']){
  const total=await count(t), withLeg=await count(t,'legacy_id=not.is.null');
  log(`  ${t.padEnd(18)} total ${total}  with legacy_id ${withLeg}  without ${total-withLeg}`);
}

log('\n# Activities — מזון category present?');
const maz=await count('activities','category=eq.מזון');
log(`  rows with category='מזון': ${maz}  (expected 3)`);

log('\n# Leads — fallback name applied');
const fb=await count('leads',`full_name=eq.${encodeURIComponent('ליד ללא שם')}`);
log(`  leads with full_name='ליד ללא שם' fallback: ${fb}  (≤ 6 expected)`);
// company/phone fallbacks aren't trivially detectable by SQL alone; total fallback count = 6 by build logic.

log('\n# Orders — relations resolve');
const oTotal=await count('orders');
const oAct=await count('orders','activity_id=not.is.null');
const oInst=await count('orders','instructor_id=not.is.null');
log(`  orders ${oTotal}  with activity_id ${oAct}/${oTotal}  with instructor_id ${oInst}/${oTotal}`);

log('\n# Quotes — nested selected_activities[].activity_id resolve to activities');
const qres=await get('quotes?select=legacy_id,selected_activities');
const aIds=new Set((await get('activities?select=id')).rows.map(r=>r.id));
let nestedTotal=0, nestedResolved=0, badQuotes=[];
for(const q of qres.rows){
  const sel=q.selected_activities||[];
  for(const a of sel){ nestedTotal++; if(aIds.has(a.activity_id)) nestedResolved++; else badQuotes.push(q.legacy_id); }
}
log(`  nested refs: ${nestedResolved}/${nestedTotal} resolved`);
if(badQuotes.length) log(`  ⚠ unresolved in quotes: ${[...new Set(badQuotes)].join(', ')}`);

log('\n# Tasks/Maintenance — assignee names staged, FK null');
const tTotal=await count('tasks'), tNull=await count('tasks','assigned_to=is.null'), tLeg=await count('tasks','legacy_assigned_to=not.is.null');
log(`  tasks ${tTotal}  assigned_to NULL ${tNull}  legacy_assigned_to set ${tLeg}`);
const mTotal=await count('maintenance_tasks'), mNull=await count('maintenance_tasks','assigned_to=is.null'), mLeg=await count('maintenance_tasks','legacy_assigned_to=not.is.null');
log(`  maintenance ${mTotal}  assigned_to NULL ${mNull}  legacy_assigned_to set ${mLeg}`);

log('\n# Sales sanity');
const sTotal=await count('sales'), sR=await count('sales','receipt_number=like.R*');
log(`  sales ${sTotal}  receipt_number starts with 'R' ${sR}/${sTotal}`);

log('\n='.repeat(64));
log('Verification complete (read-only). No data was modified.');
console.log(out.join('\n'));
