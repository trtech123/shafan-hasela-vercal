-- ============================================================
-- Migration 012: add 'cashier' (קופאי) to the user_role enum
--
-- Business roles after this migration:
--   admin       — מנהלים — full access
--   operations  — אחמ"ש / מדריך — orders, cashregister, schedule, maintenance
--   cashier     — קופאי — orders, cashregister, schedule
--   instructor  — kept for compatibility only (no active users)
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run in the same transaction as any
-- statement that USES the new value. Keep this migration standalone and apply
-- it BEFORE 013 (which references 'cashier' in policies). PostgreSQL 12+.
-- ============================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'cashier';
