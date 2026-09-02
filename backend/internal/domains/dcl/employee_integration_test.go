//go:build integration

package dcl

import (
	"errors"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func TestEmployeeDeclarationOwnsLifecycleSnapshotsAndCurrentIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
	employees := NewEmployeeService(pool, business, authorizer, bus)
	operating := NewOperatingEntityService(pool, business, authorizer, bus)

	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }

	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "员工所属主体"}}, creator("owner-create"))
	if err != nil {
		t.Fatalf("create operating entity: %v", err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("owner-submit"), reviewer("owner-approve"))
	if _, err = employees.Create(t.Context(), EmployeeCreateInput{Data: EmployeeInput{
		Kind: "PERSON", LegalName: "非法员工标识", LegalIdentifier: "employee-invalid",
		Enabled: true, CurrentOperatingEntityID: owner.ObjectID,
	}}, creator("employee-invalid-identifier")); err == nil {
		t.Fatal("Employee accepted an invalid legal identifier")
	} else {
		requireLegalIdentifierError(t, err, "invalid_legal_identifier")
	}
	assertDCLSubjectCount(t, pool, EntityEmployee, 0)
	categoryID := createEmployeeAuxiliary(t, auxiliary, auxdomain.EntityEmployeeCategory, "正式员工", creator("category-create"))
	departmentID := createEmployeeAuxiliary(t, auxiliary, auxdomain.EntityDepartment, "销售部", creator("department-create"))
	positionID := createEmployeeAuxiliary(t, auxiliary, auxdomain.EntityPosition, "销售经理", creator("position-create"))

	v1, err := employees.Create(t.Context(), EmployeeCreateInput{
		Data: employeeDeclarationInput("张三", "110105199001010010", owner.ObjectID, true, categoryID, departmentID, positionID, "13800138000", "首版"),
	}, creator("employee-create"))
	if err != nil {
		t.Fatalf("create Employee V1: %v", err)
	}
	var domainErr *DomainError
	view, err := employees.Get(t.Context(), EmployeeGetInput{ObjectID: v1.ObjectID}, creator("employee-get-draft"))
	if err != nil {
		var detail *DomainError
		if errors.As(err, &detail) {
			t.Fatalf("get Employee draft: %v: %v", err, detail.Cause)
		}
		t.Fatalf("get Employee draft: %v", err)
	}
	if view.Data.LegalName != "张三" || view.Data.CurrentOperatingEntity.SourceObjectID != owner.ObjectID || view.Data.CurrentOperatingEntity.ApprovalEntryID != owner.Approval.ApprovalEntryID {
		t.Fatalf("Employee identity/current operating-entity snapshot = %+v", view)
	}
	if view.Data.EmployeeCategoryID != categoryID || view.Data.DepartmentID != departmentID || view.Data.PositionID != positionID {
		t.Fatalf("Employee AUX snapshots = %+v", view.Data)
	}

	if _, err = employees.Create(t.Context(), EmployeeCreateInput{Data: employeeDeclarationInput("同类标识冲突", "110105199001010010", owner.ObjectID, true, categoryID, departmentID, positionID, "13800138009", "冲突")}, creator("employee-identifier-conflict")); err == nil {
		t.Fatal("Employee accepted same-type legal identifier while first draft is open")
	} else if !errors.As(err, &domainErr) || domainErr.ErrorKey != "employee_legal_identifier_claimed" {
		t.Fatalf("Employee legal identifier conflict = %v", err)
	}
	assertEmployeeCurrentAbsent(t, business, v1.ObjectID)

	v1 = submitAndApproveEmployee(t, employees, v1, creator("employee-submit"), reviewer("employee-approve"))
	assertEmployeeCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "张三", "13800138000", true)

	v2, err := employees.Save(t.Context(), EmployeeSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Data: employeeDeclarationInput("张三", "110105199001010010", owner.ObjectID, false, categoryID, departmentID, positionID, "13900139000", "二版")}, creator("employee-save-v2"))
	if err != nil {
		t.Fatalf("save Employee V2: %v", err)
	}
	assertEmployeeCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "张三", "13800138000", true)
	v2 = submitAndApproveEmployee(t, employees, v2, creator("employee-submit-v2"), reviewer("employee-approve-v2"))
	assertEmployeeCurrent(t, business, v2.ObjectID, v2.Approval.ApprovalEntryID, "张三", "13900139000", false)

	documentID := insertEmployeeVoucherReference(t, pool, v2, creatorID)
	_, err = employees.Unapprove(t.Context(), EmployeeReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "精确引用应阻断"}, reviewer("employee-unapprove-blocked"))
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "bob_unapprove_blocked" {
		t.Fatalf("Employee exact-entry blocker = %v", err)
	}
	assertApprovalState(t, pool, v2.Approval.ApprovalEntryID, approval.StatusApproved, v2.Approval.Revision)
	deleteEmployeeVoucherReference(t, pool, documentID)

	if _, err = employees.Unapprove(t.Context(), EmployeeReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "回落首版"}, reviewer("employee-unapprove-v2")); err != nil {
		t.Fatalf("unapprove Employee V2: %v", err)
	}
	assertEmployeeCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "张三", "13800138000", true)
	history, err := employees.Versions(t.Context(), EmployeeHistoryInput{ObjectID: v1.ObjectID, Page: 1, PageSize: 20}, creator("employee-history"))
	if err != nil || history.Total != 2 || len(history.Items) != 2 || history.Items[0].Data.LegalName != "张三" || history.Items[1].Data.CurrentOperatingEntity.SourceObjectID != owner.ObjectID {
		t.Fatalf("Employee history = %+v, err=%v", history, err)
	}
}

