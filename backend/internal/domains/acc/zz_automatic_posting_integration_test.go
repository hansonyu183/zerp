//go:build integration

package acc

import (
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
)

func trustedAccountingActor(t *testing.T, requestID string) approval.Actor {
	t.Helper()
	actorID := adminID
	if strings.Contains(requestID, "approve") || strings.Contains(requestID, "reject") {
		actorID = operatorID
	}
	actor, err := approval.UserActor(authorization.Principal{ActorID: actorID}, requestID)
	if err != nil {
		t.Fatalf("create accounting integration actor: %v", err)
	}
	return actor
}

func newAccountingIntegrationBOBService(pool *pgxpool.Pool, bus *txevent.Bus) *bobdomain.Service {
	authorizer := authorization.Func(nil)
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	return bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
}

func createApprovedAccountingReference(t *testing.T, service *bobdomain.Service, entity string, data bobdomain.CreateDetailInput) voudomain.ReferenceInput {
	t.Helper()
	if entity == bobdomain.EntityOperatingEntity {
		declarations := dcldomain.NewOperatingEntityService(integrationPool(t), service, authorization.Func(nil), txevent.NewBus())
		created, err := declarations.Create(t.Context(), dcldomain.OperatingEntityCreateInput{Data: dcldomain.OperatingEntityData{
			Name: data.Name, ShortName: data.ShortName, TaxNumber: data.TaxNumber,
			Address: data.Address, Phone: data.Phone, Remark: data.Remark,
		}}, trustedAccountingActor(t, "acc-posting-reference-create"))
		if err != nil {
			t.Fatalf("create operating entity reference: %v", err)
		}
		submitted, err := declarations.Submit(t.Context(), dcldomain.OperatingEntityVersionInput{
			ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID,
			ApprovalRevision: created.Approval.Revision,
		}, trustedAccountingActor(t, "acc-posting-reference-submit"))
		if err != nil {
			t.Fatalf("submit operating entity reference: %v", err)
		}
		approved, err := declarations.Approve(t.Context(), dcldomain.OperatingEntityVersionInput{
			ObjectID: submitted.ObjectID, ApprovalEntryID: submitted.Approval.ApprovalEntryID,
			ApprovalRevision: submitted.Approval.Revision,
		}, trustedAccountingActor(t, "acc-posting-reference-approve"))
		if err != nil {
			t.Fatalf("approve operating entity reference: %v", err)
		}
		return voudomain.ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID}
	}
	if entity == bobdomain.EntityFundAccount {
		declarations := dcldomain.NewFundAccountService(integrationPool(t), service, authorization.Func(nil), txevent.NewBus())
		created, err := declarations.Create(t.Context(), dcldomain.FundAccountCreateInput{Data: dcldomain.FundAccountData{
			Name: data.Name, Currency: data.Currency, AccountName: data.AccountName,
			BankName: data.BankName, BankBranch: data.BankBranch, AccountNumber: data.AccountNumber,
			Remark: data.Remark, OperatingEntityID: data.OperatingEntityID,
		}}, trustedAccountingActor(t, "acc-posting-fund-create"))
		if err != nil {
			t.Fatalf("create fund account reference: %v", err)
		}
		submitted, err := declarations.Submit(t.Context(), dcldomain.FundAccountVersionInput{
			ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID,
			ApprovalRevision: created.Approval.Revision,
		}, trustedAccountingActor(t, "acc-posting-fund-submit"))
		if err != nil {
			t.Fatalf("submit fund account reference: %v", err)
		}
		approved, err := declarations.Approve(t.Context(), dcldomain.FundAccountVersionInput{
			ObjectID: submitted.ObjectID, ApprovalEntryID: submitted.Approval.ApprovalEntryID,
			ApprovalRevision: submitted.Approval.Revision,
		}, trustedAccountingActor(t, "acc-posting-fund-approve"))
		if err != nil {
			t.Fatalf("approve fund account reference: %v", err)
		}
		return voudomain.ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID}
	}
	t.Fatalf("unsupported accounting reference entity %q", entity)
	return voudomain.ReferenceInput{}
}

