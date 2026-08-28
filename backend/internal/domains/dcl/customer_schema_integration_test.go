//go:build integration

package dcl

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/oklog/ulid/v2"
)

// TestCustomerDeclarationsUseDclPayloadAndCurrentTablesIntegration is the
// schema-level first assertion for #287. Customer relationship and account are
// independent DCL approval subjects; neither can continue to use the legacy
// BOB-owned version payload tables.
func TestCustomerDeclarationsUseDclPayloadAndCurrentTablesIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	for _, table := range []string{
		"dcl_customer_versions",
		"dcl_customer_account_versions",
		"bob_customers",
		"bob_customer_account_currents",
	} {
		var exists bool
		if err := pool.QueryRow(t.Context(), `SELECT to_regclass($1) IS NOT NULL`, "public."+table).Scan(&exists); err != nil {
			t.Fatalf("check %s: %v", table, err)
		}
		if !exists {
			t.Fatalf("missing #287 declaration table %s", table)
		}
	}
}

func TestCustomerLifecycleWritesOnlyDclVersionAndBobCurrentIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	parties := NewPartyService(pool, bobdomain.NewPartyCurrentWriter(pool), bobdomain.NewPartyCurrentReader(pool), bobdomain.NewPartyMergeEngine(pool), authorizer, bus)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	accounts := NewCustomerAccountService(pool, business, authorizer, bus)
	customers := NewCustomerService(pool, business, parties, bobdomain.NewPartyCurrentReader(pool), accounts, authorizer, bus)
	employees := NewEmployeeService(pool, business, parties, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }
	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "客户关系主体"}}, creator("owner-create"))
	if err != nil {
		t.Fatal(err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("owner-submit"), reviewer("owner-approve"))
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	party, err := parties.CreateForRelationship(t.Context(), tx, bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: "复用客户主体", StrongIdentifiers: []bobdomain.PartyIdentifierInput{{Type: bobdomain.PartyIdentifierUnifiedSocialCreditCode, Value: "91110108CUSTDCL001"}}}, creator("party-create"), true)
	if err == nil {
		err = tx.Commit(t.Context())
	}
	if err != nil {
		t.Fatalf("create reusable customer party: %v", err)
	}
	approveRelationshipParty(t, parties, party.ID, creator("party-submit"), reviewer("party-approve"))
	salesperson, err := employees.Create(t.Context(), EmployeeCreateInput{PartyID: party.ID, OperatingEntityID: owner.ObjectID, Data: EmployeeInput{}}, creator("salesperson-create"))
	if err != nil {
		t.Fatalf("create default account salesperson: %v", err)
	}
	salesperson = submitAndApproveEmployee(t, employees, salesperson, creator("salesperson-submit"), reviewer("salesperson-approve"))
	defaultAccount := CustomerAccountDataInput{
		Name: "复用客户账户", CustomerTypeCode: bobdomain.CustomerTypeEndUser,
		PricingPolicy:           CustomerPricingPolicy{DefaultPremiumUnitPrice: "0", DefaultDiscountUnitPrice: "0", ThirdPartyIntermediaryFixedUnitCost: "0", ThirdPartyIntermediaryVariableUnitCost: "0", CostItems: []CustomerPricingCostItem{}},
		CreditLimits:            []CustomerCreditLimit{},
		PrimarySalesAttribution: CustomerSalesAttributionInput{Type: CustomerSalesAttributionInternalEmployee, SubjectObjectID: salesperson.ObjectID},
	}
	v1, err := customers.Create(t.Context(), CustomerCreateInput{PartyID: party.ID, OperatingEntityID: owner.ObjectID, DefaultAccount: defaultAccount}, creator("customer-create"))
	if err != nil {
		var domainErr *DomainError
		if errors.As(err, &domainErr) && domainErr.Cause != nil {
			t.Fatalf("create customer: %v", domainErr.Cause)
		}
		t.Fatal(err)
	}
	var defaultAccountCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM dcl_customer_account_versions version JOIN approval_entries entry ON entry.id=version.approval_entry_id WHERE entry.domain='dcl' AND entry.entity='customer-account' AND entry.status='DRAFT'`).Scan(&defaultAccountCount); err != nil || defaultAccountCount != 1 {
		t.Fatalf("Customer create must atomically create default Account V1 DRAFT: count=%d err=%v", defaultAccountCount, err)
	}
	v1 = submitAndApproveCustomer(t, customers, v1, creator("customer-submit"), reviewer("customer-approve"))
	var current string
	if err = pool.QueryRow(t.Context(), `SELECT source_approval_entry_id FROM bob_customers WHERE object_id=$1`, v1.ObjectID).Scan(&current); err != nil || current != v1.Approval.ApprovalEntryID {
		t.Fatalf("current source=%s err=%v", current, err)
	}
	v2, err := customers.Save(t.Context(), CustomerSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Enabled: false}, creator("customer-save"))
	if err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT source_approval_entry_id FROM bob_customers WHERE object_id=$1`, v1.ObjectID).Scan(&current); err != nil || current != v1.Approval.ApprovalEntryID {
		t.Fatalf("draft changed BOB current source=%s err=%v", current, err)
	}
	currentView, err := business.CustomerCurrentGet(t.Context(), v1.ObjectID)
	if err != nil || currentView.SourceApprovalEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("BOB current get leaked DCL candidate: view=%+v err=%v", currentView, err)
	}
	// Relationship attachment snapshots copy the same physical file into the
	// candidate owner entry; the DCL relation table must not globally unique
	// file_id across versions.
	fileID := ulid.Make().String()
	tokenHash := sha256.Sum256([]byte(fileID))
	if _, err = pool.Exec(t.Context(), `INSERT INTO dcl_customer_files(id,storage_key,original_name,content_type,declared_size,sha256_hex,status,upload_token_hash,upload_expires_at,created_by) VALUES($1,$2,'customer.pdf','application/pdf',1,$3,'PENDING',$4,$5,$6)`, fileID, "customer/"+fileID, strings.Repeat("a", 64), hex.EncodeToString(tokenHash[:]), time.Now().Add(time.Hour), creatorID); err != nil {
		t.Fatalf("insert attachment file: %v", err)
	}
	for _, entryID := range []string{v1.Approval.ApprovalEntryID, v2.Approval.ApprovalEntryID} {
		if _, err = pool.Exec(t.Context(), `INSERT INTO dcl_customer_attachments(approval_entry_id,file_id,category_object_id,category_approval_entry_id,category_code,category_name,created_by) VALUES($1,$2,$3,$4,'CONTRACT','合同',$5)`, entryID, fileID, ulid.Make().String(), ulid.Make().String(), creatorID); err != nil {
			t.Fatalf("copy attachment into %s: %v", entryID, err)
		}
	}
	var attachmentCopies int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM dcl_customer_attachments WHERE file_id=$1`, fileID).Scan(&attachmentCopies); err != nil || attachmentCopies != 2 {
		t.Fatalf("candidate attachment copies=%d err=%v", attachmentCopies, err)
	}
	v2 = submitAndApproveCustomer(t, customers, v2, creator("customer-submit-v2"), reviewer("customer-approve-v2"))
	if err = pool.QueryRow(t.Context(), `SELECT source_approval_entry_id FROM bob_customers WHERE object_id=$1`, v1.ObjectID).Scan(&current); err != nil || current != v2.Approval.ApprovalEntryID {
		t.Fatalf("approved V2 source=%s err=%v", current, err)
	}
	currentView, err = business.CustomerCurrentGet(t.Context(), v1.ObjectID)
	if err != nil || currentView.SourceApprovalEntryID != v2.Approval.ApprovalEntryID {
		t.Fatalf("BOB current get did not switch to V2: view=%+v err=%v", currentView, err)
	}
	// DCL reads hydrate the declaration's chosen candidate/current snapshot;
	// no BOB payload or open account candidate is part of this relationship API.
	view, err := customers.Get(t.Context(), CustomerGetInput{ObjectID: v1.ObjectID}, creator("customer-get"))
	if err != nil {
		t.Fatalf("get current customer declaration: %v", err)
	}
	if view.ObjectID != v1.ObjectID || view.Approval.ApprovalEntryID != v2.Approval.ApprovalEntryID || len(view.Attachments) != 1 {
		t.Fatalf("unexpected customer view: %#v", view)
	}
	page, err := customers.Query(t.Context(), CustomerQueryInput{Page: 1, PageSize: 20, Sort: []OperatingEntitySortItem{{Field: "code", Order: "asc"}}}, creator("customer-query"))
	if err != nil {
		t.Fatalf("query customer declarations: %v", err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].LatestApproved == nil || page.Items[0].LatestApproved.Approval.ApprovalEntryID != v2.Approval.ApprovalEntryID {
		t.Fatalf("unexpected customer query page: %#v", page)
	}
	versions, err := customers.Versions(t.Context(), CustomerHistoryInput{ObjectID: v1.ObjectID, Page: 1, PageSize: 20}, creator("customer-versions"))
	if err != nil {
		t.Fatalf("list customer versions: %v", err)
	}
	if versions.Total != 2 || len(versions.Items) != 2 {
		t.Fatalf("unexpected customer version page: %#v", versions)
	}
	audit, err := customers.AuditHistory(t.Context(), CustomerHistoryInput{ObjectID: v1.ObjectID, Page: 1, PageSize: 20}, creator("customer-audit"))
	if err != nil || audit.Total < 5 {
		t.Fatalf("unexpected customer audit page: total=%d err=%v", audit.Total, err)
	}
}

func submitAndApproveCustomer(t *testing.T, service *CustomerService, mutation CustomerMutation, submitter, reviewer approval.Actor) CustomerMutation {
	t.Helper()
	pending, err := service.Submit(t.Context(), CustomerVersionInput{ObjectID: mutation.ObjectID, ApprovalEntryID: mutation.Approval.ApprovalEntryID, ApprovalRevision: mutation.Approval.Revision}, submitter)
	if err != nil {
		t.Fatal(err)
	}
	approved, err := service.Approve(t.Context(), CustomerVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer)
	if err != nil {
		t.Fatal(err)
	}
	return approved
}
