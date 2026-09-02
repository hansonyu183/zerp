//go:build integration

package dcl

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"
)

func TestCustomerAggregateSchemaIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	for _, table := range []string{
		"dcl_customer_versions",
		"dcl_customer_account_roots",
		"dcl_customer_version_accounts",
		"dcl_customer_version_account_credit_limits",
		"dcl_customer_legal_identifier_claims",
		"dcl_customer_attachments",
	} {
		var exists bool
		if err := pool.QueryRow(t.Context(), `SELECT to_regclass($1) IS NOT NULL`, "public."+table).Scan(&exists); err != nil {
			t.Fatalf("check %s: %v", table, err)
		}
		if !exists {
			t.Fatalf("missing Customer aggregate table %s", table)
		}
	}
	for _, retired := range []string{
		"dcl_customer_version" + "_identifiers",
		"dcl_customer_identifier" + "_claims",
		"dcl_customer_relationships",
		"dcl_customer_accounts",
		"dcl_customer_account_versions",
		"dcl_customer_account_credit_limits",
		"dcl_customer_account_attachments",
	} {
		var exists bool
		if err := pool.QueryRow(t.Context(), `SELECT to_regclass($1) IS NOT NULL`, "public."+retired).Scan(&exists); err != nil {
			t.Fatalf("check retired %s: %v", retired, err)
		}
		if exists {
			t.Fatalf("retired independent Customer Account table remains: %s", retired)
		}
	}
}

type customerAggregateRules struct {
	blockUnapprove bool
}

func (r *customerAggregateRules) ResolveCurrentReference(_ context.Context, _ pgx.Tx, entity, objectID string) (bobdomain.EffectiveReference, error) {
	return bobdomain.EffectiveReference{
		ObjectID: objectID, Entity: entity, Code: "REF-0001", ApprovalEntryID: ulid.Make().String(), VersionNo: 1,
		Data: bobdomain.DetailView{Name: "经营主体"},
	}, nil
}

func (r *customerAggregateRules) ResolveCustomerTypeReference(_ context.Context, _ pgx.Tx, objectID string) (bobdomain.EffectiveReference, error) {
	return bobdomain.EffectiveReference{
		ObjectID: objectID, Entity: "dictionary-item", Code: "DIT-0001", ApprovalEntryID: objectID, VersionNo: 1,
		Data: bobdomain.DetailView{Name: "终端客户"},
	}, nil
}

func (r *customerAggregateRules) ResolveCustomerAccountReferences(_ context.Context, _ pgx.Tx, _, _, settlementID, paymentID, attributionType, attributionID string) (bobdomain.EffectiveReference, bobdomain.EffectiveReference, bobdomain.EffectiveReference, error) {
	settlement := bobdomain.EffectiveReference{}
	if settlementID != "" {
		settlement = bobdomain.EffectiveReference{ObjectID: settlementID, Entity: "settlement-method", Code: "SET-0001", ApprovalEntryID: settlementID, Data: bobdomain.DetailView{Name: "月结"}}
	}
	payment := bobdomain.EffectiveReference{}
	if paymentID != "" {
		payment = bobdomain.EffectiveReference{ObjectID: paymentID, Entity: "payment-method", Code: "PAY-0001", ApprovalEntryID: paymentID, Data: bobdomain.DetailView{Name: "转账"}}
	}
	attribution := bobdomain.EffectiveReference{ObjectID: attributionID, Entity: attributionType, Code: "SAL-0001", ApprovalEntryID: ulid.Make().String(), Data: bobdomain.DetailView{Name: "销售归属"}}
	return settlement, payment, attribution, nil
}

func (r *customerAggregateRules) ValidateCustomerAccountReferences(context.Context, pgx.Tx, string, string, string, string, string) error {
	return nil
}

func (r *customerAggregateRules) ValidateHistoricalReference(_ context.Context, _ pgx.Tx, entity, objectID, entryID string) (bobdomain.EffectiveReference, error) {
	return bobdomain.EffectiveReference{ObjectID: objectID, Entity: entity, ApprovalEntryID: entryID, Data: bobdomain.DetailView{Name: "历史经营主体"}}, nil
}

func (r *customerAggregateRules) EnsureCustomerUnapproveAllowed(context.Context, pgx.Tx, string) error {
	if r.blockUnapprove {
		return errors.New("customer is referenced")
	}
	return nil
}

func customerAggregateData(legalIdentifier, legalName string, accounts ...CustomerAccountDataInput) CustomerDataInput {
	return CustomerDataInput{
		Kind: "MAINLAND_ENTERPRISE", LegalName: legalName, DisplayName: legalName,
		LegalIdentifier:    legalIdentifier,
		RemittanceProfiles: []CustomerRemittanceProfile{}, DefaultOperatingEntityID: "01JCTEST000000000000000001", Enabled: true,
		Accounts: accounts,
	}
}

