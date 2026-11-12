-- Admin-managed physical device assignments. This migration does not enable
-- the physical payment feature or change hosted Pelecard/Payper settings.
BEGIN;

CREATE TABLE public.physical_terminal_devices (
  register_number text PRIMARY KEY CHECK (register_number IN ('003','004','005','006')),
  model text NOT NULL CHECK (
    (register_number='003' AND model='N86') OR
    (register_number IN ('004','005','006') AND model='CT20')
  ),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80 AND label=btrim(label)),
  enabled boolean NOT NULL DEFAULT false,
  cash_register_code text UNIQUE REFERENCES public.cash_registers(code),
  updated_at timestamptz,
  updated_by uuid REFERENCES public.profiles(id),
  CHECK (NOT enabled OR cash_register_code IS NOT NULL)
);

INSERT INTO public.physical_terminal_devices(register_number,model,label) VALUES
  ('003','N86','N86 — 003'),
  ('004','CT20','CT20 — 004'),
  ('005','CT20','CT20 — 005'),
  ('006','CT20','CT20 — 006');

ALTER TABLE public.physical_terminal_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.physical_terminal_devices FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY physical_terminal_service_read ON public.physical_terminal_devices
  FOR SELECT TO service_role USING (true);
GRANT SELECT ON public.physical_terminal_devices TO service_role;

CREATE FUNCTION public.list_physical_terminal_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE settings jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'registerNumber',d.register_number,'model',d.model,'label',d.label,
    'enabled',d.enabled,'cashRegisterCode',d.cash_register_code
  ) ORDER BY d.register_number),'[]'::jsonb) INTO settings
  FROM public.physical_terminal_devices d;
  RETURN settings;
END $$;

CREATE FUNCTION public.save_physical_terminal_setting(
  p_register_number text, p_label text, p_enabled boolean, p_cash_register_code text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE device public.physical_terminal_devices%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'administrator_required' USING ERRCODE='42501';
  END IF;
  IF p_register_number NOT IN ('003','004','005','006') OR
    p_label IS NULL OR p_label<>btrim(p_label) OR length(p_label) NOT BETWEEN 1 AND 80 OR
    p_label ~ '[[:cntrl:]]' OR p_enabled IS NULL OR
    (p_enabled AND p_cash_register_code IS NULL) THEN
    RAISE EXCEPTION 'physical_setting_invalid' USING ERRCODE='23514';
  END IF;
  IF p_cash_register_code IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cash_registers
    WHERE code=p_cash_register_code AND active FOR SHARE
  ) THEN
    RAISE EXCEPTION 'physical_workstation_unavailable' USING ERRCODE='23514';
  END IF;
  UPDATE public.physical_terminal_devices
    SET label=p_label,enabled=p_enabled,cash_register_code=p_cash_register_code,
      updated_at=clock_timestamp(),updated_by=auth.uid()
    WHERE register_number=p_register_number
    RETURNING * INTO device;
  IF NOT FOUND THEN RAISE EXCEPTION 'physical_device_unknown' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object(
    'registerNumber',device.register_number,'model',device.model,'label',device.label,
    'enabled',device.enabled,'cashRegisterCode',device.cash_register_code
  );
END $$;

REVOKE ALL ON FUNCTION public.list_physical_terminal_settings(),
  public.save_physical_terminal_setting(text,text,boolean,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_physical_terminal_settings(),
  public.save_physical_terminal_setting(text,text,boolean,text) TO authenticated;

COMMIT;