func TestEmployeeQueryFiltersOperatingEntityWithDatabasePaginationIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
	employees := NewEmployeeService(pool, business, authorizer, bus)
	operating := NewOperatingEntityService(pool, business, authorizer, bus)

	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }
	ownerA, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "筛选主体 A"}}, creator("owner-a-create"))
	if err != nil {
		t.Fatalf("create owner A: %v", err)
	}
	ownerA = submitAndApproveOperatingEntity(t, operating, ownerA, creator("owner-a-submit"), reviewer("owner-a-approve"))
	ownerB, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "筛选主体 B"}}, creator("owner-b-create"))
	if err != nil {
		t.Fatalf("create owner B: %v", err)
	}
	ownerB = submitAndApproveOperatingEntity(t, operating, ownerB, creator("owner-b-submit"), reviewer("owner-b-approve"))
	for _, fixture := range []struct {
		name, identifier, operatingEntityID string
	}{
		{name: "筛选员工 A1", identifier: "110105199001010029", operatingEntityID: ownerA.ObjectID},
		{name: "筛选员工 A2", identifier: "110105199001010037", operatingEntityID: ownerA.ObjectID},
		{name: "筛选员工 B1", identifier: "110105199001010045", operatingEntityID: ownerB.ObjectID},
	} {
		if _, err = employees.Create(t.Context(), EmployeeCreateInput{Data: EmployeeInput{
			Kind: "PERSON", LegalName: fixture.name, LegalIdentifier: fixture.identifier,
			Enabled: true, CurrentOperatingEntityID: fixture.operatingEntityID,
		}}, creator("employee-create-"+fixture.identifier)); err != nil {
			t.Fatalf("create %s: %v", fixture.name, err)
		}
	}
	page, err := employees.Query(t.Context(), EmployeeQueryInput{
		Page: 1, PageSize: 1, Filters: EmployeeQueryFilters{OperatingEntityID: ownerA.ObjectID},
		Sort: []OperatingEntitySortItem{{Field: "name", Order: "asc"}},
	}, creator("employee-query-owner-a-page-1"))
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].CurrentOperatingEntity.SourceObjectID != ownerA.ObjectID || page.Items[0].DisplayName != "筛选员工 A1" {
		t.Fatalf("owner A page 1 = %+v, err=%v", page, err)
	}
	page, err = employees.Query(t.Context(), EmployeeQueryInput{
		Page: 2, PageSize: 1, Filters: EmployeeQueryFilters{OperatingEntityID: ownerA.ObjectID},
		Sort: []OperatingEntitySortItem{{Field: "name", Order: "asc"}},
	}, creator("employee-query-owner-a-page-2"))
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].CurrentOperatingEntity.SourceObjectID != ownerA.ObjectID || page.Items[0].DisplayName != "筛选员工 A2" {
		t.Fatalf("owner A page 2 = %+v, err=%v", page, err)
	}
}

