-- name: InsertBobObject :exec
INSERT INTO bob_objects (
    id, entity, code, current_version_id, next_version_no, revision, created_by, updated_by
) VALUES (
    sqlc.arg(id), sqlc.arg(entity), sqlc.arg(code), sqlc.arg(current_version_id), 2, 1, sqlc.arg(actor_id), sqlc.arg(actor_id)
);

-- name: InsertBobVersion :exec
INSERT INTO bob_versions (
    id, object_id, entity, version_no, status, revision, created_by, updated_by
) VALUES (
    sqlc.arg(id), sqlc.arg(object_id), sqlc.arg(entity), sqlc.arg(version_no), 'DRAFT', 1, sqlc.arg(actor_id), sqlc.arg(actor_id)
);

-- name: InsertBobCustomerDetail :exec
INSERT INTO bob_customer_versions (
    version_id, name, customer_type, short_name, category_id, tax_number,
    contact_name, contact_phone, email, address, remark, settlement_method_id, salesperson_employee_id
) VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.arg(customer_type),
    sqlc.narg(short_name), sqlc.narg(category_id), sqlc.narg(tax_number),
    sqlc.narg(contact_name), sqlc.narg(contact_phone), sqlc.narg(email),
    sqlc.narg(address), sqlc.narg(remark), sqlc.narg(settlement_method_id),
    sqlc.arg(salesperson_employee_id)
);

-- name: InsertBobSupplierDetail :exec
INSERT INTO bob_supplier_versions (
    version_id, name, supplier_type, short_name, category_id, tax_number,
    contact_name, contact_phone, email, address, remark, settlement_method_id,
    salesperson_employee_id
) VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.arg(supplier_type),
    sqlc.narg(short_name), sqlc.narg(category_id), sqlc.narg(tax_number),
    sqlc.narg(contact_name), sqlc.narg(contact_phone), sqlc.narg(email),
    sqlc.narg(address), sqlc.narg(remark), sqlc.narg(settlement_method_id),
    sqlc.arg(salesperson_employee_id)
);

-- name: InsertBobEmployeeDetail :exec
INSERT INTO bob_employee_versions (
    version_id, name, category_id, department_id, position_id, phone, email, hire_date, remark
) VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.narg(category_id), sqlc.narg(department_id),
    sqlc.narg(position_id), sqlc.narg(phone), sqlc.narg(email),
    NULLIF(sqlc.arg(hire_date)::text, '')::date, sqlc.narg(remark)
);

-- name: InsertBobProductDetail :exec
INSERT INTO bob_product_versions (
    version_id, name, unit, container_type, quantity_per_container_micros,
    category_id, specification, model, barcode, remark
) VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.arg(unit), sqlc.arg(container_type),
    sqlc.narg(quantity_per_container_micros), sqlc.narg(category_id),
    sqlc.narg(specification), sqlc.narg(model), sqlc.narg(barcode), sqlc.narg(remark)
);

-- name: InsertBobServiceDetail :exec
INSERT INTO bob_service_versions (version_id, name, unit, category_id, description, remark)
VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.arg(unit), sqlc.narg(category_id),
    sqlc.narg(description), sqlc.narg(remark)
);

-- name: InsertBobWarehouseDetail :exec
INSERT INTO bob_warehouse_versions (
    version_id, name, category_id, address, contact_name, contact_phone, manager_employee_id, remark
) VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.narg(category_id), sqlc.narg(address),
    sqlc.narg(contact_name), sqlc.narg(contact_phone), sqlc.narg(manager_employee_id), sqlc.narg(remark)
);

-- name: InsertBobVehicleDetail :exec
INSERT INTO bob_vehicle_versions (
    version_id, name, plate_number, vehicle_type, platform_object_id,
    category_id, vin, engine_number, load_capacity_kg, remark
)
VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.arg(plate_number),
    sqlc.arg(vehicle_type), sqlc.arg(platform_object_id), sqlc.narg(category_id),
    sqlc.narg(vin), sqlc.narg(engine_number),
    NULLIF(sqlc.arg(load_capacity_kg)::text, '')::numeric(12,3), sqlc.narg(remark)
);

-- name: InsertBobFundAccountDetail :exec
INSERT INTO bob_fund_account_versions (
    version_id, name, currency, category_id, account_name, bank_name, bank_branch, account_number, remark
) VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.arg(currency), sqlc.narg(category_id),
    sqlc.narg(account_name), sqlc.narg(bank_name), sqlc.narg(bank_branch),
    sqlc.narg(account_number), sqlc.narg(remark)
);

