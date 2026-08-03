-- +goose Up

ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_entity_check,
    ADD CONSTRAINT bob_objects_entity_check CHECK (entity IN (
        'customer', 'supplier', 'other-party', 'employee', 'product', 'service',
        'warehouse', 'vehicle', 'fund-account', 'category', 'department', 'position',
        'settlement-method'
    ));
ALTER TABLE bob_customer_versions
    DROP CONSTRAINT bob_customer_versions_entity_check,
    ADD CONSTRAINT bob_customer_versions_entity_check CHECK (entity IN ('customer','other-party'));

ALTER TABLE vou_documents DROP CONSTRAINT vou_documents_entity_check;
ALTER TABLE vou_receipt_details
    DROP CONSTRAINT vou_receipt_details_document_id_entity_fkey,
    DROP CONSTRAINT vou_receipt_details_entity_check,
    DROP CONSTRAINT vou_receipt_details_counterparty_entity_check;
ALTER TABLE vou_payment_details
    DROP CONSTRAINT vou_payment_details_document_id_entity_fkey,
    DROP CONSTRAINT vou_payment_details_entity_check,
    DROP CONSTRAINT vou_payment_details_counterparty_entity_check;

UPDATE vou_receipt_details
SET entity = CASE counterparty_entity
    WHEN 'customer' THEN 'customer-receipt'
    WHEN 'supplier' THEN 'supplier-receipt'
END;
UPDATE vou_payment_details
SET entity = CASE counterparty_entity
    WHEN 'customer' THEN 'customer-payment'
    WHEN 'supplier' THEN 'supplier-payment'
END;
UPDATE vou_documents d SET entity = x.entity
FROM vou_receipt_details x WHERE x.document_id=d.id AND d.entity='receipt';
UPDATE vou_documents d SET entity = x.entity
FROM vou_payment_details x WHERE x.document_id=d.id AND d.entity='payment';
UPDATE vou_audit_events a SET entity=d.entity
FROM vou_documents d WHERE d.id=a.document_id AND a.entity IN ('receipt','payment');
UPDATE vou_documents child SET parent_entity=parent.entity
FROM vou_documents parent
WHERE child.parent_document_id=parent.id AND child.parent_entity IN ('receipt','payment');

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE vou_documents
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-pricing', 'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
        'purchase-inquiry', 'purchase-order', 'purchase-inbound', 'purchase-return',
        'order-production', 'self-production',
        'receipt', 'payment',
        'customer-receipt', 'supplier-receipt', 'other-receipt',
        'customer-payment', 'supplier-payment', 'other-payment',
        'expense-reimbursement', 'expense-payment', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt', 'delivery-note', 'signoff-note'
    ));
