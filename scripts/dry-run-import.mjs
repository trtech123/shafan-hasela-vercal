// ============================================================
// DRY-RUN import validator for the Base44 → Supabase migration.
//
// SAFE BY DESIGN: this script does NOT connect to Supabase, does NOT
// modify any database, does NOT write to the project (report goes to
// stdout only). It only READS the export CSVs and reports what the real
// importer WOULD do under the planned rules + recommended defaults.
//
// Run:  node scripts/dry-run-import.mjs
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

const SOURCE_DIR = 'C:/Users/Daniel/Downloads'; // where the *_export.csv files currently live
const FILES = {
  Activity:        'Activity_export.csv',
  Instructor:      'Instructor_export.csv',
  Lead:            'Lead_export.csv',
  Quote:           'Quote_export.csv',
  Order:           'Order_export.csv',
  Task:            'Task_export.csv',
  MaintenanceTask: 'MaintenanceTask_export.csv',
  Sale:            'Sale_export.csv',
  PricingSheet:    'PricingSheet_export.csv',
};

// ---- allowed enum / CHECK sets (from 001_schema.sql + 006) ----
const ACT_CATEGORY   = ['הפעלת פארק', 'יום גיבוש', 'חוג טיפוס', 'סדנת שטח'];
const SITE_STD       = ['עכו', 'טבריה', 'נוף הגליל', 'שטח'];          // orders/quotes/maintenance
const SITE_LEAD      = ['עכו', 'טבריה', 'שטח', 'ויה פרטה'];           // leads
const LEAD_STATUS    = ['פתוח', 'נשלח', 'נסגר', 'לא רלוונטי'];        // post-006
const QUOTE_STATUS   = ['טיוטה', 'נשלחה', 'ממתינה לאישור', 'אושרה', 'בוטלה'];
const ORDER_STATUS   = ['ממתין לאישור', 'מאושר', 'שולם', 'בוצע', 'בוטל'];
const ORDER_PAYMENT  = ['לא שולם', 'שובר', 'אשראי', "צ'ק", 'מזומן'];
const TASK_PRIORITY  = ['נמוכה', 'בינונית', 'גבוהה', 'דחופה'];
const TASK_STATUS    = ['פתוחה', 'בביצוע', 'הושלמה', 'בוטלה'];
const TASK_CATEGORY  = ['ציוד', 'תחזוקה', 'אדמיניסטרציה', 'הכשרה', 'שיווק', 'אחר'];
const MNT_CATEGORY   = ['בטיחות', 'ציוד', 'מתקנים', 'ניקיון', 'כללי'];
const MNT_PRIORITY   = ['גבוהה', 'בינונית', 'נמוכה'];
const MNT_STATUS     = ['פתוחה', 'בטיפול', 'הושלמה'];

// ---- RFC-4180 CSV parser (handles quoted multiline fields + "" escapes) ----
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* ignore */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // drop a trailing blank row
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

function loadEntity(name) {
  const fp = path.join(SOURCE_DIR, FILES[name]);
  if (!fs.existsSync(fp)) return { ok: false, fp, records: [] };
  const rows = parseCSV(fs.readFileSync(fp, 'utf8'));
  const header = rows[0];
  const records = rows.slice(1).map(cols =>
    Object.fromEntries(header.map((h, i) => [h, cols[i] ?? '']))
  );
  return { ok: true, fp, header, records };
}

// ---- helpers ----
const isBlank = v => v == null || String(v).trim() === '';
const nn = v => (isBlank(v) ? null : v);                  // "" -> null
const jsonCell = v => { try { return isBlank(v) ? [] : JSON.parse(v); } catch { return '__PARSE_ERROR__'; } };

const out = [];
const log = (...a) => out.push(a.join(' '));
const hr = () => log('-'.repeat(64));

// ============================================================
log('='.repeat(64));
log('DRY-RUN — Base44 → Supabase  (NO database connection, NO writes)');
log('Source: ' + SOURCE_DIR);
log('Assumptions (recommended defaults; confirm before real run):');
log('  • legacy_id remap (Option A)  • preserve original numbers');
log('  • created_by -> null          • free-text assigned_to -> null (name staged)');
log('  • empty typed fields -> null  • is_sample=true rows skipped');
log('='.repeat(64));

const data = {};
for (const name of Object.keys(FILES)) data[name] = loadEntity(name);

