-- ============================================================
-- Migration 020: Editable message templates
--
-- Admin-editable text for system messages (email / WhatsApp / quote /
-- instructor invitation). This migration ONLY stores templates + seeds
-- defaults; production sending logic is NOT switched over here (kept safe).
--
-- Placeholders use {curlyBraces} (e.g. {clientName}). default_body keeps the
-- seeded text so the UI can offer "reset to default".
--
-- RLS: staff read (future message use), admin write. Idempotent (re-runnable).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.message_templates (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key          TEXT UNIQUE NOT NULL,
  title        TEXT NOT NULL,
  channel      TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'general')),
  body         TEXT NOT NULL,
  default_body TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_message_templates_updated_at ON public.message_templates;
CREATE TRIGGER trg_message_templates_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS ---------------------------------------------------------
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "templates: all staff read" ON public.message_templates;
CREATE POLICY "templates: all staff read"
  ON public.message_templates FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "templates: admin insert" ON public.message_templates;
CREATE POLICY "templates: admin insert"
  ON public.message_templates FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "templates: admin update" ON public.message_templates;
CREATE POLICY "templates: admin update"
  ON public.message_templates FOR UPDATE
  USING (public.is_admin());

-- Seed defaults (reuse existing in-app message texts). ON CONFLICT keeps any
-- admin edits if the migration is re-run.
INSERT INTO public.message_templates (key, title, channel, body, default_body) VALUES
(
  'order_confirmation_email',
  'אישור הזמנה — אימייל',
  'email',
  E'שלום {clientName},\n\nמצורף אישור ההזמנה עבור פעילות {activityName} בתאריך {activityDate}.\nהמסמך כולל את פרטי ההזמנה, תנאי ההזמנה והצהרת הבריאות והבטיחות.\nנא להחזיר את הטופס מלא וחתום.\n\nבברכה,\nצוות שפן הסלע',
  E'שלום {clientName},\n\nמצורף אישור ההזמנה עבור פעילות {activityName} בתאריך {activityDate}.\nהמסמך כולל את פרטי ההזמנה, תנאי ההזמנה והצהרת הבריאות והבטיחות.\nנא להחזיר את הטופס מלא וחתום.\n\nבברכה,\nצוות שפן הסלע'
),
(
  'order_whatsapp',
  'אישור הזמנה — וואטסאפ',
  'whatsapp',
  E'שלום {clientName},\n\nמצורף אישור ההזמנה שלך לפעילות {activityName} בתאריך {activityDate}.\n\nפרטי ההזמנה:\n• מספר הזמנה: {orderNumber}\n• מספר משתתפים: {participants}\n• סה״כ לתשלום: ₪{total}\n\nנא להחזיר את הטופס מלא וחתום.\n\nתודה! 🏔️ צוות שפן הסלע',
  E'שלום {clientName},\n\nמצורף אישור ההזמנה שלך לפעילות {activityName} בתאריך {activityDate}.\n\nפרטי ההזמנה:\n• מספר הזמנה: {orderNumber}\n• מספר משתתפים: {participants}\n• סה״כ לתשלום: ₪{total}\n\nנא להחזיר את הטופס מלא וחתום.\n\nתודה! 🏔️ צוות שפן הסלע'
),
(
  'quote_message',
  'הצעת מחיר — הודעה',
  'general',
  E'שלום {clientName},\n\nמצורפת הצעת מחיר עבור {activityName}.\nנשמח לעמוד לרשותך לכל שאלה.\n\nבברכה,\nצוות שפן הסלע',
  E'שלום {clientName},\n\nמצורפת הצעת מחיר עבור {activityName}.\nנשמח לעמוד לרשותך לכל שאלה.\n\nבברכה,\nצוות שפן הסלע'
),
(
  'instructor_invitation',
  'הזמנת מדריך לשיבוץ',
  'whatsapp',
  E'שלום {instructorName},\n\nשובצת לפעילות:\n🏔️ {activityName}\n📅 {activityDate}\n🕐 {startTime}\n📍 {site}\n👤 לקוח: {clientName}\n👥 {participants} משתתפים\n\nבהצלחה!',
  E'שלום {instructorName},\n\nשובצת לפעילות:\n🏔️ {activityName}\n📅 {activityDate}\n🕐 {startTime}\n📍 {site}\n👤 לקוח: {clientName}\n👥 {participants} משתתפים\n\nבהצלחה!'
)
ON CONFLICT (key) DO NOTHING;
