\set ON_ERROR_STOP on

BEGIN;

LOCK TABLE bob_objects, dcl_subjects, bob_vehicle_versions, approval_entries,
  approval_events, app_permissions IN ACCESS EXCLUSIVE MODE;

ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_check;
ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_check
  CHECK (entity IN ('operating-entity','warehouse','vehicle'));

CREATE TABLE dcl_vehicle_versions (
  approval_entry_id character varying(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE RESTRICT,
  entity character varying(16) NOT NULL DEFAULT 'vehicle' CHECK (entity='vehicle'),
  name character varying(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  plate_number character varying(32) NOT NULL CHECK (length(btrim(plate_number)) BETWEEN 1 AND 32 AND plate_number=upper(btrim(plate_number))),
  vehicle_type character varying(64) NOT NULL CHECK (length(btrim(vehicle_type)) BETWEEN 1 AND 64),
  vehicle_type_object_id character varying(26) NOT NULL,
  vehicle_type_approval_entry_id character varying(26) NOT NULL,
  vehicle_type_name character varying(200) NOT NULL CHECK (length(btrim(vehicle_type_name)) BETWEEN 1 AND 200),
  vehicle_type_entity character varying(32) NOT NULL DEFAULT 'dictionary-item' CHECK (vehicle_type_entity='dictionary-item'),
  vin character varying(17) CHECK (vin IS NULL OR vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  engine_number character varying(64), load_capacity_kg numeric(12,3) CHECK (load_capacity_kg IS NULL OR load_capacity_kg>0),
  remark character varying(1000), carrier_affiliation_type character varying(16) NOT NULL CHECK (carrier_affiliation_type IN ('INTERNAL','EXTERNAL')),
  carrier_operating_entity_id character varying(26), carrier_operating_entity_approval_entry_id character varying(26),
  carrier_operating_entity character varying(16) NOT NULL DEFAULT 'operating-entity' CHECK (carrier_operating_entity='operating-entity'),
  carrier_service_relationship_object_id character varying(26), carrier_service_relationship_approval_entry_id character varying(26),
  carrier_service_relationship_entity character varying(16) NOT NULL DEFAULT 'other-unit' CHECK (carrier_service_relationship_entity='other-unit'),
  bulk_liquid_capable boolean NOT NULL DEFAULT false, enabled boolean NOT NULL,
  CHECK ((carrier_affiliation_type='INTERNAL' AND carrier_operating_entity_id IS NOT NULL AND carrier_service_relationship_object_id IS NULL) OR (carrier_affiliation_type='EXTERNAL' AND carrier_operating_entity_id IS NULL AND carrier_service_relationship_object_id IS NOT NULL)),
  FOREIGN KEY (vehicle_type_object_id,vehicle_type_entity) REFERENCES aux_objects(id,entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (carrier_operating_entity_id,carrier_operating_entity) REFERENCES bob_objects(id,entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (carrier_service_relationship_object_id,carrier_service_relationship_entity) REFERENCES bob_objects(id,entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX dcl_vehicle_versions_carrier_operating_idx ON dcl_vehicle_versions(carrier_operating_entity_id);
CREATE INDEX dcl_vehicle_versions_carrier_service_relationship_idx ON dcl_vehicle_versions(carrier_service_relationship_object_id);
CREATE INDEX dcl_vehicle_versions_vehicle_type_idx ON dcl_vehicle_versions(vehicle_type_object_id);

CREATE TABLE dcl_vehicle_identifier_claims (
  identifier_kind character varying(8) NOT NULL CHECK (identifier_kind IN ('PLATE','VIN')),
  normalized_value character varying(64) NOT NULL CHECK (length(btrim(normalized_value))>0),
  object_id character varying(26) NOT NULL REFERENCES bob_objects(id) ON DELETE CASCADE,
  approved_entry_id character varying(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
  open_entry_id character varying(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
  PRIMARY KEY(identifier_kind,normalized_value),
  CHECK (approved_entry_id IS NOT NULL OR open_entry_id IS NOT NULL)
);

CREATE TABLE bob_vehicles (
  object_id character varying(26) PRIMARY KEY REFERENCES bob_objects(id) ON DELETE RESTRICT,
  source_approval_entry_id character varying(26) NOT NULL UNIQUE REFERENCES approval_entries(id) ON DELETE RESTRICT,
  name character varying(200) NOT NULL, plate_number character varying(32) NOT NULL, vehicle_type character varying(64) NOT NULL,
  vehicle_type_object_id character varying(26) NOT NULL, vehicle_type_approval_entry_id character varying(26) NOT NULL,
  vehicle_type_name character varying(200) NOT NULL,
  vin character varying(17), engine_number character varying(200), load_capacity_kg numeric(12,3), remark character varying(1000),
  carrier_affiliation_type character varying(16) NOT NULL, carrier_operating_entity_id character varying(26), carrier_operating_entity_approval_entry_id character varying(26),
  carrier_service_relationship_object_id character varying(26), carrier_service_relationship_approval_entry_id character varying(26),
  bulk_liquid_capable boolean NOT NULL DEFAULT false, enabled boolean NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(), updated_by character varying(26) NOT NULL
);

INSERT INTO dcl_subjects(id,entity,created_at,created_by)
SELECT id,entity,created_at,created_by FROM bob_objects WHERE entity='vehicle';
INSERT INTO dcl_vehicle_versions(
  approval_entry_id,entity,name,plate_number,vehicle_type,vehicle_type_object_id,vehicle_type_approval_entry_id,vehicle_type_name,vehicle_type_entity,
  vin,engine_number,load_capacity_kg,remark,carrier_affiliation_type,carrier_operating_entity_id,
  carrier_operating_entity_approval_entry_id,carrier_operating_entity,carrier_service_relationship_object_id,
  carrier_service_relationship_approval_entry_id,carrier_service_relationship_entity,bulk_liquid_capable,enabled
)
SELECT version.approval_entry_id,version.entity,version.name,version.plate_number,type_object.code,
  type_object.id,type_entry.id,type_payload.data->>'name','dictionary-item',version.vin,version.engine_number,
  version.load_capacity_kg,version.remark,version.carrier_affiliation_type,version.carrier_operating_entity_id,
  version.carrier_operating_entity_approval_entry_id,version.carrier_operating_entity,version.carrier_service_relationship_object_id,
  version.carrier_service_relationship_approval_entry_id,version.carrier_service_relationship_entity,version.bulk_liquid_capable,object.enabled
FROM bob_vehicle_versions version JOIN approval_entries entry ON entry.id=version.approval_entry_id AND entry.domain='bob' AND entry.entity='vehicle'
JOIN bob_objects object ON object.id=entry.subject_id AND object.entity='vehicle'
JOIN aux_objects type_object ON type_object.entity='dictionary-item' AND upper(type_object.code)=upper(version.vehicle_type) AND type_object.enabled
JOIN LATERAL (SELECT approved.id FROM approval_entries approved WHERE approved.domain='aux' AND approved.entity='dictionary-item' AND approved.subject_id=type_object.id AND approved.status='APPROVED' ORDER BY approved.version_no DESC LIMIT 1) type_entry ON true
JOIN aux_version_payloads type_payload ON type_payload.approval_entry_id=type_entry.id AND type_payload.data->>'dictionaryTypeCode'='DCT-0002';
INSERT INTO bob_vehicles
SELECT object.id,entry.id,version.name,version.plate_number,version.vehicle_type,version.vehicle_type_object_id,
  version.vehicle_type_approval_entry_id,version.vehicle_type_name,version.vin,version.engine_number,version.load_capacity_kg,version.remark,
  version.carrier_affiliation_type,version.carrier_operating_entity_id,version.carrier_operating_entity_approval_entry_id,
  version.carrier_service_relationship_object_id,version.carrier_service_relationship_approval_entry_id,version.bulk_liquid_capable,
  object.enabled,object.updated_at,object.updated_by
FROM bob_objects object JOIN LATERAL (SELECT approved.* FROM approval_entries approved WHERE approved.domain='bob' AND approved.entity='vehicle' AND approved.subject_id=object.id AND approved.status='APPROVED' ORDER BY approved.version_no DESC LIMIT 1) entry ON true
JOIN dcl_vehicle_versions version ON version.approval_entry_id=entry.id WHERE object.entity='vehicle';

UPDATE approval_entries SET domain='dcl' WHERE domain='bob' AND entity='vehicle';
UPDATE approval_events SET domain='dcl' WHERE domain='bob' AND entity='vehicle';

WITH selected_entries AS (
  SELECT id,subject_id,status FROM approval_entries entry
  WHERE domain='dcl' AND entity='vehicle' AND status IN ('DRAFT','PENDING')
  UNION ALL
  SELECT approved.id,approved.subject_id,approved.status FROM approval_entries approved
  WHERE approved.domain='dcl' AND approved.entity='vehicle' AND approved.status='APPROVED'
    AND approved.id=(SELECT latest.id FROM approval_entries latest WHERE latest.domain='dcl' AND latest.entity='vehicle'
      AND latest.subject_id=approved.subject_id AND latest.status='APPROVED' ORDER BY latest.version_no DESC LIMIT 1)
), desired AS (
  SELECT entry.subject_id,identifier.kind,identifier.normalized_value,
    max(entry.id) FILTER (WHERE entry.status='APPROVED') AS approved_entry_id,
    max(entry.id) FILTER (WHERE entry.status IN ('DRAFT','PENDING')) AS open_entry_id
  FROM selected_entries entry JOIN dcl_vehicle_versions version ON version.approval_entry_id=entry.id
  CROSS JOIN LATERAL (VALUES ('PLATE'::text,upper(btrim(version.plate_number))),('VIN'::text,upper(btrim(COALESCE(version.vin,''))))) identifier(kind,normalized_value)
  WHERE identifier.normalized_value<>'' GROUP BY entry.subject_id,identifier.kind,identifier.normalized_value
)
INSERT INTO dcl_vehicle_identifier_claims(identifier_kind,normalized_value,object_id,approved_entry_id,open_entry_id)
SELECT kind,normalized_value,subject_id,approved_entry_id,open_entry_id FROM desired;
UPDATE app_permissions permission SET path=mapping.path,domain=mapping.domain,action=mapping.action,description=mapping.description,revision=permission.revision+1,updated_at=clock_timestamp()
FROM (VALUES
 ('01JBOB00000000000000000071','/dcl/vehicle/approve','dcl','approve','审核通过车辆声明'),
 ('01JBOB00000000000000000072','/dcl/vehicle/audit-history','dcl','audit-history','查看车辆声明审核记录'),
 ('01JBOB00000000000000000073','/dcl/vehicle/create','dcl','create','创建车辆声明'),
 ('01JBOB00000000000000000077','/dcl/vehicle/reject','dcl','reject','审核驳回车辆声明'),
 ('01JBOB00000000000000000078','/dcl/vehicle/save','dcl','save','保存车辆声明草稿'),
 ('01JBOB00000000000000000079','/dcl/vehicle/submit','dcl','submit','提交车辆声明审核'),
 ('01JBOB00000000000000000080','/dcl/vehicle/versions','dcl','versions','查看车辆声明版本'),
 ('01JBOB00000000000000000087','/dcl/vehicle/delete','dcl','delete','删除首版车辆声明草稿'),
 ('01JBOB00000000000000000157','/dcl/vehicle/unsubmit','dcl','unsubmit','撤回车辆声明审核'),
 ('01JBOB00000000000000000158','/dcl/vehicle/unapprove','dcl','unapprove','反审核车辆声明'),
 ('01JBOB00000000000000000159','/dcl/vehicle/get','dcl','get','查看车辆声明'),
 ('01JBOB00000000000000000160','/dcl/vehicle/query','dcl','query','查询车辆声明')
) mapping(id,path,domain,action,description) WHERE permission.id=mapping.id;

DO $$
BEGIN
  IF (SELECT count(*) FROM bob_objects WHERE entity='vehicle')<>(SELECT count(*) FROM dcl_subjects WHERE entity='vehicle')
    OR (SELECT count(*) FROM bob_vehicle_versions)<>(SELECT count(*) FROM dcl_vehicle_versions)
    OR (SELECT count(DISTINCT subject_id) FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND status='APPROVED')<>(SELECT count(*) FROM bob_vehicles) THEN
    RAISE EXCEPTION 'issue #280 cutover count mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM approval_entries WHERE domain='bob' AND entity='vehicle') OR EXISTS (SELECT 1 FROM approval_events WHERE domain='bob' AND entity='vehicle') THEN
    RAISE EXCEPTION 'issue #280 cutover left BOB-owned vehicle approval data';
  END IF;
	IF (SELECT count(*) FROM app_permissions WHERE id IN (
		'01JBOB00000000000000000071','01JBOB00000000000000000072','01JBOB00000000000000000073',
		'01JBOB00000000000000000077','01JBOB00000000000000000078','01JBOB00000000000000000079',
		'01JBOB00000000000000000080','01JBOB00000000000000000087','01JBOB00000000000000000157',
		'01JBOB00000000000000000158','01JBOB00000000000000000159','01JBOB00000000000000000160'
	) AND domain='dcl')<>12 THEN
		RAISE EXCEPTION 'issue #280 permission cutover did not update all DCL vehicle permission IDs';
	END IF;
	IF (SELECT count(*) FROM app_permissions WHERE id IN ('01JBOB00000000000000000075','01JBOB00000000000000000076')
		AND domain='bob' AND action IN ('get','query'))<>2 THEN
		RAISE EXCEPTION 'issue #280 permission cutover changed BOB vehicle current read IDs';
	END IF;
END $$;

DROP TABLE bob_vehicle_versions;
COMMIT;