// reference id sets for relation resolution
const idSet = (name) => new Set(data[name].records.map(r => r.id).filter(Boolean));
const activityIds   = idSet('Activity');
const instructorIds = idSet('Instructor');

const summary = [];

function reportCounts(name, recs) {
  const samples = recs.filter(r => String(r.is_sample).toLowerCase() === 'true').length;
  log(`\n### ${name} — ${recs.length} rows parsed${samples ? `  (is_sample=true: ${samples} would be skipped)` : ''}`);
}

// ---------- Activity ----------
{
  const recs = data.Activity.records;
  reportCounts('Activity', recs);
  let mazon = 0, emptyCat = 0, badImages = 0, base44Imgs = 0, wouldInsert = 0, blocked = 0;
  for (const r of recs) {
    const cat = nn(r.category);
    const imgs = jsonCell(r.images);
    if (imgs === '__PARSE_ERROR__') badImages++;
    if (cat === 'מזון') mazon++;
    if (isBlank(r.category)) emptyCat++;
    if (String(r.image_url).includes('base44.app') || (Array.isArray(imgs) && imgs.some(u => String(u).includes('base44.app')))) base44Imgs++;
    const catOk = cat === null || ACT_CATEGORY.includes(cat);
    if (!catOk) blocked++; else wouldInsert++;
  }
  log(`  would INSERT cleanly: ${wouldInsert}`);
  log(`  BLOCKED (category 'מזון' not in CHECK): ${mazon}  → needs 'מזון' added to CHECK or remap`);
  log(`  normalize empty category "" -> null: ${emptyCat}`);
  log(`  rows with Base44-hosted image URLs: ${base44Imgs}  (keep-as-URL vs re-host decision)`);
  if (badImages) log(`  ⚠ images JSON parse errors: ${badImages}`);
  summary.push(['Activity', recs.length, wouldInsert, mazon, "מזון category"]);
}

// ---------- Instructor ----------
{
  const recs = data.Instructor.records;
  reportCounts('Instructor', recs);
  let wouldInsert = 0, badSpec = 0;
  for (const r of recs) {
    if (jsonCell(r.specialties) === '__PARSE_ERROR__') badSpec++;
    if (!isBlank(r.full_name) && !isBlank(r.phone)) wouldInsert++;
  }
  log(`  would INSERT cleanly: ${wouldInsert} / ${recs.length}`);
  if (badSpec) log(`  ⚠ specialties JSON parse errors: ${badSpec}`);
  summary.push(['Instructor', recs.length, wouldInsert, 0, '—']);
}

// ---------- Lead ----------
{
  const recs = data.Lead.records;
  reportCounts('Lead', recs);
  let emptyName = 0, badStatus = 0, badSite = 0, emptySite = 0, junk = 0, wouldInsert = 0;
  for (const r of recs) {
    const st = nn(r.status), site = nn(r.site);
    if (isBlank(r.full_name)) emptyName++;
    if (String(r.full_name).trim() === 'ליד חדש') junk++;
    if (st && !LEAD_STATUS.includes(st)) badStatus++;
    if (isBlank(r.site)) emptySite++;
    else if (!SITE_LEAD.includes(site)) badSite++;
    if (!isBlank(r.full_name)) wouldInsert++;
  }
  log(`  would INSERT (have full_name): ${wouldInsert}`);
  log(`  BLOCKED (empty full_name, NOT NULL): ${emptyName}  → Q11 (fallback / relax / skip)`);
  log(`     fallback preview = company || phone || 'ליד ללא שם'`);
  log(`  status values outside CHECK: ${badStatus}  (expected 0 — no 'טופל' found)`);
  log(`  site values outside CHECK: ${badSite}  |  empty site -> null: ${emptySite}`);
  log(`  junk placeholder ('ליד חדש'): ${junk}  (candidate skip)`);
  summary.push(['Lead', recs.length, wouldInsert, emptyName, 'empty full_name']);
}

