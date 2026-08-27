//go:build integration

package dcl

import (
	"context"
	"errors"
	"sync"
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

func TestFundAccountDeclarationLifecycleAndReferencesIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary), authorizer, bus)
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	service := NewFundAccountService(pool, business, authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }

	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: OperatingEntityData{Name: "资金账户所属主体"}}, creator("owner-create"))
	if err != nil {
		t.Fatalf("create operating entity: %v", err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("owner-submit"), reviewer("owner-approve"))
	data := FundAccountData{Name: "基本账户", Currency: "cny", AccountName: "测试户名", BankName: "测试银行", AccountNumber: " 6222-001 ", OperatingEntityID: owner.ObjectID}
	v1, err := service.Create(t.Context(), FundAccountCreateInput{Data: data}, creator("fund-create"))
	if err != nil {
		t.Fatalf("create fund account: %v", err)
	}
	if _, err = business.Get(t.Context(), bobdomain.EntityFundAccount, bobdomain.GetInput{ObjectID: v1.ObjectID}); err == nil {
		t.Fatal("candidate was exposed as BOB current")
	}
	var accountNumber, operatingEntry string
	if err = pool.QueryRow(t.Context(), `SELECT account_number,operating_entity_approval_entry_id FROM dcl_fund_account_versions WHERE approval_entry_id=$1`, v1.Approval.ApprovalEntryID).Scan(&accountNumber, &operatingEntry); err != nil {
		t.Fatalf("read DCL snapshot: %v", err)
	}
	if accountNumber != "6222001" || operatingEntry != owner.Approval.ApprovalEntryID {
		t.Fatalf("stored snapshot=(%q,%q)", accountNumber, operatingEntry)
	}
	v1 = submitAndApproveFundAccount(t, service, v1, creator("fund-submit"), reviewer("fund-approve"))
	current, err := business.Get(t.Context(), bobdomain.EntityFundAccount, bobdomain.GetInput{ObjectID: v1.ObjectID})
	if err != nil || current.Data.Name != "基本账户" || current.Approval.ApprovalEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("BOB current=%+v err=%v", current, err)
	}
	page, err := business.Query(t.Context(), bobdomain.EntityFundAccount, bobdomain.QueryInput{Page: 1, PageSize: 20})
	if err != nil || len(page.Items) != 1 || page.Items[0].LatestApproved == nil {
		t.Fatalf("BOB current page=%+v err=%v", page, err)
	}
	if page.Items[0].LatestApproved.Summary.AccountNumber != "" {
		t.Fatalf("BOB current list exposed full account number: %+v", page.Items[0].LatestApproved.Summary)
	}

	v2, err := service.Save(t.Context(), FundAccountSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Enabled: false, Data: FundAccountData{Name: "基本账户 V2", Currency: "CNY", AccountNumber: "6222-002", OperatingEntityID: owner.ObjectID}}, creator("fund-save"))
	if err != nil {
		t.Fatalf("save V2: %v", err)
	}
	ownerV2, err := operating.Save(t.Context(), OperatingEntitySaveInput{ObjectID: owner.ObjectID, ApprovalEntryID: owner.Approval.ApprovalEntryID, ApprovalRevision: owner.Approval.Revision, Enabled: true, Data: OperatingEntityData{Name: "资金账户所属主体 V2"}}, creator("owner-save-v2"))
	if err != nil {
		t.Fatalf("save operating V2: %v", err)
	}
	ownerV2 = submitAndApproveOperatingEntity(t, operating, ownerV2, creator("owner-submit-v2"), reviewer("owner-approve-v2"))
	_, err = service.Submit(t.Context(), FundAccountVersionInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision}, creator("fund-stale-operating"))
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "fund_account_operating_reference_stale" {
		t.Fatalf("stale operating error=%v", err)
	}
	v2, err = service.Save(t.Context(), FundAccountSaveInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Enabled: false, Data: FundAccountData{Name: "基本账户 V2", Currency: "CNY", AccountNumber: "6222-002", OperatingEntityID: owner.ObjectID}}, creator("fund-refresh-operating"))
	if err != nil {
		t.Fatalf("refresh operating reference: %v", err)
	}
	v2 = submitAndApproveFundAccount(t, service, v2, creator("fund-submit-v2"), reviewer("fund-approve-v2"))
	v2, err = service.Unapprove(t.Context(), FundAccountReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "restore V1"}, reviewer("fund-unapprove-v2"))
	if err != nil {
		t.Fatalf("unapprove V2: %v", err)
	}
	current, err = business.Get(t.Context(), bobdomain.EntityFundAccount, bobdomain.GetInput{ObjectID: v1.ObjectID})
	if err != nil || current.Data.Name != "基本账户" || !current.Enabled {
		t.Fatalf("fallback current=%+v err=%v", current, err)
	}

}

func submitAndApproveFundAccount(t *testing.T, service *FundAccountService, input FundAccountMutation, submitter, reviewer approval.Actor) FundAccountMutation {
	t.Helper()
	pending, err := service.Submit(t.Context(), FundAccountVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.Approval.ApprovalEntryID, ApprovalRevision: input.Approval.Revision}, submitter)
	if err != nil {
		t.Fatalf("submit fund account: %v", err)
	}
	approved, err := service.Approve(t.Context(), FundAccountVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer)
	if err != nil {
		t.Fatalf("approve fund account: %v", err)
	}
	return approved
}