-- name: InsertBobCategoryDetail :exec
INSERT INTO bob_category_versions (version_id, name, target_entity, parent_id, description)
VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.arg(target_entity),
    sqlc.narg(parent_id), sqlc.narg(description)
);

-- name: InsertBobDepartmentDetail :exec
INSERT INTO bob_department_versions (version_id, name, category_id, parent_id, description)
VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.narg(category_id),
    sqlc.narg(parent_id), sqlc.narg(description)
);

-- name: InsertBobPositionDetail :exec
INSERT INTO bob_position_versions (version_id, name, category_id, description)
VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.narg(category_id), sqlc.narg(description)
);

-- name: InsertBobSettlementMethodDetail :exec
INSERT INTO bob_settlement_method_versions (
    version_id, name, rule_type, month_offset, day_of_month, day_offset, description
) VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.arg(rule_type), sqlc.arg(month_offset),
    sqlc.narg(day_of_month), sqlc.arg(day_offset), sqlc.narg(description)
);

-- name: CopyBobCustomerDetail :exec
INSERT INTO bob_customer_versions (
    version_id, name, customer_type, short_name, category_id, tax_number,
    contact_name, contact_phone, email, address, remark, settlement_method_id, salesperson_employee_id
)
SELECT sqlc.arg(new_version_id), d.name, d.customer_type, d.short_name, d.category_id,
       d.tax_number, d.contact_name, d.contact_phone, d.email, d.address, d.remark,
       d.settlement_method_id, d.salesperson_employee_id
FROM bob_customer_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobSupplierDetail :exec
INSERT INTO bob_supplier_versions (
    version_id, name, supplier_type, short_name, category_id, tax_number,
    contact_name, contact_phone, email, address, remark, settlement_method_id,
    salesperson_employee_id
)
SELECT sqlc.arg(new_version_id), d.name, d.supplier_type, d.short_name, d.category_id,
       d.tax_number, d.contact_name, d.contact_phone, d.email, d.address, d.remark,
       d.settlement_method_id, d.salesperson_employee_id
FROM bob_supplier_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobEmployeeDetail :exec
INSERT INTO bob_employee_versions (
    version_id, name, category_id, department_id, position_id, phone, email, hire_date, remark
)
SELECT sqlc.arg(new_version_id), d.name, d.category_id, d.department_id, d.position_id,
       d.phone, d.email, d.hire_date, d.remark
FROM bob_employee_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobProductDetail :exec
INSERT INTO bob_product_versions (
    version_id, name, unit, container_type, quantity_per_container_micros,
    category_id, specification, model, barcode, remark
)
SELECT sqlc.arg(new_version_id), d.name, d.unit, d.container_type, d.quantity_per_container_micros,
       d.category_id, d.specification,
       d.model, d.barcode, d.remark
FROM bob_product_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobServiceDetail :exec
INSERT INTO bob_service_versions (version_id, name, unit, category_id, description, remark)
SELECT sqlc.arg(new_version_id), d.name, d.unit, d.category_id, d.description, d.remark
FROM bob_service_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobWarehouseDetail :exec
INSERT INTO bob_warehouse_versions (
    version_id, name, category_id, address, contact_name, contact_phone, manager_employee_id, remark
)
SELECT sqlc.arg(new_version_id), d.name, d.category_id, d.address, d.contact_name,
       d.contact_phone, d.manager_employee_id, d.remark
FROM bob_warehouse_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobVehicleDetail :exec
INSERT INTO bob_vehicle_versions (
    version_id, name, plate_number, vehicle_type, platform_object_id,
    category_id, vin, engine_number, load_capacity_kg, remark
)
SELECT sqlc.arg(new_version_id), d.name, d.plate_number, d.vehicle_type, d.platform_object_id,
       d.category_id, d.vin, d.engine_number, d.load_capacity_kg, d.remark
FROM bob_vehicle_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobFundAccountDetail :exec
INSERT INTO bob_fund_account_versions (
    version_id, name, currency, category_id, account_name, bank_name, bank_branch, account_number, remark
)
SELECT sqlc.arg(new_version_id), d.name, d.currency, d.category_id, d.account_name,
       d.bank_name, d.bank_branch, d.account_number, d.remark
