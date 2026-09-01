//go:build integration

package dcl

import (
	"encoding/json"
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

// TestSupplierMayApproveWithoutSettlementOrPurchaserIntegration covers the
// public DCL seam: both optional snapshots may remain absent through approval.
func TestSupplierMayApproveWithoutSettlementOrPurchaserIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	auxiliary := auxdomain.NewService(pool)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	suppliers := NewSupplierService(pool, business, authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }
	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "供应商测试经营主体"}}, creator("owner-create"))
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("owner-submit"), reviewer("owner-approve"))
	if _, err = suppliers.Create(t.Context(), SupplierCreateInput{Data: SupplierInput{
		Kind: "ORGANIZATION", LegalName: "非法供应商标识", StrongIdentifiers: []BusinessIdentifierInput{{Type: "BANK_ACCOUNT", Value: "supplier-invalid"}},
		Enabled: true, OperatingEntityIDs: []string{owner.ObjectID}, DefaultOperatingEntityID: owner.ObjectID,
	}}, creator("supplier-invalid-identifier")); err == nil {
		t.Fatal("Supplier accepted an unsupported business identifier type")
	} else {
		assertDCLValidationFailure(t, err)
	}
	assertDCLSubjectCount(t, pool, EntitySupplier, 0)
	draft, err := suppliers.Create(t.Context(), SupplierCreateInput{Data: SupplierInput{Kind: "ORGANIZATION", LegalName: "供应商草稿", StrongIdentifiers: []BusinessIdentifierInput{{Type: "UNIFIED_SOCIAL_CREDIT_CODE", Value: "91110108TESTSUP001"}}, Enabled: true, OperatingEntityIDs: []string{owner.ObjectID}, DefaultOperatingEntityID: owner.ObjectID}}, creator("supplier-create"))
	if err != nil {
		t.Fatalf("create incomplete supplier draft: %v", err)
	}
	approved := submitAndApproveSupplier(t, suppliers, draft, creator("supplier-submit-without-optional-snapshots"), reviewer("supplier-approve-without-optional-snapshots"))
	view, err := business.Get(t.Context(), bobdomain.EntitySupplier, bobdomain.GetInput{ObjectID: approved.ObjectID})
	if err != nil {
		t.Fatal(err)
	}
	if view.Data.SettlementMethodID != "" || view.Data.DefaultPurchaserEmployeeID != "" || view.Data.SettlementMethod != nil || view.Data.DefaultPurchaser != nil {
		t.Fatalf("absent Supplier optional snapshots = %+v", view.Data)
	}
}

