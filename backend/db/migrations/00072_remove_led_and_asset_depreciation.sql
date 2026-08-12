-- +goose Up

DELETE FROM app_business_menu_items
WHERE permission_code LIKE '/led/%'
   OR permission_code LIKE '/vou/asset-depreciation/%';

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE domain='led' OR (domain='vou' AND entity='asset-depreciation')
);
DELETE FROM app_permissions
WHERE domain='led' OR (domain='vou' AND entity='asset-depreciation');

DELETE FROM acc_vouchers
WHERE source_type='VOU' AND source_entity='asset-depreciation';
DELETE FROM vou_audit_events
WHERE document_id IN (SELECT document_id FROM vou_asset_depreciation_details);
DELETE FROM vou_asset_depreciation_lines;
DELETE FROM vou_asset_depreciation_details;
DELETE FROM vou_documents WHERE entity='asset-depreciation';
DELETE FROM vou_number_counters WHERE entity='asset-depreciation';
SET CONSTRAINTS ALL IMMEDIATE;

DROP TABLE vou_asset_depreciation_lines;
DROP TABLE vou_asset_depreciation_details;

-- The deferred one-detail invariant is shared by every remaining VOU detail
-- table. Replace its function before any later transaction invokes it.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE target_id varchar(26); detail_count integer;
BEGIN
 IF TG_TABLE_NAME='vou_documents' THEN target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 ELSE target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END; END IF;
 IF NOT EXISTS (SELECT 1 FROM vou_documents WHERE id=target_id) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 SELECT (SELECT count(*) FROM vou_sale_pricing_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_inquiry_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_order_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_outbound_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_delivery_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_signoff_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_return_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_order_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_inbound_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_return_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_production_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_inventory_count_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_receipt_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_payment_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_expense_payment_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_employee_loan_writeoff_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_other_income_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_acquisition_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_sale_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_liquidation_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_bill_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_intermediary_calculation_details WHERE document_id=target_id) INTO detail_count;
 IF detail_count<>1 THEN RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql;
-- +goose StatementEnd

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-pricing','sale-order','sale-outbound','sale-delivery','sale-signoff','sale-return',
        'purchase-inquiry','purchase-order','purchase-inbound','purchase-return',
        'order-production','self-production','inventory-count',
        'sales-receipt','sales-refund','purchase-payment','purchase-refund',
        'other-receipt','other-payment','employee-loan','employee-repayment','employee-loan-writeoff',
        'expense-reimbursement','expense-payment','other-income',
        'asset-acquisition','asset-sale','asset-liquidation',
        'bill-receipt','bill-payment','bill-issue','bill-discount','bill-maturity',
        'intermediary-calculation','customer-order','procurement-order','goods-receipt',
        'delivery-note','signoff-note'
    ));

-- LED facts are intentionally discarded. ACC starts from independently approved
-- openings and never migrates, aliases, replays, or double-writes LED rows.
-- Keep the drops explicit so schema tooling also sees that the obsolete model is gone.
DROP TABLE IF EXISTS led_asset_entries CASCADE;
DROP TABLE IF EXISTS led_asset_number_assignments CASCADE;
DROP TABLE IF EXISTS led_asset_number_counters CASCADE;
DROP TABLE IF EXISTS led_assets CASCADE;
DROP TABLE IF EXISTS led_audit_events CASCADE;
DROP TABLE IF EXISTS led_bill_entries CASCADE;
DROP TABLE IF EXISTS led_bills CASCADE;
DROP TABLE IF EXISTS led_closing_container CASCADE;
DROP TABLE IF EXISTS led_closing_fund CASCADE;
DROP TABLE IF EXISTS led_closing_inventory CASCADE;
DROP TABLE IF EXISTS led_closing_other_payable CASCADE;
DROP TABLE IF EXISTS led_closing_party CASCADE;
DROP TABLE IF EXISTS led_closings CASCADE;
DROP TABLE IF EXISTS led_container_entries CASCADE;
DROP TABLE IF EXISTS led_draft_container CASCADE;
DROP TABLE IF EXISTS led_draft_fund CASCADE;
DROP TABLE IF EXISTS led_draft_inventory CASCADE;
DROP TABLE IF EXISTS led_draft_party CASCADE;
DROP TABLE IF EXISTS led_fund_entries CASCADE;
DROP TABLE IF EXISTS led_generations CASCADE;
DROP TABLE IF EXISTS led_inventory_cost_allocations CASCADE;
DROP TABLE IF EXISTS led_inventory_entries CASCADE;
DROP TABLE IF EXISTS led_opening_container CASCADE;
DROP TABLE IF EXISTS led_opening_fund CASCADE;
DROP TABLE IF EXISTS led_opening_inventory CASCADE;
DROP TABLE IF EXISTS led_opening_party CASCADE;
DROP TABLE IF EXISTS led_party_entries CASCADE;
DROP TABLE IF EXISTS led_control CASCADE;
DROP FUNCTION IF EXISTS led_assert_document_open() CASCADE;
DROP FUNCTION IF EXISTS led_assert_attachment_open() CASCADE;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION 'migration 00072 is irreversible; LED and asset depreciation VOU facts were intentionally removed';
END
$$;
-- +goose StatementEnd