FROM bob_fund_account_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobCategoryDetail :exec
INSERT INTO bob_category_versions (version_id, name, target_entity, parent_id, description)
SELECT sqlc.arg(new_version_id), d.name, d.target_entity, d.parent_id, d.description
FROM bob_category_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobDepartmentDetail :exec
INSERT INTO bob_department_versions (version_id, name, category_id, parent_id, description)
SELECT sqlc.arg(new_version_id), d.name, d.category_id, d.parent_id, d.description
FROM bob_department_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobPositionDetail :exec
INSERT INTO bob_position_versions (version_id, name, category_id, description)
SELECT sqlc.arg(new_version_id), d.name, d.category_id, d.description
FROM bob_position_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobSettlementMethodDetail :exec
INSERT INTO bob_settlement_method_versions (
    version_id, name, rule_type, month_offset, day_of_month, day_offset, description
)
SELECT sqlc.arg(new_version_id), d.name, d.rule_type, d.month_offset,
       d.day_of_month, d.day_offset, d.description
FROM bob_settlement_method_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: UpdateBobCustomerDetail :execrows
UPDATE bob_customer_versions
SET name = sqlc.arg(name), customer_type = sqlc.arg(customer_type),
    short_name = sqlc.narg(short_name), category_id = sqlc.narg(category_id),
    tax_number = sqlc.narg(tax_number), contact_name = sqlc.narg(contact_name),
    contact_phone = sqlc.narg(contact_phone), email = sqlc.narg(email),
    address = sqlc.narg(address), remark = sqlc.narg(remark),
    settlement_method_id = sqlc.narg(settlement_method_id),
    salesperson_employee_id = sqlc.arg(salesperson_employee_id)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobSupplierDetail :execrows
UPDATE bob_supplier_versions
SET name = sqlc.arg(name), supplier_type = sqlc.arg(supplier_type),
    short_name = sqlc.narg(short_name), category_id = sqlc.narg(category_id),
    tax_number = sqlc.narg(tax_number), contact_name = sqlc.narg(contact_name),
    contact_phone = sqlc.narg(contact_phone), email = sqlc.narg(email),
    address = sqlc.narg(address), remark = sqlc.narg(remark),
    settlement_method_id = sqlc.narg(settlement_method_id),
    salesperson_employee_id = sqlc.arg(salesperson_employee_id)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobEmployeeDetail :execrows
UPDATE bob_employee_versions
SET name = sqlc.arg(name), category_id = sqlc.narg(category_id),
    department_id = sqlc.narg(department_id), position_id = sqlc.narg(position_id),
    phone = sqlc.narg(phone), email = sqlc.narg(email),
    hire_date = NULLIF(sqlc.arg(hire_date)::text, '')::date, remark = sqlc.narg(remark)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobProductDetail :execrows
UPDATE bob_product_versions
SET name = sqlc.arg(name), unit = sqlc.arg(unit), container_type = sqlc.arg(container_type),
    quantity_per_container_micros = sqlc.narg(quantity_per_container_micros),
    category_id = sqlc.narg(category_id),
    specification = sqlc.narg(specification), model = sqlc.narg(model),
    barcode = sqlc.narg(barcode), remark = sqlc.narg(remark)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobServiceDetail :execrows
UPDATE bob_service_versions
SET name = sqlc.arg(name), unit = sqlc.arg(unit), category_id = sqlc.narg(category_id),
    description = sqlc.narg(description), remark = sqlc.narg(remark)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobWarehouseDetail :execrows
UPDATE bob_warehouse_versions
SET name = sqlc.arg(name), category_id = sqlc.narg(category_id), address = sqlc.narg(address),
    contact_name = sqlc.narg(contact_name), contact_phone = sqlc.narg(contact_phone),
    manager_employee_id = sqlc.narg(manager_employee_id), remark = sqlc.narg(remark)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobVehicleDetail :execrows
UPDATE bob_vehicle_versions
SET name = sqlc.arg(name), plate_number = sqlc.arg(plate_number),
    vehicle_type = sqlc.arg(vehicle_type), platform_object_id = sqlc.arg(platform_object_id),
    category_id = sqlc.narg(category_id), vin = sqlc.narg(vin),
    engine_number = sqlc.narg(engine_number),
    load_capacity_kg = NULLIF(sqlc.arg(load_capacity_kg)::text, '')::numeric(12,3),
    remark = sqlc.narg(remark)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobFundAccountDetail :execrows
