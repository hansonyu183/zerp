DO $$
DECLARE
  next_code text;
BEGIN
  IF to_regclass('public.app_role_code_counters') IS NULL THEN
    RAISE EXCEPTION 'role code counter is missing';
  END IF;
  UPDATE app_role_code_counters
  SET next_value = next_value + 1
  WHERE counter_key = 'default' AND next_value < 9999
  RETURNING ('ROL-' || lpad(next_value::text, 4, '0'))::text INTO next_code;
  IF next_code <> 'ROL-0043' THEN
    RAISE EXCEPTION 'role code counter = %, expected ROL-0043', next_code;
  END IF;
END
$$;
