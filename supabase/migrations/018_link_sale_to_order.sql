-- ============================================================
-- Migration 018: Link a POS sale to an existing order/customer
--
-- When more participants arrive for a group that already has an order, the
-- cashier can attach the extra POS sale to that order so it reports under the
-- same customer/agent.
--
--   sales.order_id          FK → orders(id), ON DELETE SET NULL (keep the sale
--                           even if the order is later removed).
--   sales.linked_order_info JSONB snapshot of the order at link time
--                           { order_number, client_name, client_phone, organization }
--                           so the receipt/report show details without a join
--                           and survive later edits/deletion.
--
-- Both nullable — existing unlinked sales are unaffected (NULL).
-- ============================================================

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS linked_order_info JSONB;

CREATE INDEX IF NOT EXISTS idx_sales_order_id ON public.sales(order_id);

COMMENT ON COLUMN public.sales.order_id IS
  'Optional link to the order this POS sale belongs to (additional participants). NULL = standalone sale.';
COMMENT ON COLUMN public.sales.linked_order_info IS
  'Snapshot of the linked order at link time (order_number/client_name/client_phone/organization).';
