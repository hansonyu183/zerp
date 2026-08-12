DO $$ BEGIN
  IF to_regclass('rpt_definitions') IS NULL OR to_regclass('rpt_versions') IS NULL THEN
    RAISE EXCEPTION 'RPT tables are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='zerp_report_reader') THEN
    RAISE EXCEPTION 'RPT read-only database role is missing';
  END IF;
  IF (SELECT count(*) FROM app_permissions WHERE domain='rpt' AND entity='definition') <> 10 THEN
    RAISE EXCEPTION 'RPT management permissions are missing';
  END IF;
  IF (SELECT count(*) FROM rpt_definitions WHERE ever_approved) <> 8 OR
     (SELECT count(*) FROM app_permissions WHERE domain='rpt') <> 26 THEN
    RAISE EXCEPTION 'RPT built-in reports or use permissions are missing';
  END IF;
END $$;

CREATE TABLE rpt_gate_probe(value text NOT NULL);
INSERT INTO rpt_definitions(id,code,name,ever_approved,created_by,updated_by)
VALUES('RPTGATEDEF0000000000000001','migration-gate-probe','迁移门禁探针',true,'SYSTEM','SYSTEM');
INSERT INTO rpt_versions(id,definition_id,version_no,status,validity,sql_text,parameters,columns,approved_by,created_by,updated_by)
VALUES(
  'RPTGATEVER0000000000000001','RPTGATEDEF0000000000000001',1,'APPROVED','VALID',
  'SELECT value AS value FROM rpt_gate_probe','[]',
  '[{"alias":"value","name":"值","order":1,"type":"TEXT","width":100,"visible":true}]',
  'SYSTEM','SYSTEM','SYSTEM'
);
UPDATE rpt_definitions SET current_version_id='RPTGATEVER0000000000000001' WHERE id='RPTGATEDEF0000000000000001';
SELECT rpt_validate_current_reports();
ALTER TABLE rpt_gate_probe ADD COLUMN compatible integer;
SELECT rpt_validate_current_reports();

DO $$ BEGIN
  BEGIN
    ALTER TABLE rpt_gate_probe DROP COLUMN value;
    PERFORM rpt_validate_current_reports();
    RAISE EXCEPTION 'incompatible migration unexpectedly passed RPT gate';
  EXCEPTION WHEN undefined_column THEN
    NULL;
  END;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='rpt_gate_probe' AND column_name='value'
  ) THEN
    RAISE EXCEPTION 'incompatible migration changes were not rolled back';
  END IF;
END $$;
DROP TABLE rpt_migration_probe;