UPDATE bob_fund_account_versions
SET name = sqlc.arg(name), currency = sqlc.arg(currency), category_id = sqlc.narg(category_id),
    account_name = sqlc.narg(account_name), bank_name = sqlc.narg(bank_name),
    bank_branch = sqlc.narg(bank_branch), account_number = sqlc.narg(account_number),
    remark = sqlc.narg(remark)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobCategoryDetail :execrows
UPDATE bob_category_versions
SET name = sqlc.arg(name), target_entity = sqlc.arg(target_entity),
    parent_id = sqlc.narg(parent_id), description = sqlc.narg(description)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobDepartmentDetail :execrows
UPDATE bob_department_versions
SET name = sqlc.arg(name), category_id = sqlc.narg(category_id),
    parent_id = sqlc.narg(parent_id), description = sqlc.narg(description)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobPositionDetail :execrows
UPDATE bob_position_versions
SET name = sqlc.arg(name), category_id = sqlc.narg(category_id), description = sqlc.narg(description)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobSettlementMethodDetail :execrows
UPDATE bob_settlement_method_versions
SET name = sqlc.arg(name), rule_type = sqlc.arg(rule_type),
    month_offset = sqlc.arg(month_offset), day_of_month = sqlc.narg(day_of_month),
    day_offset = sqlc.arg(day_offset), description = sqlc.narg(description)
WHERE version_id = sqlc.arg(version_id);

-- name: LockBobObject :one
SELECT id, entity, code, current_version_id, effective_version_id, next_version_no, revision, updated_at
FROM bob_objects
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
FOR UPDATE;

-- name: FindBobObjectIDByCode :one
SELECT id
FROM bob_objects
WHERE entity = sqlc.arg(entity) AND upper(code) = upper(sqlc.arg(code)::text)
LIMIT 1;

-- name: LockBobVersion :one
SELECT id, object_id, entity, version_no, status, revision,
       submitted_at, submitted_by, reviewed_at, reviewed_by
FROM bob_versions
WHERE id = sqlc.arg(id) AND object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
FOR UPDATE;

-- name: BobDraftAuditIsDeletable :one
SELECT count(*) >= 1
   AND count(*) FILTER (WHERE event_type = 'CREATED') = 1
   AND bool_and(event_type IN ('CREATED', 'SAVED'))
FROM bob_audit_events
WHERE object_id = sqlc.arg(object_id)
  AND version_id = sqlc.arg(version_id)
  AND entity = sqlc.arg(entity);

