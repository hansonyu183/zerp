//go:build integration

package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

const cutoverCheckActor = "01J00000000000000000000000"

func TestVouCutoverCheckCommand(t *testing.T) {
	pool := cutoverCheckPool(t)
	truncateCutoverCheckVOU(t, pool)
	commandPath := buildCutoverCheckCommand(t)
	readOnlyDatabaseURL := os.Getenv("TEST_DATABASE_URL") + "&default_transaction_read_only=on"

	t.Run("no legacy documents", func(t *testing.T) {
		result := runCutoverCheck(t, commandPath, readOnlyDatabaseURL)
		if result.exitCode != 0 {
			t.Fatalf("exit code = %d, stderr=%q", result.exitCode, result.stderr)
		}
		if result.stdout != "VOU approval cutover check: total=0\n" {
			t.Fatalf("stdout = %q", result.stdout)
		}
		if result.stderr != "" {
			t.Fatalf("stderr = %q", result.stderr)
		}
	})

	t.Run("single entity", func(t *testing.T) {
		insertApprovedCutoverCheckDocument(t, pool, "01J00000000000000000000115", "other-income", "OIN-20260808-0115", "2026-08-08")

		result := runCutoverCheck(t, commandPath, readOnlyDatabaseURL)
		if result.exitCode != 1 {
			t.Fatalf("exit code = %d, stderr=%q", result.exitCode, result.stderr)
		}
		want := "VOU approval cutover check: total=1\n" +
			"entity other-income: 1\n" +
			"document entity=other-income number=OIN-20260808-0115 business_date=2026-08-08 status=APPROVED\n"
		if result.stdout != want {
			t.Fatalf("stdout = %q, want %q", result.stdout, want)
		}
		if result.stderr != "" {
			t.Fatalf("stderr = %q", result.stderr)
		}
	})

	t.Run("multiple entities", func(t *testing.T) {
		insertApprovedCutoverCheckDocument(t, pool, "01J00000000000000000000116", "other-income", "OIN-20260809-0116", "2026-08-09")
		insertApprovedCutoverCheckDocument(t, pool, "01J00000000000000000000117", "other-income", "OIN-20260810-0117", "2026-08-10")
		insertApprovedCutoverCheckDocument(t, pool, "01J00000000000000000000118", "employee-loan", "ELN-20260807-0118", "2026-08-07")

		result := runCutoverCheck(t, commandPath, readOnlyDatabaseURL)
		if result.exitCode != 1 {
			t.Fatalf("exit code = %d, stderr=%q", result.exitCode, result.stderr)
		}
		want := "VOU approval cutover check: total=4\n" +
			"entity employee-loan: 1\n" +
			"entity other-income: 3\n" +
			"document entity=employee-loan number=ELN-20260807-0118 business_date=2026-08-07 status=APPROVED\n" +
			"document entity=other-income number=OIN-20260808-0115 business_date=2026-08-08 status=APPROVED\n" +
			"document entity=other-income number=OIN-20260809-0116 business_date=2026-08-09 status=APPROVED\n" +
			"document entity=other-income number=OIN-20260810-0117 business_date=2026-08-10 status=APPROVED\n"
		if result.stdout != want {
			t.Fatalf("stdout = %q, want %q", result.stdout, want)
		}
		if result.stderr != "" {
			t.Fatalf("stderr = %q", result.stderr)
		}
	})

	t.Run("posted and non-ledger documents are ignored", func(t *testing.T) {
		truncateCutoverCheckVOU(t, pool)
		insertApprovedCutoverCheckDocument(t, pool, "01J00000000000000000000119", "other-income", "OIN-20260811-0119", "2026-08-11")
		insertCutoverCheckFundEntry(t, pool, "01J00000000000000000000119", "OIN-20260811-0119", "2026-08-11")
		insertApprovedCutoverCheckDocument(t, pool, "01J00000000000000000000120", "sale-pricing", "SPR-20260811-0120", "2026-08-11")

		result := runCutoverCheck(t, commandPath, readOnlyDatabaseURL)
		if result.exitCode != 0 {
			t.Fatalf("exit code = %d, stdout=%q, stderr=%q", result.exitCode, result.stdout, result.stderr)
		}
		if result.stdout != "VOU approval cutover check: total=0\n" {
			t.Fatalf("stdout = %q", result.stdout)
		}
		if result.stderr != "" {
			t.Fatalf("stderr = %q", result.stderr)
		}
	})

	t.Run("query failure is non-zero and has desensitized output", func(t *testing.T) {
		if _, err := pool.Exec(t.Context(), "ALTER TABLE vou_documents RENAME TO vou_documents_unavailable"); err != nil {
			t.Fatalf("disable VOU documents table: %v", err)
		}
		t.Cleanup(func() {
			if _, err := pool.Exec(context.Background(), "ALTER TABLE vou_documents_unavailable RENAME TO vou_documents"); err != nil {
				t.Errorf("restore VOU documents table: %v", err)
			}
		})

		result := runCutoverCheck(t, commandPath, os.Getenv("TEST_DATABASE_URL"))
		if result.exitCode == 0 {
			t.Fatal("exit code = 0")
		}
		if result.stdout != "" {
			t.Fatalf("stdout = %q", result.stdout)
		}
		if result.stderr != "VOU approval cutover check failed\n" {
			t.Fatalf("stderr = %q", result.stderr)
		}
	})
}

