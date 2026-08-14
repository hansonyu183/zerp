//go:build integration

package previewseed

import (
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPreviewSeedCoverageIdempotenceAndTesterTakeoverIntegration(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	databaseName := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if databaseURL == "" || databaseName == "" {
		t.Fatal("TEST_DATABASE_URL and TEST_POSTGRES_DB are required")
	}
	if !strings.HasSuffix(databaseName, "_test") {
		t.Fatalf("TEST_POSTGRES_DB %q must end with _test", databaseName)
	}
	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect integration database: %v", err)
	}
	t.Cleanup(pool.Close)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if _, err = pool.Exec(t.Context(), `
		INSERT INTO app_users(
			id,username,display_name,password_hash,status,password_changed_at,created_by,updated_by
		) VALUES(
			'01JPREVIEWADMIN00000000001','preview-seed-test-admin','Preview Seed Test Admin',
			'test-only-unused-password-hash','ENABLED',now(),$1,$1
		) ON CONFLICT(id) DO NOTHING
	`, actorID); err != nil {
		t.Fatalf("seed preview accounting actor: %v", err)
	}
	seeder, err := New(pool, t.TempDir(), logger)
	if err != nil {
		t.Fatalf("new preview seeder: %v", err)
	}
	var setup Counts
	if err = seeder.seedAuxiliary(t.Context(), &setup); err != nil {
		t.Fatalf("seed legacy preview auxiliary data: %v", err)
	}
	if err = seeder.seedBusiness(t.Context(), &setup); err != nil {
		t.Fatalf("seed legacy preview business data: %v", err)
	}
	fund := seeder.voucherReference("fund-effective")
	employee := seeder.voucherReference("employee-effective")
	created, err := seeder.vouchers.Create(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.CreateInput{Data: voudomain.DraftInput{
		BusinessDate: "2026-07-12", Currency: "CNY", FundAccount: &fund, Employee: &employee,
		ExpenseLines: []voudomain.ExpenseLineInput{{Category: "交通", Description: "预览基线费用", Amount: "120.00"}},
		Remark:       "预览费用报销：已批准",
	}}, actorID, requestID("expense-approved", "create"))
	if err != nil {
		t.Fatalf("create legacy preview expense reimbursement: %v", err)
	}
	checked, err := seeder.vouchers.Check(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Revision,
	}, actorID, requestID("expense-approved", "check"))
	if err != nil {
		t.Fatalf("check legacy preview expense reimbursement: %v", err)
	}
	if _, err = seeder.vouchers.Approve(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.DocumentRevisionInput{
		DocumentID: checked.DocumentID, Revision: checked.Revision,
	}, actorID, requestID("expense-approved", "approve")); err != nil {
		t.Fatalf("approve legacy preview expense reimbursement: %v", err)
	}
	if _, err = seeder.Seed(t.Context()); err != nil {
		t.Fatalf("seed preview data: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `
		DELETE FROM vou_audit_events
		WHERE request_id=$1 AND event_type='CREATED'
	`, requestID("intermediary-calculation-draft", "create")); err != nil {
		t.Fatalf("simulate existing preview intermediary period: %v", err)
	}
	second, err := seeder.Seed(t.Context())
	if err != nil {
		t.Fatalf("repeat preview seed: %v", err)
	}
	if created := second.Auxiliary.Created + second.Business.Created +
		second.Workflows.Created + second.Vouchers.Created + second.Accounting.Created; created != 0 {
		t.Fatalf("repeat seed created %d rows: %+v", created, second)
	}
	if resumed := second.Auxiliary.Resumed + second.Business.Resumed +
		second.Workflows.Resumed + second.Vouchers.Resumed + second.Accounting.Resumed; resumed != 0 {
		t.Fatalf("repeat seed resumed %d rows: %+v", resumed, second)
	}
	assertDistinctEntities(t, pool, "aux_objects", 8)
	var businessEntities int
	if err = pool.QueryRow(t.Context(), `
		SELECT count(DISTINCT o.entity)
		FROM bob_objects o
		WHERE EXISTS(
			SELECT 1 FROM bob_audit_events a
			WHERE a.object_id=o.id AND a.request_id LIKE $1
		)
	`, seedPrefix+"%").Scan(&businessEntities); err != nil {
		t.Fatalf("count preview BOB entities: %v", err)
	}
	if businessEntities != 9 {
		t.Fatalf("preview BOB distinct entities = %d, want 9", businessEntities)
	}
	assertDistinctEntities(t, pool, "vou_documents", 34)
	var legacyWorkflowTypes, expenseWorkflowInstances int
	if err = pool.QueryRow(t.Context(), `
		SELECT
			(SELECT count(DISTINCT process_type) FROM wfl_process_instances),
			(SELECT count(*) FROM wfl_definition_instances instance
			 JOIN wfl_process_definitions definition ON definition.id=instance.definition_id
			 WHERE definition.code='expense-payment')
	`).Scan(&legacyWorkflowTypes, &expenseWorkflowInstances); err != nil {
		t.Fatalf("count workflow types: %v", err)
	}
	if legacyWorkflowTypes != 2 || expenseWorkflowInstances != 1 {
		t.Fatalf("workflow coverage legacyTypes=%d expenseInstances=%d", legacyWorkflowTypes, expenseWorkflowInstances)
	}
	assertAccountingAndReportFacts(t, pool)
	var receiptID string
	if err = pool.QueryRow(t.Context(), `
		SELECT document_id
		FROM vou_audit_events
		WHERE request_id=$1 AND event_type='CREATED'
	`, requestID("receipt-approved", "create")).Scan(&receiptID); err != nil {
		t.Fatalf("find approved receipt: %v", err)
	}
	receipt, err := seeder.vouchers.Get(
		t.Context(), voudomain.EntitySalesReceipt, voudomain.GetInput{DocumentID: receiptID},
	)
	if err != nil {
		t.Fatalf("get approved receipt: %v", err)
	}
	if _, err = seeder.vouchers.Unapprove(
		t.Context(),
		voudomain.EntitySalesReceipt,
		voudomain.ReverseInput{
			DocumentID: receipt.DocumentID, Revision: receipt.Revision, Reason: "测试人员接管",
		},
		actorID,
		"tester-unapprove-preview-receipt",
	); err != nil {
		t.Fatalf("tester unapprove receipt: %v", err)
	}
	if _, err = seeder.Seed(t.Context()); err != nil {
		t.Fatalf("repeat seed after tester takeover: %v", err)
	}
	receipt, err = seeder.vouchers.Get(
		t.Context(), voudomain.EntitySalesReceipt, voudomain.GetInput{DocumentID: receiptID},
	)
	if err != nil {
		t.Fatalf("get tester-owned receipt: %v", err)
	}
	if receipt.Status != voudomain.StatusChecked {
		t.Fatalf("tester-owned receipt status = %s, want CHECKED", receipt.Status)
	}
}

func assertAccountingAndReportFacts(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	var books, approvedOpenings, mappings, postedLines int
	if err := pool.QueryRow(t.Context(), `
		SELECT
			(SELECT count(*) FROM acc_books WHERE description=$1),
			(SELECT count(*) FROM acc_openings opening JOIN acc_books book ON book.id=opening.book_id WHERE book.description=$1 AND opening.state='APPROVED'),
			(SELECT count(*) FROM acc_mapping_versions mapping JOIN acc_books book ON book.id=mapping.book_id WHERE book.description=$1 AND mapping.state='APPROVED'),
			(SELECT count(*) FROM acc_voucher_lines line JOIN acc_vouchers voucher ON voucher.id=line.voucher_id WHERE voucher.source_entity='other-income')
	`, previewAccountingBookDescription).Scan(&books, &approvedOpenings, &mappings, &postedLines); err != nil {
		t.Fatalf("read preview accounting facts: %v", err)
	}
	if books != 1 || approvedOpenings != 1 || mappings != len(previewVouEntities) || postedLines < 2 {
		t.Fatalf("accounting coverage books=%d openings=%d mappings=%d postedLines=%d", books, approvedOpenings, mappings, postedLines)
	}
	var reports, reportRows int
	if err := pool.QueryRow(t.Context(), `
		SELECT
			(SELECT count(*) FROM rpt_definitions WHERE current_version_id IS NOT NULL AND enabled),
			(SELECT count(*) FROM acc_voucher_lines)
	`).Scan(&reports, &reportRows); err != nil {
		t.Fatalf("read preview report facts: %v", err)
	}
	if reports < 8 || reportRows < 2 {
		t.Fatalf("report coverage definitions=%d facts=%d", reports, reportRows)
	}
}

func assertDistinctEntities(
	t *testing.T,
	pool *pgxpool.Pool,
	table string,
	want int,
) {
	t.Helper()
	var count int
	if err := pool.QueryRow(t.Context(), "SELECT count(DISTINCT entity) FROM "+table).Scan(&count); err != nil {
		t.Fatalf("count %s entities: %v", table, err)
	}
	if count != want {
		t.Fatalf("%s distinct entities = %d, want %d", table, count, want)
	}
}
