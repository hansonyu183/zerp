//go:build integration

package dcl

import (
	"errors"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func TestWarehouseDeclarationControlsBOBCurrentDataIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	business := newDCLIntegrationBOBService(pool, auxiliary, authorizer, bus)
	service := NewWarehouseService(pool, business, authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }

	v1, err := service.Create(t.Context(), WarehouseCreateInput{Data: WarehouseData{Name: "一号仓"}}, creator("create-v1"))
	if err != nil {
		t.Fatalf("create V1: %v", err)
	}
	assertWarehouseAbsent(t, business, v1.ObjectID)

	v1 = submitAndApproveWarehouse(t, service, v1, creator("submit-v1"), reviewer("approve-v1"))
	assertWarehouseCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "一号仓", true)

	v2, err := service.Save(t.Context(), WarehouseSaveInput{
		ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID,
		ApprovalRevision: v1.Approval.Revision, Enabled: false,
		Data: WarehouseData{Name: "二号仓", Address: "新地址"},
	}, creator("save-v2"))
	if err != nil {
		t.Fatalf("create V2: %v", err)
	}
	assertWarehouseCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "一号仓", true)

	v2 = submitAndApproveWarehouse(t, service, v2, creator("submit-v2"), reviewer("approve-v2"))
	assertWarehouseCurrent(t, business, v1.ObjectID, v2.Approval.ApprovalEntryID, "二号仓", false)

	v2, err = service.Unapprove(t.Context(), WarehouseReviewInput{
		ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision, Reason: "回落验证",
	}, reviewer("unapprove-v2"))
	if err != nil {
		t.Fatalf("unapprove V2: %v", err)
	}
	assertWarehouseCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "一号仓", true)
}

func TestWarehouseDeclarationPersistsManagerApprovalSnapshotIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	business := newDCLIntegrationBOBService(pool, auxiliary, authorizer, bus)
	service := NewWarehouseService(pool, business, authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }

	employeeID, employeeEntryID := insertApprovedEmployeeReference(t, pool, creatorID, reviewerID)

	warehouse, err := service.Create(t.Context(), WarehouseCreateInput{Data: WarehouseData{
		Name: "负责人快照仓", ManagerEmployeeID: employeeID,
	}}, creator("warehouse-create"))
	if err != nil {
		t.Fatalf("create warehouse: %v", err)
	}
	var snapshot string
	if err = pool.QueryRow(t.Context(), `SELECT manager_employee_approval_entry_id FROM dcl_warehouse_versions WHERE approval_entry_id=$1`, warehouse.Approval.ApprovalEntryID).Scan(&snapshot); err != nil {
		t.Fatalf("read warehouse manager snapshot: %v", err)
	}
	if snapshot != employeeEntryID {
		t.Fatalf("manager snapshot = %q, want %q", snapshot, employeeEntryID)
	}
	warehouse = submitAndApproveWarehouse(t, service, warehouse, creator("warehouse-submit"), reviewer("warehouse-approve"))
	view, err := business.Get(t.Context(), bobdomain.EntityWarehouse, bobdomain.GetInput{ObjectID: warehouse.ObjectID})
	if err != nil {
		t.Fatalf("get current warehouse: %v", err)
	}
	if view.Data.ManagerEmployeeID != employeeID || view.Data.ManagerEmployeeApprovalEntryID != employeeEntryID {
		t.Fatalf("warehouse manager current = %+v", view.Data)
	}
}

func TestWarehouseUnapproveDisabledFallbackBlockerRollsBackIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	business := newDCLIntegrationBOBService(pool, auxiliary, authorizer, bus)
	service := NewWarehouseService(pool, business, authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }

	v1, err := service.Create(t.Context(), WarehouseCreateInput{Data: WarehouseData{Name: "回落禁用仓"}}, creator("create-v1"))
	if err != nil {
		t.Fatalf("create V1: %v", err)
	}
	v1, err = service.Save(t.Context(), WarehouseSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Enabled: false, Data: WarehouseData{Name: "回落禁用仓"}}, creator("disable-v1"))
	if err != nil {
		t.Fatalf("save disabled V1: %v", err)
	}
	v1 = submitAndApproveWarehouse(t, service, v1, creator("submit-v1"), reviewer("approve-v1"))
	v2, err := service.Save(t.Context(), WarehouseSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Enabled: true, Data: WarehouseData{Name: "当前启用仓"}}, creator("save-v2"))
	if err != nil {
		t.Fatalf("save V2: %v", err)
	}
	v2 = submitAndApproveWarehouse(t, service, v2, creator("submit-v2"), reviewer("approve-v2"))

	insertWarehousePendingInventoryCount(t, pool, v1, creatorID)
	_, err = service.Unapprove(t.Context(), WarehouseReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "会回落禁用版本"}, reviewer("unapprove-v2"))
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "warehouse_disable_blocked" {
		t.Fatalf("unapprove disabled fallback error = %v", err)
	}
	blockers, ok := domainErr.Data.(bobdomain.WarehouseDisableBlockers)
	if !ok || len(blockers.Documents) != 1 || len(blockers.References) != 0 {
		t.Fatalf("document fallback blockers = %#v", domainErr.Data)
	}
	assertApprovalState(t, pool, v2.Approval.ApprovalEntryID, approval.StatusApproved, v2.Approval.Revision)
	assertWarehouseCurrent(t, business, v2.ObjectID, v2.Approval.ApprovalEntryID, "当前启用仓", true)
}

