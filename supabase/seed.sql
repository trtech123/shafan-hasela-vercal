-- ============================================================
-- Seed data for Shafan Hasela MVP recovery (Phase 1)
--
-- Idempotent: re-running is a no-op for already-seeded rows.
-- Uses WHERE NOT EXISTS clauses on natural keys (name / full_name / title).
--
-- Run via: scripts/run-seed.mjs  (preferred; uses service-role from .env.local)
-- Or paste into Supabase Dashboard SQL Editor.
--
-- IMPORTANT — leads.status values:
--   This file uses ONLY values present in BOTH the original 001 constraint
--   ('פתוח', 'טופל', 'לא רלוונטי') AND the post-006 constraint
--   ('פתוח', 'נשלח', 'נסגר', 'לא רלוונטי') → namely 'פתוח' and 'לא רלוונטי' only.
--   To use the richer post-006 statuses ('נשלח', 'נסגר'), apply 006 first
--   then add additional UPDATE statements at the bottom.
-- ============================================================

-- ---- Promote the single existing profile to admin (Phase 1 step) ----
UPDATE public.profiles
   SET role = 'admin'
 WHERE id IN (SELECT id FROM public.profiles ORDER BY created_at ASC LIMIT 1);

-- ============================================================
-- Activities
-- ============================================================
INSERT INTO public.activities (name, category, description, duration_hours, max_participants, price_per_person, status)
SELECT * FROM (VALUES
  ('הפעלת פארק כשרון',          'הפעלת פארק', 'הפעלת פארק חבלים לקבוצות עד 30 משתתפים',                  2.0::numeric, 30, 60.00::numeric,  'פעיל'),
  ('יום גיבוש כיתתי',           'יום גיבוש',  'יום גיבוש קצר עם פעילויות שטח קלות',                       4.0::numeric, 35, 95.00::numeric,  'פעיל'),
  ('סדנת טיפוס למתחילים',       'חוג טיפוס',  'מבוא לטיפוס ספורטיבי, ציוד כלול',                         2.0::numeric, 12, 110.00::numeric, 'פעיל'),
  ('סדנת שטח אקסטרים',          'סדנת שטח',  'יום שטח מאתגר כולל ניווט, רפלינג ופעילות קבוצתית',          5.0::numeric, 20, 220.00::numeric, 'פעיל'),
  ('יום גיבוש לחברה',           'יום גיבוש',  'יום גיבוש מלא לחברות, כולל ארוחת צהריים והפעלות',           6.0::numeric, 80, 150.00::numeric, 'פעיל'),
  ('חוג טיפוס מתקדם',          'חוג טיפוס',  'אימון טיפוס למתקדמים, דגש על טכניקה',                      1.5::numeric, 10, 130.00::numeric, 'פעיל')
) AS v(name, category, description, duration_hours, max_participants, price_per_person, status)
WHERE NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.name = v.name);

-- ============================================================
-- Instructors
-- ============================================================
INSERT INTO public.instructors (full_name, phone, email, specialties, status)
SELECT v.full_name, v.phone, v.email, v.specialties::text[], v.status FROM (VALUES
  ('דניאל כהן',  '050-1234567', 'dani@example.com',  ARRAY['הפעלת פארק', 'יום גיבוש'],   'פעיל'),
  ('נועה לוי',   '052-2345678', 'noa@example.com',   ARRAY['חוג טיפוס'],                  'פעיל'),
  ('תומר אבני',  '054-3456789', 'tomer@example.com', ARRAY['סדנת שטח', 'יום גיבוש'],      'פעיל'),
  ('מאיה ברק',   '053-4567890', 'maya@example.com',  ARRAY['הפעלת פארק', 'חוג טיפוס'],    'פעיל')
) AS v(full_name, phone, email, specialties, status)
WHERE NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.full_name = v.full_name);