func TestEmployeeDraftSavePreservesDisabledAuxiliarySnapshotIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
	employees := NewEmployeeService(pool, business, authorizer, bus)
	operating := NewOperatingEntityService(pool, business, authorizer, bus)

	creatorID := ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "员工快照所属主体"}}, creator("owner-create"))
	if err != nil {
		t.Fatalf("create operating entity: %v", err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("owner-submit"), dclActor(t, ulid.Make().String(), "owner-approve"))
	categoryID := createEmployeeAuxiliary(t, auxiliary, auxdomain.EntityEmployeeCategory, "正式员工", creator("category-create"))
	departmentID := createEmployeeAuxiliary(t, auxiliary, auxdomain.EntityDepartment, "销售部", creator("department-create"))
	departmentV2ID := createEmployeeAuxiliary(t, auxiliary, auxdomain.EntityDepartment, "销售二部", creator("department-v2-create"))
	positionID := createEmployeeAuxiliary(t, auxiliary, auxdomain.EntityPosition, "销售经理", creator("position-create"))
	draft, err := employees.Create(t.Context(), EmployeeCreateInput{
		Data: employeeDeclarationInput("李四", "110105199001010053", owner.ObjectID, true, categoryID, departmentID, positionID, "13800138001", "首版"),
	}, creator("employee-create"))
	if err != nil {
		t.Fatalf("create employee draft: %v", err)
	}
	original, err := employees.Get(t.Context(), EmployeeGetInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID}, creator("employee-get"))
	if err != nil {
		t.Fatalf("get employee draft: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `UPDATE aux_objects SET data='{"name":"正式员工 V2","description":"Employee snapshot test"}'::jsonb,enabled=false,revision=revision+1 WHERE id=$1 AND entity='employee-category'`, categoryID); err != nil {
		t.Fatalf("rename and disable unchanged employee category: %v", err)
	}
	saved, err := employees.Save(t.Context(), EmployeeSaveInput{
		ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision,
		Data: employeeDeclarationInput("李四", "110105199001010053", owner.ObjectID, true, categoryID, departmentV2ID, positionID, "13800138001", "仅修改备注"),
	}, creator("employee-save"))
	if err != nil {
		t.Fatalf("save employee draft with disabled AUX source: %v", err)
	}
	view, err := employees.Get(t.Context(), EmployeeGetInput{ObjectID: saved.ObjectID, ApprovalEntryID: saved.Approval.ApprovalEntryID}, creator("employee-get-saved"))
	if err != nil || view.Data.EmployeeCategoryID != categoryID || view.Data.EmployeeCategoryName != original.Data.EmployeeCategoryName || view.Data.DepartmentID != departmentV2ID || view.Data.DepartmentName != "销售二部" {
		t.Fatalf("employee draft snapshots = original=%+v saved=%+v err=%v", original.Data, view.Data, err)
	}
	if _, err = pool.Exec(t.Context(), `UPDATE aux_objects SET enabled=false,revision=revision+1 WHERE id=$1 AND entity='department'`, departmentID); err != nil {
		t.Fatalf("disable newly selected department: %v", err)
	}
	if _, err = employees.Save(t.Context(), EmployeeSaveInput{
		ObjectID: saved.ObjectID, ApprovalEntryID: saved.Approval.ApprovalEntryID, ApprovalRevision: saved.Approval.Revision,
		Data: employeeDeclarationInput("李四", "110105199001010053", owner.ObjectID, true, categoryID, departmentID, positionID, "13800138001", "拒绝停用新部门"),
	}, creator("employee-disabled-selection")); err == nil {
		t.Fatal("save accepted newly selected disabled department")
	}
}

func employeeDeclarationInput(name, identifier, operatingEntityID string, enabled bool, categoryID, departmentID, positionID, phone, remark string) EmployeeInput {
	return EmployeeInput{
		Kind:                     "PERSON",
		LegalName:                name,
		LegalIdentifier:          identifier,
		Enabled:                  enabled,
		CurrentOperatingEntityID: operatingEntityID,
		EmployeeCategoryID:       categoryID,
		DepartmentID:             departmentID,
		PositionID:               positionID,
		Phone:                    phone,
		Email:                    "employee@example.com",
		HireDate:                 "2026-08-01",
		Remark:                   remark,
	}
}

func assertDCLValidationFailure(t *testing.T, err error) {
	t.Helper()
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "validation_failed" {
		t.Fatalf("error = %v, want validation_failed", err)
	}
}