func TestWarehouseUnapproveDisabledFallbackInventoryBlockerRollsBackIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	business := newDCLIntegrationBOBService(pool, auxiliary, authorizer, bus)
	service := NewWarehouseService(pool, business, authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }

	v1, err := service.Create(t.Context(), WarehouseCreateInput{Data: WarehouseData{Name: "库存回落禁用仓"}}, creator("create-v1"))
	if err != nil {
		t.Fatalf("create V1: %v", err)
	}
	v1, err = service.Save(t.Context(), WarehouseSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Enabled: false, Data: WarehouseData{Name: "库存回落禁用仓"}}, creator("disable-v1"))
	if err != nil {
		t.Fatalf("save disabled V1: %v", err)
	}
	v1 = submitAndApproveWarehouse(t, service, v1, creator("submit-v1"), reviewer("approve-v1"))
	v2, err := service.Save(t.Context(), WarehouseSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Enabled: true, Data: WarehouseData{Name: "库存当前启用仓"}}, creator("save-v2"))
	if err != nil {
		t.Fatalf("save V2: %v", err)
	}
	v2 = submitAndApproveWarehouse(t, service, v2, creator("submit-v2"), reviewer("approve-v2"))

	insertWarehouseInventoryBalance(t, pool, v1.ObjectID)
	_, err = service.Unapprove(t.Context(), WarehouseReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "会回落禁用库存仓"}, reviewer("unapprove-v2"))
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "warehouse_disable_blocked" {
		t.Fatalf("unapprove disabled inventory fallback error = %v", err)
	}
	blockers, ok := domainErr.Data.(bobdomain.WarehouseDisableBlockers)
	if !ok || len(blockers.Inventory) != 1 || len(blockers.References) != 0 {
		t.Fatalf("inventory fallback blockers = %#v", domainErr.Data)
	}
	assertApprovalState(t, pool, v2.Approval.ApprovalEntryID, approval.StatusApproved, v2.Approval.Revision)
	assertWarehouseCurrent(t, business, v2.ObjectID, v2.Approval.ApprovalEntryID, "库存当前启用仓", true)
}

func insertWarehousePendingInventoryCount(t *testing.T, pool *pgxpool.Pool, warehouse WarehouseMutation, actorID string) {
	t.Helper()
	entryID, documentID := ulid.Make().String(), ulid.Make().String()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin pending inventory-count fixture: %v", err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	if _, err := tx.Exec(t.Context(), `
		INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at)
		VALUES($1,'vou','inventory-count',$2,1,'DRAFT',1,$3,now(),$3,now())
	`, entryID, documentID, actorID); err != nil {
		t.Fatalf("insert pending inventory-count approval: %v", err)
	}
	if _, err := tx.Exec(t.Context(), `
		INSERT INTO vou_documents(id,entity,document_no,approval_entry_id,business_date,currency,total_amount_cents)
		VALUES($1,'inventory-count','INV-20260827-0001',$2,'2026-08-27','CNY',0)
	`, documentID, entryID); err != nil {
		t.Fatalf("insert pending inventory-count document: %v", err)
	}
	if _, err := tx.Exec(t.Context(), `
		INSERT INTO vou_inventory_count_details(document_id,warehouse_object_id,warehouse_approval_entry_id,warehouse_code,warehouse_name)
		VALUES($1,$2,$3,'WHS-BLOCK','回落禁用仓')
	`, documentID, warehouse.ObjectID, warehouse.Approval.ApprovalEntryID); err != nil {
		t.Fatalf("insert warehouse pending inventory count: %v", err)
	}
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit pending inventory-count fixture: %v", err)
	}
}

func insertApprovedEmployeeReference(t *testing.T, pool *pgxpool.Pool, creatorID, reviewerID string) (string, string) {
	t.Helper()
	objectID, entryID := ulid.Make().String(), ulid.Make().String()
	if _, err := pool.Exec(t.Context(), `INSERT INTO bob_objects(id,entity,code,enabled,revision,created_by,updated_by) VALUES($1,'employee','EMP-0001',true,1,$2,$2)`, objectID, creatorID); err != nil {
		t.Fatalf("insert employee object: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at)
		VALUES($1,'bob','employee',$2,1,'APPROVED',3,$3,now(),$4,now(),$3,now(),$4,now())
	`, entryID, objectID, creatorID, reviewerID); err != nil {
		t.Fatalf("insert employee approval: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO bob_employee_versions(approval_entry_id,name) VALUES($1,'仓库负责人')`, entryID); err != nil {
		t.Fatalf("insert employee version: %v", err)
	}
	return objectID, entryID
}

