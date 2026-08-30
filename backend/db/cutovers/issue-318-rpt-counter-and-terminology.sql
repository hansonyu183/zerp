BEGIN;

LOCK TABLE object_number_counters, dcl_rpt_definition_code_counters,
  dcl_subjects IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF (SELECT count(*) FROM dcl_rpt_definition_code_counters
      WHERE counter_key='default')<>1
     OR EXISTS (
       SELECT 1 FROM dcl_rpt_definition_code_counters
       WHERE counter_key<>'default'
     ) THEN
    RAISE EXCEPTION 'RPT definition counter must contain exactly the default row';
  END IF;
END $$;

ALTER TABLE object_number_counters
  DROP CONSTRAINT object_number_counters_last_value_check;
ALTER TABLE object_number_counters
  ADD CONSTRAINT object_number_counters_last_value_check
  CHECK(last_value BETWEEN 1 AND 999999);

WITH consumed AS (
  SELECT GREATEST(
    (SELECT next_value FROM dcl_rpt_definition_code_counters WHERE counter_key='default'),
    COALESCE((
      SELECT max(substring(code FROM 5)::integer)
      FROM dcl_subjects
      WHERE entity='rpt-definition' AND code ~ '^rpt-[0-9]{6}$'
    ),0)
  ) AS last_value
)
INSERT INTO object_number_counters(domain,entity,last_value)
SELECT 'dcl','rpt-definition',last_value
FROM consumed
WHERE last_value>0
ON CONFLICT(domain,entity) DO UPDATE
SET last_value=GREATEST(object_number_counters.last_value,EXCLUDED.last_value);

DROP TABLE dcl_rpt_definition_code_counters;

COMMIT;
