//go:build integration

package dcl

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

// TestSupplierDraftRequiresExactPurchasingSnapshotsAtSubmitIntegration covers
// the public DCL seam: drafts may be incomplete, but a purchasing-effective
// Supplier cannot be submitted without the exact settlement and purchaser
// snapshots required by the domain rule.
func TestSupplierDraftRequiresExactPurchasingSnapshotsAtSubmitIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	parties := NewPartyService(pool, bobdomain.NewPartyCurrentWriter(pool), bobdomain.NewPartyCurrentReader(pool), bobdomain.NewPartyMergeEngine(pool), authorizer, bus)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary), authorizer, bus)
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	suppliers := NewSupplierService(pool, business, parties, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }
	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "供应商测试经营主体"}}, creator("owner-create"))
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("owner-submit"), reviewer("owner-approve"))
	draft, err := suppliers.Create(t.Context(), SupplierCreateInput{OperatingEntityID: owner.ObjectID, NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: "供应商草稿", StrongIdentifiers: []bobdomain.PartyIdentifierInput{{Type: bobdomain.PartyIdentifierUnifiedSocialCreditCode, Value: "91110108TESTSUP001"}}}}, creator("supplier-create"))
	if err != nil {
		t.Fatalf("create incomplete supplier draft: %v", err)
	}
	approveRelationshipParty(t, parties, draft.PartyID, creator("party-submit"), reviewer("party-approve"))
	if _, err = suppliers.Submit(t.Context(), SupplierVersionInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision}, creator("supplier-submit")); err == nil {
		t.Fatal("submitted supplier without settlement and default purchaser snapshots")
	}
	if _, err = business.Get(t.Context(), bobdomain.EntitySupplier, bobdomain.GetInput{ObjectID: draft.ObjectID}); err == nil {
		t.Fatal("BOB exposed unapproved supplier draft")
	}
}

