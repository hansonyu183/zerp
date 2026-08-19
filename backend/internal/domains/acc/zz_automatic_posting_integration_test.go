//go:build integration

package acc

import (
	"errors"
	"io"
	"log/slog"
	"testing"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
)

func createApprovedAccountingReference(t *testing.T, service *bobdomain.Service, entity string, data bobdomain.CreateDetailInput) voudomain.ReferenceInput {
	t.Helper()
	created, err := service.Create(t.Context(), entity, bobdomain.CreateInput{Data: data}, adminID, "acc-posting-reference-create")
	if err != nil {
		t.Fatalf("create %s reference: %v", entity, err)
	}
	submitted, err := service.Submit(t.Context(), entity, bobdomain.VersionRevisionInput{ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision}, adminID, "acc-posting-reference-submit")
	if err != nil {
		t.Fatalf("submit %s reference: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, bobdomain.ReviewInput{ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision}, operatorID, "acc-posting-reference-approve")
	if err != nil {
		t.Fatalf("approve %s reference: %v", entity, err)
	}
	return voudomain.ReferenceInput{ObjectID: approved.ObjectID, VersionID: approved.VersionID}
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
	business := bobdomain.NewService(pool)
	handler := createApprovedAccountingReference(t, business, bobdomain.EntityEmployee, bobdomain.CreateDetailInput{Name: "自动记账经办人"})
	operating := createApprovedAccountingReference(t, business, bobdomain.EntityOperatingEntity, bobdomain.CreateDetailInput{Name: "自动记账经营主体"})
	fund := createApprovedAccountingReference(t, business, bobdomain.EntityFundAccount, bobdomain.CreateDetailInput{Name: "自动记账账户", Currency: "CNY", OperatingEntityID: operating.ObjectID})
	vouchers, err := voudomain.NewService(pool, business, auxiliaryrefs.New(auxdomain.NewService(pool)), bus, voudomain.AttachmentOptions{Root: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
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