type cutoverCheckResult struct {
	exitCode       int
	stdout, stderr string
}

func buildCutoverCheckCommand(t *testing.T) string {
	t.Helper()
	commandPath := filepath.Join(t.TempDir(), "zerp-vou-cutover-check")
	command := exec.Command("go", "build", "-o", commandPath, "./cmd/vou-cutover-check")
	command.Dir = filepath.Clean(filepath.Join("..", ".."))
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("build cutover check command: %v\n%s", err, output)
	}
	return commandPath
}

func runCutoverCheck(t *testing.T, commandPath, databaseURL string) cutoverCheckResult {
	t.Helper()
	command := exec.Command(commandPath)
	command.Env = append(os.Environ(), "APP_ENV=test", "DATABASE_URL="+databaseURL, "DATABASE_CONNECT_TIMEOUT=100ms")
	var stdout, stderr strings.Builder
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()
	result := cutoverCheckResult{stdout: stdout.String(), stderr: stderr.String()}
	if err == nil {
		return result
	}
	if exitError, ok := err.(*exec.ExitError); ok {
		result.exitCode = exitError.ExitCode()
		return result
	}
	t.Fatalf("run command: %v", err)
	return cutoverCheckResult{}
}

func cutoverCheckPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if databaseURL == "" || !strings.HasSuffix(strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB")), "_test") {
		t.Fatal("safe TEST_DATABASE_URL and TEST_POSTGRES_DB ending in _test are required")
	}
	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect integration database: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func truncateCutoverCheckVOU(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(t.Context(), `
		TRUNCATE wfl_runtime_audit_events, wfl_edge_executions, wfl_node_instances,
			wfl_definition_instances, vou_audit_events, vou_download_tokens, vou_document_attachments,
			vou_files, wfl_audit_events, wfl_process_documents, wfl_process_instances,
			vou_asset_liquidation_lines,vou_asset_liquidation_details,
			vou_asset_sale_lines,vou_asset_sale_details,
			vou_asset_depreciation_lines,vou_asset_depreciation_details,
			vou_asset_acquisition_lines,vou_asset_acquisition_details,
			vou_price_lines, vou_purchase_inquiry_details, vou_sale_pricing_details,
			vou_inventory_count_lines, vou_inventory_count_details,
			vou_sale_return_lines, vou_sale_return_details,
			vou_purchase_return_lines, vou_purchase_return_details,
			vou_sale_signoff_lines, vou_sale_signoff_details,
			vou_sale_delivery_details, vou_sale_outbound_lines, vou_sale_outbound_details,
			vou_purchase_inbound_lines, vou_purchase_inbound_details,
			vou_production_material_lines, vou_production_output_lines, vou_production_details,
			vou_expense_lines, vou_sale_order_formula_lines, vou_sale_order_formulas,
			vou_product_lines, vou_other_income_details,
			vou_employee_loan_writeoff_details, vou_expense_payment_details, vou_expense_reimbursement_details, vou_payment_details, vou_receipt_details,
			vou_purchase_order_details,
			vou_sale_order_details, vou_documents, vou_number_counters CASCADE`)
	if err != nil {
		t.Fatalf("truncate VOU: %v", err)
	}
}