func customerAggregateAccount(name string, defaultAccount bool) CustomerAccountDataInput {
	return CustomerAccountDataInput{
		Enabled: true, IsDefault: defaultAccount, Name: name, CustomerTypeID: "01JAVX00000000000000000005",
		PricingPolicy:           CustomerPricingPolicy{CostItems: []CustomerPricingCostItem{}},
		CreditLimits:            []CustomerCreditLimit{{Currency: "CNY", Amount: "1000.00"}, {Currency: "USD", Amount: "200.00"}},
		PrimarySalesAttribution: CustomerSalesAttributionInput{Type: CustomerSalesAttributionInternalEmployee, SubjectObjectID: "01JCTEST000000000000000002"},
	}
}

func approveCustomerAggregate(t *testing.T, service *CustomerService, mutation CustomerMutation, creator, reviewer approval.Actor) CustomerMutation {
	t.Helper()
	pending, err := service.Submit(t.Context(), CustomerVersionInput{ObjectID: mutation.ObjectID, ApprovalEntryID: mutation.Approval.ApprovalEntryID, ApprovalRevision: mutation.Approval.Revision}, creator)
	if err != nil {
		t.Fatalf("submit Customer: %v", err)
	}
	approved, err := service.Approve(t.Context(), CustomerVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer)
	if err != nil {
		t.Fatalf("approve Customer: %v", err)
	}
	return approved
}