// ---------- Quote ----------
{
  const recs = data.Quote.records;
  reportCounts('Quote', recs);
  let badSel = 0, nestedTotal = 0, nestedResolved = 0, badStatus = 0, emptySite = 0, lineage = 0, wouldInsert = 0;
  for (const r of recs) {
    const sel = jsonCell(r.selected_activities);
    if (sel === '__PARSE_ERROR__') { badSel++; }
    else if (Array.isArray(sel)) {
      for (const a of sel) { nestedTotal++; if (activityIds.has(a.activity_id)) nestedResolved++; }
    }
    const st = nn(r.status);
    if (st && !QUOTE_STATUS.includes(st)) badStatus++;
    if (isBlank(r.site)) emptySite++;
    if (!isBlank(r.converted_to_order_id)) lineage++;
    if (!isBlank(r.client_name) && !isBlank(r.client_phone)) wouldInsert++;
  }
  log(`  would INSERT cleanly: ${wouldInsert} / ${recs.length}`);
  log(`  nested selected_activities[].activity_id: ${nestedResolved}/${nestedTotal} resolve to an Activity  → remap`);
  if (badSel) log(`  ⚠ selected_activities JSON parse errors: ${badSel}`);
  log(`  status outside CHECK: ${badStatus}  |  empty site -> null: ${emptySite}`);
  log(`  converted_to_order_id present (lineage): ${lineage}  (expected 0 — links absent)`);
  summary.push(['Quote', recs.length, wouldInsert, 0, '—']);
}

// ---------- Order ----------
{
  const recs = data.Order.records;
  reportCounts('Order', recs);
  let actResolved = 0, actMissing = 0, instResolved = 0, instEmpty = 0, instMissing = 0;
  let emptySite = 0, emptyTimes = 0, badStatus = 0, badPay = 0, missingReq = 0, wouldInsert = 0;
  for (const r of recs) {
    if (isBlank(r.activity)) actMissing++;
    else if (activityIds.has(r.activity)) actResolved++; else actMissing++;
    if (isBlank(r.instructor)) instEmpty++;
    else if (instructorIds.has(r.instructor)) instResolved++; else instMissing++;
    if (isBlank(r.site)) emptySite++;
    if (isBlank(r.start_time)) emptyTimes++;
    if (isBlank(r.end_time)) emptyTimes++;
    const st = nn(r.status), pay = nn(r.payment_status);
    if (st && !ORDER_STATUS.includes(st)) badStatus++;
    if (pay && !ORDER_PAYMENT.includes(pay)) badPay++;
    const reqOk = !isBlank(r.client_name) && !isBlank(r.client_phone) && !isBlank(r.activity_date) && !isBlank(r.num_participants);
    if (!reqOk) missingReq++; else wouldInsert++;
  }
  log(`  would INSERT cleanly: ${wouldInsert} / ${recs.length}`);
  log(`  activity_id remap: ${actResolved} resolved, ${actMissing} missing/empty`);
  log(`  instructor_id remap: ${instResolved} resolved, ${instEmpty} empty(->null), ${instMissing} missing`);
  log(`  empty site -> null: ${emptySite}  |  empty start/end times -> null: ${emptyTimes}`);
  log(`  status/payment outside CHECK: ${badStatus}/${badPay}  (expected 0)`);
  log(`  rows missing a NOT NULL field: ${missingReq}  (expected 0)`);
  log(`  ⚠ NOTE: only ${recs.length} orders — verify this is the FULL export, not capped.`);
  summary.push(['Order', recs.length, wouldInsert, 0, 'verify completeness']);
}

// ---------- Task ----------
{
  const recs = data.Task.records;
  reportCounts('Task', recs);
  const assignees = new Set();
  let emptyTime = 0, badCat = 0, badPri = 0, badStatus = 0, missingReq = 0, wouldInsert = 0;
  for (const r of recs) {
    if (!isBlank(r.assigned_to)) assignees.add(r.assigned_to);
    if (isBlank(r.due_time)) emptyTime++;
    const c = nn(r.category), p = nn(r.priority), s = nn(r.status);
    if (c && !TASK_CATEGORY.includes(c)) badCat++;
    if (p && !TASK_PRIORITY.includes(p)) badPri++;
    if (s && !TASK_STATUS.includes(s)) badStatus++;
    const reqOk = !isBlank(r.title) && !isBlank(r.due_date);
    if (!reqOk) missingReq++; else wouldInsert++;
  }
  log(`  would INSERT cleanly: ${wouldInsert} / ${recs.length}`);
  log(`  assigned_to (free-text names): [${[...assignees].join(', ')}]  → FK null, name staged (Q5)`);
  log(`  empty due_time -> null: ${emptyTime}`);
  log(`  category/priority/status outside CHECK: ${badCat}/${badPri}/${badStatus}  (expected 0)`);
  log(`  rows missing a NOT NULL field: ${missingReq}  (expected 0)`);
  summary.push(['Task', recs.length, wouldInsert, 0, 'assigned_to (Q5)']);
}

