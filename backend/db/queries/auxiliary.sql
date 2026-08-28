-- AUX is stable-ID current data. These queries intentionally expose no
-- Approval entry, candidate, version, or historical payload identity.

-- name: QueryAuxReferenceCandidates :many
SELECT id AS object_id, code, CAST(COALESCE(data->>'name','') AS text) AS name
FROM aux_objects
WHERE entity=sqlc.arg(entity)
  AND enabled
  AND (sqlc.arg(keyword)::text='' OR code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR COALESCE(data->>'name','') ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(dictionary_type_code)::text='' OR data->>'dictionaryTypeCode'=sqlc.arg(dictionary_type_code)::text)
ORDER BY COALESCE((data->>'sortOrder')::integer,2147483647),code,id
LIMIT 20;

-- name: GetAuxObject :one
SELECT id,entity,code,enabled,revision,updated_at,updated_by,data
FROM aux_objects
WHERE id=sqlc.arg(object_id) AND entity=sqlc.arg(entity);

-- name: AcquireAuxiliaryWriteLock :exec
SELECT pg_advisory_xact_lock(sqlc.arg(lock_key));

-- name: AllocateAuxObjectNumber :one
INSERT INTO object_number_counters(domain,entity,last_value)
VALUES('aux',sqlc.arg(entity),1)
ON CONFLICT(domain,entity) DO UPDATE
SET last_value=object_number_counters.last_value+1
WHERE object_number_counters.last_value<9999
RETURNING last_value;

-- name: InsertAuxObject :exec
INSERT INTO aux_objects(id,entity,code,data,created_by,updated_by)
VALUES(sqlc.arg(id),sqlc.arg(entity),sqlc.arg(code),sqlc.arg(data),sqlc.arg(actor_id),sqlc.arg(actor_id));

-- name: GetAuxObjectForUpdate :one
SELECT code,enabled,revision,data
FROM aux_objects
WHERE id=sqlc.arg(object_id) AND entity=sqlc.arg(entity)
FOR UPDATE;

-- name: UpdateAuxObjectData :execrows
UPDATE aux_objects
SET data=sqlc.arg(data),revision=revision+1,updated_at=now(),updated_by=sqlc.arg(actor_id)
WHERE id=sqlc.arg(object_id) AND entity=sqlc.arg(entity);

-- name: GetAuxObjectStateForUpdate :one
SELECT enabled,revision
FROM aux_objects
WHERE id=sqlc.arg(object_id) AND entity=sqlc.arg(entity)
FOR UPDATE;

-- name: UpdateAuxObjectState :execrows
UPDATE aux_objects
SET enabled=sqlc.arg(enabled),revision=revision+1,updated_at=now(),updated_by=sqlc.arg(actor_id)
WHERE id=sqlc.arg(object_id) AND entity=sqlc.arg(entity) AND revision=sqlc.arg(object_revision);

-- name: GetAuxObjectRevisionForUpdate :one
SELECT revision
FROM aux_objects
WHERE id=sqlc.arg(object_id) AND entity=sqlc.arg(entity)
FOR UPDATE;

-- name: DeleteAuxObject :execrows
DELETE FROM aux_objects
WHERE id=sqlc.arg(object_id) AND entity=sqlc.arg(entity);

