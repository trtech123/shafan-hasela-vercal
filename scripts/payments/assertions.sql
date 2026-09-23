-- Local PGlite assertion compatibility harness, not a production migration.
-- Execute the existing SQL suites without pgTAP being installed. Fail hard on
-- false assertions, mismatched SQLSTATE/message, and incorrect plan counts.
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon,authenticated,service_role;
CREATE FUNCTION extensions.plan(n integer) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('test.expected',n::text,true);
  PERFORM set_config('test.executed','0',true);
  RETURN 'plan';
END $$;
CREATE FUNCTION extensions.ok(value boolean, description text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',description; END IF;
  PERFORM set_config('test.executed',(current_setting('test.executed')::integer+1)::text,true);
  RETURN description;
END $$;
CREATE FUNCTION extensions.is(actual anyelement, expected anyelement, description text) RETURNS text LANGUAGE sql AS $$
  SELECT extensions.ok(actual IS NOT DISTINCT FROM expected,description)
$$;
CREATE FUNCTION extensions.throws_ok(statement text, expected_code text, expected_message text, description text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE caught boolean := false; actual_code text; actual_message text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    caught := true;
    GET STACKED DIAGNOSTICS actual_code = RETURNED_SQLSTATE, actual_message = MESSAGE_TEXT;
  END;
  RETURN extensions.ok(caught AND actual_code=expected_code
    AND (expected_message IS NULL OR actual_message=expected_message),description);
END $$;
CREATE FUNCTION extensions.lives_ok(statement text, description text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE statement; RETURN extensions.ok(true,description); END $$;
CREATE FUNCTION extensions.finish() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('test.executed') <> current_setting('test.expected') THEN
    RAISE EXCEPTION 'plan count mismatch: expected %, executed %',current_setting('test.expected'),current_setting('test.executed');
  END IF;
  RETURN 'pass';
END $$;