func TestSupplierLifecycleLatestApprovedReadAndPurchaseBlockerIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	auxiliary := auxdomain.NewService(pool)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	employees := NewEmployeeService(pool, business, authorizer, bus)
	suppliers := NewSupplierService(pool, business, authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(id string) approval.Actor { return dclActor(t, creatorID, id) }
	reviewer := func(id string) approval.Actor { return dclActor(t, reviewerID, id) }
	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "供应商生命周期主体"}}, creator("owner-create"))
	if err != nil {
		t.Fatal(err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("owner-submit"), reviewer("owner-approve"))
	categoryID := insertSupplierAux(t, pool, auxdomain.EntityEmployeeCategory, "CAT-0001", map[string]any{"name": "采购员工"}, creatorID)
	departmentID := insertSupplierAux(t, pool, auxdomain.EntityDepartment, "DEP-0001", map[string]any{"name": "采购部"}, creatorID)
	positionID := insertSupplierAux(t, pool, auxdomain.EntityPosition, "POS-0001", map[string]any{"name": "采购员"}, creatorID)
	settlementID := insertSupplierAux(t, pool, auxdomain.EntitySettlementMethod, "SET-0001", map[string]any{"name": "月结30天", "termCode": "MONTHLY_30", "ruleType": "MONTH_END", "monthOffset": 1, "dayOfMonth": 0, "dayOffset": 0}, creatorID)
	purchaser, err := employees.Create(t.Context(), EmployeeCreateInput{Data: employeeDeclarationInput("采购员甲", "110101199001010012", owner.ObjectID, true, categoryID, departmentID, positionID, "", "")}, creator("purchaser-create"))
	if err != nil {
		t.Fatal(err)
	}
	purchaser = submitAndApproveEmployee(t, employees, purchaser, creator("purchaser-submit"), reviewer("purchaser-approve"))
	v1, err := suppliers.Create(t.Context(), SupplierCreateInput{Data: SupplierInput{Kind: "ORGANIZATION", LegalName: "复用供应商主体", DisplayName: "复用供应商", StrongIdentifiers: []BusinessIdentifierInput{{Type: "UNIFIED_SOCIAL_CREDIT_CODE", Value: "91110108SUPLIFE001"}}, Enabled: true, OperatingEntityIDs: []string{owner.ObjectID}, DefaultOperatingEntityID: owner.ObjectID, ShortName: "复用供应商", SettlementMethodID: settlementID, DefaultPurchaserEmployeeID: purchaser.ObjectID}}, creator("supplier-create"))
	if err != nil {
		t.Fatal(err)
	}
	v1 = submitAndApproveSupplier(t, suppliers, v1, creator("supplier-submit"), reviewer("supplier-approve"))
	assertSupplierCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID)
	insertSupplierPurchaseReference(t, pool, v1, creatorID, reviewerID, "VOU-20260828-0001")
	v2, err := suppliers.Save(t.Context(), SupplierSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Data: SupplierInput{Kind: "ORGANIZATION", LegalName: "复用供应商主体", DisplayName: "候选二版", StrongIdentifiers: []BusinessIdentifierInput{{Type: "UNIFIED_SOCIAL_CREDIT_CODE", Value: "91110108SUPLIFE001"}}, Enabled: false, OperatingEntityIDs: []string{owner.ObjectID}, DefaultOperatingEntityID: owner.ObjectID, ShortName: "候选二版", SettlementMethodID: settlementID, DefaultPurchaserEmployeeID: purchaser.ObjectID}}, creator("supplier-save"))
	if err != nil {
		t.Fatal(err)
	}
	assertSupplierCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID)
	if _, err = suppliers.Save(t.Context(), SupplierSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Data: SupplierInput{Kind: "ORGANIZATION", LegalName: "复用供应商主体", StrongIdentifiers: []BusinessIdentifierInput{{Type: "UNIFIED_SOCIAL_CREDIT_CODE", Value: "91110108SUPLIFE001"}}, Enabled: false, OperatingEntityIDs: []string{owner.ObjectID}, DefaultOperatingEntityID: owner.ObjectID, SettlementMethodID: settlementID, DefaultPurchaserEmployeeID: purchaser.ObjectID}}, creator("supplier-stale-save")); err == nil {
		t.Fatal("stale supplier save succeeded")
	}
	v2 = submitAndApproveSupplier(t, suppliers, v2, creator("supplier-submit-v2"), reviewer("supplier-approve-v2"))
	assertSupplierCurrent(t, business, v2.ObjectID, v2.Approval.ApprovalEntryID)
	validationTx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	_, err = business.ValidateHistoricalReference(t.Context(), validationTx, bobdomain.EntitySupplier, v1.ObjectID, v1.Approval.ApprovalEntryID)
	_ = validationTx.Rollback(t.Context())
	if err != nil {
		t.Fatalf("resolve historical v1 supplier snapshot: %v", err)
	}
	var v1Reference string
	if err = pool.QueryRow(t.Context(), `SELECT supplier_approval_entry_id FROM vou_purchase_inquiry_details WHERE document_id=(SELECT id FROM vou_documents WHERE document_no='VOU-20260828-0001')`).Scan(&v1Reference); err != nil || v1Reference != v1.Approval.ApprovalEntryID {
		t.Fatalf("historical purchase supplier snapshot=%s err=%v", v1Reference, err)
	}
	insertSupplierPurchaseReference(t, pool, v2, creatorID, reviewerID, "VOU-20260828-0002")
	_, err = suppliers.Unapprove(t.Context(), SupplierReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "采购事实阻断"}, reviewer("supplier-unapprove"))
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "bob_unapprove_blocked" {
		t.Fatalf("Supplier exact purchase blocker = %v", err)
	}
}