-- name: BobObjectHasExternalReferences :one
SELECT EXISTS (
    SELECT 1
    FROM bob_vehicle_versions vehicle
    WHERE vehicle.platform_object_id = sqlc.arg(target_object_id)
       OR vehicle.category_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_customer_versions
    WHERE category_id = sqlc.arg(target_object_id)
       OR settlement_method_id = sqlc.arg(target_object_id)
       OR salesperson_employee_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_supplier_versions
    WHERE category_id = sqlc.arg(target_object_id)
       OR settlement_method_id = sqlc.arg(target_object_id)
       OR salesperson_employee_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_employee_versions
    WHERE category_id = sqlc.arg(target_object_id)
       OR department_id = sqlc.arg(target_object_id)
       OR position_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_product_versions
    WHERE category_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_service_versions
    WHERE category_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_warehouse_versions
    WHERE category_id = sqlc.arg(target_object_id)
       OR manager_employee_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_fund_account_versions
    WHERE category_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_category_versions
    WHERE parent_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_department_versions
    WHERE category_id = sqlc.arg(target_object_id)
       OR parent_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_position_versions
    WHERE category_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1
    FROM vou_sale_order_details sale_order
    WHERE sale_order.customer_object_id = sqlc.arg(target_object_id)
       OR sale_order.customer_version_id = sqlc.arg(target_version_id)
       OR sale_order.salesperson_object_id = sqlc.arg(target_object_id)
       OR sale_order.salesperson_version_id = sqlc.arg(target_version_id)
       OR sale_order.warehouse_object_id = sqlc.arg(target_object_id)
       OR sale_order.warehouse_version_id = sqlc.arg(target_version_id)
       OR sale_order.settlement_method_object_id = sqlc.arg(target_object_id)
       OR sale_order.settlement_method_version_id = sqlc.arg(target_version_id)
       OR sale_order.platform_object_id = sqlc.arg(target_object_id)
       OR sale_order.platform_version_id = sqlc.arg(target_version_id)
       OR sale_order.vehicle_object_id = sqlc.arg(target_object_id)
       OR sale_order.vehicle_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_purchase_order_details purchase_order
    WHERE purchase_order.supplier_object_id = sqlc.arg(target_object_id)
       OR purchase_order.supplier_version_id = sqlc.arg(target_version_id)
       OR purchase_order.purchaser_object_id = sqlc.arg(target_object_id)
       OR purchase_order.purchaser_version_id = sqlc.arg(target_version_id)
       OR purchase_order.warehouse_object_id = sqlc.arg(target_object_id)
       OR purchase_order.warehouse_version_id = sqlc.arg(target_version_id)
       OR purchase_order.settlement_method_object_id = sqlc.arg(target_object_id)
       OR purchase_order.settlement_method_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_intermediary_sale_order_details intermediary
    WHERE intermediary.customer_object_id = sqlc.arg(target_object_id)
       OR intermediary.customer_version_id = sqlc.arg(target_version_id)
       OR intermediary.supplier_object_id = sqlc.arg(target_object_id)
       OR intermediary.supplier_version_id = sqlc.arg(target_version_id)
       OR intermediary.salesperson_object_id = sqlc.arg(target_object_id)
       OR intermediary.salesperson_version_id = sqlc.arg(target_version_id)
       OR intermediary.purchaser_object_id = sqlc.arg(target_object_id)
       OR intermediary.purchaser_version_id = sqlc.arg(target_version_id)
       OR intermediary.customer_settlement_method_object_id = sqlc.arg(target_object_id)
       OR intermediary.customer_settlement_method_version_id = sqlc.arg(target_version_id)
       OR intermediary.supplier_settlement_method_object_id = sqlc.arg(target_object_id)
       OR intermediary.supplier_settlement_method_version_id = sqlc.arg(target_version_id)
       OR intermediary.platform_object_id = sqlc.arg(target_object_id)
       OR intermediary.platform_version_id = sqlc.arg(target_version_id)
       OR intermediary.vehicle_object_id = sqlc.arg(target_object_id)
       OR intermediary.vehicle_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_receipt_details receipt
    WHERE receipt.counterparty_object_id = sqlc.arg(target_object_id)
       OR receipt.counterparty_version_id = sqlc.arg(target_version_id)
       OR receipt.fund_account_object_id = sqlc.arg(target_object_id)
       OR receipt.fund_account_version_id = sqlc.arg(target_version_id)
       OR receipt.handler_object_id = sqlc.arg(target_object_id)
       OR receipt.handler_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_payment_details payment
    WHERE payment.counterparty_object_id = sqlc.arg(target_object_id)
       OR payment.counterparty_version_id = sqlc.arg(target_version_id)
       OR payment.fund_account_object_id = sqlc.arg(target_object_id)
       OR payment.fund_account_version_id = sqlc.arg(target_version_id)
       OR payment.handler_object_id = sqlc.arg(target_object_id)
       OR payment.handler_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_expense_reimbursement_details reimbursement
    WHERE reimbursement.employee_object_id = sqlc.arg(target_object_id)
       OR reimbursement.employee_version_id = sqlc.arg(target_version_id)
       OR reimbursement.fund_account_object_id = sqlc.arg(target_object_id)
       OR reimbursement.fund_account_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_other_income_details other_income
    WHERE other_income.counterparty_object_id = sqlc.arg(target_object_id)
       OR other_income.counterparty_version_id = sqlc.arg(target_version_id)
       OR other_income.fund_account_object_id = sqlc.arg(target_object_id)
       OR other_income.fund_account_version_id = sqlc.arg(target_version_id)
       OR other_income.handler_object_id = sqlc.arg(target_object_id)
       OR other_income.handler_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_product_lines product_line
    WHERE product_line.product_object_id = sqlc.arg(target_object_id)
       OR product_line.product_version_id = sqlc.arg(target_version_id)
);

-- name: DeleteBobAuditEventsForDraft :execrows
DELETE FROM bob_audit_events
WHERE object_id = sqlc.arg(object_id)
  AND version_id = sqlc.arg(version_id)
  AND entity = sqlc.arg(entity)
  AND event_type IN ('CREATED', 'SAVED');