-- ============================================================
-- Leads (using only enum values valid in BOTH old + new constraint)
-- Sites use leads-specific enum: עכו / טבריה / שטח / ויה פרטה
-- ============================================================
INSERT INTO public.leads (full_name, phone, email, company, site, event_date, status, source_text, notes)
SELECT * FROM (VALUES
  ('משפחת אברהמי',   '050-1112233', 'avraham@example.com',  NULL,                'עכו',       (CURRENT_DATE + INTERVAL '14 days')::date, 'פתוח',       'התקשרו על יום הולדת לבן 10',  NULL),
  ('בית ספר רעות',  '04-9876543',  'school@example.com',   'בית ספר רעות',      'טבריה',     (CURRENT_DATE + INTERVAL '21 days')::date, 'פתוח',       'יום גיבוש לכיתות ה-ו',         'תאריך גמיש'),
  ('חברת היי-טק',   '03-5551234',  'hr@hitech.example',    'NorthTech',         'ויה פרטה',  (CURRENT_DATE + INTERVAL '30 days')::date, 'פתוח',       'יום גיבוש לחברה, 60 איש',      NULL),
  ('יעל מזרחי',     '052-9998877', NULL,                   NULL,                'שטח',       (CURRENT_DATE +  INTERVAL '7 days')::date, 'לא רלוונטי','חיפשה אטרקציות לילדים קטנים מדי', 'לא מתאים לגיל הזה'),
  ('עומר טל',       '054-4445555', 'omer@example.com',     NULL,                'עכו',       (CURRENT_DATE + INTERVAL '45 days')::date, 'פתוח',       'מסיבת רווקים',                 NULL)
) AS v(full_name, phone, email, company, site, event_date, status, source_text, notes)
WHERE NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.full_name = v.full_name AND l.phone = v.phone);

-- ============================================================
-- Quotes
-- selected_activities JSONB shape:
--   [{activity_id, activity_name, price_per_person, duration_hours, image_url}]
-- ============================================================
INSERT INTO public.quotes (client_name, client_phone, client_email, organization, event_date, site, num_participants,
                           selected_activities, total_price, discount, final_price, status, notes)
SELECT
  v.client_name, v.client_phone, v.client_email, v.organization, v.event_date::date, v.site, v.num_participants,
  v.selected_activities::jsonb, v.total_price::numeric, v.discount::numeric, v.final_price::numeric, v.status, v.notes
FROM (VALUES
  (
    'משפחת לוי', '050-1010101', 'levi@example.com', NULL,
    (CURRENT_DATE + INTERVAL '20 days')::date, 'עכו', 25,
    (SELECT json_build_array(json_build_object(
       'activity_id', a.id::text, 'activity_name', a.name,
       'price_per_person', a.price_per_person, 'duration_hours', a.duration_hours, 'image_url', a.image_url
     ))::text FROM public.activities a WHERE a.name = 'הפעלת פארק כשרון' LIMIT 1),
    1500.00, 0.00, 1500.00, 'טיוטה', 'בקשה לאזור הצפוני של הפארק'
  ),
  (
    'בית ספר אורן', '04-7777777', 'school@oren.example', 'בית ספר אורן',
    (CURRENT_DATE + INTERVAL '15 days')::date, 'טבריה', 60,
    (SELECT json_build_array(
       json_build_object('activity_id', a1.id::text, 'activity_name', a1.name, 'price_per_person', a1.price_per_person, 'duration_hours', a1.duration_hours, 'image_url', a1.image_url),
       json_build_object('activity_id', a2.id::text, 'activity_name', a2.name, 'price_per_person', a2.price_per_person, 'duration_hours', a2.duration_hours, 'image_url', a2.image_url)
     )::text FROM public.activities a1, public.activities a2
       WHERE a1.name = 'יום גיבוש כיתתי' AND a2.name = 'חוג טיפוס מתקדם' LIMIT 1),
    8400.00, 400.00, 8000.00, 'נשלחה', NULL
  ),
  (
    'NorthTech', '03-5551234', 'hr@hitech.example', 'NorthTech בע"מ',
    (CURRENT_DATE + INTERVAL '30 days')::date, 'נוף הגליל', 60,
    (SELECT json_build_array(json_build_object(
       'activity_id', a.id::text, 'activity_name', a.name,
       'price_per_person', a.price_per_person, 'duration_hours', a.duration_hours, 'image_url', a.image_url
     ))::text FROM public.activities a WHERE a.name = 'יום גיבוש לחברה' LIMIT 1),
    9000.00, 500.00, 8500.00, 'ממתינה לאישור', 'ממתין לחתימה'
  ),
  (
    'מועדון הטיפוס שטח', '054-8889999', NULL, NULL,
    (CURRENT_DATE +  INTERVAL '7 days')::date, 'שטח', 14,
    (SELECT json_build_array(json_build_object(
       'activity_id', a.id::text, 'activity_name', a.name,
       'price_per_person', a.price_per_person, 'duration_hours', a.duration_hours, 'image_url', a.image_url
     ))::text FROM public.activities a WHERE a.name = 'סדנת שטח אקסטרים' LIMIT 1),
    3080.00, 0.00, 3080.00, 'אושרה', NULL
  )
) AS v(client_name, client_phone, client_email, organization, event_date, site, num_participants,
       selected_activities, total_price, discount, final_price, status, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.quotes q WHERE q.client_name = v.client_name AND q.client_phone = v.client_phone
);