// ---------- MaintenanceTask ----------
{
  const recs = data.MaintenanceTask.records;
  reportCounts('MaintenanceTask', recs);
  const assignees = new Set();
  let badSite = 0, badCat = 0, missingReq = 0, wouldInsert = 0;
  for (const r of recs) {
    if (!isBlank(r.assigned_to)) assignees.add(r.assigned_to);
    const site = nn(r.site), c = nn(r.category);
    if (isBlank(r.site) || !SITE_STD.includes(site)) badSite++;
    if (c && !MNT_CATEGORY.includes(c)) badCat++;
    const reqOk = !isBlank(r.title) && !isBlank(r.site);
    if (!reqOk) missingReq++; else wouldInsert++;
  }
  log(`  would INSERT cleanly: ${wouldInsert} / ${recs.length}`);
  log(`  assigned_to (free-text names): [${[...assignees].join(', ')}]  → FK null, name staged (Q5)`);
  log(`  site invalid/empty (NOT NULL CHECK): ${badSite}  |  category outside CHECK: ${badCat}`);
  log(`  rows missing a NOT NULL field: ${missingReq}  (expected 0)`);
  summary.push(['MaintenanceTask', recs.length, wouldInsert, 0, 'assigned_to (Q5)']);
}

// ---------- Sale ----------
{
  const recs = data.Sale.records;
  reportCounts('Sale', recs);
  let badItems = 0, missingReq = 0, wouldInsert = 0;
  for (const r of recs) {
    if (jsonCell(r.items) === '__PARSE_ERROR__') badItems++;
    const reqOk = !isBlank(r.total) && !isBlank(r.method) && !isBlank(r.sale_date) && !isBlank(r.receipt_number);
    if (!reqOk) missingReq++; else wouldInsert++;
  }
  log(`  would INSERT cleanly: ${wouldInsert} / ${recs.length}`);
  log(`  items JSON: parsed OK (verbatim, no nested remap)  | parse errors: ${badItems}`);
  log(`  rows missing a NOT NULL field: ${missingReq}  (expected 0)`);
  summary.push(['Sale', recs.length, wouldInsert, 0, '—']);
}

// ---------- PricingSheet ----------
{
  const recs = data.PricingSheet.records;
  reportCounts('PricingSheet', recs);
  let badCat = 0, emptyTemplates = 0, withLink = 0, wouldInsert = 0;
  for (const r of recs) {
    const cats = jsonCell(r.categories);
    if (cats === '__PARSE_ERROR__') badCat++;
    const hasRows = Array.isArray(cats) && cats.some(c => Array.isArray(c.rows) && c.rows.length > 0);
    if (!hasRows) emptyTemplates++;
    if (!isBlank(r.lead_id) || !isBlank(r.quote_id)) withLink++;
    if (!isBlank(r.title)) wouldInsert++;
  }
  log(`  would INSERT cleanly: ${wouldInsert} / ${recs.length}`);
  log(`  empty template sheets (no row data): ${emptyTemplates}  (candidate skip)`);
  log(`  sheets linked to a lead/quote: ${withLink}  (expected 0 -> lead_id/quote_id null)`);
  if (badCat) log(`  ⚠ categories JSON parse errors: ${badCat}`);
  summary.push(['PricingSheet', recs.length, wouldInsert, 0, 'all empty templates']);
}

// ============================================================
hr();
log('SUMMARY (would-insert under recommended defaults):');
log('entity            parsed  insert  blocked  note');
for (const [n, p, i, b, note] of summary) {
  log(`  ${n.padEnd(16)} ${String(p).padStart(5)} ${String(i).padStart(7)} ${String(b).padStart(8)}  ${note}`);
}
hr();
log('HARD BLOCKERS to resolve before a real run:');
log("  1. Activity 'מזון' category (3) — add to CHECK + UI, or remap");
log('  2. Lead empty full_name (6) — Q11 fallback / relax / skip');
log('DECISIONS w/ recommended defaults applied above: Q3 preserve numbers,');
log('  Q4 created_by=null, Q5 assigned_to staged, skip junk (1 lead + 3 pricing).');
log('NOTHING was written and NO database was contacted.');
log('='.repeat(64));

console.log(out.join('\n'));
