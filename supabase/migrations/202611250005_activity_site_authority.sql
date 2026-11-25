-- New activity classifications must be explicit. Historical activity and
-- financial records are left unchanged; they require a separate review.
BEGIN;
ALTER TABLE public.activities ADD COLUMN site text
  CHECK (site IS NULL OR site IN
    ('עכו','טבריה','נוף הגליל','שטח','פודטראק','קפה אקסטרים'));

CREATE FUNCTION public.enforce_new_activity_site() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.site IS NULL THEN
    RAISE EXCEPTION 'activity_site_required' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND NEW.site IS DISTINCT FROM OLD.site AND NEW.site IS NULL THEN
    RAISE EXCEPTION 'activity_site_required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_enforce_new_activity_site BEFORE INSERT OR UPDATE OF site
  ON public.activities FOR EACH ROW EXECUTE FUNCTION public.enforce_new_activity_site();
REVOKE ALL ON FUNCTION public.enforce_new_activity_site()
  FROM PUBLIC,anon,authenticated,service_role;

-- POS service lines use the activity's saved site. A product with an explicit
-- saved site may not be sold under a different accounting site. Unclassified
-- products still require the cashier's explicit sale-site selection.
CREATE FUNCTION public.validate_pos_accounting_site() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE site_value text;
BEGIN
  IF NEW.operation<>'payment' OR NEW.order_id IS NOT NULL THEN RETURN NEW; END IF;
  site_value:=NEW.checkout_snapshot->>'site';
  IF site_value IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(
      coalesce(NEW.checkout_snapshot->'items','[]'::jsonb)) line
      JOIN public.activities a ON a.id::text=line.value->>'id'
      WHERE a.site IS NOT NULL AND a.site IS DISTINCT FROM site_value)
    OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(
      coalesce(NEW.checkout_snapshot->'items','[]'::jsonb)) line
      JOIN public.products product ON product.id::text=line.value->>'id'
      WHERE product.site IS NOT NULL AND product.site IS DISTINCT FROM site_value)
  THEN RAISE EXCEPTION 'accounting_site_mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_pos_accounting_site BEFORE INSERT ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.validate_pos_accounting_site();
REVOKE ALL ON FUNCTION public.validate_pos_accounting_site()
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