-- ============================================================
-- Orders (spread across the current month so Dashboard + Schedule populate)
-- ============================================================
INSERT INTO public.orders (client_name, client_phone, client_email, organization,
                           activity_id, instructor_id, activity_date, start_time, end_time,
                           site, num_participants, price_per_person, total_price,
                           status, payment_status, notes, instructor_notified)
SELECT v.client_name, v.client_phone, v.client_email, v.organization,
       (SELECT id FROM public.activities  WHERE name = v.activity_name),
       (SELECT id FROM public.instructors WHERE full_name = v.instructor_name),
       v.activity_date::date, v.start_time::time, v.end_time::time,
       v.site, v.num_participants, v.price_per_person::numeric, v.total_price::numeric,
       v.status, v.payment_status, v.notes, v.instructor_notified
FROM (VALUES
  ('משפחת כהן',        '050-2223344', 'cohen@example.com',  NULL,           'הפעלת פארק כשרון',     'דניאל כהן',
     (date_trunc('month', CURRENT_DATE) + INTERVAL  '3 days')::date,  '10:00', '12:00', 'עכו',      28, 60.00,  1680.00, 'בוצע',         'אשראי',   NULL, true),
  ('בית ספר נוף',       '04-1112223',  'school@nof.example', 'בית ספר נוף',  'יום גיבוש כיתתי',       'תומר אבני',
     (date_trunc('month', CURRENT_DATE) + INTERVAL  '7 days')::date,  '09:00', '13:00', 'טבריה',    32, 95.00,  3040.00, 'בוצע',         'מזומן',   NULL, true),
  ('NorthTech',         '03-5551234',  'hr@hitech.example',  'NorthTech',    'יום גיבוש לחברה',       'דניאל כהן',
     (date_trunc('month', CURRENT_DATE) + INTERVAL '12 days')::date,  '09:00', '15:00', 'נוף הגליל', 65, 150.00, 9750.00, 'מאושר',        'שובר',    'יום גיבוש שנתי', true),
  ('מועדון טיפוס תל אביב', '054-1212121', 'club@example.com', NULL,         'חוג טיפוס מתקדם',       'נועה לוי',
     (date_trunc('month', CURRENT_DATE) + INTERVAL '15 days')::date,  '17:00', '18:30', 'עכו',      10, 130.00, 1300.00, 'מאושר',        'אשראי',   NULL, false),
  ('משפחת אברהמי',     '050-1112233', 'avraham@example.com', NULL,         'הפעלת פארק כשרון',     'מאיה ברק',
     (date_trunc('month', CURRENT_DATE) + INTERVAL '18 days')::date,  '14:00', '16:00', 'עכו',      22, 60.00,  1320.00, 'ממתין לאישור', 'לא שולם', NULL, false),
  ('סדנת שטח קבוצתית',  '052-7777777', NULL,                  NULL,         'סדנת שטח אקסטרים',     'תומר אבני',
     (date_trunc('month', CURRENT_DATE) + INTERVAL '22 days')::date,  '08:00', '13:00', 'שטח',      18, 220.00, 3960.00, 'שולם',         'אשראי',   NULL, true),
  ('משפחת לוי',         '050-1010101', 'levi@example.com',    NULL,         'הפעלת פארק כשרון',     'מאיה ברק',
     (date_trunc('month', CURRENT_DATE) + INTERVAL '24 days')::date,  '11:00', '13:00', 'עכו',      25, 60.00,  1500.00, 'מאושר',        'לא שולם', 'מהצעת מחיר', false),
  ('מתנ"ס עפולה',       '04-6543210',  'matnas@example.com',  'מתנ"ס עפולה', 'יום גיבוש כיתתי',       'נועה לוי',
     (date_trunc('month', CURRENT_DATE) + INTERVAL '27 days')::date,  '09:30', '13:30', 'נוף הגליל', 28, 95.00,  2660.00, 'ממתין לאישור', 'לא שולם', NULL, false)
) AS v(client_name, client_phone, client_email, organization, activity_name, instructor_name,
       activity_date, start_time, end_time, site, num_participants, price_per_person, total_price,
       status, payment_status, notes, instructor_notified)
