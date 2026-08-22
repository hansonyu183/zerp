-- +goose Up

-- Party merges are explicit, irreversible business actions.  No existing
-- Party, relationship version, VOU or ACC history is rewritten.
ALTER TABLE bob_party_audit_events
    DROP CONSTRAINT bob_party_audit_events_event_type_check,
    ADD CONSTRAINT bob_party_audit_events_event_type_check
        CHECK (event_type IN ('CREATED','SAVED','MERGED'));

CREATE TABLE bob_party_merge_preflights (
    id varchar(26) PRIMARY KEY,
    source_party_id varchar(26) NOT NULL REFERENCES bob_parties(id) ON DELETE RESTRICT,
    target_party_id varchar(26) NOT NULL REFERENCES bob_parties(id) ON DELETE RESTRICT,
    source_revision bigint NOT NULL CHECK (source_revision>=1),
    target_revision bigint NOT NULL CHECK (target_revision>=1),
    state_fingerprint char(64) NOT NULL CHECK (state_fingerprint ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    request_id varchar(128) NOT NULL,
    consumed_at timestamptz,
    consumed_by varchar(26),
    CHECK (source_party_id<>target_party_id),
    CHECK ((consumed_at IS NULL AND consumed_by IS NULL) OR (consumed_at IS NOT NULL AND consumed_by IS NOT NULL))
);
CREATE INDEX bob_party_merge_preflights_open_idx
    ON bob_party_merge_preflights(source_party_id,target_party_id,created_at DESC)
    WHERE consumed_at IS NULL;

CREATE TABLE bob_party_merge_events (
    id varchar(26) PRIMARY KEY,
    preflight_id varchar(26) NOT NULL REFERENCES bob_party_merge_preflights(id) ON DELETE RESTRICT,
    source_party_id varchar(26) NOT NULL REFERENCES bob_parties(id) ON DELETE RESTRICT,
    target_party_id varchar(26) NOT NULL REFERENCES bob_parties(id) ON DELETE RESTRICT,
    actor_id varchar(26) NOT NULL,
    request_id varchar(128) NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(preflight_id),
    CHECK (source_party_id<>target_party_id)
);

CREATE TABLE bob_party_relationship_merge_events (
    id varchar(26) PRIMARY KEY,
    merge_event_id varchar(26) NOT NULL REFERENCES bob_party_merge_events(id) ON DELETE RESTRICT,
    relationship_type varchar(16) NOT NULL CHECK (relationship_type IN (
        'customer','supplier','employee','other-unit','sales-partner'
    )),
    source_object_id varchar(26) NOT NULL REFERENCES bob_objects(id) ON DELETE RESTRICT,
    target_object_id varchar(26) REFERENCES bob_objects(id) ON DELETE RESTRICT,
    operating_entity_id varchar(26) NOT NULL REFERENCES bob_objects(id) ON DELETE RESTRICT,
    action varchar(16) NOT NULL CHECK (action IN ('TRANSFERRED','MERGED')),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((action='TRANSFERRED' AND target_object_id IS NULL) OR
           (action='MERGED' AND target_object_id IS NOT NULL))
);
CREATE INDEX bob_party_relationship_merge_events_source_idx
    ON bob_party_relationship_merge_events(source_object_id,occurred_at DESC)
    INCLUDE (merge_event_id);

-- A merged source Party cannot be used to create a new relationship.  Existing
-- historical facts refer to relationship IDs and are deliberately untouched.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION bob_reject_merged_party_relationship() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM bob_parties WHERE id=NEW.party_id AND merged_into_party_id IS NOT NULL) THEN
        RAISE EXCEPTION 'merged Party cannot start a new relationship' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER bob_customer_relationship_merged_party_ck
    BEFORE INSERT OR UPDATE OF party_id ON bob_customer_relationships
    FOR EACH ROW EXECUTE FUNCTION bob_reject_merged_party_relationship();
CREATE TRIGGER bob_supplier_relationship_merged_party_ck
    BEFORE INSERT OR UPDATE OF party_id ON bob_supplier_relationships
    FOR EACH ROW EXECUTE FUNCTION bob_reject_merged_party_relationship();
CREATE TRIGGER bob_employment_relationship_merged_party_ck
    BEFORE INSERT OR UPDATE OF party_id ON bob_employment_relationships
    FOR EACH ROW EXECUTE FUNCTION bob_reject_merged_party_relationship();
CREATE TRIGGER bob_service_relationship_merged_party_ck
    BEFORE INSERT OR UPDATE OF party_id ON bob_service_relationships
    FOR EACH ROW EXECUTE FUNCTION bob_reject_merged_party_relationship();
CREATE TRIGGER bob_sales_relationship_merged_party_ck
    BEFORE INSERT OR UPDATE OF party_id ON bob_sales_relationships
    FOR EACH ROW EXECUTE FUNCTION bob_reject_merged_party_relationship();

WITH permissions(id,path,action,description) AS (
    VALUES
        ('01JBOB88MRG000000000000001','/bob/party/merge-preflight','merge-preflight','预检主体合并'),
        ('01JBOB88MRG000000000000002','/bob/party/merge-confirm','merge-confirm','确认主体合并')
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT id,path,'bob','party',action,description,'ENABLED' FROM permissions
ON CONFLICT(path) DO NOTHING;

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role.id,permission.id,role.updated_by
FROM app_roles role JOIN app_permissions permission
  ON permission.path IN ('/bob/party/merge-preflight','/bob/party/merge-confirm')
WHERE role.code='superadmin'
ON CONFLICT DO NOTHING;

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION '00088 Party merge is irreversible'; END $$;
-- +goose StatementEnd