func createApprovedAccountingEmployee(t *testing.T, pool *pgxpool.Pool, business *bobdomain.Service, bus *txevent.Bus, operatingEntityID, name, requestPrefix string) voudomain.ReferenceInput {
	t.Helper()
	authorizer := authorization.Func(nil)
	parties := dcldomain.NewPartyService(pool, bobdomain.NewPartyCurrentWriter(pool), bobdomain.NewPartyCurrentReader(pool), bobdomain.NewPartyMergeEngine(pool), authorizer, bus)
	employees := dcldomain.NewEmployeeService(pool, business, parties, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)
	created, err := employees.Create(t.Context(), dcldomain.EmployeeCreateInput{
		NewParty:          &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindPerson, LegalName: name},
		OperatingEntityID: operatingEntityID,
	}, trustedAccountingActor(t, requestPrefix+"-create"))
	if err != nil {
		t.Fatalf("create employee declaration: %v", err)
	}
	employeeView, err := employees.Get(t.Context(), dcldomain.EmployeeGetInput{ObjectID: created.ObjectID}, trustedAccountingActor(t, requestPrefix+"-get"))
	if err != nil {
		t.Fatalf("get employee declaration: %v", err)
	}
	party, err := parties.Get(t.Context(), dcldomain.PartyGetInput{PartyID: employeeView.PartyID}, bobdomain.PartyRelationshipVisibility{}, trustedAccountingActor(t, requestPrefix+"-party-get"))
	if err != nil {
		t.Fatalf("get employee party: %v", err)
	}
	partyPending, err := parties.Submit(t.Context(), dcldomain.PartyVersionInput{PartyID: party.PartyID, ApprovalEntryID: party.Approval.ApprovalEntryID, ApprovalRevision: party.Approval.Revision}, trustedAccountingActor(t, requestPrefix+"-party-submit"))
	if err != nil {
		t.Fatalf("submit employee party: %v", err)
	}
	if _, err = parties.Approve(t.Context(), dcldomain.PartyVersionInput{PartyID: partyPending.PartyID, ApprovalEntryID: partyPending.Approval.ApprovalEntryID, ApprovalRevision: partyPending.Approval.Revision}, trustedAccountingActor(t, requestPrefix+"-party-approve")); err != nil {
		t.Fatalf("approve employee party: %v", err)
	}
	pending, err := employees.Submit(t.Context(), dcldomain.EmployeeVersionInput{ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: created.Approval.Revision}, trustedAccountingActor(t, requestPrefix+"-submit"))
	if err != nil {
		t.Fatalf("submit employee declaration: %v", err)
	}
	approved, err := employees.Approve(t.Context(), dcldomain.EmployeeVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, trustedAccountingActor(t, requestPrefix+"-approve"))
	if err != nil {
		t.Fatalf("approve employee declaration: %v", err)
	}
	return voudomain.ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID}
}

