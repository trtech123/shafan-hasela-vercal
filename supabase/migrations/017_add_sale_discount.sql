-- ============================================================
-- Migration 017: POS discount / price override on sales
--
-- Stores the discount a cashier applied before payment. NULL = no discount.
-- Shape:
--   { "type": "הנחת עובד" | "הנחת נכה" | "הנחה כללית",
--     "mode": "percentage" | "fixed",
--     "value": <number>,            -- percent (0–100) or fixed ₪
--     "original_total": <number>,   -- cart subtotal before discount
--     "final_total": <number> }     -- = sales.total
--
-- sales.total holds the FINAL (post-discount) total, so existing reporting,
-- split payments and CSV keep working unchanged. The user who applied it is
-- already captured by sales.created_by.
-- ============================================================

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS discount JSONB;

COMMENT ON COLUMN public.sales.discount IS
  'POS discount applied before payment (type/mode/value/original_total/final_total). NULL = no discount. sales.total is the final post-discount amount.';
