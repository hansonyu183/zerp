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
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
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

func createApprovedAccountingReference(t *testing.T, service *bobdomain.Service, entity string, data bobdomain.CreateDetailInput) voudomain.ReferenceInput {
	t.Helper()
	created, err := service.Create(t.Context(), entity, bobdomain.CreateInput{Data: data}, trustedAccountingActor(t, "acc-posting-reference-create"))
	if err != nil {
		t.Fatalf("create %s reference: %v", entity, err)
	}
	submitted, err := service.Submit(t.Context(), entity, bobdomain.VersionRevisionInput{ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: created.Approval.Revision}, trustedAccountingActor(t, "acc-posting-reference-submit"))
	if err != nil {
		t.Fatalf("submit %s reference: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, bobdomain.ReviewInput{ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: submitted.Approval.Revision}, trustedAccountingActor(t, "acc-posting-reference-approve"))
	if err != nil {
		t.Fatalf("approve %s reference: %v", entity, err)
	}
	return voudomain.ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID}
}

func createApprovedZeroOpening(t *testing.T, service *Service, book BookView) {
	t.Helper()
	opening, err := service.ApproveOpening(t.Context(), book.ID, 0, adminID)
	if err != nil || opening.State != OpeningStateApproved {
		t.Fatalf("approve zero opening for %s: %+v, %v", book.Code, opening, err)
	}
}

func TestZZAutomaticPostingUsesVOUEventSnapshotAndUnapprovalDeletesFactsIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	accounting := NewService(pool)
	book, err := accounting.CreateBook(t.Context(), CreateBookInput{Name: "自动记账", StartMonth: "2026-07", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty}, adminID)
	if err != nil {
		t.Fatalf("create accounting book: %v", err)
	}
	debit, err := accounting.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "1002", Name: "银行存款", BalanceDirection: BalanceDirectionDebit, Enabled: true, RequiredDimensions: []string{}, SettlementPurpose: SettlementPurposeNone}, adminID)
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
			{SubjectSource: "FIXED", SubjectValue: debit.ID, Direction: BalanceDirectionDebit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{}},
			{SubjectSource: "FIXED", SubjectValue: credit.ID, Direction: BalanceDirectionCredit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{}},
		}}}},
	}, adminID)
	if err != nil {
		t.Fatalf("create accounting mapping: %v", err)
	}
	if _, err = accounting.ApproveMapping(t.Context(), book.ID, mapping.ID, mapping.Revision, adminID); err != nil {
		t.Fatalf("approve accounting mapping: %v", err)
	}

	bus := txevent.NewBus()
	if err = accounting.RegisterSubscriptions(bus); err != nil {
		t.Fatalf("register accounting subscriptions: %v", err)
	}
	auxiliary := auxdomain.NewService(pool, authorization.Func(nil), bus)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary), authorization.Func(nil), bus)
	operating := createApprovedAccountingReference(t, business, bobdomain.EntityOperatingEntity, bobdomain.CreateDetailInput{Name: "自动记账经营主体"})
	employment, err := business.EmploymentCreate(t.Context(), bobdomain.EmploymentCreateInput{
		NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindPerson, LegalName: "自动记账经办人"},
		Data:     bobdomain.CreateDetailInput{OperatingEntityID: operating.ObjectID},
	}, trustedAccountingActor(t, "acc-posting-employee-create"), true)
	if err != nil {
		t.Fatalf("create employee reference: %v", err)
	}
	submittedEmployment, err := business.Submit(t.Context(), bobdomain.EntityEmployee, bobdomain.VersionRevisionInput{
		ObjectID: employment.ObjectID, ApprovalEntryID: employment.Approval.ApprovalEntryID, ApprovalRevision: employment.Approval.Revision,
	}, trustedAccountingActor(t, "acc-posting-employee-submit"))
	if err != nil {
		t.Fatalf("submit employee reference: %v", err)
	}
	approvedEmployment, err := business.Approve(t.Context(), bobdomain.EntityEmployee, bobdomain.ReviewInput{
		ObjectID: employment.ObjectID, ApprovalEntryID: employment.Approval.ApprovalEntryID, ApprovalRevision: submittedEmployment.Approval.Revision,
	}, trustedAccountingActor(t, "acc-posting-employee-approve"))
	if err != nil {
		t.Fatalf("approve employee reference: %v", err)
	}
	handler := voudomain.ReferenceInput{ObjectID: approvedEmployment.ObjectID, ApprovalEntryID: approvedEmployment.Approval.ApprovalEntryID}
	fund := createApprovedAccountingReference(t, business, bobdomain.EntityFundAccount, bobdomain.CreateDetailInput{Name: "自动记账账户", Currency: "CNY", OperatingEntityID: operating.ObjectID})
	vouchers, err := voudomain.NewService(pool, business, auxiliaryrefs.New(auxiliary), bus, voudomain.AttachmentOptions{Root: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("new VOU service: %v", err)
	}
	created, err := vouchers.Create(t.Context(), voudomain.EntityOtherIncome, voudomain.CreateInput{Data: voudomain.DraftInput{BusinessDate: "2026-07-24", Currency: "CNY", SourceName: "废料收入", FundAccount: &fund, Handler: &handler, Amount: "60.00"}}, adminID, "acc-posting-vou-create")
	if err != nil {
		t.Fatalf("create VOU: %v", err)
	}
	checked, err := vouchers.Check(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{DocumentID: created.DocumentID, Revision: created.Revision}, adminID, "acc-posting-vou-check")
	if err != nil {
		t.Fatalf("check VOU: %v", err)
	}
	approved, err := vouchers.Approve(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{DocumentID: created.DocumentID, Revision: checked.Revision}, adminID, "acc-posting-vou-approve")
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
	if vouchersCount != 1 || linesCount != 2 || sourceEntity != voudomain.EntityOtherIncome || sourceDocumentNo == "" || sourceRevision != approved.Revision {
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
	duplicateTx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin duplicate approval delivery: %v", err)
	}
	if err = accounting.HandleDocumentApproved(t.Context(), duplicateTx, voudomain.DocumentApprovedEvent{
		Entity: voudomain.EntityOtherIncome, DocumentID: created.DocumentID, DocumentNo: approved.DocumentNo,
		Revision: approved.Revision, ActorID: adminID, RequestID: "acc-posting-duplicate-approve", Snapshot: approvedSnapshot,
	}); err != nil {
		_ = duplicateTx.Rollback(t.Context())
		t.Fatalf("duplicate approval delivery: %v", err)
	}
	if err = duplicateTx.Commit(t.Context()); err != nil {
		t.Fatalf("commit duplicate approval delivery: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM acc_vouchers WHERE source_type='VOU' AND source_id=$1`, created.DocumentID).Scan(&remaining); err != nil || remaining != 1 {
		t.Fatalf("facts after duplicate approval = %d, err=%v", remaining, err)
	}
	unapproved, err := vouchers.Unapprove(t.Context(), voudomain.EntityOtherIncome, voudomain.ReverseInput{DocumentID: created.DocumentID, Revision: approved.Revision, Reason: "测试反批准"}, adminID, "acc-posting-vou-unapprove")
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
	if err = accounting.HandleDocumentUnapproved(t.Context(), duplicateTx, voudomain.DocumentUnapprovedEvent{
		Entity: voudomain.EntityOtherIncome, DocumentID: created.DocumentID, DocumentNo: approved.DocumentNo,
		Revision: approved.Revision + 1, ActorID: adminID, RequestID: "acc-posting-duplicate-unapprove", Reason: "重复投递", Snapshot: approvedSnapshot,
	}); err != nil {
		_ = duplicateTx.Rollback(t.Context())
		t.Fatalf("duplicate unapproval delivery: %v", err)
	}
	if err = duplicateTx.Commit(t.Context()); err != nil {
		t.Fatalf("commit duplicate unapproval delivery: %v", err)
	}
	reopenedApproved, err := vouchers.Uncheck(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{DocumentID: created.DocumentID, Revision: unapproved.Revision}, adminID, "acc-posting-vou-uncheck")
	if err != nil {
		t.Fatalf("uncheck reversed VOU: %v", err)
	}
	if _, err = vouchers.Delete(t.Context(), voudomain.EntityOtherIncome, voudomain.DeleteInput{DocumentID: created.DocumentID, Revision: reopenedApproved.Revision, Reason: "测试清理"}, adminID, "acc-posting-vou-delete"); err != nil {
		t.Fatalf("delete reversed VOU: %v", err)
	}

	secondBook, err := accounting.CreateBook(t.Context(), CreateBookInput{Name: "缺失映射账簿", StartMonth: "2026-07", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty}, adminID)
	if err != nil {
		t.Fatalf("create second accounting book: %v", err)
	}
	createApprovedZeroOpening(t, accounting, secondBook)
	failed, err := vouchers.Create(t.Context(), voudomain.EntityOtherIncome, voudomain.CreateInput{Data: voudomain.DraftInput{BusinessDate: "2026-07-25", Currency: "CNY", SourceName: "缺失映射", FundAccount: &fund, Handler: &handler, Amount: "10.00"}}, adminID, "acc-posting-failure-create")
	if err != nil {
		t.Fatalf("create failure VOU: %v", err)
	}
	failedChecked, err := vouchers.Check(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{DocumentID: failed.DocumentID, Revision: failed.Revision}, adminID, "acc-posting-failure-check")
	if err != nil {
		t.Fatalf("check failure VOU: %v", err)
	}
	_, err = vouchers.Approve(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{DocumentID: failed.DocumentID, Revision: failedChecked.Revision}, adminID, "acc-posting-failure-approve")
	var vouErr *voudomain.DomainError
	if !errors.As(err, &vouErr) || vouErr.Kind != voudomain.ErrorConflict || vouErr.Message != "approved accounting mapping is missing" {
		t.Fatalf("missing mapping approval error = %#v", err)
	}
	var status string
	if err = pool.QueryRow(t.Context(), `SELECT status FROM vou_documents WHERE id=$1`, failed.DocumentID).Scan(&status); err != nil || status != voudomain.StatusChecked {
		t.Fatalf("failed VOU state = %s, err=%v", status, err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM acc_vouchers WHERE source_type='VOU' AND source_id=$1`, failed.DocumentID).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("rolled back automatic facts = %d, err=%v", remaining, err)
	}
	reopened, err := vouchers.Uncheck(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{DocumentID: failed.DocumentID, Revision: failedChecked.Revision}, adminID, "acc-posting-failure-uncheck")
	if err != nil {
		t.Fatalf("uncheck failed VOU: %v", err)
	}
	if _, err = vouchers.Delete(t.Context(), voudomain.EntityOtherIncome, voudomain.DeleteInput{DocumentID: failed.DocumentID, Revision: reopened.Revision, Reason: "测试清理"}, adminID, "acc-posting-failure-delete"); err != nil {
		t.Fatalf("delete failed VOU: %v", err)
	}
}

func TestZZServiceAcceptanceApprovalPostsServiceRelationshipPayableAndReceivableIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	accounting := NewService(pool)
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
	}, adminID)
	if err != nil {
		t.Fatalf("create service acceptance mapping: %v", err)
	}
	if _, err = accounting.ApproveMapping(t.Context(), book.ID, mapping.ID, mapping.Revision, adminID); err != nil {
		t.Fatalf("approve service acceptance mapping: %v", err)
	}
	contractMapping, err := accounting.CreateMapping(t.Context(), CreateMappingInput{
		BookID: book.ID, VouEntity: voudomain.EntityServiceContract, DefaultResult: MappingResultUnpost,
		Definition: MappingDefinition{Rules: []MappingRule{}, Templates: []PostingTemplate{}},
	}, adminID)
	if err != nil {
		t.Fatalf("create service contract mapping: %v", err)
	}
	if _, err = accounting.ApproveMapping(t.Context(), book.ID, contractMapping.ID, contractMapping.Revision, adminID); err != nil {
		t.Fatalf("approve service contract mapping: %v", err)
	}

	bus := txevent.NewBus()
	if err = accounting.RegisterSubscriptions(bus); err != nil {
		t.Fatalf("register accounting subscriptions: %v", err)
	}
	auxiliary := auxdomain.NewService(pool, authorization.Func(nil), bus)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary), authorization.Func(nil), bus)
	operating := createApprovedAccountingReference(t, business, bobdomain.EntityOperatingEntity, bobdomain.CreateDetailInput{Name: "服务验收经营主体"})
	employment, err := business.EmploymentCreate(t.Context(), bobdomain.EmploymentCreateInput{
		NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindPerson, LegalName: "服务验收经办人"},
		Data:     bobdomain.CreateDetailInput{OperatingEntityID: operating.ObjectID},
	}, trustedAccountingActor(t, "service-acceptance-employee-create"), true)
	if err != nil {
		t.Fatalf("create employee reference: %v", err)
	}
	submittedEmployment, err := business.Submit(t.Context(), bobdomain.EntityEmployee, bobdomain.VersionRevisionInput{
		ObjectID: employment.ObjectID, ApprovalEntryID: employment.Approval.ApprovalEntryID, ApprovalRevision: employment.Approval.Revision,
	}, trustedAccountingActor(t, "service-acceptance-employee-submit"))
	if err != nil {
		t.Fatalf("submit employee reference: %v", err)
	}
	approvedEmployment, err := business.Approve(t.Context(), bobdomain.EntityEmployee, bobdomain.ReviewInput{
		ObjectID: employment.ObjectID, ApprovalEntryID: employment.Approval.ApprovalEntryID, ApprovalRevision: submittedEmployment.Approval.Revision,
	}, trustedAccountingActor(t, "service-acceptance-employee-approve"))
	if err != nil {
		t.Fatalf("approve employee reference: %v", err)
	}
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
	serviceRelationship, err := business.OtherUnitCreate(t.Context(), bobdomain.OtherUnitCreateInput{
		NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: "服务验收往来单位"},
		Data:     bobdomain.OtherUnitData{OperatingEntityID: operating.ObjectID, SettlementMethodID: settlementID},
	}, trustedAccountingActor(t, "service-acceptance-other-unit-create"), true)
	if err != nil {
		t.Fatalf("create service relationship: %v", err)
	}
	submittedRelationship, err := business.Submit(t.Context(), bobdomain.EntityOtherUnit, bobdomain.VersionRevisionInput{
		ObjectID: serviceRelationship.ObjectID, ApprovalEntryID: serviceRelationship.Approval.ApprovalEntryID, ApprovalRevision: serviceRelationship.Approval.Revision,
	}, trustedAccountingActor(t, "service-acceptance-other-unit-submit"))
	if err != nil {
		t.Fatalf("submit service relationship: %v", err)
	}
	approvedRelationship, err := business.Approve(t.Context(), bobdomain.EntityOtherUnit, bobdomain.ReviewInput{
		ObjectID: serviceRelationship.ObjectID, ApprovalEntryID: serviceRelationship.Approval.ApprovalEntryID, ApprovalRevision: submittedRelationship.Approval.Revision,
	}, trustedAccountingActor(t, "service-acceptance-other-unit-approve"))
	if err != nil {
		t.Fatalf("approve service relationship: %v", err)
	}
	vouchers, err := voudomain.NewService(pool, business, auxiliaryrefs.New(auxiliary), bus, voudomain.AttachmentOptions{Root: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("new VOU service: %v", err)
	}
	handler := &voudomain.ReferenceInput{ObjectID: approvedEmployment.ObjectID, ApprovalEntryID: approvedEmployment.Approval.ApprovalEntryID}
	counterparty := &voudomain.ReferenceInput{ObjectID: approvedRelationship.ObjectID, ApprovalEntryID: approvedRelationship.Approval.ApprovalEntryID}
	contract, err := vouchers.Create(t.Context(), voudomain.EntityServiceContract, voudomain.CreateInput{Data: voudomain.DraftInput{
		BusinessDate: "2026-07-01", Currency: "CNY", CounterpartyType: bobdomain.EntityOtherUnit,
		Counterparty: counterparty, Handler: handler,
		ServiceContract: &voudomain.ServiceContractInput{Terms: "服务验收自动记账合同"},
	}}, adminID, "service-acceptance-contract-create")
	if err != nil {
		t.Fatalf("create service contract: %v", err)
	}
	checkedContract, err := vouchers.Check(t.Context(), voudomain.EntityServiceContract, voudomain.DocumentRevisionInput{DocumentID: contract.DocumentID, Revision: contract.Revision}, adminID, "service-acceptance-contract-check")
	if err != nil {
		t.Fatalf("check service contract: %v", err)
	}
	approvedContract, err := vouchers.Approve(t.Context(), voudomain.EntityServiceContract, voudomain.DocumentRevisionInput{DocumentID: checkedContract.DocumentID, Revision: checkedContract.Revision}, adminID, "service-acceptance-contract-approve")
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
		}}, adminID, requestPrefix+"-create")
		if createErr != nil {
			t.Fatalf("create %s service acceptance: %v", direction, createErr)
		}
		checked, checkErr := vouchers.Check(t.Context(), voudomain.EntityServiceAcceptance, voudomain.DocumentRevisionInput{DocumentID: created.DocumentID, Revision: created.Revision}, adminID, requestPrefix+"-check")
		if checkErr != nil {
			t.Fatalf("check %s service acceptance: %v", direction, checkErr)
		}
		approved, approveErr := vouchers.Approve(t.Context(), voudomain.EntityServiceAcceptance, voudomain.DocumentRevisionInput{DocumentID: checked.DocumentID, Revision: checked.Revision}, adminID, requestPrefix+"-approve")
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
			DocumentID: acceptance.DocumentID, Revision: acceptance.Revision, Reason: "测试清理",
		}, adminID, "service-acceptance-cleanup-unapprove-"+acceptance.DocumentID)
		if unapproveErr != nil {
			t.Fatalf("unapprove service acceptance during cleanup: %v", unapproveErr)
		}
		draft, uncheckErr := vouchers.Uncheck(t.Context(), voudomain.EntityServiceAcceptance, voudomain.DocumentRevisionInput{
			DocumentID: acceptance.DocumentID, Revision: unapproved.Revision,
		}, adminID, "service-acceptance-cleanup-uncheck-"+acceptance.DocumentID)
		if uncheckErr != nil {
			t.Fatalf("uncheck service acceptance during cleanup: %v", uncheckErr)
		}
		if _, deleteErr := vouchers.Delete(t.Context(), voudomain.EntityServiceAcceptance, voudomain.DeleteInput{
			DocumentID: acceptance.DocumentID, Revision: draft.Revision, Reason: "测试清理",
		}, adminID, "service-acceptance-cleanup-delete-"+acceptance.DocumentID); deleteErr != nil {
			t.Fatalf("delete service acceptance during cleanup: %v", deleteErr)
		}
	}
	unapprovedContract, err := vouchers.Unapprove(t.Context(), voudomain.EntityServiceContract, voudomain.ReverseInput{
		DocumentID: approvedContract.DocumentID, Revision: approvedContract.Revision, Reason: "测试清理",
	}, adminID, "service-contract-cleanup-unapprove")
	if err != nil {
		t.Fatalf("unapprove service contract during cleanup: %v", err)
	}
	draftContract, err := vouchers.Uncheck(t.Context(), voudomain.EntityServiceContract, voudomain.DocumentRevisionInput{
		DocumentID: approvedContract.DocumentID, Revision: unapprovedContract.Revision,
	}, adminID, "service-contract-cleanup-uncheck")
	if err != nil {
		t.Fatalf("uncheck service contract during cleanup: %v", err)
	}
	if _, err = vouchers.Delete(t.Context(), voudomain.EntityServiceContract, voudomain.DeleteInput{
		DocumentID: approvedContract.DocumentID, Revision: draftContract.Revision, Reason: "测试清理",
	}, adminID, "service-contract-cleanup-delete"); err != nil {
		t.Fatalf("delete service contract during cleanup: %v", err)
	}
}
