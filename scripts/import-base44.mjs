// ============================================================
// import-base44.mjs — Base44 CSV exports → Supabase.
//
// SAFE BY DEFAULT:
//   node scripts/import-base44.mjs              → DRY-RUN (offline, no DB, no writes)
//   node scripts/import-base44.mjs --commit     → REAL import (UPSERT on legacy_id)
//   node scripts/import-base44.mjs --commit --clear-seed
//                                               → also DELETE seed rows (legacy_id IS NULL)
//                                                 from the 9 business tables (NOT profiles)
//
// PREREQUISITES for --commit:
//   1. Apply migrations 007 (legacy_id columns) and 008 (מזון category) first.
//   2. Run scripts/backup-tables.mjs first.
//
// Recommended-default decisions baked in (change here if yours differ):
//   • preserve original numbers   • created_by -> null
//   • empty typed fields -> null  • free-text assigned_to -> null (name -> legacy_assigned_to)
//   • Lead empty full_name -> company || phone || 'ליד ללא שם'
//   • skip is_sample=true, the 'ליד חדש' placeholder, and empty pricing templates
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = process.argv.includes('--commit');
const CLEAR = process.argv.includes('--clear-seed');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = 'C:/Users/Daniel/Downloads';
const FILES = { Activity:'Activity_export.csv', Instructor:'Instructor_export.csv', Lead:'Lead_export.csv',
  Quote:'Quote_export.csv', Order:'Order_export.csv', Task:'Task_export.csv',
  MaintenanceTask:'MaintenanceTask_export.csv', Sale:'Sale_export.csv', PricingSheet:'PricingSheet_export.csv' };

const ACT_CATEGORY = ['הפעלת פארק','יום גיבוש','חוג טיפוס','סדנת שטח','מזון']; // incl. 008
const SITE_STD = ['עכו','טבריה','נוף הגליל','שטח'];
const SITE_LEAD = ['עכו','טבריה','שטח','ויה פרטה'];