WHERE NOT EXISTS (
  SELECT 1 FROM public.orders o
   WHERE o.client_name = v.client_name AND o.client_phone = v.client_phone
     AND o.activity_date = v.activity_date::date
);

-- ============================================================
-- Tasks (assigned_to = single existing profile)
-- ============================================================
INSERT INTO public.tasks (title, description, due_date, due_time, assigned_to, priority, status, category)
SELECT v.title, v.description, v.due_date::date, v.due_time::time,
       (SELECT id FROM public.profiles ORDER BY created_at ASC LIMIT 1),
       v.priority, v.status, v.category
FROM (VALUES
  ('הזמנת ציוד חבלים חדש',       'בדיקה וחידוש ציוד חבלים בעכו',          (CURRENT_DATE + INTERVAL  '2 days')::date, '10:00', 'גבוהה',  'פתוחה',  'ציוד'),
  ('עדכון תוכנית בטיחות שנתית',  'עדכון נהלים מול בודק מוסמך',             (CURRENT_DATE + INTERVAL  '5 days')::date, NULL,    'בינונית', 'בביצוע','אדמיניסטרציה'),
  ('פרסום ברשתות חברתיות',       'הכנת פוסטים לקראת חופש פסח',            (CURRENT_DATE + INTERVAL  '1 day')::date,  '14:00', 'נמוכה',  'פתוחה',  'שיווק'),
  ('הכשרת מדריך חדש',           'יום הכשרה ראשוני למדריך חדש בטבריה',     (CURRENT_DATE + INTERVAL '10 days')::date, '09:00', 'בינונית', 'פתוחה',  'הכשרה'),
  ('סגירת חשבון ספק חודשי',      'תשלום ספק ציוד אפריל',                  (CURRENT_DATE - INTERVAL  '2 days')::date, NULL,    'דחופה',  'פתוחה',  'אדמיניסטרציה')
) AS v(title, description, due_date, due_time, priority, status, category)
WHERE NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.title = v.title);

-- ============================================================
-- Maintenance tasks (one per site)
-- ============================================================
INSERT INTO public.maintenance_tasks (title, site, category, priority, status, description, due_date, assigned_to)
SELECT v.title, v.site, v.category, v.priority, v.status, v.description, v.due_date::date,
       (SELECT id FROM public.profiles ORDER BY created_at ASC LIMIT 1)
FROM (VALUES
  ('בדיקת חבלים שבועית',        'עכו',      'בטיחות', 'גבוהה',  'פתוחה',  'בדיקה ויזואלית של כל מערכות החבלים',  (CURRENT_DATE + INTERVAL '3 days')::date),
  ('צביעת מתקני משחק',          'טבריה',    'מתקנים', 'נמוכה',  'בטיפול','חידוש צבע על מתקני העץ',              (CURRENT_DATE + INTERVAL '14 days')::date),
  ('ניקיון אזור פיקניק',         'נוף הגליל', 'ניקיון', 'בינונית', 'פתוחה', 'ניקיון יסודי לפני סוף השבוע',          (CURRENT_DATE + INTERVAL '2 days')::date),
  ('בדיקת ציוד רפלינג',          'שטח',      'ציוד',  'גבוהה',  'פתוחה',  'בדיקת חוטים, רתמות וגלגלות',          (CURRENT_DATE + INTERVAL '5 days')::date)
) AS v(title, site, category, priority, status, description, due_date)
WHERE NOT EXISTS (SELECT 1 FROM public.maintenance_tasks m WHERE m.title = v.title);