-- name: DeleteBobCustomerDetail :execrows
DELETE FROM bob_customer_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobSupplierDetail :execrows
DELETE FROM bob_supplier_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobEmployeeDetail :execrows
DELETE FROM bob_employee_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobProductDetail :execrows
DELETE FROM bob_product_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobServiceDetail :execrows
DELETE FROM bob_service_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobWarehouseDetail :execrows
DELETE FROM bob_warehouse_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobVehicleDetail :execrows
DELETE FROM bob_vehicle_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobFundAccountDetail :execrows
DELETE FROM bob_fund_account_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobCategoryDetail :execrows
DELETE FROM bob_category_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobDepartmentDetail :execrows
DELETE FROM bob_department_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobPositionDetail :execrows
DELETE FROM bob_position_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobSettlementMethodDetail :execrows
DELETE FROM bob_settlement_method_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobFirstVersion :execrows
DELETE FROM bob_versions
WHERE id = sqlc.arg(version_id)
  AND object_id = sqlc.arg(object_id)
  AND entity = sqlc.arg(entity)
  AND version_no = 1
  AND status = 'DRAFT'
  AND revision = sqlc.arg(revision)
  AND submitted_at IS NULL
  AND submitted_by IS NULL
  AND reviewed_at IS NULL
  AND reviewed_by IS NULL;

-- name: DeleteBobObject :execrows
DELETE FROM bob_objects
WHERE id = sqlc.arg(object_id)
  AND entity = sqlc.arg(entity)
  AND current_version_id = sqlc.arg(version_id)
  AND effective_version_id IS NULL
  AND next_version_no = 2
  AND revision = sqlc.arg(object_revision);

-- name: LockEffectiveLogisticsPlatform :one
SELECT o.id
FROM bob_objects o
JOIN bob_versions v
  ON v.id = o.effective_version_id
 AND v.object_id = o.id
 AND v.entity = o.entity
JOIN bob_supplier_versions s ON s.version_id = v.id
WHERE o.id = sqlc.arg(platform_object_id)
  AND o.entity = 'supplier'
  AND o.current_version_id = o.effective_version_id
  AND v.status = 'EFFECTIVE'
  AND s.supplier_type = 'LOGISTICS_PLATFORM'
FOR SHARE OF o;

-- name: LockEffectiveBobReference :one
SELECT o.id
FROM bob_objects o
JOIN bob_versions v
  ON v.id = o.effective_version_id
 AND v.object_id = o.id
 AND v.entity = o.entity
WHERE o.id = sqlc.arg(object_id)
  AND o.entity = sqlc.arg(entity)
  AND o.current_version_id = o.effective_version_id
  AND v.status = 'EFFECTIVE'
FOR SHARE OF o;

-- name: LockEffectiveCategoryReference :one
SELECT detail.target_entity
FROM bob_objects o
JOIN bob_versions v
  ON v.id = o.effective_version_id
 AND v.object_id = o.id
 AND v.entity = o.entity
JOIN bob_category_versions detail ON detail.version_id = v.id
WHERE o.id = sqlc.arg(target_category_id)
  AND o.entity = 'category'
  AND o.current_version_id = o.effective_version_id
  AND v.status = 'EFFECTIVE'
FOR SHARE OF o;

-- name: MarkBobVersionSaved :execrows
UPDATE bob_versions
SET revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status IN ('DRAFT', 'REJECTED');

-- name: SubmitBobVersion :execrows
UPDATE bob_versions
SET status = 'PENDING', revision = revision + 1, submitted_at = now(), submitted_by = sqlc.arg(actor_id),
    reviewed_at = NULL, reviewed_by = NULL, review_comment = NULL, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status IN ('DRAFT', 'REJECTED');

-- name: ApproveBobVersion :execrows
UPDATE bob_versions
SET status = 'EFFECTIVE', revision = revision + 1, reviewed_at = now(), reviewed_by = sqlc.arg(actor_id),
    review_comment = sqlc.narg(comment), updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'PENDING' AND submitted_by <> sqlc.arg(actor_id);

-- name: RejectBobVersion :execrows
UPDATE bob_versions
SET status = 'REJECTED', revision = revision + 1, reviewed_at = now(), reviewed_by = sqlc.arg(actor_id),
    review_comment = sqlc.arg(comment), updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'PENDING' AND submitted_by <> sqlc.arg(actor_id);

-- name: InvalidateBobVersion :execrows
UPDATE bob_versions
SET status = 'INVALID', revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'EFFECTIVE';

