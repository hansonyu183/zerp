-- +goose Up
CREATE TABLE vou_number_counters (
    entity varchar(32) NOT NULL,
    business_date date NOT NULL,
    last_value integer NOT NULL CHECK (last_value BETWEEN 1 AND 999999),
    PRIMARY KEY (entity, business_date)
);

CREATE TABLE vou_documents (
    id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL CHECK (entity IN (
        'sale-order', 'purchase-order', 'intermediary-sale-order',
        'receipt', 'payment', 'expense-reimbursement', 'other-income'
    )),
    document_no varchar(32) NOT NULL UNIQUE,
    status varchar(16) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'EXECUTED')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_cents bigint NOT NULL CHECK (total_amount_cents > 0),
    remark varchar(1000),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL,
    reviewed_at timestamptz,
    reviewed_by varchar(26),
    approved_at timestamptz,
    approved_by varchar(26),
    executed_at timestamptz,
    executed_by varchar(26),
    CONSTRAINT vou_documents_id_entity_uq UNIQUE (id, entity),
    CONSTRAINT vou_documents_status_audit_ck CHECK (
        (status = 'DRAFT' AND reviewed_at IS NULL AND reviewed_by IS NULL
            AND approved_at IS NULL AND approved_by IS NULL AND executed_at IS NULL AND executed_by IS NULL)
        OR (status = 'REVIEWED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
            AND approved_at IS NULL AND approved_by IS NULL AND executed_at IS NULL AND executed_by IS NULL)
        OR (status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
            AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND executed_at IS NULL AND executed_by IS NULL)
        OR (status = 'EXECUTED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
            AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND executed_at IS NOT NULL AND executed_by IS NOT NULL)
    )
);
CREATE INDEX vou_documents_query_idx ON vou_documents (entity, business_date DESC, id DESC);
CREATE INDEX vou_documents_status_idx ON vou_documents (entity, status, updated_at DESC, id DESC);

CREATE TABLE vou_sale_order_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'sale-order' CHECK (entity = 'sale-order'),
    customer_object_id varchar(26) NOT NULL,
    customer_version_id varchar(26) NOT NULL,
    customer_code varchar(64) NOT NULL,
    customer_name varchar(200) NOT NULL,
    outbound_date date,
    signoff_date date,
    platform_object_id varchar(26),
    platform_version_id varchar(26),
    platform_code varchar(64),
    platform_name varchar(200),
    vehicle_object_id varchar(26),
    vehicle_version_id varchar(26),
    vehicle_code varchar(64),
    vehicle_name varchar(200),
    vehicle_plate_number varchar(32),
    difference_reason varchar(1000),
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents (id, entity) ON DELETE RESTRICT,
    CONSTRAINT vou_sale_order_execution_ck CHECK (
        (outbound_date IS NULL AND signoff_date IS NULL
            AND platform_object_id IS NULL AND platform_version_id IS NULL
            AND platform_code IS NULL AND platform_name IS NULL
            AND vehicle_object_id IS NULL AND vehicle_version_id IS NULL
            AND vehicle_code IS NULL AND vehicle_name IS NULL AND vehicle_plate_number IS NULL
            AND difference_reason IS NULL)
        OR (outbound_date IS NOT NULL AND signoff_date IS NOT NULL
            AND platform_object_id IS NOT NULL AND platform_version_id IS NOT NULL
            AND platform_code IS NOT NULL AND platform_name IS NOT NULL
            AND vehicle_object_id IS NOT NULL AND vehicle_version_id IS NOT NULL
            AND vehicle_code IS NOT NULL AND vehicle_name IS NOT NULL AND vehicle_plate_number IS NOT NULL
            AND outbound_date <= signoff_date)
    )
);

CREATE TABLE vou_purchase_order_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'purchase-order' CHECK (entity = 'purchase-order'),
    supplier_object_id varchar(26) NOT NULL,
    supplier_version_id varchar(26) NOT NULL,
    supplier_code varchar(64) NOT NULL,
    supplier_name varchar(200) NOT NULL,
    inbound_date date,
    difference_reason varchar(1000),
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents (id, entity) ON DELETE RESTRICT
);