// ---- env (only needed for --commit) ----
function readEnvFile(fp){ if(!fs.existsSync(fp))return{}; const e={}; for(const l of fs.readFileSync(fp,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if(m)e[m[1]]=m[2].replace(/^['"]|['"]$/g,'');} return e; }
const env = { ...readEnvFile(path.join(REPO_ROOT,'app','.env')), ...readEnvFile(path.join(REPO_ROOT,'.env.local')) };
const URL = env.VITE_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;

// ---- CSV parser (RFC-4180) ----
function parseCSV(text){ if(text.charCodeAt(0)===0xFEFF)text=text.slice(1); const rows=[]; let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){f+='"';i++;} else q=false; } else f+=c; }
    else { if(c==='"')q=true; else if(c===',' ){row.push(f);f='';} else if(c==='\r'){} else if(c==='\n'){row.push(f);rows.push(row);row=[];f='';} else f+=c; } }
  if(f.length||row.length){row.push(f);rows.push(row);} return rows.filter(r=>!(r.length===1&&r[0]==='')); }
function load(name){ const fp=path.join(SOURCE_DIR,FILES[name]); const rows=parseCSV(fs.readFileSync(fp,'utf8')); const h=rows[0];
  return rows.slice(1).map(c=>Object.fromEntries(h.map((k,i)=>[k,c[i]??'']))); }

// ---- normalize helpers ----
const blank = v => v==null || String(v).trim()==='';
const nn = v => blank(v)?null:v;
const num = v => blank(v)?null:Number(v);
const int = v => blank(v)?null:parseInt(v,10);
const jarr = v => { try { return blank(v)?[]:JSON.parse(v); } catch { return []; } };
const isSample = r => String(r.is_sample).toLowerCase()==='true';
const ts = r => ({ created_at: nn(r.created_date), updated_at: nn(r.updated_date) });

// ---- build normalized payloads (legacy_id carried; FKs filled at commit time) ----
function build() {
  const A = load('Activity').filter(r=>!isSample(r)).map(r=>({ legacy_id:r.id, name:r.name,
    category: r.category==='מזון'?'מזון':(ACT_CATEGORY.includes(r.category)?r.category:null),
    description:nn(r.description), duration_hours:num(r.duration_hours), max_participants:int(r.max_participants),
    price_per_person:num(r.price_per_person), image_url:nn(r.image_url), images:jarr(r.images),
    status:nn(r.status)||'פעיל', ...ts(r) }));

  const I = load('Instructor').filter(r=>!isSample(r)).map(r=>({ legacy_id:r.id, full_name:r.full_name,
    phone:r.phone, email:nn(r.email), specialties:jarr(r.specialties), notes:nn(r.notes),
    status:nn(r.status)||'פעיל', ...ts(r) }));

  const L = load('Lead').filter(r=>!isSample(r))
    .filter(r=>!(String(r.full_name).trim()==='ליד חדש')) // skip placeholder
    .map(r=>({ legacy_id:r.id,
      full_name: nn(r.full_name) || nn(r.company) || nn(r.phone) || 'ליד ללא שם', // Q11 fallback
      phone:nn(r.phone), email:nn(r.email), company:nn(r.company),
      site: SITE_LEAD.includes(r.site)?r.site:null, event_date:nn(r.event_date),
      status:nn(r.status)||'פתוח', source_text:nn(r.source_text), notes:nn(r.notes), ...ts(r) }));

  const Q = load('Quote').filter(r=>!isSample(r)).map(r=>({ legacy_id:r.id, quote_number:r.quote_number,
    client_name:r.client_name, client_phone:r.client_phone, client_email:nn(r.client_email),
    organization:nn(r.organization), event_date:nn(r.event_date),
    site: SITE_STD.includes(r.site)?r.site:null, num_participants:int(r.num_participants),
    _selected_raw: jarr(r.selected_activities), total_price:num(r.total_price), discount:num(r.discount),
    final_price:num(r.final_price), notes:nn(r.notes), status:nn(r.status)||'טיוטה',
    converted_to_order_id:null, ...ts(r) }));

  const O = load('Order').filter(r=>!isSample(r)).map(r=>({ legacy_id:r.id, order_number:r.order_number,
    client_name:r.client_name, client_phone:r.client_phone, client_email:nn(r.client_email),
    organization:nn(r.organization), _activity_ref:nn(r.activity), _instructor_ref:nn(r.instructor),
    activity_date:r.activity_date, start_time:nn(r.start_time), end_time:nn(r.end_time),
    site: SITE_STD.includes(r.site)?r.site:null, num_participants:int(r.num_participants),
    price_per_person:num(r.price_per_person), total_price:num(r.total_price),
    status:nn(r.status)||'ממתין לאישור', payment_status:nn(r.payment_status)||'לא שולם',
    notes:nn(r.notes), instructor_notified:String(r.instructor_notified).toLowerCase()==='true',
    billing_institution_name:nn(r.billing_institution_name), billing_signer_name:nn(r.billing_signer_name),
    billing_signer_id:nn(r.billing_signer_id), billing_signer_role:nn(r.billing_signer_role),
    billing_signer_phone:nn(r.billing_signer_phone), billing_company_id:nn(r.billing_company_id),
    billing_accounting_email:nn(r.billing_accounting_email), quote_id:null, ...ts(r) }));

  const T = load('Task').filter(r=>!isSample(r)).map(r=>({ legacy_id:r.id, title:r.title, description:nn(r.description),
    due_date:r.due_date, due_time:nn(r.due_time), assigned_to:null, legacy_assigned_to:nn(r.assigned_to),
    priority:nn(r.priority)||'בינונית', status:nn(r.status)||'פתוחה', category:nn(r.category)||'אחר', ...ts(r) }));

  const M = load('MaintenanceTask').filter(r=>!isSample(r)).map(r=>({ legacy_id:r.id, title:r.title, site:r.site,
    category:nn(r.category), priority:nn(r.priority)||'בינונית', status:nn(r.status)||'פתוחה',
    description:nn(r.description), due_date:nn(r.due_date), assigned_to:null, legacy_assigned_to:nn(r.assigned_to), ...ts(r) }));

  const S = load('Sale').filter(r=>!isSample(r)).map(r=>({ legacy_id:r.id, receipt_number:r.receipt_number,
    items:jarr(r.items), total:num(r.total), method:r.method, sale_date:r.sale_date, ...ts(r) }));

  const P = load('PricingSheet').filter(r=>!isSample(r))
    .map(r=>({ legacy_id:r.id, title:r.title||'גיליון תמחור חדש', _lead_ref:nn(r.lead_id), lead_name:nn(r.lead_name),
      _quote_ref:nn(r.quote_id), quote_number:nn(r.quote_number), num_participants:int(r.num_participants),
      categories:jarr(r.categories), total_cost:num(r.total_cost), total_sell:num(r.total_sell),
      total_profit:num(r.total_profit), margin_pct:num(r.margin_pct), notes:nn(r.notes), ...ts(r) }))
    .filter(p => Array.isArray(p.categories) && p.categories.some(c=>Array.isArray(c.rows)&&c.rows.length>0)); // skip empty templates

  return { A,I,L,Q,O,T,M,S,P };
}

// ---- PostgREST helpers (only used with --commit) ----
async function upsert(table, rows){ if(!rows.length) return [];
  const res = await fetch(`${URL}/rest/v1/${table}?on_conflict=legacy_id`, { method:'POST',
    headers:{ apikey:KEY, Authorization:`Bearer ${KEY}`, 'Content-Type':'application/json',
      Prefer:'resolution=merge-duplicates,return=representation' }, body:JSON.stringify(rows) });
  if(!res.ok) throw new Error(`${table} upsert HTTP ${res.status}: ${await res.text()}`);
  return res.json(); }
async function clearSeed(table){ const res = await fetch(`${URL}/rest/v1/${table}?legacy_id=is.null`, { method:'DELETE',
    headers:{ apikey:KEY, Authorization:`Bearer ${KEY}`, Prefer:'return=minimal' } });
  if(!res.ok) throw new Error(`${table} clear HTTP ${res.status}: ${await res.text()}`); }
const mapBy = (rows,k='legacy_id') => Object.fromEntries(rows.map(r=>[r[k], r.id]));

// ============================================================
const d = build();
const counts = Object.fromEntries(Object.entries(d).map(([k,v])=>[k,v.length]));

if(!COMMIT){
  console.log('DRY-RUN (offline, no DB, no writes). Would UPSERT, by entity:');
  console.log(`  activities ${counts.A}  instructors ${counts.I}  leads ${counts.L}  quotes ${counts.Q}`);
  console.log(`  orders ${counts.O}  tasks ${counts.T}  maintenance ${counts.M}  sales ${counts.S}  pricing ${counts.P}`);
  console.log('  (pricing empty templates skipped; junk lead skipped; is_sample skipped)');
  console.log('Run with --commit to write (requires migrations 007+008 applied and a backup).');
  process.exit(0);
}

// ---- REAL IMPORT (--commit) ----
if(!URL||!KEY){ console.error('Missing env for --commit (app/.env + .env.local).'); process.exit(1); }
console.log('COMMIT mode. Order: ' + (CLEAR?'clear-seed → ':'') + 'activities,instructors → leads,quotes,orders → pricing,tasks,maintenance,sales');

if(CLEAR){ for(const t of ['sales','pricing_sheets','tasks','maintenance_tasks','orders','quotes','leads','instructors','activities']){ await clearSeed(t); console.log('  cleared seed: '+t); } }

const aMap = mapBy(await upsert('activities', d.A));
const iMap = mapBy(await upsert('instructors', d.I));
console.log(`  activities ${d.A.length}, instructors ${d.I.length}`);

await upsert('leads', d.L);
const Qrows = d.Q.map(({_selected_raw,...q})=>({ ...q,
  selected_activities: (_selected_raw||[]).map(a=>({ ...a, activity_id: aMap[a.activity_id] || null })) }));
await upsert('quotes', Qrows);
const Orows = d.O.map(({_activity_ref,_instructor_ref,...o})=>({ ...o,
  activity_id: _activity_ref?aMap[_activity_ref]||null:null,
  instructor_id: _instructor_ref?iMap[_instructor_ref]||null:null }));
await upsert('orders', Orows);
console.log(`  leads ${d.L.length}, quotes ${Qrows.length}, orders ${Orows.length}`);

const lMap = mapBy(await fetch(`${URL}/rest/v1/leads?select=id,legacy_id`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}}).then(r=>r.json()));
const qMap = mapBy(await fetch(`${URL}/rest/v1/quotes?select=id,legacy_id`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}}).then(r=>r.json()));
const Prows = d.P.map(({_lead_ref,_quote_ref,...p})=>({ ...p, lead_id:_lead_ref?lMap[_lead_ref]||null:null, quote_id:_quote_ref?qMap[_quote_ref]||null:null }));
await upsert('pricing_sheets', Prows);
await upsert('tasks', d.T);
await upsert('maintenance_tasks', d.M);
await upsert('sales', d.S);
console.log(`  pricing ${Prows.length}, tasks ${d.T.length}, maintenance ${d.M.length}, sales ${d.S.length}`);
console.log('DONE. Verify row counts + open the app.');