func assertDCLSubjectCount(t *testing.T, pool *pgxpool.Pool, entity string, want int) {
	t.Helper()
	var got int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM dcl_subjects WHERE entity=$1`, entity).Scan(&got); err != nil {
		t.Fatalf("count %s subjects: %v", entity, err)
	}
	if got != want {
		t.Fatalf("%s subject count = %d, want %d", entity, got, want)
	}
}

func createEmployeeAuxiliary(t *testing.T, service *auxdomain.Service, entity, name string, creator approval.Actor) string {
	t.Helper()
	created, err := service.Create(t.Context(), entity, auxdomain.CreateInput{Data: auxdomain.CreateData{Data: map[string]any{"name": name, "description": "Employee snapshot test"}}}, creator)
	if err != nil {
		t.Fatalf("create %s: %v", entity, err)
	}
	return created.ObjectID
}

func submitAndApproveEmployee(t *testing.T, service *EmployeeService, mutation EmployeeMutation, submitter, reviewer approval.Actor) EmployeeMutation {
	t.Helper()
	pending, err := service.Submit(t.Context(), EmployeeVersionInput{ObjectID: mutation.ObjectID, ApprovalEntryID: mutation.Approval.ApprovalEntryID, ApprovalRevision: mutation.Approval.Revision}, submitter)
	if err != nil {
		t.Fatalf("submit Employee: %v", err)
	}
	approved, err := service.Approve(t.Context(), EmployeeVersionInput{ObjectID: mutation.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer)
	if err != nil {
		t.Fatalf("approve Employee: %v", err)
	}
	return approved
}

func assertEmployeeCurrentAbsent(t *testing.T, business *bobdomain.Service, objectID string) {
	t.Helper()
	if _, err := business.Get(t.Context(), bobdomain.EntityEmployee, bobdomain.GetInput{ObjectID: objectID}); err == nil {
		t.Fatal("BOB exposed Employee candidate")
	}
}

func assertEmployeeCurrent(t *testing.T, business *bobdomain.Service, objectID, entryID, name, phone string, enabled bool) {
	t.Helper()
	view, err := business.Get(t.Context(), bobdomain.EntityEmployee, bobdomain.GetInput{ObjectID: objectID})
	if err != nil {
		t.Fatalf("get BOB Employee current: %v", err)
	}
	if view.SourceApprovalEntryID != entryID || view.Data.Name != name || view.Data.Phone != phone || view.Enabled != enabled {
		t.Fatalf("BOB Employee current = %+v", view)
	}
}

func insertEmployeeVoucherReference(t *testing.T, pool *pgxpool.Pool, employee EmployeeMutation, actorID string) string {
	t.Helper()
	documentID, entryID := ulid.Make().String(), ulid.Make().String()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	if _, err = tx.Exec(t.Context(), `INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at) VALUES($1,'vou','expense-reimbursement',$2,1,'DRAFT',1,$3,now(),$3,now())`, entryID, documentID, actorID); err == nil {
		_, err = tx.Exec(t.Context(), `INSERT INTO vou_documents(id,entity,document_no,approval_entry_id,business_date,currency,total_amount_cents) VALUES($1,'expense-reimbursement','VOU-20260828-0001',$2,'2026-08-28','CNY',100)`, documentID, entryID)
	}
	if err == nil {
		_, err = tx.Exec(t.Context(), `INSERT INTO vou_expense_reimbursement_details(document_id,employee_object_id,employee_approval_entry_id,employee_code,employee_name) SELECT $1::text,$2::text,$3::text,code,'张三' FROM dcl_subjects WHERE id=$2::text AND entity='employee'`, documentID, employee.ObjectID, employee.Approval.ApprovalEntryID)
	}
	if err == nil {
		err = tx.Commit(t.Context())
	}
	if err != nil {
		t.Fatalf("insert Employee VOU reference: %v", err)
	}
	return documentID
}

func deleteEmployeeVoucherReference(t *testing.T, pool *pgxpool.Pool, documentID string) {
	t.Helper()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	if _, err = tx.Exec(t.Context(), `DELETE FROM vou_expense_reimbursement_details WHERE document_id=$1`, documentID); err == nil {
		_, err = tx.Exec(t.Context(), `DELETE FROM vou_documents WHERE id=$1`, documentID)
	}
	if err == nil {
		_, err = tx.Exec(t.Context(), `DELETE FROM approval_entries WHERE domain='vou' AND subject_id=$1`, documentID)
	}
	if err == nil {
		err = tx.Commit(t.Context())
	}
	if err != nil {
		t.Fatalf("delete Employee VOU reference: %v", err)
	}
}