func TestFundAccountIdentifierClaimsAndApprovalRollbackIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary), authorizer, bus)
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	service := NewFundAccountService(pool, business, authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }
	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: OperatingEntityData{Name: "账户唯一性主体"}}, creator("owner-create"))
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("owner-submit"), reviewer("owner-approve"))
	data := FundAccountData{Name: "并发账户", Currency: "CNY", AccountNumber: "6222-333", OperatingEntityID: owner.ObjectID}
	type result struct{ err error }
	results := make(chan result, 2)
	var wait sync.WaitGroup
	for i := range 2 {
		wait.Add(1)
		go func(i int) {
			defer wait.Done()
			_, createErr := service.Create(t.Context(), FundAccountCreateInput{Data: data}, creator("concurrent-"+string(rune('a'+i))))
			results <- result{createErr}
		}(i)
	}
	wait.Wait()
	close(results)
	succeeded, conflicted := 0, 0
	for r := range results {
		if r.err == nil {
			succeeded++
			continue
		}
		var domainErr *DomainError
		if errors.As(r.err, &domainErr) && domainErr.ErrorKey == "fund_account_identifier_conflict" {
			conflicted++
			continue
		}
		t.Fatalf("concurrent create: %v", r.err)
	}
	if succeeded != 1 || conflicted != 1 {
		t.Fatalf("concurrent results success=%d conflict=%d", succeeded, conflicted)
	}

	v1, err := service.Create(t.Context(), FundAccountCreateInput{Data: FundAccountData{Name: "回落账户", Currency: "CNY", AccountNumber: "111-111", OperatingEntityID: owner.ObjectID}}, creator("fallback-create"))
	if err != nil {
		t.Fatalf("create fallback V1: %v", err)
	}
	v1 = submitAndApproveFundAccount(t, service, v1, creator("fallback-submit-v1"), reviewer("fallback-approve-v1"))
	v2, err := service.Save(t.Context(), FundAccountSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Enabled: true, Data: FundAccountData{Name: "回落账户 V2", Currency: "CNY", AccountNumber: "222-222", OperatingEntityID: owner.ObjectID}}, creator("fallback-save-v2"))
	if err != nil {
		t.Fatalf("save fallback V2: %v", err)
	}
	if _, err = service.Create(t.Context(), FundAccountCreateInput{Data: FundAccountData{Name: "占用候选", Currency: "CNY", AccountNumber: "222222", OperatingEntityID: owner.ObjectID}}, creator("open-conflict")); err == nil {
		t.Fatal("open candidate account number was not reserved")
	}
	v2 = submitAndApproveFundAccount(t, service, v2, creator("fallback-submit-v2"), reviewer("fallback-approve-v2"))
	reused, err := service.Create(t.Context(), FundAccountCreateInput{Data: FundAccountData{Name: "复用旧账号", Currency: "CNY", AccountNumber: "111111", OperatingEntityID: owner.ObjectID}}, creator("reuse-old"))
	if err != nil {
		t.Fatalf("reuse released V1 number: %v", err)
	}
	reused = submitAndApproveFundAccount(t, service, reused, creator("reuse-submit"), reviewer("reuse-approve"))
	_, err = service.Unapprove(t.Context(), FundAccountReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "conflicting fallback"}, reviewer("fallback-unapprove"))
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "fund_account_identifier_conflict" {
		t.Fatalf("unapprove fallback conflict=%v", err)
	}
	stillApproved, err := service.Get(t.Context(), FundAccountGetInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID}, creator("verify-atomic"))
	if err != nil || stillApproved.Approval.Status != approval.StatusApproved {
		t.Fatalf("unapprove was not atomic view=%+v err=%v", stillApproved, err)
	}
	_ = reused

	failing := NewFundAccountService(pool, failingFundAccountWriter{Service: business}, authorizer, bus)
	pending, err := failing.Create(t.Context(), FundAccountCreateInput{Data: FundAccountData{Name: "失败投影", Currency: "CNY", AccountNumber: "999999", OperatingEntityID: owner.ObjectID}}, creator("failure-create"))
	if err != nil {
		t.Fatalf("create failing projection: %v", err)
	}
	pending, err = failing.Submit(t.Context(), FundAccountVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, creator("failure-submit"))
	if err != nil {
		t.Fatalf("submit failing projection: %v", err)
	}
	if _, err = failing.Approve(t.Context(), FundAccountVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer("failure-approve")); err == nil {
		t.Fatal("failing BOB current writer approved declaration")
	}
	view, err := service.Get(t.Context(), FundAccountGetInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID}, creator("failure-check"))
	if err != nil || view.Approval.Status != approval.StatusPending {
		t.Fatalf("failed projection changed approval view=%+v err=%v", view, err)
	}
}

type failingFundAccountWriter struct{ *bobdomain.Service }

func (failingFundAccountWriter) ApplyFundAccountCurrent(context.Context, pgx.Tx, string, string, bool, bobdomain.FundAccountData, string) (bobdomain.FundAccountCurrent, error) {
	return bobdomain.FundAccountCurrent{}, errors.New("injected BOB current failure")
}