ALTER TABLE vou_receipt_details
    ADD CONSTRAINT vou_receipt_details_entity_check CHECK (entity IN (
        'receipt','customer-receipt','supplier-receipt','other-receipt'
    )),
    ADD CONSTRAINT vou_receipt_details_counterparty_entity_check CHECK (
        counterparty_entity IN ('customer','supplier','other-party')
    ),
    ADD CONSTRAINT vou_receipt_details_entity_party_check CHECK (
        (entity='customer-receipt' AND counterparty_entity='customer') OR
        (entity='supplier-receipt' AND counterparty_entity='supplier') OR
        (entity='other-receipt' AND counterparty_entity='other-party') OR
        (entity='receipt' AND counterparty_entity IN ('customer','supplier'))
    ),
    ADD CONSTRAINT vou_receipt_details_document_id_entity_fkey
        FOREIGN KEY (document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT;
ALTER TABLE vou_payment_details
    ADD CONSTRAINT vou_payment_details_entity_check CHECK (entity IN (
        'payment','customer-payment','supplier-payment','other-payment'
    )),
    ADD CONSTRAINT vou_payment_details_counterparty_entity_check CHECK (
        counterparty_entity IN ('customer','supplier','other-party')
    ),
    ADD CONSTRAINT vou_payment_details_entity_party_check CHECK (
        (entity='customer-payment' AND counterparty_entity='customer') OR
        (entity='supplier-payment' AND counterparty_entity='supplier') OR
        (entity='other-payment' AND counterparty_entity='other-party') OR
        (entity='payment' AND counterparty_entity IN ('customer','supplier'))
    ),
    ADD CONSTRAINT vou_payment_details_document_id_entity_fkey
        FOREIGN KEY (document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT;

ALTER TABLE led_draft_party DROP CONSTRAINT led_draft_party_counterparty_entity_check;
ALTER TABLE led_opening_party DROP CONSTRAINT led_opening_party_counterparty_entity_check;
ALTER TABLE led_party_entries DROP CONSTRAINT led_party_entries_counterparty_entity_check;
ALTER TABLE led_draft_party ADD CONSTRAINT led_draft_party_counterparty_entity_check
    CHECK (counterparty_entity IN ('customer','supplier','other-party'));
ALTER TABLE led_opening_party ADD CONSTRAINT led_opening_party_counterparty_entity_check
    CHECK (counterparty_entity IN ('customer','supplier','other-party'));
ALTER TABLE led_party_entries ADD CONSTRAINT led_party_entries_counterparty_entity_check
    CHECK (counterparty_entity IN ('customer','supplier','other-party'));

UPDATE wfl_definition_nodes SET document_entity='customer-receipt' WHERE document_entity='receipt';
UPDATE wfl_definition_nodes SET document_entity='supplier-payment' WHERE document_entity='payment';
UPDATE wfl_node_instances n SET document_entity=d.entity
FROM vou_documents d WHERE n.document_id=d.id AND n.document_entity IN ('receipt','payment');

INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'PS' || substring(md5('/' || target.domain || '/' || target.entity || '/' || source.action),1,24),
       '/' || target.domain || '/' || target.entity || '/' || source.action,
       target.domain,target.entity,source.action,
       replace(source.description, source.entity, target.entity),'ENABLED'
FROM app_permissions source
CROSS JOIN (VALUES
    ('bob','customer','other-party'),
    ('vou','receipt','customer-receipt'),('vou','receipt','supplier-receipt'),('vou','receipt','other-receipt'),
    ('vou','payment','customer-payment'),('vou','payment','supplier-payment'),('vou','payment','other-payment'),
    ('led','party','customer'),('led','party','supplier'),('led','party','other')
) target(domain,source_entity,entity)
WHERE source.domain=target.domain AND source.entity=target.source_entity
ON CONFLICT (path) DO NOTHING;

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT DISTINCT rp.role_id,new_permission.id,rp.created_by
FROM app_role_permissions rp
JOIN app_permissions old_permission ON old_permission.id=rp.permission_id
JOIN app_permissions new_permission
  ON new_permission.domain=old_permission.domain
 AND new_permission.action=old_permission.action
 AND (
   (old_permission.domain='bob' AND old_permission.entity='customer' AND new_permission.entity='other-party') OR
   (old_permission.domain='vou' AND old_permission.entity='receipt' AND new_permission.entity IN ('customer-receipt','supplier-receipt','other-receipt')) OR
   (old_permission.domain='vou' AND old_permission.entity='payment' AND new_permission.entity IN ('customer-payment','supplier-payment','other-payment')) OR
   (old_permission.domain='led' AND old_permission.entity='party' AND new_permission.entity IN ('customer','supplier','other'))
 )
ON CONFLICT DO NOTHING;

DELETE FROM app_role_permissions WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE (domain='vou' AND entity IN ('receipt','payment')) OR (domain='led' AND entity='party')
);
DELETE FROM app_permissions WHERE (domain='vou' AND entity IN ('receipt','payment')) OR (domain='led' AND entity='party');

-- +goose Down

-- +goose StatementBegin
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM bob_objects WHERE entity='other-party') OR
       EXISTS (SELECT 1 FROM vou_receipt_details WHERE counterparty_entity='other-party') OR
       EXISTS (SELECT 1 FROM vou_payment_details WHERE counterparty_entity='other-party') THEN
        RAISE EXCEPTION 'cannot roll back split party transactions while other-party data exists';
    END IF;
END $$;
-- +goose StatementEnd

INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'PS' || substring(md5('/' || target.domain || '/' || target.entity || '/' || source.action),1,24),
       '/' || target.domain || '/' || target.entity || '/' || source.action,
       target.domain,target.entity,source.action,
       replace(source.description, source.entity, target.entity),'ENABLED'
FROM app_permissions source
CROSS JOIN (VALUES
    ('vou','customer-receipt','receipt'),
    ('vou','customer-payment','payment'),
    ('led','customer','party')
) target(domain,source_entity,entity)
WHERE source.domain=target.domain AND source.entity=target.source_entity
ON CONFLICT (path) DO NOTHING;

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT DISTINCT rp.role_id,old_permission.id,rp.created_by
FROM app_role_permissions rp
JOIN app_permissions new_permission ON new_permission.id=rp.permission_id
JOIN app_permissions old_permission
  ON old_permission.domain=new_permission.domain
 AND old_permission.action=new_permission.action
 AND (
   (new_permission.domain='vou' AND new_permission.entity IN ('customer-receipt','supplier-receipt','other-receipt') AND old_permission.entity='receipt') OR
   (new_permission.domain='vou' AND new_permission.entity IN ('customer-payment','supplier-payment','other-payment') AND old_permission.entity='payment') OR
   (new_permission.domain='led' AND new_permission.entity IN ('customer','supplier','other') AND old_permission.entity='party')
 )
