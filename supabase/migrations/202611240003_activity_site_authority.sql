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

-- A new order cannot take its revenue site from a mutable product category.
-- The activity site is authoritative, and old unclassified activities must
-- be classified explicitly before use on a new order.
CREATE FUNCTION public.enforce_order_activity_site() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE activity_site text; item jsonb;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.activity_id IS NOT DISTINCT FROM OLD.activity_id
      AND NEW.site IS NOT DISTINCT FROM OLD.site THEN RETURN NEW; END IF;
  END IF;
  IF NEW.activity_id IS NOT NULL THEN
    SELECT a.site INTO activity_site FROM public.activities a WHERE a.id=NEW.activity_id;
    IF activity_site IS NULL OR NEW.site IS DISTINCT FROM activity_site THEN
      RAISE EXCEPTION 'order_activity_site_mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.quote_id IS NOT NULL AND pg_catalog.jsonb_typeof(
    NEW.quotation_snapshot->'selected_activities')='array' THEN
    FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(
      NEW.quotation_snapshot->'selected_activities') LOOP
      IF nullif(item->>'activity_id','') IS NOT NULL THEN
        SELECT a.site INTO activity_site FROM public.activities a
          WHERE a.id=(item->>'activity_id')::uuid;
        IF activity_site IS NULL OR NEW.site IS DISTINCT FROM activity_site THEN
          RAISE EXCEPTION 'order_activity_site_mismatch' USING ERRCODE='23514'; END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_enforce_order_activity_site BEFORE INSERT OR UPDATE OF activity_id,site
  ON public.orders FOR EACH ROW EXECUTE FUNCTION public.enforce_order_activity_site();
REVOKE ALL ON FUNCTION public.enforce_order_activity_site()
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