-- name: AdvanceBobObjectForEdit :execrows
UPDATE bob_objects
SET current_version_id = sqlc.arg(new_version_id), effective_version_id = NULL,
    next_version_no = next_version_no + 1, revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity) AND revision = sqlc.arg(revision)
  AND current_version_id = sqlc.arg(old_version_id) AND effective_version_id = sqlc.arg(old_version_id);

-- name: SetBobObjectEffective :execrows
UPDATE bob_objects
SET effective_version_id = sqlc.arg(version_id), revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity) AND current_version_id = sqlc.arg(version_id)
  AND effective_version_id IS NULL AND revision = sqlc.arg(revision);

-- name: TouchBobObject :exec
UPDATE bob_objects SET updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity);

-- name: InsertBobAuditEvent :exec
INSERT INTO bob_audit_events (
    id, object_id, version_id, entity, event_type, from_status, to_status, actor_id, comment, request_id, summary
) VALUES (
    sqlc.arg(id), sqlc.arg(object_id), sqlc.arg(version_id), sqlc.arg(entity), sqlc.arg(event_type),
    sqlc.narg(from_status), sqlc.arg(to_status), sqlc.arg(actor_id), sqlc.narg(comment), sqlc.arg(request_id), sqlc.arg(summary)
);

-- name: GetBobVersionView :one
SELECT * FROM bob_version_views
WHERE object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
  AND version_id = COALESCE(NULLIF(sqlc.arg(version_id)::text, ''), current_version_id);

-- name: CountBobObjects :one
SELECT count(*)
FROM bob_version_views
WHERE entity = sqlc.arg(entity) AND version_id = current_version_id
  AND (cardinality(sqlc.arg(statuses)::text[]) = 0 OR status = ANY(sqlc.arg(statuses)::text[]))
  AND (sqlc.arg(customer_type)::text = '' OR customer_type = sqlc.arg(customer_type))
  AND (sqlc.arg(supplier_type)::text = '' OR supplier_type = sqlc.arg(supplier_type))
  AND (sqlc.arg(category_id)::text = '' OR category_id = sqlc.arg(category_id))
  AND (sqlc.arg(department_id)::text = '' OR department_id = sqlc.arg(department_id))
  AND (sqlc.arg(position_id)::text = '' OR position_id = sqlc.arg(position_id))
  AND (sqlc.arg(salesperson_employee_id)::text = '' OR salesperson_employee_id = sqlc.arg(salesperson_employee_id))
  AND (sqlc.arg(currency)::text = '' OR currency = sqlc.arg(currency))
  AND (sqlc.arg(target_entity)::text = '' OR target_entity = sqlc.arg(target_entity))
  AND (sqlc.arg(parent_id)::text = '' OR parent_id = sqlc.arg(parent_id))
  AND (NOT sqlc.arg(root_only)::boolean OR parent_id = '')
  AND (
      sqlc.arg(keyword)::text = ''
      OR code ILIKE '%' || sqlc.arg(keyword) || '%'
      OR name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR (entity = 'vehicle' AND plate_number ILIKE '%' || sqlc.arg(keyword) || '%')
      OR short_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR tax_number ILIKE '%' || sqlc.arg(keyword) || '%'
      OR contact_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR contact_phone ILIKE '%' || sqlc.arg(keyword) || '%'
      OR email ILIKE '%' || sqlc.arg(keyword) || '%'
      OR address ILIKE '%' || sqlc.arg(keyword) || '%'
      OR phone ILIKE '%' || sqlc.arg(keyword) || '%'
      OR specification ILIKE '%' || sqlc.arg(keyword) || '%'
      OR model ILIKE '%' || sqlc.arg(keyword) || '%'
      OR barcode ILIKE '%' || sqlc.arg(keyword) || '%'
      OR vin ILIKE '%' || sqlc.arg(keyword) || '%'
      OR engine_number ILIKE '%' || sqlc.arg(keyword) || '%'
      OR account_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR bank_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR bank_branch ILIKE '%' || sqlc.arg(keyword) || '%'
  );

