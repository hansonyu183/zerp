//go:build integration

package testseed

import (
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/config"
	appdomain "github.com/hansonyu183/zerp/backend/internal/domains/app"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSeedCoverageIdempotenceAndTesterTakeoverIntegration(t *testing.T) {
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
	attachmentRoot := t.TempDir()
	seeder, err := New(pool, config.Config{
		Environment: config.EnvironmentTest, PasswordMinLength: 12,
		AttachmentStorageRoot: attachmentRoot,
		SessionIdleTimeout:    30 * time.Minute, SessionAbsoluteTimeout: 12 * time.Hour,
		SigninLockThreshold: 5, SigninLockDuration: 15 * time.Minute,
	}, AccountSeed{
		AdminUsername: "test-admin", AdminDisplayName: "测试管理员", AdminPassword: "Admin-password-1!",
		UserUsername: "test-user", UserDisplayName: "测试用户", UserPassword: "User-password-1!",
	}, attachmentRoot, logger)
	if err != nil {
		t.Fatalf("new test seeder: %v", err)
	}
	if _, err = seeder.app.BootstrapAdmin(
		t.Context(), "existing-admin", "Existing Administrator", "Existing-password-1!",
	); err != nil {
		t.Fatalf("bootstrap existing administrator: %v", err)
	}
	var setup Counts
	if err = seeder.seedAuxiliary(t.Context(), &setup); err != nil {
		t.Fatalf("seed legacy test auxiliary data: %v", err)
	}
	if err = seeder.seedBusiness(t.Context(), &setup); err != nil {
		t.Fatalf("seed legacy test business data: %v", err)
	}
	fund := seeder.voucherReference("fund-effective")
	employee := seeder.voucherReference("employee-effective")
	created, err := seeder.vouchers.Create(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.CreateInput{Data: voudomain.DraftInput{
		BusinessDate: "2026-07-12", Currency: "CNY", FundAccount: &fund, Employee: &employee,
		ExpenseLines: []voudomain.ExpenseLineInput{{Category: "交通", Description: "测试基线费用", Amount: "120.00"}},
		Remark:       "测试费用报销：已批准",
	}}, mustApprovalActor(requestID("expense-approved", "create")))
	if err != nil {
		t.Fatalf("create legacy test expense reimbursement: %v", err)
	}
	checked, err := seeder.vouchers.Submit(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Approval.Revision,
	}, mustApprovalActor(requestID("expense-approved", "check")))
	if err != nil {
		t.Fatalf("check legacy test expense reimbursement: %v", err)
	}
	if _, err = seeder.vouchers.Approve(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.DocumentRevisionInput{
		DocumentID: checked.DocumentID, Revision: checked.Approval.Revision,
	}, mustApprovalActor(requestID("expense-approved", "approve"))); err != nil {
		t.Fatalf("approve legacy test expense reimbursement: %v", err)
	}
	first, err := seeder.Seed(t.Context())
	if err != nil {
		t.Fatalf("seed test data: %v", err)
	}
	if first.Accounts.Created != 2 {
		t.Fatalf("first seed accounts = %+v, want two created", first.Accounts)
	}
	var fundApprovalEntryID string
	if err = pool.QueryRow(t.Context(), `
		SELECT entry.id
		FROM approval_events event
		JOIN approval_entries entry ON entry.id=event.entry_id
		WHERE event.request_id=$1 AND event.action='CREATED'
		  AND entry.domain='dcl' AND entry.entity='fund-account'
	`, requestID("fund-effective", "create")).Scan(&fundApprovalEntryID); err != nil {
		t.Fatalf("find DCL fund-account seed approval entry: %v", err)
	}
	var fundSnapshotName string
	if err = pool.QueryRow(t.Context(), `
		SELECT name FROM dcl_fund_account_versions WHERE approval_entry_id=$1
	`, fundApprovalEntryID).Scan(&fundSnapshotName); err != nil || fundSnapshotName != "人民币基本账户（测试）" {
		t.Fatalf("DCL fund-account seed snapshot name=%q err=%v", fundSnapshotName, err)
	}
	for _, account := range []struct{ username, password string }{
		{"test-admin", "Admin-password-1!"},
		{"test-user", "User-password-1!"},
	} {
		signin, signinErr := seeder.app.Signin(t.Context(), account.username, account.password, "verify-test-account")
		if signinErr != nil {
			t.Fatalf("sign in %s: %v", account.username, signinErr)
		}
		if signin.Data.PasswordChangeRequired || len(signin.Data.Permissions) == 0 {
			t.Fatalf("test account %s is not immediately usable", account.username)
		}
	}
	userSignin, err := seeder.app.Signin(t.Context(), "test-user", "User-password-1!", "change-test-user-password")
	if err != nil {
		t.Fatalf("sign in test user before password change: %v", err)
	}
	principal, err := seeder.app.AuthenticateSession(
		t.Context(), userSignin.SessionToken, userSignin.Data.CSRFToken,
		"/app/user/change-password", "authorize-test-user-password-change",
	)
	if err != nil {
		t.Fatalf("authorize test user password change: %v", err)
	}
	if err = seeder.app.ChangePassword(t.Context(), principal, appdomain.ChangePasswordInput{
		CurrentPassword: "User-password-1!", NewPassword: "Changed-password-2!",
	}, "change-test-user-password"); err != nil {
		t.Fatalf("change test user password: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `
		DELETE FROM approval_events
		WHERE domain='vou' AND request_id=$1 AND action='CREATED'
	`, requestID("intermediary-calculation-draft", "create")); err != nil {
		t.Fatalf("simulate existing test intermediary period: %v", err)
	}
	second, err := seeder.Seed(t.Context())
	if err != nil {
		t.Fatalf("repeat test seed: %v", err)
	}
	if created := second.Auxiliary.Created + second.Business.Created +
		second.Vouchers.Created + second.Accounting.Created; created != 0 {
		t.Fatalf("repeat seed created %d rows: %+v", created, second)
	}
	if second.Accounts.Created != 0 || second.Accounts.Skipped != 2 {
		t.Fatalf("repeat seed accounts = %+v, want two skipped", second.Accounts)
	}
	if _, err = seeder.app.Signin(t.Context(), "test-user", "Changed-password-2!", "verify-preserved-test-user-password"); err != nil {
		t.Fatalf("repeat seed reset the tester-managed password: %v", err)
	}
	if resumed := second.Auxiliary.Resumed + second.Business.Resumed +
		second.Vouchers.Resumed + second.Accounting.Resumed; resumed != 0 {
		t.Fatalf("repeat seed resumed %d rows: %+v", resumed, second)
	}
	assertDistinctEntities(t, pool, "aux_objects", 11)
	var businessEntities int
	if err = pool.QueryRow(t.Context(), `
		SELECT count(DISTINCT entry.entity)
		FROM approval_events event
		JOIN approval_entries entry ON entry.id=event.entry_id
		WHERE event.domain IN ('bob','dcl') AND event.request_id LIKE $1
	`, seedPrefix+"%").Scan(&businessEntities); err != nil {
		t.Fatalf("count test business entities: %v", err)
	}
	if businessEntities != 11 {
		t.Fatalf("test business distinct entities = %d, want 11", businessEntities)
	}
	assertDistinctEntities(t, pool, "vou_documents", 33)
	var workflowDefinitions, workflowInstances int
	if err = pool.QueryRow(t.Context(), `
		SELECT
			(SELECT count(*) FROM wfl_process_definitions definition WHERE EXISTS(
				SELECT 1 FROM approval_entries approval
				WHERE approval.domain='dcl' AND approval.entity='wfl-process-definition'
					AND approval.subject_id=definition.id AND approval.status='DRAFT'
			)),
			(SELECT count(*) FROM wfl_definition_instances)
	`).Scan(&workflowDefinitions, &workflowInstances); err != nil {
		t.Fatalf("count workflow seeds: %v", err)
	}
	if workflowDefinitions != 3 || workflowInstances != 0 {
		t.Fatalf("workflow seed coverage definitions=%d instances=%d", workflowDefinitions, workflowInstances)
	}
	var generatedExpensePayments int
	if err = pool.QueryRow(t.Context(), `
		SELECT count(*)
		FROM vou_documents
		WHERE entity='expense-payment'
	`).Scan(&generatedExpensePayments); err != nil {
		t.Fatalf("count test expense payments: %v", err)
	}
	if generatedExpensePayments != 0 {
		t.Fatalf("draft workflow seeds generated %d expense payments, want 0", generatedExpensePayments)
	}
	assertAccountingAndReportFacts(t, pool)
	var receiptID string
	if err = pool.QueryRow(t.Context(), `
		SELECT entry.subject_id
		FROM approval_events event
		JOIN approval_entries entry ON entry.id = event.entry_id
		WHERE entry.domain='vou' AND event.request_id=$1 AND event.action='CREATED'
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
			DocumentID: receipt.DocumentID, Revision: receipt.Approval.Revision, Reason: "测试人员接管",
		},
		mustApprovalActor("tester-unapprove-test-receipt"),
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
	if receipt.Approval.Status != voudomain.StatusPending {
		t.Fatalf("tester-owned receipt status = %s, want PENDING", receipt.Approval.Status)
	}
}

func assertAccountingAndReportFacts(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	var books, approvedOpenings, mappings, postedLines int
	if err := pool.QueryRow(t.Context(), `
		SELECT
			(SELECT count(*) FROM acc_books WHERE description=$1),
			(SELECT count(*) FROM approval_entries approval JOIN acc_books book ON book.id=approval.subject_id WHERE book.description=$1 AND approval.domain='acc' AND approval.entity='opening' AND approval.version_no IS NULL AND approval.status='APPROVED'),
			(SELECT count(*) FROM approval_entries approval JOIN acc_mappings mapping ON mapping.id=approval.subject_id JOIN acc_books book ON book.id=mapping.book_id WHERE book.description=$1 AND approval.domain='dcl' AND approval.entity='acc-mapping' AND approval.status='APPROVED'),
			(SELECT count(*) FROM acc_voucher_lines line JOIN acc_vouchers voucher ON voucher.id=line.voucher_id WHERE voucher.source_entity='other-income')
	`, testAccountingBookDescription).Scan(&books, &approvedOpenings, &mappings, &postedLines); err != nil {
		t.Fatalf("read test accounting facts: %v", err)
	}
	if books != 1 || approvedOpenings != 1 || mappings != len(testVouEntities) || postedLines < 2 {
		t.Fatalf("accounting coverage books=%d openings=%d mappings=%d postedLines=%d", books, approvedOpenings, mappings, postedLines)
	}
	var reports, reportRows int
	if err := pool.QueryRow(t.Context(), `
		SELECT
			(SELECT count(*) FROM rpt_definitions definition WHERE definition.enabled AND EXISTS(SELECT 1 FROM approval_entries approval WHERE approval.domain='dcl' AND approval.entity='rpt-definition' AND approval.subject_id=definition.id AND approval.status='APPROVED')),
			(SELECT count(*) FROM acc_voucher_lines)
	`).Scan(&reports, &reportRows); err != nil {
		t.Fatalf("read test report facts: %v", err)
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