func TestZZAutomaticPostingUsesVOUEventSnapshotAndUnapprovalDeletesFactsIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	accounting := defaultIntegrationACCService(pool)
	book, err := accounting.CreateBook(t.Context(), CreateBookInput{Name: "自动记账", StartMonth: "2026-07", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty}, adminID)
	if err != nil {
		t.Fatalf("create accounting book: %v", err)
	}
	debit, err := accounting.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "1002", Name: "银行存款", BalanceDirection: BalanceDirectionDebit, Enabled: true, RequiredDimensions: []string{DimensionFundAccount}, SettlementPurpose: SettlementPurposeNone}, adminID)
	if err != nil {
		t.Fatalf("create debit subject: %v", err)
	}
	credit, err := accounting.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "6051", Name: "其他业务收入", BalanceDirection: BalanceDirectionCredit, Enabled: true, RequiredDimensions: []string{}, SettlementPurpose: SettlementPurposeNone}, adminID)
	if err != nil {
		t.Fatalf("create credit subject: %v", err)
	}
	createApprovedZeroOpening(t, accounting, book)
	templateID := "other-income-standard"
	mapping, err := accounting.CreateMapping(t.Context(), CreateMappingInput{
		BookID: book.ID, VouEntity: voudomain.EntityOtherIncome, DefaultResult: MappingResultPost,
		Definition: MappingDefinition{DefaultTemplateID: &templateID, Rules: []MappingRule{}, Templates: []PostingTemplate{{ID: templateID, Lines: []PostingLineTemplate{
			{SubjectSource: "FIXED", SubjectValue: debit.ID, Direction: BalanceDirectionDebit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{DimensionFundAccount: "fundAccount.objectId"}},
			{SubjectSource: "FIXED", SubjectValue: credit.ID, Direction: BalanceDirectionCredit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{}},
		}}}},
	}, integrationACCActor(t, adminID, "acc-posting-mapping-create"))
	if err != nil {
		t.Fatalf("create accounting mapping: %v", err)
	}
	mapping = approveIntegrationMapping(t, accounting, book.ID, voudomain.EntityOtherIncome, mapping)

	bus := txevent.NewBus()
	if err = accounting.RegisterSubscriptions(bus); err != nil {
		t.Fatalf("register accounting subscriptions: %v", err)
	}
	auxiliary := auxdomain.NewService(pool, authorization.Func(nil), bus)
	business := newAccountingIntegrationBOBService(pool, bus)
	operating := createApprovedAccountingReference(t, business, bobdomain.EntityOperatingEntity, bobdomain.CreateDetailInput{Name: "自动记账经营主体"})
	handler := createApprovedAccountingEmployee(t, pool, business, bus, operating.ObjectID, "自动记账经办人", "acc-posting-employee")
	fund := createApprovedAccountingReference(t, business, bobdomain.EntityFundAccount, bobdomain.CreateDetailInput{Name: "自动记账账户", Currency: "CNY", OperatingEntityID: operating.ObjectID})
	vouchers, err := voudomain.NewService(pool, business, auxiliaryrefs.New(auxiliary), bus, voudomain.AttachmentOptions{Root: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)), voudomain.WithApprovalAuthorizer(authorization.Func(nil)))
	if err != nil {
		t.Fatalf("new VOU service: %v", err)
	}
	created, err := vouchers.Create(t.Context(), voudomain.EntityOtherIncome, voudomain.CreateInput{Data: voudomain.DraftInput{BusinessDate: "2026-07-24", Currency: "CNY", SourceName: "废料收入", FundAccount: &fund, Handler: &handler, Amount: "60.00"}}, trustedAccountingActor(t, "acc-posting-vou-create"))
	if err != nil {
		t.Fatalf("create VOU: %v", err)
	}
	checked, err := vouchers.Submit(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{DocumentID: created.DocumentID, Revision: created.Approval.Revision}, trustedAccountingActor(t, "acc-posting-vou-submit"))
	if err != nil {
		t.Fatalf("check VOU: %v", err)
	}
	approved, err := vouchers.Approve(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{DocumentID: created.DocumentID, Revision: checked.Approval.Revision}, trustedAccountingActor(t, "acc-posting-vou-approve"))
	if err != nil {
		chain := []string{err.Error()}
		for current := errors.Unwrap(err); current != nil; current = errors.Unwrap(current) {
			chain = append(chain, current.Error())
		}
		t.Fatalf("approve VOU with ACC posting: %#v", chain)
	}
	var vouchersCount, linesCount int
	var sourceEntity, sourceDocumentNo string
	var sourceRevision int64
	if err = pool.QueryRow(t.Context(), `
		SELECT count(DISTINCT voucher.id), count(line.id), max(voucher.source_entity), max(voucher.source_document_no), max(voucher.source_revision)
		FROM acc_vouchers voucher
		LEFT JOIN acc_voucher_lines line ON line.voucher_id=voucher.id
		WHERE voucher.book_id=$1 AND voucher.source_type='VOU' AND voucher.source_id=$2
	`, book.ID, created.DocumentID).Scan(&vouchersCount, &linesCount, &sourceEntity, &sourceDocumentNo, &sourceRevision); err != nil {
		t.Fatalf("read automatic voucher: %v", err)
	}
	if vouchersCount != 1 || linesCount != 2 || sourceEntity != voudomain.EntityOtherIncome || sourceDocumentNo == "" || sourceRevision != approved.Approval.Revision {
		t.Fatalf("automatic facts = vouchers:%d lines:%d entity:%s no:%s revision:%d", vouchersCount, linesCount, sourceEntity, sourceDocumentNo, sourceRevision)
	}
	var debitTotal, creditTotal int64
	var remaining int
	if err = pool.QueryRow(t.Context(), `SELECT sum(debit_minor),sum(credit_minor) FROM acc_voucher_lines line JOIN acc_vouchers voucher ON voucher.id=line.voucher_id WHERE voucher.source_id=$1`, created.DocumentID).Scan(&debitTotal, &creditTotal); err != nil || debitTotal != 6000 || creditTotal != 6000 {
		t.Fatalf("automatic trial balance = %d/%d, err=%v", debitTotal, creditTotal, err)
	}
	approvedSnapshot, err := vouchers.Get(t.Context(), voudomain.EntityOtherIncome, voudomain.GetInput{DocumentID: created.DocumentID})
	if err != nil {
		t.Fatalf("get approved VOU snapshot: %v", err)
	}
	var storedFundDimension, storedSourceID string
	if err = pool.QueryRow(t.Context(), `
		SELECT line.dimensions->>$3, voucher.source_id
		FROM acc_voucher_lines line
		JOIN acc_vouchers voucher ON voucher.id=line.voucher_id
		WHERE voucher.book_id=$1 AND voucher.source_id=$2 AND line.subject_id=$4
	`, book.ID, created.DocumentID, DimensionFundAccount, debit.ID).Scan(&storedFundDimension, &storedSourceID); err != nil {
		t.Fatalf("read ACC fund account trace: %v", err)
	}
	if storedFundDimension != fund.ObjectID || storedSourceID != created.DocumentID {
		t.Fatalf("ACC fund account trace = dimension:%q source:%q", storedFundDimension, storedSourceID)
	}

	fundDeclarations := dcldomain.NewFundAccountService(pool, business, authorization.Func(nil), txevent.NewBus())
	fundV1, err := fundDeclarations.Get(t.Context(), dcldomain.FundAccountGetInput{
		ObjectID: fund.ObjectID, ApprovalEntryID: fund.ApprovalEntryID,
	}, trustedAccountingActor(t, "acc-posting-fund-v1-get"))
	if err != nil {
		t.Fatalf("get fund account V1: %v", err)
	}
	fundV2, err := fundDeclarations.Save(t.Context(), dcldomain.FundAccountSaveInput{
		ObjectID: fundV1.ObjectID, ApprovalEntryID: fundV1.Approval.ApprovalEntryID,
		ApprovalRevision: fundV1.Approval.Revision, Enabled: fundV1.Enabled,
		Data: dcldomain.FundAccountData{
			Name: fundV1.Data.Name + " V2", Currency: fundV1.Data.Currency,
			AccountName: fundV1.Data.AccountName, BankName: fundV1.Data.BankName,
			BankBranch: fundV1.Data.BankBranch, AccountNumber: fundV1.Data.AccountNumber,
			Remark: fundV1.Data.Remark, OperatingEntityID: fundV1.Data.OperatingEntityID,
		},
	}, trustedAccountingActor(t, "acc-posting-fund-v2-save"))
	if err != nil {
		t.Fatalf("save fund account V2: %v", err)
	}
	fundV2, err = fundDeclarations.Submit(t.Context(), dcldomain.FundAccountVersionInput{
		ObjectID: fundV2.ObjectID, ApprovalEntryID: fundV2.Approval.ApprovalEntryID,
		ApprovalRevision: fundV2.Approval.Revision,
	}, trustedAccountingActor(t, "acc-posting-fund-v2-submit"))
	if err != nil {
		t.Fatalf("submit fund account V2: %v", err)
	}
	fundV2, err = fundDeclarations.Approve(t.Context(), dcldomain.FundAccountVersionInput{
		ObjectID: fundV2.ObjectID, ApprovalEntryID: fundV2.Approval.ApprovalEntryID,
		ApprovalRevision: fundV2.Approval.Revision,
	}, trustedAccountingActor(t, "acc-posting-fund-v2-approve"))
	if err != nil {
		t.Fatalf("approve fund account V2: %v", err)
	}
	stableSnapshot, err := vouchers.Get(t.Context(), voudomain.EntityOtherIncome, voudomain.GetInput{DocumentID: created.DocumentID})
	if err != nil || stableSnapshot.Data.FundAccount == nil || stableSnapshot.Data.FundAccount.ApprovalEntryID != fund.ApprovalEntryID {
		t.Fatalf("historical VOU fund snapshot = %+v, err=%v", stableSnapshot.Data.FundAccount, err)
	}
	if err = pool.QueryRow(t.Context(), `
		SELECT line.dimensions->>$3, voucher.source_id
		FROM acc_voucher_lines line
		JOIN acc_vouchers voucher ON voucher.id=line.voucher_id
		WHERE voucher.book_id=$1 AND voucher.source_id=$2 AND line.subject_id=$4
	`, book.ID, created.DocumentID, DimensionFundAccount, debit.ID).Scan(&storedFundDimension, &storedSourceID); err != nil {
		t.Fatalf("read ACC fund trace after current switch: %v", err)
	}
	if storedFundDimension != fund.ObjectID || storedSourceID != created.DocumentID {
		t.Fatalf("ACC fund trace changed after current switch = dimension:%q source:%q", storedFundDimension, storedSourceID)
	}
	fund = voudomain.ReferenceInput{ObjectID: fundV2.ObjectID, ApprovalEntryID: fundV2.Approval.ApprovalEntryID}
	duplicateTx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin duplicate approval delivery: %v", err)
	}
	if err = accounting.HandleDocumentApproved(t.Context(), duplicateTx, approvedVOUEvent(approvedSnapshot)); err != nil {
		_ = duplicateTx.Rollback(t.Context())
		t.Fatalf("duplicate approval delivery: %v", err)
	}
	if err = duplicateTx.Commit(t.Context()); err != nil {
		t.Fatalf("commit duplicate approval delivery: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM acc_vouchers WHERE source_type='VOU' AND source_id=$1`, created.DocumentID).Scan(&remaining); err != nil || remaining != 1 {
		t.Fatalf("facts after duplicate approval = %d, err=%v", remaining, err)
	}
	unapproved, err := vouchers.Unapprove(t.Context(), voudomain.EntityOtherIncome, voudomain.ReverseInput{DocumentID: created.DocumentID, Revision: approved.Approval.Revision, Reason: "测试反批准"}, trustedAccountingActor(t, "acc-posting-vou-unapprove"))
	if err != nil {
		t.Fatalf("unapprove VOU with ACC deletion: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM acc_vouchers WHERE source_type='VOU' AND source_id=$1`, created.DocumentID).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("facts after unapproval = %d, err=%v", remaining, err)
	}
	duplicateTx, err = pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin duplicate unapproval delivery: %v", err)
	}
	if err = accounting.HandleDocumentUnapproved(t.Context(), duplicateTx, unapprovedVOUEvent(approvedSnapshot)); err != nil {
		_ = duplicateTx.Rollback(t.Context())
		t.Fatalf("duplicate unapproval delivery: %v", err)
	}
	if err = duplicateTx.Commit(t.Context()); err != nil {
		t.Fatalf("commit duplicate unapproval delivery: %v", err)
	}
	reopenedApproved, err := vouchers.Unsubmit(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{DocumentID: created.DocumentID, Revision: unapproved.Approval.Revision}, trustedAccountingActor(t, "acc-posting-vou-unsubmit"))
	if err != nil {
		t.Fatalf("unsubmit reversed VOU: %v", err)
	}
	if _, err = vouchers.Delete(t.Context(), voudomain.EntityOtherIncome, voudomain.DeleteInput{DocumentID: created.DocumentID, Revision: reopenedApproved.Approval.Revision, Reason: "测试清理"}, trustedAccountingActor(t, "acc-posting-vou-delete")); err != nil {
		t.Fatalf("delete reversed VOU: %v", err)
	}

	secondBook, err := accounting.CreateBook(t.Context(), CreateBookInput{Name: "缺失映射账簿", StartMonth: "2026-07", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty}, adminID)
	if err != nil {
		t.Fatalf("create second accounting book: %v", err)
	}
	createApprovedZeroOpening(t, accounting, secondBook)
	failed, err := vouchers.Create(t.Context(), voudomain.EntityOtherIncome, voudomain.CreateInput{Data: voudomain.DraftInput{BusinessDate: "2026-07-25", Currency: "CNY", SourceName: "缺失映射", FundAccount: &fund, Handler: &handler, Amount: "10.00"}}, trustedAccountingActor(t, "acc-posting-failure-create"))
	if err != nil {
		t.Fatalf("create failure VOU: %v", err)
	}
	failedChecked, err := vouchers.Submit(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{DocumentID: failed.DocumentID, Revision: failed.Approval.Revision}, trustedAccountingActor(t, "acc-posting-failure-submit"))
	if err != nil {
		t.Fatalf("check failure VOU: %v", err)
	}
	_, err = vouchers.Approve(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{DocumentID: failed.DocumentID, Revision: failedChecked.Approval.Revision}, trustedAccountingActor(t, "acc-posting-failure-approve"))
	var vouErr *voudomain.DomainError
	if !errors.As(err, &vouErr) || vouErr.Kind != voudomain.ErrorConflict || vouErr.Message != "approved accounting mapping is missing" {
		t.Fatalf("missing mapping approval error = %#v", err)
	}
	var status string
	if err = pool.QueryRow(t.Context(), `SELECT entry.status FROM vou_documents document JOIN approval_entries entry ON entry.id=document.approval_entry_id WHERE document.id=$1`, failed.DocumentID).Scan(&status); err != nil || status != voudomain.StatusPending {
		t.Fatalf("failed VOU state = %s, err=%v", status, err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM acc_vouchers WHERE source_type='VOU' AND source_id=$1`, failed.DocumentID).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("rolled back automatic facts = %d, err=%v", remaining, err)
	}
	reopened, err := vouchers.Unsubmit(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{DocumentID: failed.DocumentID, Revision: failedChecked.Approval.Revision}, trustedAccountingActor(t, "acc-posting-failure-unsubmit"))
	if err != nil {
		t.Fatalf("unsubmit failed VOU: %v", err)
	}
	if _, err = vouchers.Delete(t.Context(), voudomain.EntityOtherIncome, voudomain.DeleteInput{DocumentID: failed.DocumentID, Revision: reopened.Approval.Revision, Reason: "测试清理"}, trustedAccountingActor(t, "acc-posting-failure-delete")); err != nil {
		t.Fatalf("delete failed VOU: %v", err)
	}
}

func TestZZServiceAcceptanceApprovalPostsServiceRelationshipPayableAndReceivableIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	accounting := defaultIntegrationACCService(pool)
	book, err := accounting.CreateBook(t.Context(), CreateBookInput{
		Name: "服务验收自动记账", StartMonth: "2026-07", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty,
	}, adminID)
	if err != nil {
		t.Fatalf("create accounting book: %v", err)
	}
	expense, err := accounting.CreateSubject(t.Context(), CreateSubjectInput{
		BookID: book.ID, Code: "6601", Name: "服务费用", BalanceDirection: BalanceDirectionDebit,
		Enabled: true, RequiredDimensions: []string{}, SettlementPurpose: SettlementPurposeNone,
	}, adminID)
	if err != nil {
		t.Fatalf("create service expense subject: %v", err)
	}
	income, err := accounting.CreateSubject(t.Context(), CreateSubjectInput{
		BookID: book.ID, Code: "6051", Name: "服务收入", BalanceDirection: BalanceDirectionCredit,
		Enabled: true, RequiredDimensions: []string{}, SettlementPurpose: SettlementPurposeNone,
	}, adminID)
	if err != nil {
		t.Fatalf("create service income subject: %v", err)
	}
	receivable, err := accounting.CreateSubject(t.Context(), CreateSubjectInput{
		BookID: book.ID, Code: "122102", Name: "服务往来应收", BalanceDirection: BalanceDirectionDebit,
		Enabled: true, RequiredDimensions: []string{DimensionServiceRelationship}, SettlementPurpose: SettlementPurposeOther,
	}, adminID)
	if err != nil {
		t.Fatalf("create service receivable subject: %v", err)
	}
	payable, err := accounting.CreateSubject(t.Context(), CreateSubjectInput{
		BookID: book.ID, Code: "224102", Name: "服务往来应付", BalanceDirection: BalanceDirectionCredit,
		Enabled: true, RequiredDimensions: []string{DimensionServiceRelationship}, SettlementPurpose: SettlementPurposeOther,
	}, adminID)
	if err != nil {
		t.Fatalf("create service payable subject: %v", err)
	}
	createApprovedZeroOpening(t, accounting, book)
	payableTemplateID, receivableTemplateID := "service-acceptance-payable", "service-acceptance-receivable"
	mapping, err := accounting.CreateMapping(t.Context(), CreateMappingInput{
		BookID: book.ID, VouEntity: voudomain.EntityServiceAcceptance, DefaultResult: MappingResultUnpost,
		Definition: MappingDefinition{
			Rules: []MappingRule{
				{Conditions: []MappingCondition{{Field: "serviceAcceptance.settlementDirection", Operator: "EQ", Values: []string{"PAYABLE"}}}, Result: MappingResultPost, TemplateID: &payableTemplateID},
				{Conditions: []MappingCondition{{Field: "serviceAcceptance.settlementDirection", Operator: "EQ", Values: []string{"RECEIVABLE"}}}, Result: MappingResultPost, TemplateID: &receivableTemplateID},
			},
			Templates: []PostingTemplate{
				{ID: payableTemplateID, Lines: []PostingLineTemplate{
					{SubjectSource: "FIXED", SubjectValue: expense.ID, Direction: BalanceDirectionDebit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{}},
					{SubjectSource: "FIXED", SubjectValue: payable.ID, Direction: BalanceDirectionCredit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{DimensionServiceRelationship: "counterparty.objectId"}},
				}},
				{ID: receivableTemplateID, Lines: []PostingLineTemplate{
					{SubjectSource: "FIXED", SubjectValue: receivable.ID, Direction: BalanceDirectionDebit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{DimensionServiceRelationship: "counterparty.objectId"}},
					{SubjectSource: "FIXED", SubjectValue: income.ID, Direction: BalanceDirectionCredit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{}},
				}},
			},
		},
	}, integrationACCActor(t, adminID, "acc-service-acceptance-mapping-create"))
	if err != nil {
		t.Fatalf("create service acceptance mapping: %v", err)
	}
	approveIntegrationMapping(t, accounting, book.ID, voudomain.EntityServiceAcceptance, mapping)
	contractMapping, err := accounting.CreateMapping(t.Context(), CreateMappingInput{
		BookID: book.ID, VouEntity: voudomain.EntityServiceContract, DefaultResult: MappingResultUnpost,
		Definition: MappingDefinition{Rules: []MappingRule{}, Templates: []PostingTemplate{}},
	}, integrationACCActor(t, adminID, "acc-service-contract-mapping-create"))
	if err != nil {
		t.Fatalf("create service contract mapping: %v", err)
	}
	approveIntegrationMapping(t, accounting, book.ID, voudomain.EntityServiceContract, contractMapping)

	bus := txevent.NewBus()
	if err = accounting.RegisterSubscriptions(bus); err != nil {
		t.Fatalf("register accounting subscriptions: %v", err)
	}
	auxiliary := auxdomain.NewService(pool, authorization.Func(nil), bus)
	business := newAccountingIntegrationBOBService(pool, bus)
	parties := dcldomain.NewPartyService(pool, bobdomain.NewPartyCurrentWriter(pool), bobdomain.NewPartyCurrentReader(pool), bobdomain.NewPartyMergeEngine(pool), authorization.Func(nil), bus)
	relationships := dcldomain.NewRelationshipService(pool, business, parties, bobdomain.NewPartyCurrentReader(pool), authorization.Func(nil), bus)
	operating := createApprovedAccountingReference(t, business, bobdomain.EntityOperatingEntity, bobdomain.CreateDetailInput{Name: "服务验收经营主体"})
	employee := createApprovedAccountingEmployee(t, pool, business, bus, operating.ObjectID, "服务验收经办人", "service-acceptance-employee")
	var settlementID string
	if err = pool.QueryRow(t.Context(), `
		SELECT object.id
		FROM aux_objects object
		JOIN approval_entries entry ON entry.domain='aux' AND entry.entity=object.entity AND entry.subject_id=object.id AND entry.status='APPROVED'
		JOIN aux_version_payloads payload ON payload.approval_entry_id=entry.id
		WHERE object.entity='settlement-method' AND object.enabled AND payload.data->>'termCode'=$1
		ORDER BY entry.version_no DESC LIMIT 1
	`, bobdomain.SettlementTermMonthly30).Scan(&settlementID); err != nil {
		t.Fatalf("load monthly settlement method: %v", err)
	}
	serviceRelationship, err := relationships.CreateOtherUnit(t.Context(), dcldomain.OtherUnitCreateInput{
		NewParty:          &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: "服务验收往来单位"},
		OperatingEntityID: operating.ObjectID,
		Data:              dcldomain.OtherUnitData{SettlementMethodID: settlementID},
	}, trustedAccountingActor(t, "service-acceptance-other-unit-create"))
	if err != nil {
		t.Fatalf("create service relationship: %v", err)
	}
	party, err := parties.Get(t.Context(), dcldomain.PartyGetInput{PartyID: serviceRelationship.PartyID}, bobdomain.PartyRelationshipVisibility{}, trustedAccountingActor(t, "service-acceptance-other-unit-party-get"))
	if err != nil {
		t.Fatalf("get service relationship Party: %v", err)
	}
	if party.Approval.Status == approval.StatusDraft {
		pending, submitErr := parties.Submit(t.Context(), dcldomain.PartyVersionInput{PartyID: party.PartyID, ApprovalEntryID: party.Approval.ApprovalEntryID, ApprovalRevision: party.Approval.Revision}, trustedAccountingActor(t, "service-acceptance-other-unit-party-submit"))
		if submitErr != nil {
			t.Fatalf("submit service relationship Party: %v", submitErr)
		}
		party.Approval = pending.Approval
	}
	if party.Approval.Status == approval.StatusPending {
		if _, approveErr := parties.Approve(t.Context(), dcldomain.PartyVersionInput{PartyID: party.PartyID, ApprovalEntryID: party.Approval.ApprovalEntryID, ApprovalRevision: party.Approval.Revision}, trustedAccountingActor(t, "service-acceptance-other-unit-party-approve")); approveErr != nil {
			t.Fatalf("approve service relationship Party: %v", approveErr)
		}
	}
	submittedRelationship, err := relationships.SubmitOtherUnit(t.Context(), dcldomain.RelationshipVersionInput{
		ObjectID: serviceRelationship.ObjectID, ApprovalEntryID: serviceRelationship.Approval.ApprovalEntryID, ApprovalRevision: serviceRelationship.Approval.Revision,
	}, trustedAccountingActor(t, "service-acceptance-other-unit-submit"))
	if err != nil {
		t.Fatalf("submit service relationship: %v", err)
	}
	approvedRelationship, err := relationships.ApproveOtherUnit(t.Context(), dcldomain.RelationshipVersionInput{
		ObjectID: serviceRelationship.ObjectID, ApprovalEntryID: serviceRelationship.Approval.ApprovalEntryID, ApprovalRevision: submittedRelationship.Approval.Revision,
	}, trustedAccountingActor(t, "service-acceptance-other-unit-approve"))
	if err != nil {
		t.Fatalf("approve service relationship: %v", err)
	}
	vouchers, err := voudomain.NewService(pool, business, auxiliaryrefs.New(auxiliary), bus, voudomain.AttachmentOptions{Root: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)), voudomain.WithApprovalAuthorizer(authorization.Func(nil)))
	if err != nil {
		t.Fatalf("new VOU service: %v", err)
	}
	handler := &employee
	counterparty := &voudomain.ReferenceInput{ObjectID: approvedRelationship.ObjectID, ApprovalEntryID: approvedRelationship.Approval.ApprovalEntryID}
	contract, err := vouchers.Create(t.Context(), voudomain.EntityServiceContract, voudomain.CreateInput{Data: voudomain.DraftInput{
		BusinessDate: "2026-07-01", Currency: "CNY", CounterpartyType: bobdomain.EntityOtherUnit,
		Counterparty: counterparty, Handler: handler,
		ServiceContract: &voudomain.ServiceContractInput{Terms: "服务验收自动记账合同"},
	}}, trustedAccountingActor(t, "service-acceptance-contract-create"))
	if err != nil {
		t.Fatalf("create service contract: %v", err)
	}
	checkedContract, err := vouchers.Submit(t.Context(), voudomain.EntityServiceContract, voudomain.DocumentRevisionInput{DocumentID: contract.DocumentID, Revision: contract.Approval.Revision}, trustedAccountingActor(t, "service-acceptance-contract-submit"))
	if err != nil {
		t.Fatalf("check service contract: %v", err)
	}
	approvedContract, err := vouchers.Approve(t.Context(), voudomain.EntityServiceContract, voudomain.DocumentRevisionInput{DocumentID: checkedContract.DocumentID, Revision: checkedContract.Approval.Revision}, trustedAccountingActor(t, "service-acceptance-contract-approve"))
	if err != nil {
		t.Fatalf("approve service contract: %v", err)
	}

	approveAcceptance := func(direction, amount, requestPrefix string) voudomain.MutationResult {
		t.Helper()
		created, createErr := vouchers.Create(t.Context(), voudomain.EntityServiceAcceptance, voudomain.CreateInput{Data: voudomain.DraftInput{
			BusinessDate: "2026-07-10", Currency: "CNY", Amount: amount,
			ServiceAcceptance: &voudomain.ServiceAcceptanceInput{
				ContractDocumentID: approvedContract.DocumentID, ServiceDate: "2026-07-01", AcceptanceDate: "2026-07-10",
				SettlementDirection: direction, FulfillmentFact: "服务已履约", AcceptanceFact: "验收通过",
			},
		}}, trustedAccountingActor(t, requestPrefix+"-create"))
		if createErr != nil {
			t.Fatalf("create %s service acceptance: %v", direction, createErr)
		}
		checked, checkErr := vouchers.Submit(t.Context(), voudomain.EntityServiceAcceptance, voudomain.DocumentRevisionInput{DocumentID: created.DocumentID, Revision: created.Approval.Revision}, trustedAccountingActor(t, requestPrefix+"-submit"))
		if checkErr != nil {
			t.Fatalf("check %s service acceptance: %v", direction, checkErr)
		}
		approved, approveErr := vouchers.Approve(t.Context(), voudomain.EntityServiceAcceptance, voudomain.DocumentRevisionInput{DocumentID: checked.DocumentID, Revision: checked.Approval.Revision}, trustedAccountingActor(t, requestPrefix+"-approve"))
		if approveErr != nil {
			t.Fatalf("approve %s service acceptance with ACC posting: %v", direction, approveErr)
		}
		return approved
	}
	assertPosting := func(acceptance voudomain.MutationResult, debitSubjectID, creditSubjectID string, amountMinor int64, dimensionSubjectID string) {
		t.Helper()
		var voucherCount, lineCount int
		if err = pool.QueryRow(t.Context(), `
			SELECT count(DISTINCT voucher.id), count(line.id)
			FROM acc_vouchers voucher
			JOIN acc_voucher_lines line ON line.voucher_id=voucher.id
			WHERE voucher.book_id=$1 AND voucher.source_type='VOU' AND voucher.source_id=$2
		`, book.ID, acceptance.DocumentID).Scan(&voucherCount, &lineCount); err != nil || voucherCount != 1 || lineCount != 2 {
			t.Fatalf("automatic service acceptance facts = vouchers:%d lines:%d err=%v", voucherCount, lineCount, err)
		}
		var debitTotal, creditTotal int64
		if err = pool.QueryRow(t.Context(), `
			SELECT COALESCE(sum(line.debit_minor) FILTER (WHERE line.subject_id=$3), 0),
				COALESCE(sum(line.credit_minor) FILTER (WHERE line.subject_id=$4), 0)
			FROM acc_voucher_lines line
			JOIN acc_vouchers voucher ON voucher.id=line.voucher_id
			WHERE voucher.book_id=$1 AND voucher.source_id=$2
		`, book.ID, acceptance.DocumentID, debitSubjectID, creditSubjectID).Scan(&debitTotal, &creditTotal); err != nil || debitTotal != amountMinor || creditTotal != amountMinor {
			t.Fatalf("automatic service acceptance totals = %d/%d, want %d/%d, err=%v", debitTotal, creditTotal, amountMinor, amountMinor, err)
		}
		if dimensionSubjectID == "" {
			return
		}
		var relationshipID string
		var legacyPartyDimension bool
		if err = pool.QueryRow(t.Context(), `
			SELECT line.dimensions->>$3, line.dimensions ? 'PARTY'
			FROM acc_voucher_lines line
			JOIN acc_vouchers voucher ON voucher.id=line.voucher_id
			WHERE voucher.book_id=$1 AND voucher.source_id=$2 AND line.subject_id=$4
		`, book.ID, acceptance.DocumentID, DimensionServiceRelationship, dimensionSubjectID).Scan(&relationshipID, &legacyPartyDimension); err != nil || relationshipID != approvedRelationship.ObjectID || legacyPartyDimension {
			t.Fatalf("service relationship dimensions = relationship:%q legacyParty:%t want:%q err=%v", relationshipID, legacyPartyDimension, approvedRelationship.ObjectID, err)
		}
	}

	payableAcceptance := approveAcceptance("PAYABLE", "1200.00", "service-acceptance-payable")
	assertPosting(payableAcceptance, expense.ID, payable.ID, 120000, payable.ID)
	receivableAcceptance := approveAcceptance("RECEIVABLE", "300.00", "service-acceptance-receivable")
	assertPosting(receivableAcceptance, receivable.ID, income.ID, 30000, receivable.ID)
	for _, acceptance := range []voudomain.MutationResult{payableAcceptance, receivableAcceptance} {
		unapproved, unapproveErr := vouchers.Unapprove(t.Context(), voudomain.EntityServiceAcceptance, voudomain.ReverseInput{
			DocumentID: acceptance.DocumentID, Revision: acceptance.Approval.Revision, Reason: "测试清理",
		}, trustedAccountingActor(t, "service-acceptance-cleanup-unapprove-"+acceptance.DocumentID))
		if unapproveErr != nil {
			t.Fatalf("unapprove service acceptance during cleanup: %v", unapproveErr)
		}
		draft, unsubmitErr := vouchers.Unsubmit(t.Context(), voudomain.EntityServiceAcceptance, voudomain.DocumentRevisionInput{
			DocumentID: acceptance.DocumentID, Revision: unapproved.Approval.Revision,
		}, trustedAccountingActor(t, "service-acceptance-cleanup-unsubmit-"+acceptance.DocumentID))
		if unsubmitErr != nil {
			t.Fatalf("unsubmit service acceptance during cleanup: %v", unsubmitErr)
		}
		if _, deleteErr := vouchers.Delete(t.Context(), voudomain.EntityServiceAcceptance, voudomain.DeleteInput{
			DocumentID: acceptance.DocumentID, Revision: draft.Approval.Revision, Reason: "测试清理",
		}, trustedAccountingActor(t, "service-acceptance-cleanup-delete-"+acceptance.DocumentID)); deleteErr != nil {
			t.Fatalf("delete service acceptance during cleanup: %v", deleteErr)
		}
	}
	unapprovedContract, err := vouchers.Unapprove(t.Context(), voudomain.EntityServiceContract, voudomain.ReverseInput{
		DocumentID: approvedContract.DocumentID, Revision: approvedContract.Approval.Revision, Reason: "测试清理",
	}, trustedAccountingActor(t, "service-contract-cleanup-unapprove"))
	if err != nil {
		t.Fatalf("unapprove service contract during cleanup: %v", err)
	}
	draftContract, err := vouchers.Unsubmit(t.Context(), voudomain.EntityServiceContract, voudomain.DocumentRevisionInput{
		DocumentID: approvedContract.DocumentID, Revision: unapprovedContract.Approval.Revision,
	}, trustedAccountingActor(t, "service-contract-cleanup-unsubmit"))
	if err != nil {
		t.Fatalf("unsubmit service contract during cleanup: %v", err)
	}
	if _, err = vouchers.Delete(t.Context(), voudomain.EntityServiceContract, voudomain.DeleteInput{
		DocumentID: approvedContract.DocumentID, Revision: draftContract.Approval.Revision, Reason: "测试清理",
	}, trustedAccountingActor(t, "service-contract-cleanup-delete")); err != nil {
		t.Fatalf("delete service contract during cleanup: %v", err)
	}
}