ON CONFLICT DO NOTHING;

DELETE FROM app_role_permissions WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE
      (domain='bob' AND entity='other-party') OR
      (domain='vou' AND entity IN ('customer-receipt','supplier-receipt','other-receipt','customer-payment','supplier-payment','other-payment')) OR
      (domain='led' AND entity IN ('customer','supplier','other'))
);
DELETE FROM app_permissions WHERE
  (domain='bob' AND entity='other-party') OR
  (domain='vou' AND entity IN ('customer-receipt','supplier-receipt','other-receipt','customer-payment','supplier-payment','other-payment')) OR
  (domain='led' AND entity IN ('customer','supplier','other'));

ALTER TABLE led_draft_party DROP CONSTRAINT led_draft_party_counterparty_entity_check;
ALTER TABLE led_opening_party DROP CONSTRAINT led_opening_party_counterparty_entity_check;
ALTER TABLE led_party_entries DROP CONSTRAINT led_party_entries_counterparty_entity_check;
ALTER TABLE led_draft_party ADD CONSTRAINT led_draft_party_counterparty_entity_check CHECK (counterparty_entity IN ('customer','supplier'));
ALTER TABLE led_opening_party ADD CONSTRAINT led_opening_party_counterparty_entity_check CHECK (counterparty_entity IN ('customer','supplier'));
ALTER TABLE led_party_entries ADD CONSTRAINT led_party_entries_counterparty_entity_check CHECK (counterparty_entity IN ('customer','supplier'));

ALTER TABLE vou_receipt_details DROP CONSTRAINT vou_receipt_details_document_id_entity_fkey, DROP CONSTRAINT vou_receipt_details_entity_check, DROP CONSTRAINT vou_receipt_details_counterparty_entity_check, DROP CONSTRAINT vou_receipt_details_entity_party_check;
ALTER TABLE vou_payment_details DROP CONSTRAINT vou_payment_details_document_id_entity_fkey, DROP CONSTRAINT vou_payment_details_entity_check, DROP CONSTRAINT vou_payment_details_counterparty_entity_check, DROP CONSTRAINT vou_payment_details_entity_party_check;
ALTER TABLE vou_documents DROP CONSTRAINT vou_documents_entity_check;
UPDATE vou_receipt_details SET entity='receipt';
UPDATE vou_payment_details SET entity='payment';
UPDATE vou_documents SET entity='receipt' WHERE entity IN ('customer-receipt','supplier-receipt');
UPDATE vou_documents SET entity='payment' WHERE entity IN ('customer-payment','supplier-payment');
UPDATE vou_audit_events a SET entity=d.entity FROM vou_documents d WHERE d.id=a.document_id;
UPDATE vou_documents child SET parent_entity=parent.entity FROM vou_documents parent WHERE child.parent_document_id=parent.id;
UPDATE wfl_definition_nodes SET document_entity='receipt' WHERE document_entity='customer-receipt';
UPDATE wfl_definition_nodes SET document_entity='payment' WHERE document_entity='supplier-payment';
UPDATE wfl_node_instances n SET document_entity=d.entity FROM vou_documents d WHERE n.document_id=d.id;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE vou_documents ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
    'sale-pricing','sale-order','sale-outbound','sale-delivery','sale-signoff','sale-return',
    'purchase-inquiry','purchase-order','purchase-inbound','purchase-return','order-production','self-production',
    'receipt','payment','expense-reimbursement','expense-payment','other-income',
    'customer-order','procurement-order','goods-receipt','delivery-note','signoff-note'
));
ALTER TABLE vou_receipt_details ADD CONSTRAINT vou_receipt_details_entity_check CHECK (entity='receipt'), ADD CONSTRAINT vou_receipt_details_counterparty_entity_check CHECK (counterparty_entity IN ('customer','supplier')), ADD CONSTRAINT vou_receipt_details_document_id_entity_fkey FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT;
ALTER TABLE vou_payment_details ADD CONSTRAINT vou_payment_details_entity_check CHECK (entity='payment'), ADD CONSTRAINT vou_payment_details_counterparty_entity_check CHECK (counterparty_entity IN ('customer','supplier')), ADD CONSTRAINT vou_payment_details_document_id_entity_fkey FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT;

ALTER TABLE bob_customer_versions
    DROP CONSTRAINT bob_customer_versions_entity_check,
    ADD CONSTRAINT bob_customer_versions_entity_check CHECK (entity='customer');
ALTER TABLE bob_objects DROP CONSTRAINT bob_objects_entity_check, ADD CONSTRAINT bob_objects_entity_check CHECK (entity IN ('customer','supplier','employee','product','service','warehouse','vehicle','fund-account','category','department','position','settlement-method'));