-- ============================================================
-- Sales (last 7 days, varying methods + totals)
-- items JSONB shape: [{id, name, qty, customPrice}]
-- ============================================================
INSERT INTO public.sales (items, total, method, sale_date)
SELECT v.items::jsonb, v.total::numeric, v.method, v.sale_date::date
FROM (VALUES
  ((SELECT json_build_array(json_build_object('id', a.id::text, 'name', a.name, 'qty', 2, 'customPrice', 60))::text
    FROM public.activities a WHERE a.name = 'הפעלת פארק כשרון' LIMIT 1),  120.00, 'מזומן',   (CURRENT_DATE - INTERVAL '6 days')::date),
  ((SELECT json_build_array(json_build_object('id', a.id::text, 'name', a.name, 'qty', 1, 'customPrice', 110))::text
    FROM public.activities a WHERE a.name = 'סדנת טיפוס למתחילים' LIMIT 1), 110.00, 'אשראי',  (CURRENT_DATE - INTERVAL '5 days')::date),
  ((SELECT json_build_array(json_build_object('id', a.id::text, 'name', a.name, 'qty', 4, 'customPrice', 95))::text
    FROM public.activities a WHERE a.name = 'יום גיבוש כיתתי' LIMIT 1),    380.00, 'אשראי',  (CURRENT_DATE - INTERVAL '4 days')::date),
  ((SELECT json_build_array(json_build_object('id', a.id::text, 'name', a.name, 'qty', 3, 'customPrice', 60))::text
    FROM public.activities a WHERE a.name = 'הפעלת פארק כשרון' LIMIT 1),  180.00, 'מזומן',   (CURRENT_DATE - INTERVAL '3 days')::date),
  ((SELECT json_build_array(json_build_object('id', a.id::text, 'name', a.name, 'qty', 1, 'customPrice', 220))::text
    FROM public.activities a WHERE a.name = 'סדנת שטח אקסטרים' LIMIT 1),  220.00, 'העברה',  (CURRENT_DATE - INTERVAL '2 days')::date),
  ((SELECT json_build_array(json_build_object('id', a.id::text, 'name', a.name, 'qty', 2, 'customPrice', 130))::text
    FROM public.activities a WHERE a.name = 'חוג טיפוס מתקדם' LIMIT 1),   260.00, 'אשראי',  (CURRENT_DATE - INTERVAL '1 day')::date),
  ((SELECT json_build_array(json_build_object('id', a.id::text, 'name', a.name, 'qty', 5, 'customPrice', 60))::text
    FROM public.activities a WHERE a.name = 'הפעלת פארק כשרון' LIMIT 1),  300.00, 'מזומן',  CURRENT_DATE)
) AS v(items, total, method, sale_date)
WHERE NOT EXISTS (
  SELECT 1 FROM public.sales s WHERE s.sale_date = v.sale_date::date AND s.total = v.total::numeric AND s.method = v.method
);

-- ============================================================
-- Pricing sheets (1 row, linked to NorthTech quote)
-- ============================================================
INSERT INTO public.pricing_sheets (title, quote_id, quote_number, num_participants, categories,
                                   total_cost, total_sell, total_profit, margin_pct, notes)
SELECT 'תמחור NorthTech 60 איש',
       q.id, q.quote_number, 60,
       jsonb_build_array(
         jsonb_build_object(
           'id', 'cat-1',
           'name', 'ציוד',
           'rows', jsonb_build_array(
             jsonb_build_object('id','r1','description','חבלים','cost',300,'quantity',60,'total_cost',18000,'sell_price',0,'total_sell',0,'profit',0,'margin_pct',0,'notes',''),
             jsonb_build_object('id','r2','description','קסדות','cost',50,'quantity',60,'total_cost',3000,'sell_price',0,'total_sell',0,'profit',0,'margin_pct',0,'notes','')
           )
         ),
         jsonb_build_object(
           'id', 'cat-2',
           'name', 'הסעדה',
           'rows', jsonb_build_array(
             jsonb_build_object('id','r3','description','ארוחת צהריים','cost',45,'quantity',60,'total_cost',2700,'sell_price',60,'total_sell',3600,'profit',900,'margin_pct',25.0,'notes','')
           )
         )
       ),
       23700, 8500, -15200, -64.13, 'תמחור גס לבדיקה'
  FROM public.quotes q
 WHERE q.client_name = 'NorthTech'
   AND NOT EXISTS (SELECT 1 FROM public.pricing_sheets p WHERE p.title = 'תמחור NorthTech 60 איש')
 LIMIT 1;
