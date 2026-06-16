-- ============================================================
-- Migration 014: staff-only internal notes on orders
--
-- Adds orders.internal_notes — visible to staff (admin/ops/cashier via the
-- existing orders RLS) but NEVER shown to customers. It is intentionally
-- separate from orders.notes (which IS customer-facing and prints in the
-- order-confirmation PDF / email). internal_notes must never be wired into
-- OrderConfirmationPDF, send-order-doc, or any customer-facing message.
--
-- Additive, nullable — no backfill, no impact on existing rows or RLS.
-- ============================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS internal_notes TEXT;

COMMENT ON COLUMN public.orders.internal_notes IS
  'Staff-only internal notes. NEVER customer-facing (excluded from the order-confirmation PDF, send-order-doc email, and WhatsApp). Distinct from orders.notes, which is customer-facing.';