func insertApprovedCutoverCheckDocument(t *testing.T, pool *pgxpool.Pool, id, entity, number, businessDate string) {
	t.Helper()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	defer tx.Rollback(t.Context())
	_, err = tx.Exec(t.Context(), `
		INSERT INTO vou_documents(
			id, entity, document_no, status, business_date, currency, total_amount_cents,
			created_by, updated_by, reviewed_at, reviewed_by, approved_at, approved_by,
			posted_at, posted_by
		) VALUES($1, $2, $3, 'APPROVED', $4, 'CNY', 1, $5, $5, now(), $5, now(), $5,
			now(), $5)`,
		id, entity, number, businessDate, cutoverCheckActor)
	if err != nil {
		t.Fatalf("insert fixture document: %v", err)
	}
	switch entity {
	case "other-income":
		_, err = tx.Exec(t.Context(), `
			INSERT INTO vou_other_income_details(
				document_id, entity, source_name, fund_account_object_id, fund_account_version_id,
				fund_account_code, fund_account_name
			) VALUES($1, $2, 'cutover fixture', '01J00000000000000000000001',
				'01J00000000000000000000002', 'BANK', 'Cutover fixture')`, id, entity)
	case "employee-loan":
		_, err = tx.Exec(t.Context(), `
			INSERT INTO vou_payment_details(
				document_id, entity, counterparty_entity, counterparty_object_id,
				counterparty_version_id, counterparty_code, counterparty_name,
				fund_account_object_id, fund_account_version_id, fund_account_code, fund_account_name
			) VALUES($1, $2, 'employee', '01J00000000000000000000003',
				'01J00000000000000000000004', 'EMP-001', 'Cutover employee',
				'01J00000000000000000000001', '01J00000000000000000000002', 'BANK', 'Cutover fixture')`, id, entity)
	default:
		_, err = tx.Exec(t.Context(), `
			INSERT INTO vou_sale_pricing_details(document_id, entity) VALUES($1, $2)`, id, entity)
	}
	if err != nil {
		t.Fatalf("insert fixture detail: %v", err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit fixture: %v", err)
	}
}

func insertCutoverCheckFundEntry(t *testing.T, pool *pgxpool.Pool, documentID, documentNo, businessDate string) {
	t.Helper()
	generationID := "01J00000000000000000000999"
	_, err := pool.Exec(t.Context(), `
		INSERT INTO led_generations(id, cutover_date, status, activated_by, request_id)
		VALUES($1, $2, 'ARCHIVED', $3, 'cutover-check-fixture')`,
		generationID, businessDate, cutoverCheckActor)
	if err == nil {
		_, err = pool.Exec(t.Context(), `
		INSERT INTO led_fund_entries(
			id, generation_id, entry_type, source_entity, source_document_id, source_document_no,
			source_revision, effective_date, occurred_at, actor_id, request_id,
			fund_account_object_id, fund_account_version_id, fund_account_code, fund_account_name,
			currency, amount_delta_cents
		) VALUES(
			'01J00000000000000000000998', $1, 'POSTING', 'other-income', $4, $5,
			1, $2, now(), $3, 'cutover-check-fixture',
			'01J00000000000000000000001', '01J00000000000000000000002', 'BANK', 'Cutover fixture',
			'CNY', 1
		)`, generationID, businessDate, cutoverCheckActor, documentID, documentNo)
	}
	if err != nil {
		t.Fatalf("insert posted ledger fixture: %v", err)
	}
	t.Cleanup(func() {
		if _, cleanupErr := pool.Exec(context.Background(),
			"DELETE FROM led_fund_entries WHERE generation_id=$1", generationID); cleanupErr != nil {
			t.Errorf("remove posted ledger fixture: %v", cleanupErr)
		}
		if _, cleanupErr := pool.Exec(context.Background(),
			"DELETE FROM led_generations WHERE id=$1", generationID); cleanupErr != nil {
			t.Errorf("remove ledger generation fixture: %v", cleanupErr)
		}
	})
}
