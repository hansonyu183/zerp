//go:build integration

package dcl

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"
)

func TestCustomerAccountLifecycleCopiesCandidateAttachmentsAndFallsBackIntegration(t *testing.T) {
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
	relationships := NewRelationshipService(pool, business, parties, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(request string) approval.Actor { return dclActor(t, creatorID, request) }
	reviewer := func(request string) approval.Actor { return dclActor(t, reviewerID, request) }
	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "账户生命周期主体"}}, creator("owner-create"))
	if err != nil {
		t.Fatal(err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("owner-submit"), reviewer("owner-approve"))
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	party, err := parties.CreateForRelationship(t.Context(), tx, bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: "账户客户", StrongIdentifiers: []bobdomain.PartyIdentifierInput{{Type: bobdomain.PartyIdentifierUnifiedSocialCreditCode, Value: "91110108CACDCL001"}}}, creator("party-create"), true)
	if err == nil {
		err = tx.Commit(t.Context())
	}
	if err != nil {
		t.Fatal(err)
	}
	approveRelationshipParty(t, parties, party.ID, creator("party-submit"), reviewer("party-approve"))
	employee, err := employees.Create(t.Context(), EmployeeCreateInput{PartyID: party.ID, OperatingEntityID: owner.ObjectID, Data: EmployeeInput{}}, creator("employee-create"))
	if err != nil {
		t.Fatal(err)
	}
	employee = submitAndApproveEmployee(t, employees, employee, creator("employee-submit"), reviewer("employee-approve"))
	input := CustomerAccountDataInput{Name: "账户 V1", CustomerTypeCode: bobdomain.CustomerTypeEndUser, PricingPolicy: CustomerPricingPolicy{DefaultPremiumUnitPrice: "0", DefaultDiscountUnitPrice: "0", ThirdPartyIntermediaryFixedUnitCost: "0", ThirdPartyIntermediaryVariableUnitCost: "0", CostItems: []CustomerPricingCostItem{}}, CreditLimits: []CustomerCreditLimit{{Currency: "CNY", Amount: "100"}}, PrimarySalesAttribution: CustomerSalesAttributionInput{Type: CustomerSalesAttributionInternalEmployee, SubjectObjectID: employee.ObjectID}}
	customer, err := customers.Create(t.Context(), CustomerCreateInput{PartyID: party.ID, OperatingEntityID: owner.ObjectID, DefaultAccount: input}, creator("customer-create"))
	if err != nil {
		t.Fatal(err)
	}
	var accountID, accountEntry string
	if err = pool.QueryRow(t.Context(), `SELECT id,subject_id FROM approval_entries WHERE domain='dcl' AND entity='customer-account' AND status='DRAFT'`).Scan(&accountEntry, &accountID); err != nil {
		t.Fatalf("default account: %v", err)
	}
	account := CustomerAccountMutation{ObjectID: accountID, Approval: approval.VersionMeta{ApprovalEntryID: accountEntry, Revision: 1}}
	account = submitAndApproveCustomerAccount(t, accounts, account, creator("account-submit-v1"), reviewer("account-approve-v1"))
	employeeView, err := accounts.Get(t.Context(), CustomerAccountGetInput{ObjectID: accountID}, creator("account-get-v1"))
	if err != nil || employeeView.Data.PrimarySalesAttribution.SubjectApprovalEntryID != employee.Approval.ApprovalEntryID {
		t.Fatalf("employee attribution snapshot=%+v err=%v", employeeView.Data.PrimarySalesAttribution, err)
	}
	var current string
	if err = pool.QueryRow(t.Context(), `SELECT source_approval_entry_id FROM bob_customer_account_currents WHERE object_id=$1`, accountID).Scan(&current); err != nil || current != account.Approval.ApprovalEntryID {
		t.Fatalf("V1 current=%s err=%v", current, err)
	}
	if err = accounts.Delete(t.Context(), CustomerAccountDeleteInput{ObjectID: accountID, ApprovalEntryID: account.Approval.ApprovalEntryID, ApprovalRevision: account.Approval.Revision}, creator("account-delete-approved")); err == nil {
		t.Fatal("approved customer account delete was accepted")
	}
	partner, err := relationships.CreateSalesPartner(t.Context(), SalesPartnerCreateInput{NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: "账户渠道合作方", StrongIdentifiers: []bobdomain.PartyIdentifierInput{{Type: bobdomain.PartyIdentifierUnifiedSocialCreditCode, Value: "91110108CACDCL002"}}}, OperatingEntityID: owner.ObjectID, Data: SalesPartnerData{Capabilities: []string{"CHANNEL_PARTNER"}, ContactName: "账户渠道"}}, creator("partner-create"))
	if err != nil {
		t.Fatal(err)
	}
	approveRelationshipParty(t, parties, partner.PartyID, creator("partner-party-submit"), reviewer("partner-party-approve"))
	pendingPartner, err := relationships.SubmitSalesPartner(t.Context(), RelationshipVersionInput{ObjectID: partner.ObjectID, ApprovalEntryID: partner.Approval.ApprovalEntryID, ApprovalRevision: partner.Approval.Revision}, creator("partner-submit"))
	if err != nil {
		t.Fatal(err)
	}
	partner, err = relationships.ApproveSalesPartner(t.Context(), RelationshipVersionInput{ObjectID: pendingPartner.ObjectID, ApprovalEntryID: pendingPartner.Approval.ApprovalEntryID, ApprovalRevision: pendingPartner.Approval.Revision}, reviewer("partner-approve"))
	if err != nil {
		t.Fatal(err)
	}
	partnerInput := input
	partnerInput.Name = "渠道结算子账户"
	partnerInput.PrimarySalesAttribution = CustomerSalesAttributionInput{Type: CustomerSalesAttributionChannelPartner, SubjectObjectID: partner.ObjectID}
	partnerAccount, err := accounts.Create(t.Context(), CustomerAccountCreateInput{CustomerRelationshipID: customer.ObjectID, Data: partnerInput}, creator("partner-account-create"))
	if err != nil || partnerAccount.CustomerRelationshipID != customer.ObjectID {
		t.Fatalf("second account=%+v err=%v", partnerAccount, err)
	}
	partnerView, err := accounts.Get(t.Context(), CustomerAccountGetInput{ObjectID: partnerAccount.ObjectID}, creator("partner-account-get"))
	if err != nil || partnerView.Data.PrimarySalesAttribution.SubjectApprovalEntryID != partner.Approval.ApprovalEntryID {
		t.Fatalf("partner attribution snapshot=%+v err=%v", partnerView.Data.PrimarySalesAttribution, err)
	}
	var accountCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM bob_customer_accounts WHERE customer_relationship_id=$1`, customer.ObjectID).Scan(&accountCount); err != nil || accountCount != 2 {
		t.Fatalf("customer accounts=%d err=%v", accountCount, err)
	}
	fileID := ulid.Make().String()
	if _, err = pool.Exec(t.Context(), `INSERT INTO dcl_customer_files(id,storage_key,original_name,content_type,declared_size,sha256_hex,status,upload_token_hash,upload_expires_at,created_by) VALUES($1,$2,'account.pdf','application/pdf',1,$3,'PENDING',$4,$5,$6)`, fileID, "customer/"+fileID, strings.Repeat("a", 64), strings.Repeat("b", 64), time.Now().Add(time.Hour), creatorID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO dcl_customer_account_attachments(approval_entry_id,file_id,category_object_id,category_approval_entry_id,category_code,category_name,created_by) VALUES($1,$2,$3,$4,'CONTRACT','合同',$5)`, account.Approval.ApprovalEntryID, fileID, ulid.Make().String(), ulid.Make().String(), creatorID); err != nil {
		t.Fatal(err)
	}
	type saveResult struct {
		mutation CustomerAccountMutation
		err      error
	}
	v2Input := input
	v2Input.Name = "账户 V2"
	start := make(chan struct{})
	saves := make(chan saveResult, 2)
	for _, saveActor := range []approval.Actor{creator("account-save-concurrent-one"), creator("account-save-concurrent-two")} {
		go func(actor approval.Actor) {
			<-start
			mutation, saveErr := accounts.Save(t.Context(), CustomerAccountSaveInput{ObjectID: accountID, ApprovalEntryID: account.Approval.ApprovalEntryID, ApprovalRevision: account.Approval.Revision, Enabled: true, Data: v2Input}, actor)
			saves <- saveResult{mutation: mutation, err: saveErr}
		}(saveActor)
	}
	close(start)
	var v2 CustomerAccountMutation
	successes := 0
	saveErrors := make([]string, 0, 2)
	for n := 0; n < 2; n++ {
		result := <-saves
		if result.err == nil {
			successes++
			v2 = result.mutation
		} else {
			saveErrors = append(saveErrors, accountTestError(result.err))
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent saves succeeded=%d errors=%v, want exactly one", successes, saveErrors)
	}
	var copies int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM dcl_customer_account_attachments WHERE file_id=$1`, fileID).Scan(&copies); err != nil || copies != 2 {
		t.Fatalf("candidate attachment copies=%d err=%v", copies, err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT source_approval_entry_id FROM bob_customer_account_currents WHERE object_id=$1`, accountID).Scan(&current); err != nil || current != account.Approval.ApprovalEntryID {
		t.Fatalf("candidate changed current=%s err=%v", current, err)
	}
	v2 = submitAndApproveCustomerAccount(t, accounts, v2, creator("account-submit-v2"), reviewer("account-approve-v2"))
	if err = pool.QueryRow(t.Context(), `SELECT source_approval_entry_id FROM bob_customer_account_currents WHERE object_id=$1`, accountID).Scan(&current); err != nil || current != v2.Approval.ApprovalEntryID {
		t.Fatalf("V2 current=%s err=%v", current, err)
	}
	tx, err = pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	v1Exact, err := business.ValidateApprovedSnapshotReference(t.Context(), tx, bobdomain.EntityCustomerAccount, accountID, account.Approval.ApprovalEntryID)
	_ = tx.Rollback(t.Context())
	if err != nil || v1Exact.Data.Name != "账户 V1" {
		t.Fatalf("historical V1 exact snapshot after V2 approval=%+v err=%v", v1Exact, err)
	}
	voucherID, voucherEntryID := ulid.Make().String(), ulid.Make().String()
	voucherTx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer voucherTx.Rollback(t.Context())
	if _, err = voucherTx.Exec(t.Context(), `
		INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at)
		VALUES($1,'vou','sales-receipt',$2,1,'APPROVED',3,$3,now(),$4,now(),$3,now(),$4,now())`,
		voucherEntryID, voucherID, creatorID, reviewerID); err != nil {
		t.Fatalf("insert immutable V1 sales approval: %v", err)
	}
	if _, err = voucherTx.Exec(t.Context(), `
		INSERT INTO vou_documents(id,entity,document_no,approval_entry_id,business_date,currency,total_amount_cents)
		VALUES($2,'sales-receipt','RCP-20260828-0001',$1,'2026-08-28','CNY',100)`, voucherEntryID, voucherID); err != nil {
		t.Fatalf("insert immutable V1 sales document: %v", err)
	}
	if _, err = voucherTx.Exec(t.Context(), `
		INSERT INTO vou_receipt_details(document_id,entity,counterparty_entity,counterparty_object_id,counterparty_approval_entry_id,counterparty_code,counterparty_name,fund_account_object_id,fund_account_approval_entry_id,fund_account_code,fund_account_name)
		VALUES($1,'sales-receipt','customer-account',$2,$3,$4,'账户 V1',$5,$6,'FAC-0001','测试资金账户')`,
		voucherID, accountID, account.Approval.ApprovalEntryID, employeeView.Code, ulid.Make().String(), ulid.Make().String()); err != nil {
		t.Fatalf("insert immutable V1 sales snapshot: %v", err)
	}
	if err = voucherTx.Commit(t.Context()); err != nil {
		t.Fatalf("commit immutable V1 sales snapshot: %v", err)
	}
	v2, err = accounts.Unapprove(t.Context(), CustomerAccountReviewInput{ObjectID: accountID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "fallback"}, reviewer("account-unapprove-v2"))
	if err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT source_approval_entry_id FROM bob_customer_account_currents WHERE object_id=$1`, accountID).Scan(&current); err != nil || current != account.Approval.ApprovalEntryID {
		t.Fatalf("fallback current=%s err=%v", current, err)
	}
	var savedCustomerName string
	if err = pool.QueryRow(t.Context(), `SELECT counterparty_name FROM vou_receipt_details WHERE document_id=$1`, voucherID).Scan(&savedCustomerName); err != nil || savedCustomerName != "账户 V1" {
		t.Fatalf("historical VOU customer snapshot=%q err=%v", savedCustomerName, err)
	}
	v2, err = accounts.Unsubmit(t.Context(), CustomerAccountReviewInput{ObjectID: accountID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision}, creator("account-unsubmit-v2"))
	if err != nil {
		t.Fatal(err)
	}
	if err = accounts.Delete(t.Context(), CustomerAccountDeleteInput{ObjectID: accountID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision}, creator("account-delete-v2")); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_entries WHERE domain='dcl' AND entity='customer-account' AND subject_id=$1`, accountID).Scan(&remaining); err != nil || remaining != 1 {
		t.Fatalf("remaining account versions=%d err=%v", remaining, err)
	}
	if _, err = accounts.Unapprove(t.Context(), CustomerAccountReviewInput{ObjectID: accountID, ApprovalEntryID: account.Approval.ApprovalEntryID, ApprovalRevision: account.Approval.Revision, Reason: "must be blocked by VOU"}, reviewer("account-unapprove-v1-blocked")); err == nil {
		t.Fatal("VOU-referenced customer account V1 was unapproved")
	} else {
		var domainErr *DomainError
		if !errors.As(err, &domainErr) || domainErr.ErrorKey != "bob_unapprove_blocked" {
			t.Fatalf("VOU blocker error=%v", err)
		}
	}
	attachments, err := NewCustomerAttachmentService(pool, CustomerAttachmentOptions{Root: t.TempDir()}, authorizer, bus)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = attachments.Initiate(t.Context(), CustomerAttachmentInitiateInput{Scope: CustomerAttachmentScopeAccount, OwnerApprovalEntryID: account.Approval.ApprovalEntryID, ApprovalRevision: account.Approval.Revision, CategoryObjectID: ulid.Make().String(), FileName: "blocked.pdf", ContentType: "application/pdf", Size: 1, SHA256: strings.Repeat("a", 64)}, creator("attachment-on-approved")); err == nil {
		t.Fatal("approved account attachment write was accepted")
	}
	partnerFiles := make([]string, maxDCLCustomerAttachments)
	for n := range partnerFiles {
		partnerFiles[n] = ulid.Make().String()
		if _, err = pool.Exec(t.Context(), `INSERT INTO dcl_customer_files(id,storage_key,original_name,content_type,declared_size,sha256_hex,status,upload_token_hash,upload_expires_at,created_by) VALUES($1,$2,$3,'application/pdf',1,$4,'PENDING',$5,$6,$7)`, partnerFiles[n], "customer/"+partnerFiles[n], "partner-"+partnerFiles[n]+".pdf", strings.Repeat("a", 64), fmt.Sprintf("%064x", n+1), time.Now().Add(time.Hour), creatorID); err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(t.Context(), `INSERT INTO dcl_customer_account_attachments(approval_entry_id,file_id,category_object_id,category_approval_entry_id,category_code,category_name,created_by) VALUES($1,$2,$3,$4,'CONTRACT','合同',$5)`, partnerAccount.Approval.ApprovalEntryID, partnerFiles[n], ulid.Make().String(), ulid.Make().String(), creatorID); err != nil {
			t.Fatal(err)
		}
	}
	var attachmentEvent dclapproval.CustomerAccountPayload
	if err = dclapproval.CustomerAccountTopic.Subscribe(bus, "account-attachment-payload", func(_ context.Context, _ pgx.Tx, event approval.Event[dclapproval.CustomerAccountPayload]) error {
		attachmentEvent = event.Payload
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	removed, err := attachments.Remove(t.Context(), CustomerAttachmentRemoveInput{Scope: CustomerAttachmentScopeAccount, OwnerApprovalEntryID: partnerAccount.Approval.ApprovalEntryID, ApprovalRevision: partnerAccount.Approval.Revision, FileID: partnerFiles[0]}, creator("attachment-remove-at-limit"))
	if err != nil || removed.ApprovalRevision != partnerAccount.Approval.Revision+1 {
		t.Fatalf("remove at attachment limit=%+v err=%v", removed, err)
	}
	if attachmentEvent.SubjectID != partnerAccount.ObjectID || attachmentEvent.Code == "" || attachmentEvent.CustomerRelationshipID != customer.ObjectID || attachmentEvent.Name != partnerInput.Name || !attachmentEvent.Enabled {
		t.Fatalf("incomplete account attachment event payload=%+v", attachmentEvent)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM dcl_customer_account_attachments WHERE approval_entry_id=$1`, partnerAccount.Approval.ApprovalEntryID).Scan(&copies); err != nil || copies != maxDCLCustomerAttachments-1 {
		t.Fatalf("attachments after full remove=%d err=%v", copies, err)
	}
	rollback, err := accounts.Save(t.Context(), CustomerAccountSaveInput{ObjectID: accountID, ApprovalEntryID: account.Approval.ApprovalEntryID, ApprovalRevision: account.Approval.Revision, Enabled: true, Data: input}, creator("account-rollback-save"))
	if err != nil {
		t.Fatal(err)
	}
	pendingRollback, err := accounts.Submit(t.Context(), CustomerAccountVersionInput{ObjectID: rollback.ObjectID, ApprovalEntryID: rollback.Approval.ApprovalEntryID, ApprovalRevision: rollback.Approval.Revision}, creator("account-rollback-submit"))
	if err != nil {
		t.Fatal(err)
	}
	failure := errors.New("forced customer account current failure")
	failingAccounts := NewCustomerAccountService(pool, failingCustomerAccountCurrent{customerAccountCurrent: business, failure: failure}, authorizer, bus)
	if _, err = failingAccounts.Approve(t.Context(), CustomerAccountVersionInput{ObjectID: pendingRollback.ObjectID, ApprovalEntryID: pendingRollback.Approval.ApprovalEntryID, ApprovalRevision: pendingRollback.Approval.Revision}, reviewer("account-rollback-approve")); !errors.Is(err, failure) {
		t.Fatalf("approve error=%v, want current failure", err)
	}
	var status string
	if err = pool.QueryRow(t.Context(), `SELECT status FROM approval_entries WHERE id=$1`, pendingRollback.Approval.ApprovalEntryID).Scan(&status); err != nil || status != string(approval.StatusPending) {
		t.Fatalf("rollback approval status=%s err=%v", status, err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT source_approval_entry_id FROM bob_customer_account_currents WHERE object_id=$1`, accountID).Scan(&current); err != nil || current != account.Approval.ApprovalEntryID {
		t.Fatalf("failed current apply changed current=%s err=%v", current, err)
	}
}

func accountTestError(err error) string {
	parts := make([]string, 0, 3)
	for err != nil {
		parts = append(parts, fmt.Sprintf("%T: %v", err, err))
		err = errors.Unwrap(err)
	}
	return strings.Join(parts, " <- ")
}

type failingCustomerAccountCurrent struct {
	customerAccountCurrent
	failure error
}

func (f failingCustomerAccountCurrent) ApplyCustomerAccountCurrent(context.Context, pgx.Tx, bobdomain.RelationshipIdentity, string, bool, string) (bobdomain.RelationshipIdentity, error) {
	return bobdomain.RelationshipIdentity{}, f.failure
}

func submitAndApproveCustomerAccount(t *testing.T, service *CustomerAccountService, mutation CustomerAccountMutation, submitter, reviewer approval.Actor) CustomerAccountMutation {
	t.Helper()
	pending, err := service.Submit(t.Context(), CustomerAccountVersionInput{ObjectID: mutation.ObjectID, ApprovalEntryID: mutation.Approval.ApprovalEntryID, ApprovalRevision: mutation.Approval.Revision}, submitter)
	if err != nil {
		t.Fatal(err)
	}
	approved, err := service.Approve(t.Context(), CustomerAccountVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer)
	if err != nil {
		t.Fatal(err)
	}
	return approved
}