CREATE TABLE vou_intermediary_sale_order_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'intermediary-sale-order' CHECK (entity = 'intermediary-sale-order'),
    customer_object_id varchar(26) NOT NULL,
    customer_version_id varchar(26) NOT NULL,
    customer_code varchar(64) NOT NULL,
    customer_name varchar(200) NOT NULL,
    supplier_object_id varchar(26) NOT NULL,
    supplier_version_id varchar(26) NOT NULL,
    supplier_code varchar(64) NOT NULL,
    supplier_name varchar(200) NOT NULL,
    outbound_date date,
    signoff_date date,
    platform_object_id varchar(26),
    platform_version_id varchar(26),
    platform_code varchar(64),
    platform_name varchar(200),
    vehicle_object_id varchar(26),
    vehicle_version_id varchar(26),
    vehicle_code varchar(64),
    vehicle_name varchar(200),
    vehicle_plate_number varchar(32),
    difference_reason varchar(1000),
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents (id, entity) ON DELETE RESTRICT,
    CONSTRAINT vou_intermediary_execution_ck CHECK (
        (outbound_date IS NULL AND signoff_date IS NULL
            AND platform_object_id IS NULL AND platform_version_id IS NULL
            AND platform_code IS NULL AND platform_name IS NULL
            AND vehicle_object_id IS NULL AND vehicle_version_id IS NULL
            AND vehicle_code IS NULL AND vehicle_name IS NULL AND vehicle_plate_number IS NULL
            AND difference_reason IS NULL)
        OR (outbound_date IS NOT NULL AND signoff_date IS NOT NULL
            AND platform_object_id IS NOT NULL AND platform_version_id IS NOT NULL
            AND platform_code IS NOT NULL AND platform_name IS NOT NULL
            AND vehicle_object_id IS NOT NULL AND vehicle_version_id IS NOT NULL
            AND vehicle_code IS NOT NULL AND vehicle_name IS NOT NULL AND vehicle_plate_number IS NOT NULL
            AND outbound_date <= signoff_date)
    )
);

CREATE TABLE vou_receipt_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'receipt' CHECK (entity = 'receipt'),
    counterparty_entity varchar(16) NOT NULL CHECK (counterparty_entity IN ('customer', 'supplier')),
    counterparty_object_id varchar(26) NOT NULL,
    counterparty_version_id varchar(26) NOT NULL,
    counterparty_code varchar(64) NOT NULL,
    counterparty_name varchar(200) NOT NULL,
    fund_account_object_id varchar(26) NOT NULL,
    fund_account_version_id varchar(26) NOT NULL,
    fund_account_code varchar(64) NOT NULL,
    fund_account_name varchar(200) NOT NULL,
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents (id, entity) ON DELETE RESTRICT
);

CREATE TABLE vou_payment_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'payment' CHECK (entity = 'payment'),
    counterparty_entity varchar(16) NOT NULL CHECK (counterparty_entity IN ('customer', 'supplier')),
    counterparty_object_id varchar(26) NOT NULL,
    counterparty_version_id varchar(26) NOT NULL,
    counterparty_code varchar(64) NOT NULL,
    counterparty_name varchar(200) NOT NULL,
    fund_account_object_id varchar(26) NOT NULL,
    fund_account_version_id varchar(26) NOT NULL,
    fund_account_code varchar(64) NOT NULL,
    fund_account_name varchar(200) NOT NULL,
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents (id, entity) ON DELETE RESTRICT
);

CREATE TABLE vou_expense_reimbursement_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'expense-reimbursement' CHECK (entity = 'expense-reimbursement'),
    employee_object_id varchar(26) NOT NULL,
    employee_version_id varchar(26) NOT NULL,
    employee_code varchar(64) NOT NULL,
    employee_name varchar(200) NOT NULL,
    fund_account_object_id varchar(26) NOT NULL,
    fund_account_version_id varchar(26) NOT NULL,
    fund_account_code varchar(64) NOT NULL,
    fund_account_name varchar(200) NOT NULL,
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents (id, entity) ON DELETE RESTRICT
);

CREATE TABLE vou_other_income_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'other-income' CHECK (entity = 'other-income'),
    source_name varchar(200) NOT NULL CHECK (length(btrim(source_name)) BETWEEN 1 AND 200),
    counterparty_entity varchar(16) CHECK (counterparty_entity IN ('customer', 'supplier')),
    counterparty_object_id varchar(26),
    counterparty_version_id varchar(26),
    counterparty_code varchar(64),
    counterparty_name varchar(200),
    fund_account_object_id varchar(26) NOT NULL,
    fund_account_version_id varchar(26) NOT NULL,
    fund_account_code varchar(64) NOT NULL,
    fund_account_name varchar(200) NOT NULL,
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents (id, entity) ON DELETE RESTRICT,
    CONSTRAINT vou_other_income_counterparty_ck CHECK (
        (counterparty_entity IS NULL AND counterparty_object_id IS NULL AND counterparty_version_id IS NULL
            AND counterparty_code IS NULL AND counterparty_name IS NULL)
        OR (counterparty_entity IS NOT NULL AND counterparty_object_id IS NOT NULL AND counterparty_version_id IS NOT NULL
            AND counterparty_code IS NOT NULL AND counterparty_name IS NOT NULL)
    )
);

