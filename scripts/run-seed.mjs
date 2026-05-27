#!/usr/bin/env node
/**
 * Phase 1 seed runner — Shafan Hasela MVP recovery
 *
 * Reads service-role key from ../.env.local (NEVER bundled into Vite).
 * Uses Supabase PostgREST + fetch only — no npm dependencies.
 *
 * Operations:
 *   1. Promote the single existing profile to role='admin' (if not already).
 *   2. Detect whether migration 006 has been applied to the live DB
 *      (by probing a leads insert with status='נשלח' — a value only valid post-006).
 *   3. Seed activities, instructors, leads, quotes, orders, tasks,
 *      maintenance_tasks, sales, and one pricing_sheet — idempotent by natural key.
 *   4. Report row counts before + after.
 *
 * Re-running is safe: existing rows are detected by natural key and skipped.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = path.resolve(__dirname, '..');
const ENV_LOCAL  = path.join(REPO_ROOT, '.env.local');
const FRONT_ENV  = path.join(REPO_ROOT, 'app', '.env');

const env = { ...readEnvFile(FRONT_ENV), ...readEnvFile(ENV_LOCAL) };
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) die(`Missing VITE_SUPABASE_URL in ${FRONT_ENV}`);
if (!SERVICE_KEY)  die(`Missing SUPABASE_SERVICE_ROLE_KEY in ${ENV_LOCAL}`);

const BASE_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

const BUSINESS_TABLES = [
  'activities', 'instructors', 'leads', 'quotes', 'orders',
  'tasks', 'maintenance_tasks', 'sales', 'pricing_sheets',
];

main().catch(e => die(e?.stack || e?.message || String(e)));

// ============================================================
// MAIN
// ============================================================
async function main() {
  log('--- Phase 1 seed runner ---');
  log(`Supabase: ${SUPABASE_URL}`);
  log('');

  // Step 1: counts before
  log('Row counts BEFORE:');
  const countsBefore = await getAllCounts();
  printCounts(countsBefore);
  log('');

  // Step 2: promote single profile to admin
  await promoteProfileToAdmin();
  log('');

  // Step 3: detect migration 006 state
  const m006Applied = await detect006();
  log(`Migration 006 applied? ${m006Applied ? 'YES' : 'NO'}`);
  if (!m006Applied) {
    log('  → leads.status restricted to original 3 values. Apply 006 via Dashboard SQL Editor');
    log(`    to enable the full lead pipeline. File: supabase/migrations/006_fix_leads_status.sql`);
  }
  log('');

  // Step 4: seed
  await seedActivities();
  await seedInstructors();
  await seedLeads();
  await seedQuotes();
  await seedOrders();
  await seedTasks();
  await seedMaintenance();
  await seedSales();
  await seedPricingSheets();
  log('');

  // Step 5: counts after
  log('Row counts AFTER:');
  const countsAfter = await getAllCounts();
  printCounts(countsAfter);

  log('');
  log('Seed complete.');
}

// ============================================================
// PROFILE PROMOTION
// ============================================================
async function promoteProfileToAdmin() {
  const profiles = await rest(`/profiles?select=id,email,role&order=created_at.asc&limit=1`);
  if (!profiles.ok) die(`Failed to read profiles: ${profiles.status} ${JSON.stringify(profiles.body)}`);
  if (!Array.isArray(profiles.body) || profiles.body.length === 0) {
    log('No profile rows exist — skipping promotion. Log in once to create a profile, then re-run.');
    return;
  }
  const p = profiles.body[0];
  if (p.role === 'admin') {
    log(`Profile ${p.email || p.id} already has role=admin — skipped.`);
    return;
  }
  const upd = await rest(`/profiles?id=eq.${p.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ role: 'admin' }),
  });
  if (!upd.ok) die(`Failed to promote profile: ${upd.status} ${JSON.stringify(upd.body)}`);
  log(`Promoted profile ${p.email || p.id}: role ${p.role} → admin.`);
}

// ============================================================
// MIGRATION 006 DETECTION
// ============================================================
async function detect006() {
  const PROBE_NAME = '__m006_probe__';
  // Clean any leftover probe
  await rest(`/leads?full_name=eq.${encodeURIComponent(PROBE_NAME)}`, { method: 'DELETE' });
  const probe = await rest(`/leads`, {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([{ full_name: PROBE_NAME, status: 'נשלח' }]),
  });
  if (probe.ok) {
    await rest(`/leads?full_name=eq.${encodeURIComponent(PROBE_NAME)}`, { method: 'DELETE' });
    return true;
  }
  const msg = JSON.stringify(probe.body);
  if (msg.includes('leads_status_check') || msg.includes('check constraint')) return false;
  log(`Probe gave unexpected error: ${probe.status} ${msg}`);
  return false;
}

// ============================================================
// SEED FUNCTIONS — each is idempotent by natural key
// ============================================================
async function seedActivities() {
  const rows = [
    ['הפעלת פארק כשרון',     'הפעלת פארק', 'הפעלת פארק חבלים לקבוצות עד 30 משתתפים',          2.0,  30, 60,   'פעיל'],
    ['יום גיבוש כיתתי',      'יום גיבוש',  'יום גיבוש קצר עם פעילויות שטח קלות',                4.0,  35, 95,   'פעיל'],
    ['סדנת טיפוס למתחילים',  'חוג טיפוס',  'מבוא לטיפוס ספורטיבי, ציוד כלול',                  2.0,  12, 110,  'פעיל'],
    ['סדנת שטח אקסטרים',     'סדנת שטח',   'יום שטח מאתגר כולל ניווט, רפלינג ופעילות קבוצתית',   5.0,  20, 220,  'פעיל'],
    ['יום גיבוש לחברה',      'יום גיבוש',  'יום גיבוש מלא לחברות, כולל ארוחת צהריים והפעלות',    6.0,  80, 150,  'פעיל'],
    ['חוג טיפוס מתקדם',     'חוג טיפוס',  'אימון טיפוס למתקדמים, דגש על טכניקה',                1.5,  10, 130,  'פעיל'],
  ].map(r => ({
    name: r[0], category: r[1], description: r[2],
    duration_hours: r[3], max_participants: r[4], price_per_person: r[5], status: r[6],
  }));
  await upsertByNaturalKey('activities', rows, 'name');
}

async function seedInstructors() {
  const rows = [
    ['דניאל כהן',  '050-1234567', 'dani@example.com',  ['הפעלת פארק', 'יום גיבוש'],  'פעיל'],
    ['נועה לוי',   '052-2345678', 'noa@example.com',   ['חוג טיפוס'],                 'פעיל'],
    ['תומר אבני',  '054-3456789', 'tomer@example.com', ['סדנת שטח', 'יום גיבוש'],     'פעיל'],
    ['מאיה ברק',   '053-4567890', 'maya@example.com',  ['הפעלת פארק', 'חוג טיפוס'],   'פעיל'],
  ].map(r => ({ full_name: r[0], phone: r[1], email: r[2], specialties: r[3], status: r[4] }));
  await upsertByNaturalKey('instructors', rows, 'full_name');
}

async function seedLeads() {
  const rows = [
    ['משפחת אברהמי',  '050-1112233', 'avraham@example.com', null,            'עכו',      14, 'פתוח',       'התקשרו על יום הולדת לבן 10',  null],
    ['בית ספר רעות',  '04-9876543',  'school@example.com',  'בית ספר רעות',  'טבריה',    21, 'פתוח',       'יום גיבוש לכיתות ה-ו',         'תאריך גמיש'],
    ['חברת היי-טק',   '03-5551234',  'hr@hitech.example',   'NorthTech',     'ויה פרטה', 30, 'פתוח',       'יום גיבוש לחברה, 60 איש',      null],
    ['יעל מזרחי',     '052-9998877', null,                  null,            'שטח',       7, 'לא רלוונטי','חיפשה אטרקציות לילדים קטנים מדי', 'לא מתאים לגיל הזה'],
    ['עומר טל',       '054-4445555', 'omer@example.com',    null,            'עכו',      45, 'פתוח',       'מסיבת רווקים',                 null],
  ].map(r => ({
    full_name: r[0], phone: r[1], email: r[2], company: r[3],
    site: r[4], event_date: daysFromNow(r[5]),
    status: r[6], source_text: r[7], notes: r[8],
  }));
  await upsertByCompositeKey('leads', rows, ['full_name', 'phone']);
}

async function seedQuotes() {
  const acts = await fetchMap('activities', 'name', 'id,name,price_per_person,duration_hours,image_url');
  if (acts.size === 0) { log('quotes: no activities — skipping'); return; }
  const sel = (name) => {
    const a = acts.get(name);
    return a ? [{ activity_id: a.id, activity_name: a.name, price_per_person: a.price_per_person, duration_hours: a.duration_hours, image_url: a.image_url }] : [];
  };
  const selMany = (names) => names.flatMap(sel);
  const rows = [
    { client_name: 'משפחת לוי',           client_phone: '050-1010101', client_email: 'levi@example.com',     organization: null,            event_date: daysFromNow(20), site: 'עכו',       num_participants: 25, selected_activities: sel('הפעלת פארק כשרון'),                                total_price: 1500, discount: 0,   final_price: 1500, status: 'טיוטה',         notes: 'בקשה לאזור הצפוני של הפארק' },
    { client_name: 'בית ספר אורן',        client_phone: '04-7777777',  client_email: 'school@oren.example',  organization: 'בית ספר אורן',  event_date: daysFromNow(15), site: 'טבריה',     num_participants: 60, selected_activities: selMany(['יום גיבוש כיתתי', 'חוג טיפוס מתקדם']),      total_price: 8400, discount: 400, final_price: 8000, status: 'נשלחה',         notes: null },
    { client_name: 'NorthTech',           client_phone: '03-5551234',  client_email: 'hr@hitech.example',    organization: 'NorthTech בע"מ', event_date: daysFromNow(30), site: 'נוף הגליל', num_participants: 60, selected_activities: sel('יום גיבוש לחברה'),                              total_price: 9000, discount: 500, final_price: 8500, status: 'ממתינה לאישור', notes: 'ממתין לחתימה' },
    { client_name: 'מועדון הטיפוס שטח',    client_phone: '054-8889999', client_email: null,                    organization: null,            event_date: daysFromNow(7),  site: 'שטח',       num_participants: 14, selected_activities: sel('סדנת שטח אקסטרים'),                            total_price: 3080, discount: 0,   final_price: 3080, status: 'אושרה',         notes: null },
  ];
  await upsertByCompositeKey('quotes', rows, ['client_name', 'client_phone']);
}

async function seedOrders() {
  const acts = await fetchMap('activities', 'name', 'id,name');
  const inst = await fetchMap('instructors', 'full_name', 'id,full_name');
  if (acts.size === 0 || inst.size === 0) { log('orders: missing activities or instructors — skipping'); return; }
  const aId = (name) => acts.get(name)?.id || null;
  const iId = (name) => inst.get(name)?.id || null;
  const monthStart = startOfMonth();
  const rows = [
    { client_name: 'משפחת כהן',           client_phone: '050-2223344', client_email: 'cohen@example.com',  organization: null,           activity_id: aId('הפעלת פארק כשרון'), instructor_id: iId('דניאל כהן'),  activity_date: addDays(monthStart, 3),  start_time: '10:00', end_time: '12:00', site: 'עכו',       num_participants: 28, price_per_person: 60,  total_price: 1680, status: 'בוצע',         payment_status: 'אשראי',   notes: null,               instructor_notified: true  },
    { client_name: 'בית ספר נוף',         client_phone: '04-1112223',  client_email: 'school@nof.example', organization: 'בית ספר נוף',  activity_id: aId('יום גיבוש כיתתי'),  instructor_id: iId('תומר אבני'),  activity_date: addDays(monthStart, 7),  start_time: '09:00', end_time: '13:00', site: 'טבריה',     num_participants: 32, price_per_person: 95,  total_price: 3040, status: 'בוצע',         payment_status: 'מזומן',   notes: null,               instructor_notified: true  },
    { client_name: 'NorthTech',           client_phone: '03-5551234',  client_email: 'hr@hitech.example',  organization: 'NorthTech',    activity_id: aId('יום גיבוש לחברה'),  instructor_id: iId('דניאל כהן'),  activity_date: addDays(monthStart, 12), start_time: '09:00', end_time: '15:00', site: 'נוף הגליל', num_participants: 65, price_per_person: 150, total_price: 9750, status: 'מאושר',        payment_status: 'שובר',    notes: 'יום גיבוש שנתי',   instructor_notified: true  },
    { client_name: 'מועדון טיפוס תל אביב', client_phone: '054-1212121', client_email: 'club@example.com',   organization: null,           activity_id: aId('חוג טיפוס מתקדם'),  instructor_id: iId('נועה לוי'),    activity_date: addDays(monthStart, 15), start_time: '17:00', end_time: '18:30', site: 'עכו',       num_participants: 10, price_per_person: 130, total_price: 1300, status: 'מאושר',        payment_status: 'אשראי',   notes: null,               instructor_notified: false },
    { client_name: 'משפחת אברהמי',        client_phone: '050-1112233', client_email: 'avraham@example.com',organization: null,           activity_id: aId('הפעלת פארק כשרון'), instructor_id: iId('מאיה ברק'),    activity_date: addDays(monthStart, 18), start_time: '14:00', end_time: '16:00', site: 'עכו',       num_participants: 22, price_per_person: 60,  total_price: 1320, status: 'ממתין לאישור', payment_status: 'לא שולם', notes: null,               instructor_notified: false },
    { client_name: 'סדנת שטח קבוצתית',     client_phone: '052-7777777', client_email: null,                  organization: null,           activity_id: aId('סדנת שטח אקסטרים'), instructor_id: iId('תומר אבני'),  activity_date: addDays(monthStart, 22), start_time: '08:00', end_time: '13:00', site: 'שטח',       num_participants: 18, price_per_person: 220, total_price: 3960, status: 'שולם',         payment_status: 'אשראי',   notes: null,               instructor_notified: true  },
    { client_name: 'משפחת לוי',           client_phone: '050-1010101', client_email: 'levi@example.com',   organization: null,           activity_id: aId('הפעלת פארק כשרון'), instructor_id: iId('מאיה ברק'),    activity_date: addDays(monthStart, 24), start_time: '11:00', end_time: '13:00', site: 'עכו',       num_participants: 25, price_per_person: 60,  total_price: 1500, status: 'מאושר',        payment_status: 'לא שולם', notes: 'מהצעת מחיר',       instructor_notified: false },
    { client_name: 'מתנ"ס עפולה',         client_phone: '04-6543210',  client_email: 'matnas@example.com', organization: 'מתנ"ס עפולה',  activity_id: aId('יום גיבוש כיתתי'),  instructor_id: iId('נועה לוי'),    activity_date: addDays(monthStart, 27), start_time: '09:30', end_time: '13:30', site: 'נוף הגליל', num_participants: 28, price_per_person: 95,  total_price: 2660, status: 'ממתין לאישור', payment_status: 'לא שולם', notes: null,               instructor_notified: false },
  ];
  await upsertByCompositeKey('orders', rows, ['client_name', 'client_phone', 'activity_date']);
}

async function seedTasks() {
  const profId = await firstProfileId();
  const rows = [
    { title: 'הזמנת ציוד חבלים חדש',       description: 'בדיקה וחידוש ציוד חבלים בעכו',         due_date: daysFromNow(2),  due_time: '10:00', assigned_to: profId, priority: 'גבוהה',  status: 'פתוחה',  category: 'ציוד' },
    { title: 'עדכון תוכנית בטיחות שנתית',  description: 'עדכון נהלים מול בודק מוסמך',           due_date: daysFromNow(5),  due_time: null,    assigned_to: profId, priority: 'בינונית', status: 'בביצוע', category: 'אדמיניסטרציה' },
    { title: 'פרסום ברשתות חברתיות',       description: 'הכנת פוסטים לקראת חופש פסח',          due_date: daysFromNow(1),  due_time: '14:00', assigned_to: profId, priority: 'נמוכה',  status: 'פתוחה',  category: 'שיווק' },
    { title: 'הכשרת מדריך חדש',           description: 'יום הכשרה ראשוני למדריך חדש בטבריה',   due_date: daysFromNow(10), due_time: '09:00', assigned_to: profId, priority: 'בינונית', status: 'פתוחה',  category: 'הכשרה' },
    { title: 'סגירת חשבון ספק חודשי',      description: 'תשלום ספק ציוד אפריל',                due_date: daysFromNow(-2), due_time: null,    assigned_to: profId, priority: 'דחופה',  status: 'פתוחה',  category: 'אדמיניסטרציה' },
  ];
  await upsertByNaturalKey('tasks', rows, 'title');
}

async function seedMaintenance() {
  const profId = await firstProfileId();
  const rows = [
    { title: 'בדיקת חבלים שבועית',   site: 'עכו',       category: 'בטיחות', priority: 'גבוהה',  status: 'פתוחה',  description: 'בדיקה ויזואלית של כל מערכות החבלים', due_date: daysFromNow(3),  assigned_to: profId },
    { title: 'צביעת מתקני משחק',     site: 'טבריה',     category: 'מתקנים', priority: 'נמוכה',  status: 'בטיפול', description: 'חידוש צבע על מתקני העץ',             due_date: daysFromNow(14), assigned_to: profId },
    { title: 'ניקיון אזור פיקניק',    site: 'נוף הגליל', category: 'ניקיון', priority: 'בינונית', status: 'פתוחה',  description: 'ניקיון יסודי לפני סוף השבוע',         due_date: daysFromNow(2),  assigned_to: profId },
    { title: 'בדיקת ציוד רפלינג',     site: 'שטח',       category: 'ציוד',  priority: 'גבוהה',  status: 'פתוחה',  description: 'בדיקת חוטים, רתמות וגלגלות',         due_date: daysFromNow(5),  assigned_to: profId },
  ];
  await upsertByNaturalKey('maintenance_tasks', rows, 'title');
}

async function seedSales() {
  const acts = await fetchMap('activities', 'name', 'id,name');
  if (acts.size === 0) { log('sales: no activities — skipping'); return; }
  const item = (name, qty, customPrice) => {
    const a = acts.get(name);
    return a ? { id: a.id, name: a.name, qty, customPrice } : null;
  };
  const rows = [
    { items: [item('הפעלת פארק כשרון', 2, 60)],     total: 120, method: 'מזומן', sale_date: daysFromNow(-6) },
    { items: [item('סדנת טיפוס למתחילים', 1, 110)], total: 110, method: 'אשראי', sale_date: daysFromNow(-5) },
    { items: [item('יום גיבוש כיתתי', 4, 95)],      total: 380, method: 'אשראי', sale_date: daysFromNow(-4) },
    { items: [item('הפעלת פארק כשרון', 3, 60)],     total: 180, method: 'מזומן', sale_date: daysFromNow(-3) },
    { items: [item('סדנת שטח אקסטרים', 1, 220)],    total: 220, method: 'העברה', sale_date: daysFromNow(-2) },
    { items: [item('חוג טיפוס מתקדם', 2, 130)],     total: 260, method: 'אשראי', sale_date: daysFromNow(-1) },
    { items: [item('הפעלת פארק כשרון', 5, 60)],     total: 300, method: 'מזומן', sale_date: daysFromNow(0)  },
  ].filter(r => r.items.every(Boolean));

  // Idempotency: (sale_date, total, method) composite
  const existing = await rest(`/sales?select=sale_date,total,method`);
  if (!existing.ok) die(`sales lookup failed: ${existing.status} ${JSON.stringify(existing.body)}`);
  const seen = new Set(existing.body.map(s => `${s.sale_date}|${Number(s.total)}|${s.method}`));
  const missing = rows.filter(r => !seen.has(`${r.sale_date}|${Number(r.total)}|${r.method}`));
  if (missing.length === 0) { log(`sales: 0 inserted (all ${rows.length} already present)`); return; }
  const ins = await rest(`/sales`, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(missing) });
  if (!ins.ok) die(`sales insert failed: ${ins.status} ${JSON.stringify(ins.body)}`);
  log(`sales: inserted ${missing.length} (${rows.length - missing.length} already present)`);
}

async function seedPricingSheets() {
  const quote = await rest(`/quotes?select=id,quote_number&client_name=eq.${encodeURIComponent('NorthTech')}&limit=1`);
  if (!quote.ok) die(`pricing_sheets: quote lookup failed: ${quote.status} ${JSON.stringify(quote.body)}`);
  if (!quote.body.length) { log('pricing_sheets: NorthTech quote not found — skipping'); return; }
  const q = quote.body[0];
  const row = {
    title: 'תמחור NorthTech 60 איש',
    quote_id: q.id,
    quote_number: q.quote_number,
    num_participants: 60,
    categories: [
      { id: 'cat-1', name: 'ציוד', rows: [
        { id: 'r1', description: 'חבלים',  cost: 300, quantity: 60, total_cost: 18000, sell_price: 0, total_sell: 0, profit: 0, margin_pct: 0, notes: '' },
        { id: 'r2', description: 'קסדות',  cost: 50,  quantity: 60, total_cost: 3000,  sell_price: 0, total_sell: 0, profit: 0, margin_pct: 0, notes: '' },
      ]},
      { id: 'cat-2', name: 'הסעדה', rows: [
        { id: 'r3', description: 'ארוחת צהריים', cost: 45, quantity: 60, total_cost: 2700, sell_price: 60, total_sell: 3600, profit: 900, margin_pct: 25.0, notes: '' },
      ]},
    ],
    total_cost: 23700, total_sell: 8500, total_profit: -15200, margin_pct: -64.13,
    notes: 'תמחור גס לבדיקה',
  };
  await upsertByNaturalKey('pricing_sheets', [row], 'title');
}

// ============================================================
// GENERIC HELPERS
// ============================================================
async function upsertByNaturalKey(table, rows, keyCol) {
  if (rows.length === 0) return;
  const keys = rows.map(r => r[keyCol]);
  const q = `/${table}?select=${keyCol}&${keyCol}=in.(${keys.map(k => `"${escapeIn(k)}"`).join(',')})`;
  const existing = await rest(q);
  if (!existing.ok) die(`${table} lookup failed: ${existing.status} ${JSON.stringify(existing.body)}`);
  const have = new Set(existing.body.map(r => r[keyCol]));
  const missing = rows.filter(r => !have.has(r[keyCol]));
  if (missing.length === 0) { log(`${table}: 0 inserted (all ${rows.length} already present)`); return; }
  const ins = await rest(`/${table}`, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(missing) });
  if (!ins.ok) die(`${table} insert failed: ${ins.status} ${JSON.stringify(ins.body)}`);
  log(`${table}: inserted ${missing.length} (${rows.length - missing.length} already present)`);
}

async function upsertByCompositeKey(table, rows, keyCols) {
  if (rows.length === 0) return;
  // Fetch existing rows constrained by the first key (cheap filter), then dedupe in JS by composite
  const firstKey = keyCols[0];
  const firstVals = [...new Set(rows.map(r => r[firstKey]))];
  const q = `/${table}?select=${keyCols.join(',')}&${firstKey}=in.(${firstVals.map(v => `"${escapeIn(v)}"`).join(',')})`;
  const existing = await rest(q);
  if (!existing.ok) die(`${table} lookup failed: ${existing.status} ${JSON.stringify(existing.body)}`);
  const sig = (r) => keyCols.map(c => String(r[c])).join('|');
  const have = new Set(existing.body.map(sig));
  const missing = rows.filter(r => !have.has(sig(r)));
  if (missing.length === 0) { log(`${table}: 0 inserted (all ${rows.length} already present)`); return; }
  const ins = await rest(`/${table}`, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(missing) });
  if (!ins.ok) die(`${table} insert failed: ${ins.status} ${JSON.stringify(ins.body)}`);
  log(`${table}: inserted ${missing.length} (${rows.length - missing.length} already present)`);
}

async function fetchMap(table, keyCol, selectCols) {
  const r = await rest(`/${table}?select=${selectCols}`);
  if (!r.ok) die(`${table} fetch failed: ${r.status} ${JSON.stringify(r.body)}`);
  const m = new Map();
  for (const row of r.body) m.set(row[keyCol], row);
  return m;
}

async function firstProfileId() {
  const r = await rest(`/profiles?select=id&order=created_at.asc&limit=1`);
  if (!r.ok || !r.body.length) return null;
  return r.body[0].id;
}

async function getAllCounts() {
  const out = {};
  out.profiles = await countRows('profiles');
  for (const t of BUSINESS_TABLES) out[t] = await countRows(t);
  return out;
}

async function countRows(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
    method: 'HEAD',
    headers: { ...BASE_HEADERS, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' },
  });
  const cr = res.headers.get('content-range');
  if (!cr) return null;
  const total = cr.split('/')[1];
  return total === '*' ? null : parseInt(total, 10);
}

async function rest(p, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${p}`, {
    ...opts,
    headers: { ...BASE_HEADERS, ...(opts.headers || {}) },
  });
  const txt = await res.text();
  let body = txt;
  try { body = txt ? JSON.parse(txt) : null; } catch { /* keep text */ }
  return { ok: res.ok, status: res.status, body };
}

// ============================================================
// UTILITIES
// ============================================================
function readEnvFile(p) {
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}

function daysFromNow(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function startOfMonth() {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function escapeIn(v) { return String(v).replaceAll('"', '\\"'); }
function printCounts(c) {
  const w = Math.max(...Object.keys(c).map(k => k.length));
  for (const [k, v] of Object.entries(c)) log(`  ${k.padEnd(w)}  ${v ?? '?'}`);
}
function log(...a) { console.log(...a); }
function die(msg) { console.error('ERROR:', msg); process.exit(1); }
