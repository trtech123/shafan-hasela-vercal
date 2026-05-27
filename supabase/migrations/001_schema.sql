-- ============================================================
-- Migration 001: Core Schema
-- Project: Shafan Hasela — Adventure Operations Pro
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- fuzzy text search on client names

-- ============================================================
-- ENUMS & TYPES
-- ============================================================

CREATE TYPE user_role AS ENUM ('admin', 'operations', 'instructor');

-- ============================================================
-- SEQUENCES (human-readable numbers)
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1000;
CREATE SEQUENCE IF NOT EXISTS quote_number_seq START 1000;
CREATE SEQUENCE IF NOT EXISTS receipt_number_seq START 1000;

-- ============================================================
-- SHARED TRIGGER: updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TABLE: profiles
-- Extends auth.users. One row per authenticated user.
-- ============================================================

CREATE TABLE public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT,
  full_name   TEXT,
  role        user_role NOT NULL DEFAULT 'instructor',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE: activities
-- Adventure activities offered by the company.
-- ============================================================

CREATE TABLE public.activities (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  category          TEXT CHECK (
    category IN ('הפעלת פארק', 'יום גיבוש', 'חוג טיפוס', 'סדנת שטח')
  ),
  description       TEXT,
  duration_hours    NUMERIC(4,2),
  max_participants  INTEGER,
  price_per_person  NUMERIC(10,2),
  image_url         TEXT,          -- primary/thumbnail image
  images            TEXT[] DEFAULT '{}', -- additional image URLs
  status            TEXT NOT NULL DEFAULT 'פעיל' CHECK (status IN ('פעיל', 'לא פעיל')),
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_activities_updated_at
  BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE: instructors
-- Staff who lead activities at various sites.
-- ============================================================

CREATE TABLE public.instructors (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name   TEXT NOT NULL,
  phone       TEXT NOT NULL,
  email       TEXT,
  specialties TEXT[] DEFAULT '{}', -- e.g. ['הפעלת פארק', 'חוג טיפוס']
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'פעיל' CHECK (status IN ('פעיל', 'לא פעיל')),
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_instructors_updated_at
  BEFORE UPDATE ON public.instructors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE: quotes
-- Created before orders. Can be converted to an order.
-- NOTE: orders.quote_id FK is added after orders table.
-- ============================================================

CREATE TABLE public.quotes (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_number          TEXT UNIQUE NOT NULL DEFAULT ('QUO-' || nextval('quote_number_seq')::TEXT),
  client_name           TEXT NOT NULL,
  client_phone          TEXT NOT NULL,
  client_email          TEXT,
  organization          TEXT,
  event_date            DATE,
  site                  TEXT CHECK (site IN ('עכו', 'טבריה', 'נוף הגליל', 'שטח')),
  num_participants      INTEGER,
  -- JSONB: [{activity_id, activity_name, price_per_person, duration_hours, image_url}]
  selected_activities   JSONB NOT NULL DEFAULT '[]',
  total_price           NUMERIC(10,2),
  discount              NUMERIC(10,2) DEFAULT 0,
  final_price           NUMERIC(10,2),
  notes                 TEXT,
  status                TEXT NOT NULL DEFAULT 'טיוטה' CHECK (
    status IN ('טיוטה', 'נשלחה', 'ממתינה לאישור', 'אושרה', 'בוטלה')
  ),
  converted_to_order_id UUID,       -- FK added after orders table
  created_by            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_quotes_updated_at
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE: orders
-- Core business record. May originate from a quote or lead.
-- ============================================================

CREATE TABLE public.orders (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number            TEXT UNIQUE NOT NULL DEFAULT ('ORD-' || nextval('order_number_seq')::TEXT),
  client_name             TEXT NOT NULL,
  client_phone            TEXT NOT NULL,
  client_email            TEXT,
  organization            TEXT,
  activity_id             UUID REFERENCES public.activities(id) ON DELETE SET NULL,
  instructor_id           UUID REFERENCES public.instructors(id) ON DELETE SET NULL,
  activity_date           DATE NOT NULL,
  start_time              TIME,
  end_time                TIME,
  site                    TEXT CHECK (site IN ('עכו', 'טבריה', 'נוף הגליל', 'שטח')),
  num_participants        INTEGER NOT NULL,
  price_per_person        NUMERIC(10,2),
  total_price             NUMERIC(10,2),
  status                  TEXT NOT NULL DEFAULT 'ממתין לאישור' CHECK (
    status IN ('ממתין לאישור', 'מאושר', 'שולם', 'בוצע', 'בוטל')
  ),
  payment_status          TEXT DEFAULT 'לא שולם' CHECK (
    payment_status IN ('לא שולם', 'שובר', 'אשראי', 'צ''ק', 'מזומן')
  ),
  notes                   TEXT,
  instructor_notified     BOOLEAN NOT NULL DEFAULT FALSE,

  -- Billing / institutional client details
  billing_institution_name  TEXT,
  billing_signer_name       TEXT,
  billing_signer_id         TEXT,
  billing_signer_role       TEXT,
  billing_signer_phone      TEXT,
  billing_company_id        TEXT,
  billing_accounting_email  TEXT,

  -- Lineage
  quote_id    UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Resolve forward reference from quotes
ALTER TABLE public.quotes
  ADD CONSTRAINT fk_quotes_converted_to_order
  FOREIGN KEY (converted_to_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE: leads
-- Potential clients. AI-parsed from free text. → quote → order.
-- ============================================================

CREATE TABLE public.leads (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name             TEXT NOT NULL,
  phone                 TEXT,
  email                 TEXT,
  company               TEXT,
  site                  TEXT CHECK (site IN ('עכו', 'טבריה', 'שטח', 'ויה פרטה')),
  event_date            DATE,
  status                TEXT NOT NULL DEFAULT 'פתוח' CHECK (
    status IN ('פתוח', 'טופל', 'לא רלוונטי')
  ),
  source_text           TEXT,  -- original raw text (WhatsApp/email) before AI parsing
  notes                 TEXT,
  converted_to_quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
  created_by            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE: tasks
-- Internal task management. assigned_to is a profile UUID.
-- ============================================================

CREATE TABLE public.tasks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       TEXT NOT NULL,
  description TEXT,
  due_date    DATE NOT NULL,
  due_time    TIME,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  priority    TEXT NOT NULL DEFAULT 'בינונית' CHECK (
    priority IN ('נמוכה', 'בינונית', 'גבוהה', 'דחופה')
  ),
  status      TEXT NOT NULL DEFAULT 'פתוחה' CHECK (
    status IN ('פתוחה', 'בביצוע', 'הושלמה', 'בוטלה')
  ),
  category    TEXT DEFAULT 'אחר' CHECK (
    category IN ('ציוד', 'תחזוקה', 'אדמיניסטרציה', 'הכשרה', 'שיווק', 'אחר')
  ),
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE: maintenance_tasks
-- Site equipment & safety tracking per location.
-- ============================================================

CREATE TABLE public.maintenance_tasks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       TEXT NOT NULL,
  site        TEXT NOT NULL CHECK (site IN ('עכו', 'טבריה', 'נוף הגליל', 'שטח')),
  category    TEXT CHECK (
    category IN ('בטיחות', 'ציוד', 'מתקנים', 'ניקיון', 'כללי')
  ),
  priority    TEXT NOT NULL DEFAULT 'בינונית' CHECK (
    priority IN ('גבוהה', 'בינונית', 'נמוכה')
  ),
  status      TEXT NOT NULL DEFAULT 'פתוחה' CHECK (
    status IN ('פתוחה', 'בטיפול', 'הושלמה')
  ),
  description TEXT,
  due_date    DATE,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_maintenance_tasks_updated_at
  BEFORE UPDATE ON public.maintenance_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE: sales
-- Point-of-sale / cash register receipts.
-- items JSONB: [{id, name, qty, customPrice}]
-- ============================================================

CREATE TABLE public.sales (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_number TEXT UNIQUE NOT NULL DEFAULT ('RCP-' || nextval('receipt_number_seq')::TEXT),
  items          JSONB NOT NULL DEFAULT '[]',
  total          NUMERIC(10,2) NOT NULL,
  method         TEXT NOT NULL, -- 'מזומן', 'אשראי', etc.
  sale_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_sales_updated_at
  BEFORE UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE: pricing_sheets
-- Cost/margin analysis sheets linked to leads or quotes.
-- categories JSONB: [{id, name, rows: [{description, cost, qty, sell_price, ...}]}]
-- ============================================================

CREATE TABLE public.pricing_sheets (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title         TEXT NOT NULL,
  lead_id       UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  lead_name     TEXT,  -- denormalized for display when lead is deleted
  quote_id      UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
  quote_number  TEXT,  -- denormalized
  num_participants INTEGER,
  categories    JSONB NOT NULL DEFAULT '[]',
  total_cost    NUMERIC(10,2),
  total_sell    NUMERIC(10,2),
  total_profit  NUMERIC(10,2),
  margin_pct    NUMERIC(5,2),
  notes         TEXT,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_pricing_sheets_updated_at
  BEFORE UPDATE ON public.pricing_sheets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- INDEXES
-- ============================================================

-- Orders — most queried table
CREATE INDEX idx_orders_activity_date    ON public.orders(activity_date);
CREATE INDEX idx_orders_status           ON public.orders(status);
CREATE INDEX idx_orders_payment_status   ON public.orders(payment_status);
CREATE INDEX idx_orders_activity_id      ON public.orders(activity_id);
CREATE INDEX idx_orders_instructor_id    ON public.orders(instructor_id);
CREATE INDEX idx_orders_quote_id         ON public.orders(quote_id);
CREATE INDEX idx_orders_client_phone     ON public.orders(client_phone);
CREATE INDEX idx_orders_client_name_trgm ON public.orders USING gin(client_name gin_trgm_ops);

-- Quotes
CREATE INDEX idx_quotes_status     ON public.quotes(status);
CREATE INDEX idx_quotes_event_date ON public.quotes(event_date);

-- Leads
CREATE INDEX idx_leads_status          ON public.leads(status);
CREATE INDEX idx_leads_event_date      ON public.leads(event_date);
CREATE INDEX idx_leads_name_trgm       ON public.leads USING gin(full_name gin_trgm_ops);

-- Tasks
CREATE INDEX idx_tasks_due_date    ON public.tasks(due_date);
CREATE INDEX idx_tasks_assigned_to ON public.tasks(assigned_to);
CREATE INDEX idx_tasks_status      ON public.tasks(status);

-- Maintenance
CREATE INDEX idx_maint_site   ON public.maintenance_tasks(site);
CREATE INDEX idx_maint_status ON public.maintenance_tasks(status);

-- Sales
CREATE INDEX idx_sales_sale_date  ON public.sales(sale_date);
CREATE INDEX idx_sales_created_by ON public.sales(created_by);

-- Pricing sheets
CREATE INDEX idx_pricing_lead_id  ON public.pricing_sheets(lead_id);
CREATE INDEX idx_pricing_quote_id ON public.pricing_sheets(quote_id);