-- name: ListAuxObjectDeleteBlockers :many
WITH requested AS (SELECT sqlc.arg(object_id)::text AS object_id), blockers(source,count) AS (
  SELECT 'aux_objects'::text,count(*)::bigint FROM aux_objects,requested WHERE data->>'parentId'=requested.object_id OR data->>'dictionaryTypeId'=requested.object_id
  UNION ALL SELECT 'dcl_employee_versions',count(*) FROM dcl_employee_versions,requested WHERE employee_category_id=requested.object_id OR department_id=requested.object_id OR position_id=requested.object_id
  UNION ALL SELECT 'dcl_product_versions',count(*) FROM dcl_product_versions,requested WHERE category_id=requested.object_id OR pricing_unit_id=requested.object_id OR product_type_id=requested.object_id OR default_input_unit_id=requested.object_id
  UNION ALL SELECT 'dcl_product_formulas',count(*) FROM dcl_product_formulas,requested WHERE output_unit_object_id=requested.object_id
  UNION ALL SELECT 'dcl_product_formula_lines',count(*) FROM dcl_product_formula_lines,requested WHERE entered_unit_object_id=requested.object_id
  UNION ALL SELECT 'dcl_product_unit_conversions',count(*) FROM dcl_product_unit_conversions,requested WHERE unit_object_id=requested.object_id
  UNION ALL SELECT 'dcl_supplier_versions',count(*) FROM dcl_supplier_versions,requested WHERE settlement_method_id=requested.object_id
  UNION ALL SELECT 'dcl_other_unit_versions',count(*) FROM dcl_other_unit_versions,requested WHERE settlement_method_id=requested.object_id
  UNION ALL SELECT 'dcl_customer_account_versions',count(*) FROM dcl_customer_account_versions,requested WHERE customer_type=requested.object_id OR settlement_method_id=requested.object_id OR payment_method_id=requested.object_id
  UNION ALL SELECT 'dcl_vehicle_versions',count(*) FROM dcl_vehicle_versions,requested WHERE vehicle_type_object_id=requested.object_id
  UNION ALL SELECT 'dcl_warehouse_versions',count(*) FROM dcl_warehouse_versions,requested WHERE category_id=requested.object_id
  UNION ALL SELECT 'dcl_customer_attachments',count(*) FROM dcl_customer_attachments,requested WHERE category_object_id=requested.object_id
  UNION ALL SELECT 'dcl_customer_account_attachments',count(*) FROM dcl_customer_account_attachments,requested WHERE category_object_id=requested.object_id
  UNION ALL SELECT 'bob_warehouses',count(*) FROM bob_warehouses,requested WHERE category_id=requested.object_id
  UNION ALL SELECT 'bob_vehicles',count(*) FROM bob_vehicles,requested WHERE vehicle_type_object_id=requested.object_id
  UNION ALL SELECT 'vou_asset_acquisition_lines',count(*) FROM vou_asset_acquisition_lines,requested WHERE category_object_id=requested.object_id OR department_object_id=requested.object_id
  UNION ALL SELECT 'vou_inventory_count_lines',count(*) FROM vou_inventory_count_lines,requested WHERE entered_unit_object_id=requested.object_id
  UNION ALL SELECT 'vou_price_lines',count(*) FROM vou_price_lines,requested WHERE product_type_object_id=requested.object_id
  UNION ALL SELECT 'vou_product_lines',count(*) FROM vou_product_lines,requested WHERE entered_unit_object_id=requested.object_id OR product_type_object_id=requested.object_id
  UNION ALL SELECT 'vou_production_material_lines',count(*) FROM vou_production_material_lines,requested WHERE actual_entered_unit_object_id=requested.object_id
  UNION ALL SELECT 'vou_production_output_lines',count(*) FROM vou_production_output_lines,requested WHERE entered_unit_object_id=requested.object_id
  UNION ALL SELECT 'vou_purchase_order_details',count(*) FROM vou_purchase_order_details,requested WHERE settlement_method_object_id=requested.object_id
  UNION ALL SELECT 'vou_sale_order_details',count(*) FROM vou_sale_order_details,requested WHERE settlement_method_object_id=requested.object_id
  UNION ALL SELECT 'vou_sale_order_formula_lines',count(*) FROM vou_sale_order_formula_lines,requested WHERE entered_unit_object_id=requested.object_id
  UNION ALL SELECT 'vou_sale_order_formulas',count(*) FROM vou_sale_order_formulas,requested WHERE output_entered_unit_object_id=requested.object_id
  UNION ALL SELECT 'vou_service_contract_details',count(*) FROM vou_service_contract_details,requested WHERE settlement_method_object_id=requested.object_id
  UNION ALL SELECT 'acc_assets',count(*) FROM acc_assets,requested WHERE category_id=requested.object_id OR department_id=requested.object_id
  UNION ALL SELECT 'acc_opening_assets',count(*) FROM acc_opening_assets,requested WHERE category_id=requested.object_id OR department_id=requested.object_id
)
SELECT source,count FROM blockers WHERE count>0 ORDER BY source;

-- name: GetEnabledAuxCurrentReference :one
SELECT id,entity,code,data
FROM aux_objects
WHERE id=sqlc.arg(object_id) AND entity=sqlc.arg(entity) AND enabled
FOR SHARE;

-- name: GetEnabledAuxReferenceByCode :one
SELECT id,entity,code,data
FROM aux_objects
WHERE entity=sqlc.arg(entity) AND upper(code)=upper(sqlc.arg(code)::text) AND enabled
FOR SHARE;

-- name: GetEnabledDictionaryType :one
SELECT code,CAST(COALESCE(data->>'name','') AS text) AS name
FROM aux_objects
WHERE id=sqlc.arg(object_id) AND entity='dictionary-type' AND enabled;

-- name: GetEnabledAuxParentID :one
SELECT CAST(COALESCE(data->>'parentId','') AS text) AS parent_id
FROM aux_objects
WHERE id=sqlc.arg(object_id) AND entity=sqlc.arg(entity) AND enabled;

-- name: GetEnabledAuxObjectData :one
SELECT data
FROM aux_objects
WHERE entity=sqlc.arg(entity) AND id=sqlc.arg(object_id) AND enabled;

-- name: IsAuxProductTypeReferenced :one
SELECT EXISTS(SELECT 1 FROM dcl_product_versions WHERE product_type_id=sqlc.arg(object_id)::text);
