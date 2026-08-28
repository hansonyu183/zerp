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
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	partyReader := bobdomain.NewPartyCurrentReader(pool)
	parties := NewPartyService(pool, bobdomain.NewPartyCurrentWriter(pool), partyReader, bobdomain.NewPartyMergeEngine(pool), authorizer, bus)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
	employees := NewEmployeeService(pool, business, parties, partyReader, authorizer, bus)
	operating := NewOperatingEntityService(pool, business, authorizer, bus)

	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }

	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "员工所属主体"}}, creator("owner-create"))
	if err != nil {
		t.Fatalf("create operating entity: %v", err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("owner-submit"), reviewer("owner-approve"))
	categoryID, categoryEntryID := approveEmployeeAuxiliary(t, auxiliary, auxdomain.EntityEmployeeCategory, "正式员工", creator("category-create"), reviewer("category-approve"))
	departmentID, departmentEntryID := approveEmployeeAuxiliary(t, auxiliary, auxdomain.EntityDepartment, "销售部", creator("department-create"), reviewer("department-approve"))
	positionID, positionEntryID := approveEmployeeAuxiliary(t, auxiliary, auxdomain.EntityPosition, "销售经理", creator("position-create"), reviewer("position-approve"))

	v1, err := employees.Create(t.Context(), EmployeeCreateInput{
		NewParty:          &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindPerson, LegalName: "张三", StrongIdentifiers: []bobdomain.PartyIdentifierInput{{Type: bobdomain.PartyIdentifierPersonID, Value: "110101199001010011"}}},
		OperatingEntityID: owner.ObjectID,
		Data:              EmployeeInput{EmployeeCategoryID: categoryID, DepartmentID: departmentID, PositionID: positionID, Phone: "13800138000", Email: "zhangsan@example.com", HireDate: "2026-08-01", Remark: "首版"},
	}, creator("employee-create"))
	if err != nil {
		t.Fatalf("create Employee V1: %v", err)
	}
	view, err := employees.Get(t.Context(), EmployeeGetInput{ObjectID: v1.ObjectID}, creator("employee-get-draft"))
	if err != nil {
		var detail *DomainError
		if errors.As(err, &detail) {
			t.Fatalf("get Employee draft with Party draft: %v: %v", err, detail.Cause)
		}
		t.Fatalf("get Employee draft with Party draft: %v", err)
	}
	if view.PartyDisplayName != "张三" || view.OperatingEntityID != owner.ObjectID {
		t.Fatalf("Employee identity view = %+v", view)
	}
	if view.Data.EmployeeCategoryApprovalEntryID != categoryEntryID || view.Data.DepartmentApprovalEntryID != departmentEntryID || view.Data.PositionApprovalEntryID != positionEntryID {
		t.Fatalf("Employee AUX snapshots = %+v", view.Data)
	}

	if _, err = employees.Submit(t.Context(), EmployeeVersionInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision}, creator("employee-submit-before-party")); err == nil {
		t.Fatal("Employee submitted before Party approval")
	}
	assertApprovalState(t, pool, v1.Approval.ApprovalEntryID, approval.StatusDraft, v1.Approval.Revision)
	assertEmployeeCurrentAbsent(t, business, v1.ObjectID)

	partyView, err := parties.Get(t.Context(), PartyGetInput{PartyID: view.PartyID}, bobdomain.PartyRelationshipVisibility{}, creator("party-get"))
	if err != nil {
		t.Fatalf("get Party draft: %v", err)
	}
	partyPending, err := parties.Submit(t.Context(), PartyVersionInput{PartyID: view.PartyID, ApprovalEntryID: partyView.Approval.ApprovalEntryID, ApprovalRevision: partyView.Approval.Revision}, creator("party-submit"))
	if err != nil {
		t.Fatalf("submit Party: %v", err)
	}
	if _, err = parties.Approve(t.Context(), PartyVersionInput{PartyID: view.PartyID, ApprovalEntryID: partyPending.Approval.ApprovalEntryID, ApprovalRevision: partyPending.Approval.Revision}, reviewer("party-approve")); err != nil {
		t.Fatalf("approve Party: %v", err)
	}

	v1 = submitAndApproveEmployee(t, employees, v1, creator("employee-submit"), reviewer("employee-approve"))
	assertEmployeeCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "张三", "13800138000", true)

	v2, err := employees.Save(t.Context(), EmployeeSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Enabled: false, Data: EmployeeInput{EmployeeCategoryID: categoryID, DepartmentID: departmentID, PositionID: positionID, Phone: "13900139000", Email: "zhangsan@example.com", HireDate: "2026-08-01", Remark: "二版"}}, creator("employee-save-v2"))
	if err != nil {
		t.Fatalf("save Employee V2: %v", err)
	}
	v2 = submitAndApproveEmployee(t, employees, v2, creator("employee-submit-v2"), reviewer("employee-approve-v2"))
	assertEmployeeCurrent(t, business, v2.ObjectID, v2.Approval.ApprovalEntryID, "张三", "13900139000", false)

	documentID := insertEmployeeVoucherReference(t, pool, v2, creatorID)
	_, err = employees.Unapprove(t.Context(), EmployeeReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "精确引用应阻断"}, reviewer("employee-unapprove-blocked"))
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "bob_unapprove_blocked" {
		t.Fatalf("Employee exact-entry blocker = %v", err)
	}
	assertApprovalState(t, pool, v2.Approval.ApprovalEntryID, approval.StatusApproved, v2.Approval.Revision)
	deleteEmployeeVoucherReference(t, pool, documentID)

	if _, err = employees.Unapprove(t.Context(), EmployeeReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "回落首版"}, reviewer("employee-unapprove-v2")); err != nil {
		t.Fatalf("unapprove Employee V2: %v", err)
	}
	assertEmployeeCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "张三", "13800138000", true)
}

func approveEmployeeAuxiliary(t *testing.T, service *auxdomain.Service, entity, name string, creator, reviewer approval.Actor) (string, string) {
	t.Helper()
	created, err := service.Create(t.Context(), entity, auxdomain.CreateInput{Data: auxdomain.CreateData{Data: map[string]any{"name": name, "description": "Employee snapshot test"}}}, creator)
	if err != nil {
		t.Fatalf("create %s: %v", entity, err)
	}
	pending, err := service.Submit(t.Context(), entity, auxdomain.ApprovalRevisionInput{ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: created.Approval.Revision}, creator)
	if err != nil {
		t.Fatalf("submit %s: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, auxdomain.ApprovalRevisionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer)
	if err != nil {
		t.Fatalf("approve %s: %v", entity, err)
	}
	return approved.ObjectID, approved.Approval.ApprovalEntryID
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
	if view.Approval.ApprovalEntryID != entryID || view.Data.Name != name || view.Data.Phone != phone || view.Enabled != enabled {
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
		_, err = tx.Exec(t.Context(), `INSERT INTO vou_expense_reimbursement_details(document_id,employee_object_id,employee_approval_entry_id,employee_code,employee_name) SELECT $1::text,$2::text,$3::text,code,'张三' FROM bob_objects WHERE id=$2::text`, documentID, employee.ObjectID, employee.Approval.ApprovalEntryID)
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