-- name: ListBobObjects :many
SELECT *
FROM bob_version_views
WHERE entity = sqlc.arg(entity) AND version_id = current_version_id
  AND (cardinality(sqlc.arg(statuses)::text[]) = 0 OR status = ANY(sqlc.arg(statuses)::text[]))
  AND (sqlc.arg(customer_type)::text = '' OR customer_type = sqlc.arg(customer_type))
  AND (sqlc.arg(supplier_type)::text = '' OR supplier_type = sqlc.arg(supplier_type))
  AND (sqlc.arg(category_id)::text = '' OR category_id = sqlc.arg(category_id))
  AND (sqlc.arg(department_id)::text = '' OR department_id = sqlc.arg(department_id))
  AND (sqlc.arg(position_id)::text = '' OR position_id = sqlc.arg(position_id))
  AND (sqlc.arg(salesperson_employee_id)::text = '' OR salesperson_employee_id = sqlc.arg(salesperson_employee_id))
  AND (sqlc.arg(currency)::text = '' OR currency = sqlc.arg(currency))
  AND (sqlc.arg(target_entity)::text = '' OR target_entity = sqlc.arg(target_entity))
  AND (sqlc.arg(parent_id)::text = '' OR parent_id = sqlc.arg(parent_id))
  AND (NOT sqlc.arg(root_only)::boolean OR parent_id = '')
  AND (
      sqlc.arg(keyword)::text = ''
      OR code ILIKE '%' || sqlc.arg(keyword) || '%'
      OR name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR (entity = 'vehicle' AND plate_number ILIKE '%' || sqlc.arg(keyword) || '%')
      OR short_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR tax_number ILIKE '%' || sqlc.arg(keyword) || '%'
      OR contact_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR contact_phone ILIKE '%' || sqlc.arg(keyword) || '%'
      OR email ILIKE '%' || sqlc.arg(keyword) || '%'
      OR address ILIKE '%' || sqlc.arg(keyword) || '%'
      OR phone ILIKE '%' || sqlc.arg(keyword) || '%'
      OR specification ILIKE '%' || sqlc.arg(keyword) || '%'
      OR model ILIKE '%' || sqlc.arg(keyword) || '%'
      OR barcode ILIKE '%' || sqlc.arg(keyword) || '%'
      OR vin ILIKE '%' || sqlc.arg(keyword) || '%'
      OR engine_number ILIKE '%' || sqlc.arg(keyword) || '%'
      OR account_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR bank_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR bank_branch ILIKE '%' || sqlc.arg(keyword) || '%'
  )
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text = 'updatedAt' AND sqlc.arg(sort_order)::text = 'asc' THEN object_updated_at END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'updatedAt' AND sqlc.arg(sort_order)::text = 'desc' THEN object_updated_at END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'code' AND sqlc.arg(sort_order)::text = 'asc' THEN code END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'code' AND sqlc.arg(sort_order)::text = 'desc' THEN code END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'name' AND sqlc.arg(sort_order)::text = 'asc' THEN name END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'name' AND sqlc.arg(sort_order)::text = 'desc' THEN name END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'status' AND sqlc.arg(sort_order)::text = 'asc' THEN status END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'status' AND sqlc.arg(sort_order)::text = 'desc' THEN status END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'version' AND sqlc.arg(sort_order)::text = 'asc' THEN version_no END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'version' AND sqlc.arg(sort_order)::text = 'desc' THEN version_no END DESC,
  object_id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountBobVersions :one
SELECT count(*) FROM bob_versions WHERE object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity);

-- name: ListBobVersions :many
SELECT * FROM bob_version_views
WHERE object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
ORDER BY version_no DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountBobAuditEvents :one
SELECT count(*) FROM bob_audit_events WHERE object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity);

-- name: ListBobAuditEvents :many
SELECT id, object_id, version_id, entity, event_type, from_status, to_status, actor_id,
       occurred_at, comment, request_id, summary
FROM bob_audit_events
WHERE object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
ORDER BY occurred_at DESC, id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: ResolveBobEffectiveReference :one
SELECT view.*
FROM bob_version_views view
JOIN bob_objects o ON o.id = view.object_id AND o.entity = view.entity
WHERE view.object_id = sqlc.arg(object_id) AND view.entity = sqlc.arg(entity)
  AND view.version_id = sqlc.arg(version_id)
  AND view.effective_version_id = view.version_id
  AND view.status = 'EFFECTIVE'
FOR SHARE OF o;

-- name: ResolveCurrentBobEffectiveReference :one
SELECT view.*
FROM bob_version_views view
JOIN bob_objects o ON o.id = view.object_id AND o.entity = view.entity
WHERE view.object_id = sqlc.arg(object_id) AND view.entity = sqlc.arg(entity)
  AND view.version_id = o.current_version_id
  AND view.version_id = o.effective_version_id
  AND view.status = 'EFFECTIVE'
FOR SHARE OF o;