func TestCustomerAggregateLifecycleAndHistoricalAccountsIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	rules := &customerAggregateRules{}
	authorizer := authorization.Func(nil)
	service := NewCustomerService(pool, rules, authorizer, txevent.NewBus())
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxdomain.NewService(pool)))
	creatorID := ulid.Make().String()
	creator := dclActor(t, creatorID, "customer-aggregate-creator")
	reviewer := dclActor(t, ulid.Make().String(), "customer-aggregate-reviewer")

	v1, err := service.Create(t.Context(), CustomerCreateInput{Data: customerAggregateData("91350211M00010001X", "聚合客户 V1",
		customerAggregateAccount("默认账户", true), customerAggregateAccount("项目账户", false),
	)}, creator)
	if err != nil {
		t.Fatalf("create Customer V1: %v (cause: %v)", err, errors.Unwrap(err))
	}
	v1View, err := service.Get(t.Context(), CustomerGetInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID}, creator)
	if err != nil {
		t.Fatalf("get Customer V1: %v", err)
	}
	if len(v1View.Data.Accounts) != 2 || v1View.Data.Accounts[0].Code != "ACC-0001" || v1View.Data.Accounts[1].Code != "ACC-0002" {
		t.Fatalf("Customer V1 account roots = %+v", v1View.Data.Accounts)
	}
	defaultID, removedApprovedID := v1View.Data.Accounts[0].AccountID, v1View.Data.Accounts[1].AccountID
	v1 = approveCustomerAggregate(t, service, v1, creator, reviewer)

	other, err := service.Create(t.Context(), CustomerCreateInput{Data: customerAggregateData("91350211M000100021", "占用法定识别号客户", customerAggregateAccount("唯一账户", true))}, creator)
	if err != nil {
		t.Fatalf("create conflicting legal identifier owner: %v", err)
	}
	_ = approveCustomerAggregate(t, service, other, creator, reviewer)

	failedData := customerAggregateData("91350211M000100021", "应回滚客户", customerAggregateAccount("默认账户", true), customerAggregateAccount("回滚账户", false))
	failedData.Accounts[0].AccountID = defaultID
	if _, err = service.Save(t.Context(), CustomerSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Data: failedData}, creator); err == nil {
		t.Fatal("saved Customer with an occupied legal identifier")
	}
	var rootCount, openCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM dcl_customer_account_roots WHERE customer_id=$1`, v1.ObjectID).Scan(&rootCount); err != nil {
		t.Fatalf("count roots after rollback: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_entries WHERE domain='dcl' AND entity='customer' AND subject_id=$1 AND status IN ('DRAFT','PENDING')`, v1.ObjectID).Scan(&openCount); err != nil {
		t.Fatalf("count candidates after rollback: %v", err)
	}
	if rootCount != 2 || openCount != 0 {
		t.Fatalf("failed aggregate save leaked state: roots=%d open=%d", rootCount, openCount)
	}

	v2Data := customerAggregateData("91350211M00010001X", "聚合客户 V2", customerAggregateAccount("默认账户 V2", true), customerAggregateAccount("候选临时账户", false))
	v2Data.Accounts[0].AccountID = defaultID
	v2, err := service.Save(t.Context(), CustomerSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Data: v2Data}, creator)
	if err != nil {
		t.Fatalf("save Customer V2: %v", err)
	}
	v2View, err := service.Get(t.Context(), CustomerGetInput{ObjectID: v1.ObjectID}, creator)
	if err != nil || len(v2View.Data.Accounts) != 2 {
		t.Fatalf("get Customer V2 candidate: view=%+v err=%v", v2View, err)
	}
	temporaryID := v2View.Data.Accounts[1].AccountID
	current, err := business.CustomerCurrentGet(t.Context(), v1.ObjectID)
	if err != nil || current.SourceApprovalEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("open V2 leaked into BOB current: current=%+v err=%v", current, err)
	}
	fileID := ulid.Make().String()
	if _, err = pool.Exec(t.Context(), `
		INSERT INTO dcl_customer_files(
			id,storage_key,original_name,content_type,declared_size,sha256_hex,status,
			upload_token_hash,upload_expires_at,stored_at,created_by
		) VALUES($1,$2,'customer-account.pdf','application/pdf',1,$3,'READY',$4,now()+interval '1 hour',now(),$5)`,
		fileID, "customer/"+fileID, strings.Repeat("a", 64), strings.Repeat("b", 64), creatorID); err != nil {
		t.Fatalf("insert Customer account file: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `
		INSERT INTO dcl_customer_attachments(
			approval_entry_id,account_id,file_id,category_object_id,category_code,category_name,created_by
		) VALUES($1,$2,$3,$4,'BUSINESS','业务附件',$5)`,
		v2.Approval.ApprovalEntryID, defaultID, fileID, ulid.Make().String(), creatorID); err != nil {
		t.Fatalf("attach file to Customer account: %v", err)
	}

	finalData := customerAggregateData("91350211M00010001X", "聚合客户 V2", customerAggregateAccount("默认账户 V2", true))
	finalData.Accounts[0].AccountID = defaultID
	v2, err = service.Save(t.Context(), CustomerSaveInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Data: finalData}, creator)
	if err != nil {
		t.Fatalf("remove never-approved account from V2: %v", err)
	}
	var attachmentExists bool
	if err = pool.QueryRow(t.Context(), `SELECT EXISTS(SELECT 1 FROM dcl_customer_attachments WHERE approval_entry_id=$1 AND account_id=$2 AND file_id=$3)`, v2.Approval.ApprovalEntryID, defaultID, fileID).Scan(&attachmentExists); err != nil {
		t.Fatalf("check Customer account attachment after save: %v", err)
	}
	if !attachmentExists {
		t.Fatal("saving a Customer candidate deleted an attachment from an unchanged account")
	}
	var temporaryExists, approvedRemovedExists bool
	if err = pool.QueryRow(t.Context(), `SELECT EXISTS(SELECT 1 FROM dcl_customer_account_roots WHERE account_id=$1), EXISTS(SELECT 1 FROM dcl_customer_account_roots WHERE account_id=$2)`, temporaryID, removedApprovedID).Scan(&temporaryExists, &approvedRemovedExists); err != nil {
		t.Fatalf("check account-root deletion rules: %v", err)
	}
	if temporaryExists || !approvedRemovedExists {
		t.Fatalf("account-root retention mismatch: temporary=%t approved=%t", temporaryExists, approvedRemovedExists)
	}
	v2 = approveCustomerAggregate(t, service, v2, creator, reviewer)
	current, err = business.CustomerCurrentGet(t.Context(), v1.ObjectID)
	if err != nil || current.SourceApprovalEntryID != v2.Approval.ApprovalEntryID {
		t.Fatalf("approved V2 did not atomically replace BOB current: current=%+v err=%v", current, err)
	}
	var currentData CustomerData
	if err = json.Unmarshal(current.Data, &currentData); err != nil || len(currentData.Accounts) != 1 || currentData.Accounts[0].AccountID != defaultID {
		t.Fatalf("BOB current Customer aggregate = %+v err=%v", currentData, err)
	}

	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin account reference checks: %v", err)
	}
	defer tx.Rollback(t.Context())
	historical, err := business.ValidateHistoricalReference(t.Context(), tx, bobdomain.EntityCustomerAccount, removedApprovedID, v1.Approval.ApprovalEntryID)
	if err != nil || historical.CustomerID != v1.ObjectID || historical.ApprovalEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("historical embedded account reference = %+v err=%v", historical, err)
	}
	if _, err = business.ResolveCurrentReference(t.Context(), tx, bobdomain.EntityCustomerAccount, removedApprovedID); err == nil {
		t.Fatal("removed account remained available as current reference")
	}
	currentDefault, err := business.ResolveCurrentReference(t.Context(), tx, bobdomain.EntityCustomerAccount, defaultID)
	if err != nil || currentDefault.CustomerID != v1.ObjectID || currentDefault.ApprovalEntryID != v2.Approval.ApprovalEntryID {
		t.Fatalf("current embedded account reference = %+v err=%v", currentDefault, err)
	}
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatalf("rollback account reference checks: %v", err)
	}

	rules.blockUnapprove = true
	if _, err = service.Unapprove(t.Context(), CustomerReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "存在历史引用"}, reviewer); err == nil {
		t.Fatal("unapproved a referenced Customer aggregate")
	}
	current, err = business.CustomerCurrentGet(t.Context(), v1.ObjectID)
	if err != nil || current.SourceApprovalEntryID != v2.Approval.ApprovalEntryID {
		t.Fatalf("blocked unapprove changed BOB current: current=%+v err=%v", current, err)
	}
}