func insertWarehouseInventoryBalance(t *testing.T, pool *pgxpool.Pool, warehouseID string) {
	t.Helper()
	bookID, subjectID, voucherID, lineID, entryID := ulid.Make().String(), ulid.Make().String(), ulid.Make().String(), ulid.Make().String(), ulid.Make().String()
	productID, productEntryID := ulid.Make().String(), ulid.Make().String()
	var userID string
	if err := pool.QueryRow(t.Context(), `SELECT id FROM app_users ORDER BY id LIMIT 1`).Scan(&userID); err != nil {
		t.Fatalf("load accounting fixture user: %v", err)
	}
	reviewerID := ulid.Make().String()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin inventory fixture: %v", err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO bob_objects(id,entity,code,enabled,revision,created_by,updated_by) VALUES($1,'product','PRD-0001',true,1,$2,$2)`, []any{productID, userID}},
		{`INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at) VALUES($1,'dcl','product',$2,1,'APPROVED',3,$3,now(),$4,now(),$3,now(),$4,now())`, []any{productEntryID, productID, userID, reviewerID}},
		{`INSERT INTO dcl_product_versions(approval_entry_id,name) VALUES($1,'库存产品')`, []any{productEntryID}},
		{`INSERT INTO acc_books(id,code,name,start_month,base_currency,control_book,created_by,updated_by) VALUES($1,'INV-FIXTURE','库存阻断账簿','2026-08-01','CNY',true,$2,$2)`, []any{bookID, userID}},
		{`INSERT INTO acc_subjects(id,book_id,code,name,balance_direction,inventory_quantity,created_by,updated_by) VALUES($1,$2,'INV','库存','DEBIT',true,$3,$3)`, []any{subjectID, bookID, userID}},
		{`INSERT INTO acc_vouchers(id,book_id,source_type,source_id,business_date,created_by) VALUES($1,$2,'OPENING','warehouse-inventory','2026-08-27',$3)`, []any{voucherID, bookID, userID}},
		{`INSERT INTO acc_voucher_lines(id,book_id,voucher_id,subject_id,currency,debit_minor,credit_minor,quantity_micros,source_line_id,line_order) VALUES($1,$2,$3,$4,'CNY',0,0,1,'warehouse-inventory',1)`, []any{lineID, bookID, voucherID, subjectID}},
		{`INSERT INTO acc_inventory_entries(id,book_id,voucher_id,voucher_line_id,subject_id,product_id,product_approval_entry_id,product_code,product_name,warehouse_id,business_date,quantity_delta_micros,source_line_id) VALUES($1,$2,$3,$4,$5,$6,$7,'PRD-0001','库存产品',$8,'2026-08-27',1,'warehouse-inventory')`, []any{entryID, bookID, voucherID, lineID, subjectID, productID, productEntryID, warehouseID}},
	} {
		if _, err := tx.Exec(t.Context(), statement.sql, statement.args...); err != nil {
			t.Fatalf("insert inventory fixture: %v", err)
		}
	}
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit inventory fixture: %v", err)
	}
}

func submitAndApproveWarehouse(
	t *testing.T,
	service *WarehouseService,
	mutation WarehouseMutation,
	submitter approval.Actor,
	reviewer approval.Actor,
) WarehouseMutation {
	t.Helper()
	pending, err := service.Submit(t.Context(), WarehouseVersionInput{
		ObjectID: mutation.ObjectID, ApprovalEntryID: mutation.Approval.ApprovalEntryID,
		ApprovalRevision: mutation.Approval.Revision,
	}, submitter)
	if err != nil {
		t.Fatalf("submit warehouse: %v", err)
	}
	approved, err := service.Approve(t.Context(), WarehouseVersionInput{
		ObjectID: mutation.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID,
		ApprovalRevision: pending.Approval.Revision,
	}, reviewer)
	if err != nil {
		t.Fatalf("approve warehouse: %v", err)
	}
	return approved
}

func assertWarehouseAbsent(t *testing.T, business *bobdomain.Service, objectID string) {
	t.Helper()
	if _, err := business.Get(t.Context(), bobdomain.EntityWarehouse, bobdomain.GetInput{ObjectID: objectID}); err == nil {
		t.Fatal("ordinary BOB get exposed a warehouse candidate")
	}
}

func assertWarehouseCurrent(t *testing.T, business *bobdomain.Service, objectID, entryID, name string, enabled bool) {
	t.Helper()
	view, err := business.Get(t.Context(), bobdomain.EntityWarehouse, bobdomain.GetInput{ObjectID: objectID})
	if err != nil {
		t.Fatalf("get BOB warehouse: %v", err)
	}
	if view.Approval.ApprovalEntryID != entryID || view.Data.Name != name || view.Enabled != enabled {
		t.Fatalf("BOB warehouse current = %+v", view)
	}
}
