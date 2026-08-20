-- +goose Up

-- Supplier master data is an intentional direct cutover. Existing Supplier
-- rows use the obsolete salesperson vocabulary and incomplete settlement
-- references, so development, test and preview fixtures must be rebuilt.
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM bob_supplier_versions) THEN
        RAISE EXCEPTION 'supplier master-data cutover requires supplier fixtures to be rebuilt'
            USING ERRCODE='P0001';
    END IF;
END
$$;
-- +goose StatementEnd

DROP INDEX bob_supplier_versions_salesperson_employee_idx;

ALTER TABLE bob_supplier_versions
    RENAME COLUMN salesperson_employee_id TO default_purchaser_employee_id;
ALTER TABLE bob_supplier_versions
    RENAME COLUMN salesperson_employee_entity TO default_purchaser_employee_entity;

ALTER TABLE bob_supplier_versions
    ALTER COLUMN default_purchaser_employee_id DROP NOT NULL,
    ADD COLUMN settlement_method_code varchar(32),
    ADD COLUMN settlement_method_name varchar(200),
    ADD COLUMN settlement_term_code varchar(32),
    ADD COLUMN settlement_rule_type varchar(32),
    ADD COLUMN settlement_month_offset integer NOT NULL DEFAULT 0 CHECK (settlement_month_offset>=0),
    ADD COLUMN settlement_day_of_month integer NOT NULL DEFAULT 0 CHECK (settlement_day_of_month BETWEEN 0 AND 31),
    ADD COLUMN settlement_day_offset integer NOT NULL DEFAULT 0 CHECK (settlement_day_offset>=0),
    ADD CONSTRAINT bob_supplier_settlement_snapshot_ck CHECK (
        (settlement_method_id IS NULL
            AND settlement_method_code IS NULL
            AND settlement_method_name IS NULL
            AND settlement_term_code IS NULL
            AND settlement_rule_type IS NULL
            AND settlement_month_offset=0
            AND settlement_day_of_month=0
            AND settlement_day_offset=0)
        OR
        (settlement_method_id IS NOT NULL
            AND settlement_method_code IS NOT NULL
            AND settlement_method_name IS NOT NULL
            AND settlement_term_code IS NOT NULL
            AND settlement_rule_type IS NOT NULL)
    );

CREATE INDEX bob_supplier_versions_default_purchaser_idx
    ON bob_supplier_versions(default_purchaser_employee_id);

ALTER TABLE vou_sale_order_details
    DROP CONSTRAINT vou_sale_order_settlement_ck,
    ADD CONSTRAINT vou_sale_order_settlement_ck CHECK (
        (settlement_method_object_id IS NULL
            AND settlement_method_version_id IS NULL
            AND settlement_method_code IS NULL
            AND settlement_method_name IS NULL
            AND settlement_rule_type IS NULL
            AND settlement_month_offset IS NULL
            AND settlement_day_of_month IS NULL
            AND settlement_day_offset IS NULL
            AND settlement_description IS NULL)
        OR (
            settlement_method_object_id IS NOT NULL
            AND settlement_method_code IS NOT NULL
            AND settlement_method_name IS NOT NULL
            AND settlement_rule_type IN ('DUE_DAYS', 'RELATIVE_DAYS', 'MONTH_END', 'FIXED_DAY')
            AND settlement_month_offset BETWEEN 0 AND 120
            AND settlement_day_offset BETWEEN -3650 AND 3650
            AND (
                (settlement_rule_type='DUE_DAYS' AND settlement_month_offset=0
                    AND settlement_day_of_month IS NULL AND settlement_due_days BETWEEN 0 AND 3650)
                OR (settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0
                    AND settlement_day_of_month IS NULL)
                OR (settlement_rule_type='MONTH_END' AND settlement_day_of_month IS NULL
                    AND settlement_cutoff_day BETWEEN 1 AND 31)
                OR (settlement_rule_type='FIXED_DAY' AND settlement_day_of_month BETWEEN 1 AND 31)
            )
        )
    );

ALTER TABLE vou_purchase_order_details
    DROP CONSTRAINT vou_purchase_order_settlement_ck,
    ADD CONSTRAINT vou_purchase_order_settlement_ck CHECK (
        (settlement_method_object_id IS NULL
            AND settlement_method_version_id IS NULL
            AND settlement_method_code IS NULL
            AND settlement_method_name IS NULL
            AND settlement_rule_type IS NULL
            AND settlement_month_offset IS NULL
            AND settlement_day_of_month IS NULL
            AND settlement_day_offset IS NULL
            AND settlement_description IS NULL)
        OR (
            settlement_method_object_id IS NOT NULL
            AND settlement_method_code IS NOT NULL
            AND settlement_method_name IS NOT NULL
            AND settlement_rule_type IN ('DUE_DAYS', 'RELATIVE_DAYS', 'MONTH_END', 'FIXED_DAY')
            AND settlement_month_offset BETWEEN 0 AND 120
            AND settlement_day_offset BETWEEN -3650 AND 3650
            AND (
                (settlement_rule_type='DUE_DAYS' AND settlement_month_offset=0
                    AND settlement_day_of_month IS NULL AND settlement_due_days BETWEEN 0 AND 3650)
                OR (settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0
                    AND settlement_day_of_month IS NULL)
                OR (settlement_rule_type='MONTH_END' AND settlement_day_of_month IS NULL
                    AND settlement_cutoff_day BETWEEN 1 AND 31)
                OR (settlement_rule_type='FIXED_DAY' AND settlement_day_of_month BETWEEN 1 AND 31)
            )
        )
    );

INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
VALUES (
    '01JBOB84SUPTAXMATCH0000001',
    '/bob/supplier/tax-match',
    'bob',
    'supplier',
    'tax-match',
    '按税号匹配供应商建档资料',
    'ENABLED'
) ON CONFLICT(path) DO NOTHING;

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role.id,permission.id,role.updated_by
FROM app_roles role
JOIN app_permissions permission ON permission.path='/bob/supplier/tax-match'
WHERE role.code='superadmin'
ON CONFLICT DO NOTHING;

SELECT rpt_validate_current_reports();

-- +goose Down

DELETE FROM app_role_permissions
WHERE permission_id IN (SELECT id FROM app_permissions WHERE path='/bob/supplier/tax-match');
DELETE FROM app_permissions WHERE path='/bob/supplier/tax-match';

ALTER TABLE vou_sale_order_details
    DROP CONSTRAINT vou_sale_order_settlement_ck,
    ADD CONSTRAINT vou_sale_order_settlement_ck CHECK (
        (settlement_method_object_id IS NULL
            AND settlement_method_version_id IS NULL
            AND settlement_method_code IS NULL
            AND settlement_method_name IS NULL
            AND settlement_rule_type IS NULL
            AND settlement_month_offset IS NULL
            AND settlement_day_of_month IS NULL
            AND settlement_day_offset IS NULL
            AND settlement_description IS NULL)
        OR (
            settlement_method_object_id IS NOT NULL
            AND settlement_method_version_id IS NOT NULL
            AND settlement_method_code IS NOT NULL
            AND settlement_method_name IS NOT NULL
            AND settlement_rule_type IN ('DUE_DAYS', 'RELATIVE_DAYS', 'MONTH_END', 'FIXED_DAY')
            AND settlement_month_offset BETWEEN 0 AND 120
            AND settlement_day_offset BETWEEN -3650 AND 3650
            AND (
                (settlement_rule_type='DUE_DAYS' AND settlement_month_offset=0
                    AND settlement_day_of_month IS NULL AND settlement_due_days BETWEEN 0 AND 3650)
                OR (settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0
                    AND settlement_day_of_month IS NULL)
                OR (settlement_rule_type='MONTH_END' AND settlement_day_of_month IS NULL
                    AND settlement_cutoff_day BETWEEN 1 AND 31)
                OR (settlement_rule_type='FIXED_DAY' AND settlement_day_of_month BETWEEN 1 AND 31)
            )
        )
    );

ALTER TABLE vou_purchase_order_details
    DROP CONSTRAINT vou_purchase_order_settlement_ck,
    ADD CONSTRAINT vou_purchase_order_settlement_ck CHECK (
        (settlement_method_object_id IS NULL
            AND settlement_method_version_id IS NULL
            AND settlement_method_code IS NULL
            AND settlement_method_name IS NULL
            AND settlement_rule_type IS NULL
            AND settlement_month_offset IS NULL
            AND settlement_day_of_month IS NULL
            AND settlement_day_offset IS NULL
            AND settlement_description IS NULL)
        OR (
            settlement_method_object_id IS NOT NULL
            AND settlement_method_version_id IS NOT NULL
            AND settlement_method_code IS NOT NULL
            AND settlement_method_name IS NOT NULL
            AND settlement_rule_type IN ('DUE_DAYS', 'RELATIVE_DAYS', 'MONTH_END', 'FIXED_DAY')
            AND settlement_month_offset BETWEEN 0 AND 120
            AND settlement_day_offset BETWEEN -3650 AND 3650
            AND (
                (settlement_rule_type='DUE_DAYS' AND settlement_month_offset=0
                    AND settlement_day_of_month IS NULL AND settlement_due_days BETWEEN 0 AND 3650)
                OR (settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0
                    AND settlement_day_of_month IS NULL)
                OR (settlement_rule_type='MONTH_END' AND settlement_day_of_month IS NULL
                    AND settlement_cutoff_day BETWEEN 1 AND 31)
                OR (settlement_rule_type='FIXED_DAY' AND settlement_day_of_month BETWEEN 1 AND 31)
            )
        )
    );

DROP INDEX bob_supplier_versions_default_purchaser_idx;
ALTER TABLE bob_supplier_versions
    DROP CONSTRAINT bob_supplier_settlement_snapshot_ck,
    DROP COLUMN settlement_day_offset,
    DROP COLUMN settlement_day_of_month,
    DROP COLUMN settlement_month_offset,
    DROP COLUMN settlement_rule_type,
    DROP COLUMN settlement_term_code,
    DROP COLUMN settlement_method_name,
    DROP COLUMN settlement_method_code;

ALTER TABLE bob_supplier_versions
    RENAME COLUMN default_purchaser_employee_entity TO salesperson_employee_entity;
ALTER TABLE bob_supplier_versions
    RENAME COLUMN default_purchaser_employee_id TO salesperson_employee_id;
ALTER TABLE bob_supplier_versions
    ALTER COLUMN salesperson_employee_id SET NOT NULL;

CREATE INDEX bob_supplier_versions_salesperson_employee_idx
    ON bob_supplier_versions(salesperson_employee_id);
