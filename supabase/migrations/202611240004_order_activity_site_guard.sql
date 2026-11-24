-- Apply only after classifying every active activity. A failed preflight
-- leaves historical orders and the operational application untouched.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.activities WHERE status='פעיל' AND site IS NULL) THEN
    RAISE EXCEPTION 'active_activity_site_review_required' USING ERRCODE='23514';
  END IF;
END $$;

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