CREATE TABLE vou_product_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL,
    document_entity varchar(32) NOT NULL CHECK (document_entity IN (
        'sale-order', 'purchase-order', 'intermediary-sale-order'
    )),
    line_no integer NOT NULL CHECK (line_no >= 1),
    product_object_id varchar(26) NOT NULL,
    product_version_id varchar(26) NOT NULL,
    product_code varchar(64) NOT NULL,
    product_name varchar(200) NOT NULL,
    product_unit varchar(32) NOT NULL,
    ordered_qty_micros bigint NOT NULL CHECK (ordered_qty_micros > 0),
    unit_price_cents bigint NOT NULL CHECK (unit_price_cents > 0),
    line_amount_cents bigint NOT NULL CHECK (line_amount_cents > 0),
    outbound_qty_micros bigint CHECK (outbound_qty_micros > 0),
    signed_qty_micros bigint CHECK (signed_qty_micros >= 0),
    rejected_qty_micros bigint CHECK (rejected_qty_micros >= 0),
    loss_qty_micros bigint CHECK (loss_qty_micros >= 0),
    inbound_qty_micros bigint CHECK (inbound_qty_micros > 0),
    FOREIGN KEY (document_id, document_entity) REFERENCES vou_documents (id, entity) ON DELETE RESTRICT,
    UNIQUE (document_id, line_no),
    CONSTRAINT vou_product_lines_execution_ck CHECK (
        (document_entity = 'purchase-order'
            AND outbound_qty_micros IS NULL AND signed_qty_micros IS NULL
            AND rejected_qty_micros IS NULL AND loss_qty_micros IS NULL)
        OR (document_entity IN ('sale-order', 'intermediary-sale-order')
            AND inbound_qty_micros IS NULL)
    )
);
CREATE INDEX vou_product_lines_document_idx ON vou_product_lines (document_id, line_no);

CREATE TABLE vou_expense_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL,
    document_entity varchar(32) NOT NULL DEFAULT 'expense-reimbursement'
        CHECK (document_entity = 'expense-reimbursement'),
    line_no integer NOT NULL CHECK (line_no >= 1),
    category varchar(100) NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 100),
    description varchar(500) NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    FOREIGN KEY (document_id, document_entity) REFERENCES vou_documents (id, entity) ON DELETE RESTRICT,
    UNIQUE (document_id, line_no)
);

CREATE TABLE vou_files (
    id varchar(26) PRIMARY KEY,
    storage_key varchar(255) NOT NULL UNIQUE,
    original_name varchar(255) NOT NULL,
    content_type varchar(32) NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    declared_size bigint NOT NULL CHECK (declared_size BETWEEN 1 AND 10485760),
    sha256_hex char(64) NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
    status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'READY')),
    upload_token_hash char(64) NOT NULL UNIQUE CHECK (upload_token_hash ~ '^[0-9a-f]{64}$'),
    upload_expires_at timestamptz NOT NULL,
    stored_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    CONSTRAINT vou_files_status_ck CHECK (
        (status = 'PENDING' AND stored_at IS NULL)
        OR (status = 'READY' AND stored_at IS NOT NULL)
    )
);
CREATE INDEX vou_files_pending_idx ON vou_files (upload_expires_at) WHERE status = 'PENDING';

CREATE TABLE vou_document_attachments (
    document_id varchar(26) NOT NULL REFERENCES vou_documents(id) ON DELETE RESTRICT,
    file_id varchar(26) NOT NULL UNIQUE REFERENCES vou_files(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    PRIMARY KEY (document_id, file_id)
);

CREATE TABLE vou_download_tokens (
    token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    file_id varchar(26) NOT NULL REFERENCES vou_files(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL
);
CREATE INDEX vou_download_tokens_expiry_idx ON vou_download_tokens (expires_at);

CREATE TABLE vou_audit_events (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL REFERENCES vou_documents(id) ON DELETE RESTRICT,
    entity varchar(32) NOT NULL,
    event_type varchar(32) NOT NULL CHECK (event_type IN (
        'CREATED', 'SAVED', 'REVIEWED', 'UNREVIEWED', 'APPROVED', 'UNAPPROVED',
        'EXECUTED', 'UNEXECUTED', 'ATTACHMENT_INITIATED', 'ATTACHMENT_UPLOADED',
        'ATTACHMENT_REMOVED'
    )),
    from_status varchar(16) CHECK (from_status IS NULL OR from_status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'EXECUTED')),
    to_status varchar(16) NOT NULL CHECK (to_status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'EXECUTED')),
    actor_id varchar(26) NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    reason varchar(1000),
    request_id varchar(128) NOT NULL,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents (id, entity) ON DELETE RESTRICT
);
CREATE INDEX vou_audit_events_history_idx ON vou_audit_events (document_id, occurred_at DESC, id DESC);

