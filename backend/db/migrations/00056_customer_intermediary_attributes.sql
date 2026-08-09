-- +goose Up

ALTER TABLE bob_customer_versions
    ADD COLUMN rebate_unit_price_cents bigint NOT NULL DEFAULT 0
        CHECK (rebate_unit_price_cents >= 0),
    ADD COLUMN intermediary_other_party_id varchar(26)
        REFERENCES bob_objects(id) ON DELETE RESTRICT;

ALTER VIEW bob_version_views RENAME TO bob_version_views_00056_base;
CREATE VIEW bob_version_views AS
SELECT base.*,
       COALESCE(customer.rebate_unit_price_cents, 0) AS rebate_unit_price_cents,
       COALESCE(customer.intermediary_other_party_id, '') AS intermediary_other_party_id
FROM bob_version_views_00056_base base
LEFT JOIN bob_customer_versions customer
  ON customer.version_id = base.version_id;

-- +goose Down

DROP VIEW bob_version_views;
ALTER VIEW bob_version_views_00056_base RENAME TO bob_version_views;

ALTER TABLE bob_customer_versions
    DROP COLUMN intermediary_other_party_id,
    DROP COLUMN rebate_unit_price_cents;
