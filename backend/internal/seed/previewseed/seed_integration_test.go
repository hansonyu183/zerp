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
	seeder, err := New(pool, t.TempDir(), logger)
	if err != nil {
		t.Fatalf("new preview seeder: %v", err)
	}
	if _, err = seeder.Seed(t.Context()); err != nil {
		t.Fatalf("seed preview data: %v", err)
	}
	second, err := seeder.Seed(t.Context())
	if err != nil {
		t.Fatalf("repeat preview seed: %v", err)
	}
	if created := second.Auxiliary.Created + second.Business.Created +
		second.Vouchers.Created; created != 0 {
		t.Fatalf("repeat seed created %d rows: %+v", created, second)
	}
	if resumed := second.Auxiliary.Resumed + second.Business.Resumed +
		second.Vouchers.Resumed; resumed != 0 {
		t.Fatalf("repeat seed resumed %d rows: %+v", resumed, second)
	}
	assertDistinctEntities(t, pool, "aux_objects", 9)
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
	if businessEntities != 8 {
		t.Fatalf("preview BOB distinct entities = %d, want 8", businessEntities)
	}
	assertDistinctEntities(t, pool, "vou_documents", 14)
	var approvedWorkflows int
	if err = pool.QueryRow(t.Context(), `
		SELECT count(DISTINCT process_type)
		FROM wfl_process_instances
		WHERE status='APPROVED'
	`).Scan(&approvedWorkflows); err != nil {
		t.Fatalf("count approved workflows: %v", err)
	}
	if approvedWorkflows != 2 {
		t.Fatalf("approved workflow types = %d, want 2", approvedWorkflows)
	}
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