-- +goose StatementBegin
CREATE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE
    target_id varchar(26);
    detail_count integer;
BEGIN
    IF TG_TABLE_NAME = 'vou_documents' THEN
        target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE
        target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM vou_documents WHERE id = target_id) THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    SELECT
        (SELECT count(*) FROM vou_sale_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_purchase_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_intermediary_sale_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_receipt_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_payment_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_other_income_details WHERE document_id = target_id)
    INTO detail_count;

    IF detail_count <> 1 THEN
        RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE = '23514';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER vou_documents_detail_ck
    AFTER INSERT OR UPDATE ON vou_documents DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_sale_order_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_sale_order_details DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_purchase_order_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_purchase_order_details DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_intermediary_sale_order_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_intermediary_sale_order_details DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_receipt_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_receipt_details DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_payment_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_payment_details DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_expense_reimbursement_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_expense_reimbursement_details DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_other_income_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_other_income_details DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();

WITH actions(action, description, ordinal) AS (
    VALUES
        ('query', '查询', 1), ('get', '查看', 2), ('create', '创建', 3), ('save', '保存草稿', 4),
        ('review', '审核', 5), ('unreview', '反审核', 6), ('approve', '批准', 7),
        ('unapprove', '反批准', 8), ('execute', '执行', 9), ('unexecute', '反执行', 10),
        ('audit-history', '查看审计记录', 11), ('attachment-initiate', '发起附件上传', 12),
        ('attachment-download', '下载附件', 13), ('attachment-remove', '移除附件', 14)
), entities(entity, description, ordinal) AS (
    VALUES
        ('sale-order', '销售单', 0), ('purchase-order', '采购单', 1),
        ('intermediary-sale-order', '居间销售单', 2), ('receipt', '往来款收款单', 3),
        ('payment', '往来款付款单', 4), ('expense-reimbursement', '费用报销单', 5),
        ('other-income', '其它收入单', 6)
), numbered AS (
    SELECT e.entity, e.description AS entity_description, a.action, a.description AS action_description,
           e.ordinal * 14 + a.ordinal AS seq
    FROM entities e CROSS JOIN actions a
)
INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
SELECT '01JVOU' || lpad(seq::text, 20, '0'), '/vou/' || entity || '/' || action,
       'vou', entity, action, action_description || entity_description, 'ENABLED'
FROM numbered;

INSERT INTO app_role_permissions (role_id, permission_id, created_by)
SELECT r.id, p.id, r.updated_by
FROM app_roles r
CROSS JOIN app_permissions p
WHERE r.code = 'superadmin' AND p.domain = 'vou'
ON CONFLICT DO NOTHING;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vou_documents) OR EXISTS (SELECT 1 FROM vou_files) THEN
        RAISE EXCEPTION 'cannot roll back VOU migration while VOU data exists';
    END IF;
END $$;
-- +goose StatementEnd

DELETE FROM app_role_permissions WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain = 'vou');
DELETE FROM app_permissions WHERE domain = 'vou';
DROP TRIGGER vou_other_income_detail_ck ON vou_other_income_details;
DROP TRIGGER vou_expense_reimbursement_detail_ck ON vou_expense_reimbursement_details;
DROP TRIGGER vou_payment_detail_ck ON vou_payment_details;
DROP TRIGGER vou_receipt_detail_ck ON vou_receipt_details;
DROP TRIGGER vou_intermediary_sale_order_detail_ck ON vou_intermediary_sale_order_details;
DROP TRIGGER vou_purchase_order_detail_ck ON vou_purchase_order_details;
DROP TRIGGER vou_sale_order_detail_ck ON vou_sale_order_details;
DROP TRIGGER vou_documents_detail_ck ON vou_documents;
DROP FUNCTION vou_validate_document_detail();
DROP TABLE vou_audit_events;
DROP TABLE vou_download_tokens;
DROP TABLE vou_document_attachments;
DROP TABLE vou_files;
DROP TABLE vou_expense_lines;
DROP TABLE vou_product_lines;
DROP TABLE vou_other_income_details;
DROP TABLE vou_expense_reimbursement_details;
DROP TABLE vou_payment_details;
DROP TABLE vou_receipt_details;
DROP TABLE vou_intermediary_sale_order_details;
DROP TABLE vou_purchase_order_details;
DROP TABLE vou_sale_order_details;
DROP TABLE vou_documents;
DROP TABLE vou_number_counters;