func insertSupplierAux(t *testing.T, pool *pgxpool.Pool, entity, code string, data map[string]any, creatorID string) string {
	t.Helper()
	objectID := ulid.Make().String()
	raw, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	_, err = tx.Exec(t.Context(), `INSERT INTO aux_objects(id,entity,code,data,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5)`, objectID, entity, code, raw, creatorID)
	if err == nil {
		err = tx.Commit(t.Context())
	}
	if err != nil {
		t.Fatalf("insert %s AUX fixture: %v", entity, err)
	}
	return objectID
}
func submitAndApproveSupplier(t *testing.T, service *SupplierService, m SupplierMutation, submitter, reviewer approval.Actor) SupplierMutation {
	t.Helper()
	pending, err := service.Submit(t.Context(), SupplierVersionInput{ObjectID: m.ObjectID, ApprovalEntryID: m.Approval.ApprovalEntryID, ApprovalRevision: m.Approval.Revision}, submitter)
	if err != nil {
		t.Fatal(err)
	}
	approved, err := service.Approve(t.Context(), SupplierVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer)
	if err != nil {
		t.Fatal(err)
	}
	return approved
}
func assertSupplierCurrent(t *testing.T, business *bobdomain.Service, objectID, entryID string) {
	t.Helper()
	view, err := business.Get(t.Context(), bobdomain.EntitySupplier, bobdomain.GetInput{ObjectID: objectID})
	if err != nil {
		t.Fatal(err)
	}
	if view.SourceApprovalEntryID != entryID {
		t.Fatalf("current entry = %s want %s", view.SourceApprovalEntryID, entryID)
	}
	if view.Data.DefaultPurchaserEmployeeID == "" || view.Data.DefaultPurchaserApprovalEntryID == "" || view.Data.DefaultPurchaserCode == "" || view.Data.DefaultPurchaserName == "" {
		t.Fatalf("BOB Supplier purchaser snapshot missing: %+v", view.Data)
	}
}
func insertSupplierPurchaseReference(t *testing.T, pool *pgxpool.Pool, supplier SupplierMutation, actorID, reviewerID, documentNo string) {
	t.Helper()
	documentID, entryID := ulid.Make().String(), ulid.Make().String()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	_, err = tx.Exec(t.Context(), `INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at) VALUES($1::text,'vou','purchase-inquiry',$2::text,1,'APPROVED',1,$3::text,now(),$3::text,now(),$3::text,now(),$4::text,now())`, entryID, documentID, actorID, reviewerID)
	if err == nil {
		_, err = tx.Exec(t.Context(), `INSERT INTO vou_documents(id,entity,document_no,approval_entry_id,business_date,currency,total_amount_cents) VALUES($1::text,'purchase-inquiry',$2::text,$3::text,'2026-08-28','CNY',0)`, documentID, documentNo, entryID)
	}
	if err == nil {
		_, err = tx.Exec(t.Context(), `INSERT INTO vou_purchase_inquiry_details(document_id,supplier_object_id,supplier_approval_entry_id,supplier_code,supplier_name) SELECT $1::text,$2::text,$3::text,code,'供应商' FROM dcl_subjects WHERE id=$2::text AND entity='supplier'`, documentID, supplier.ObjectID, supplier.Approval.ApprovalEntryID)
	}
	if err == nil {
		err = tx.Commit(t.Context())
	}
	if err != nil {
		t.Fatal(err)
	}
}
