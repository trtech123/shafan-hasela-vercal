-- Existing shared activities have no authoritative single site yet. Preserve
-- them while requiring an explicit order site. New activities must carry a
-- site under migration 003; once legacy activities are classified, the same
-- guard enforces their exact site without rewriting historical orders.
BEGIN;

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
    IF NEW.site IS NULL OR (activity_site IS NOT NULL AND NEW.site IS DISTINCT FROM activity_site) THEN
      RAISE EXCEPTION 'order_activity_site_mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.quote_id IS NOT NULL AND pg_catalog.jsonb_typeof(
    NEW.quotation_snapshot->'selected_activities')='array' THEN
    FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(
      NEW.quotation_snapshot->'selected_activities') LOOP
      IF nullif(item->>'activity_id','') IS NOT NULL THEN
        SELECT a.site INTO activity_site FROM public.activities a
          WHERE a.id=(item->>'activity_id')::uuid;
        IF NEW.site IS NULL OR (activity_site IS NOT NULL AND NEW.site IS DISTINCT FROM activity_site) THEN
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