func TestSupplierLifecycleCurrentProjectionAndPurchaseBlockerIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	parties := NewPartyService(pool, bobdomain.NewPartyCurrentWriter(pool), bobdomain.NewPartyCurrentReader(pool), bobdomain.NewPartyMergeEngine(pool), authorizer, bus)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary), authorizer, bus)
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	employees := NewEmployeeService(pool, business, parties, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)
	suppliers := NewSupplierService(pool, business, parties, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(id string) approval.Actor { return dclActor(t, creatorID, id) }
	reviewer := func(id string) approval.Actor { return dclActor(t, reviewerID, id) }
	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "供应商生命周期主体"}}, creator("owner-create"))
	if err != nil {
		t.Fatal(err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("owner-submit"), reviewer("owner-approve"))
	categoryID := insertApprovedSupplierAux(t, pool, auxdomain.EntityEmployeeCategory, "CAT-0001", map[string]any{"name": "采购员工"}, creatorID, reviewerID)
	departmentID := insertApprovedSupplierAux(t, pool, auxdomain.EntityDepartment, "DEP-0001", map[string]any{"name": "采购部"}, creatorID, reviewerID)
	positionID := insertApprovedSupplierAux(t, pool, auxdomain.EntityPosition, "POS-0001", map[string]any{"name": "采购员"}, creatorID, reviewerID)
	settlementID := insertApprovedSupplierAux(t, pool, auxdomain.EntitySettlementMethod, "SET-0001", map[string]any{"name": "月结30天", "termCode": "MONTHLY_30", "ruleType": "MONTH_END", "monthOffset": 1, "dayOfMonth": 0, "dayOffset": 0}, creatorID, reviewerID)
	purchaser, err := employees.Create(t.Context(), EmployeeCreateInput{NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindPerson, LegalName: "采购员甲", StrongIdentifiers: []bobdomain.PartyIdentifierInput{{Type: bobdomain.PartyIdentifierPersonID, Value: "110101199001010012"}}}, OperatingEntityID: owner.ObjectID, Data: EmployeeInput{EmployeeCategoryID: categoryID, DepartmentID: departmentID, PositionID: positionID, HireDate: "2026-08-01"}}, creator("purchaser-create"))
	if err != nil {
		t.Fatal(err)
	}
	purchaserDraft, err := employees.Get(t.Context(), EmployeeGetInput{ObjectID: purchaser.ObjectID}, creator("purchaser-get"))
	if err != nil {
		t.Fatal(err)
	}
	approveRelationshipParty(t, parties, purchaserDraft.PartyID, creator("purchaser-party-submit"), reviewer("purchaser-party-approve"))
	purchaser = submitAndApproveEmployee(t, employees, purchaser, creator("purchaser-submit"), reviewer("purchaser-approve"))
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	party, err := parties.CreateForRelationship(t.Context(), tx, bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: "复用供应商主体", StrongIdentifiers: []bobdomain.PartyIdentifierInput{{Type: bobdomain.PartyIdentifierUnifiedSocialCreditCode, Value: "91110108SUPLIFE001"}}}, creator("party-create"), true)
	if err == nil {
		err = tx.Commit(t.Context())
	}
	if err != nil {
		t.Fatalf("create reusable party: %v", err)
	}
	approveRelationshipParty(t, parties, party.ID, creator("party-submit"), reviewer("party-approve"))
	v1, err := suppliers.Create(t.Context(), SupplierCreateInput{PartyID: party.ID, OperatingEntityID: owner.ObjectID, Data: SupplierData{ShortName: "复用供应商", SettlementMethodID: settlementID, DefaultPurchaserEmployeeID: purchaser.ObjectID}}, creator("supplier-create"))
	if err != nil {
		t.Fatal(err)
	}
	v1 = submitAndApproveSupplier(t, suppliers, v1, creator("supplier-submit"), reviewer("supplier-approve"))
	assertSupplierCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID)
	insertSupplierPurchaseReference(t, pool, v1, creatorID, reviewerID, "VOU-20260828-0001")
	v2, err := suppliers.Save(t.Context(), SupplierSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Enabled: false, Data: SupplierData{ShortName: "候选二版", SettlementMethodID: settlementID, DefaultPurchaserEmployeeID: purchaser.ObjectID}}, creator("supplier-save"))
	if err != nil {
		t.Fatal(err)
	}
	assertSupplierCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID)
	if _, err = suppliers.Save(t.Context(), SupplierSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Enabled: false, Data: SupplierData{SettlementMethodID: settlementID, DefaultPurchaserEmployeeID: purchaser.ObjectID}}, creator("supplier-stale-save")); err == nil {
		t.Fatal("stale supplier save succeeded")
	}
	v2 = submitAndApproveSupplier(t, suppliers, v2, creator("supplier-submit-v2"), reviewer("supplier-approve-v2"))
	assertSupplierCurrent(t, business, v2.ObjectID, v2.Approval.ApprovalEntryID)
	validationTx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	_, err = business.ValidateApprovedSnapshotReference(t.Context(), validationTx, bobdomain.EntitySupplier, v1.ObjectID, v1.Approval.ApprovalEntryID)
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
	rollbackService := NewSupplierService(pool, failingSupplierCurrent{supplierCurrentWriter: business}, parties, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)
	rollback, err := rollbackService.Create(t.Context(), SupplierCreateInput{OperatingEntityID: owner.ObjectID, NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: "投影失败供应商", StrongIdentifiers: []bobdomain.PartyIdentifierInput{{Type: bobdomain.PartyIdentifierUnifiedSocialCreditCode, Value: "91110108SUPROLL001"}}}, Data: SupplierData{SettlementMethodID: settlementID, DefaultPurchaserEmployeeID: purchaser.ObjectID}}, creator("rollback-create"))
	if err != nil {
		t.Fatal(err)
	}
	approveRelationshipParty(t, parties, rollback.PartyID, creator("rollback-party-submit"), reviewer("rollback-party-approve"))
	pending, err := rollbackService.Submit(t.Context(), SupplierVersionInput{ObjectID: rollback.ObjectID, ApprovalEntryID: rollback.Approval.ApprovalEntryID, ApprovalRevision: rollback.Approval.Revision}, creator("rollback-submit"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = rollbackService.Approve(t.Context(), SupplierVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer("rollback-approve")); err == nil {
		t.Fatal("Supplier approve succeeded despite current projection failure")
	}
	var status string
	if err = pool.QueryRow(t.Context(), `SELECT status FROM approval_entries WHERE id=$1`, pending.Approval.ApprovalEntryID).Scan(&status); err != nil || status != string(approval.StatusPending) {
		t.Fatalf("rollback approval status=%s err=%v", status, err)
	}
	if _, err = business.Get(t.Context(), bobdomain.EntitySupplier, bobdomain.GetInput{ObjectID: rollback.ObjectID}); err == nil {
		t.Fatal("failed Supplier projection created BOB current")
	}
}

type failingSupplierCurrent struct{ supplierCurrentWriter }

func (f failingSupplierCurrent) ApplySupplierCurrent(context.Context, pgx.Tx, bobdomain.RelationshipIdentity, string, bool, string) (bobdomain.RelationshipIdentity, error) {
	return bobdomain.RelationshipIdentity{}, errors.New("forced supplier current failure")
}

func insertApprovedSupplierAux(t *testing.T, pool *pgxpool.Pool, entity, code string, data map[string]any, creatorID, reviewerID string) string {
	t.Helper()
	objectID, entryID := ulid.Make().String(), ulid.Make().String()
	raw, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	_, err = tx.Exec(t.Context(), `INSERT INTO aux_objects(id,entity,code,created_by,updated_by) VALUES($1,$2,$3,$4,$4)`, objectID, entity, code, creatorID)
	if err == nil {
		_, err = tx.Exec(t.Context(), `INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at) VALUES($1,'aux',$2,$3,1,'APPROVED',1,$4,now(),$4,now(),$4,now(),$5,now())`, entryID, entity, objectID, creatorID, reviewerID)
	}
	if err == nil {
		_, err = tx.Exec(t.Context(), `INSERT INTO aux_version_payloads(approval_entry_id,object_id,entity,data) VALUES($1,$2,$3,$4)`, entryID, objectID, entity, raw)
	}
	if err == nil {
		err = tx.Commit(t.Context())
	}
	if err != nil {
		t.Fatalf("insert approved %s: %v", entity, err)
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
	if view.Approval.ApprovalEntryID != entryID {
		t.Fatalf("current entry = %s want %s", view.Approval.ApprovalEntryID, entryID)
	}
	legacy, err := business.SupplierGet(t.Context(), bobdomain.GetInput{ObjectID: objectID})
	if err != nil || legacy.LatestApproved == nil || legacy.LatestApproved.Approval.ApprovalEntryID != entryID || legacy.OpenVersion != nil {
		t.Fatalf("BOB Supplier read leaked candidate: view=%+v err=%v", legacy, err)
	}
	if legacy.LatestApproved.Data.DefaultPurchaser == nil || legacy.LatestApproved.Data.DefaultPurchaser.SourceObjectID == "" || legacy.LatestApproved.Data.DefaultPurchaser.ApprovalEntryID == "" || legacy.LatestApproved.Data.DefaultPurchaser.Code == "" || legacy.LatestApproved.Data.DefaultPurchaser.Name == "" {
		t.Fatalf("BOB Supplier purchaser snapshot missing: %+v", legacy.LatestApproved.Data.DefaultPurchaser)
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
		_, err = tx.Exec(t.Context(), `INSERT INTO vou_purchase_inquiry_details(document_id,supplier_object_id,supplier_approval_entry_id,supplier_code,supplier_name) SELECT $1::text,$2::text,$3::text,code,'供应商' FROM bob_objects WHERE id=$2::text`, documentID, supplier.ObjectID, supplier.Approval.ApprovalEntryID)
	}
	if err == nil {
		err = tx.Commit(t.Context())
	}
	if err != nil {
		t.Fatal(err)
	}
}
