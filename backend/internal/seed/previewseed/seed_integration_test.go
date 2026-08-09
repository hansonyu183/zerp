//go:build integration

package previewseed

import (
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
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
		second.Vouchers.Created + second.Ledger.Created; created != 0 {
		t.Fatalf("repeat seed created %d rows: %+v", created, second)
	}
	if resumed := second.Auxiliary.Resumed + second.Business.Resumed +
		second.Vouchers.Resumed + second.Ledger.Resumed; resumed != 0 {
		t.Fatalf("repeat seed resumed %d rows: %+v", resumed, second)
	}
	assertInventoryBalanceRepairIdempotent(t, seeder, pool)
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
	assertDistinctEntities(t, pool, "vou_documents", 15)
	var completedWorkflows int
	if err = pool.QueryRow(t.Context(), `
		SELECT count(DISTINCT process_type)
		FROM wfl_process_instances
		WHERE status='COMPLETED'
	`).Scan(&completedWorkflows); err != nil {
		t.Fatalf("count completed workflows: %v", err)
	}
	if completedWorkflows != 2 {
		t.Fatalf("completed workflow types = %d, want 2", completedWorkflows)
	}
	for _, table := range []string{
		"led_inventory_entries", "led_fund_entries", "led_party_entries", "led_container_entries",
	} {
		var count int
		if err = pool.QueryRow(t.Context(), "SELECT count(*) FROM "+table).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if count == 0 {
			t.Fatalf("%s is empty", table)
		}
	}

	var receiptID string
	if err = pool.QueryRow(t.Context(), `
		SELECT document_id
		FROM vou_audit_events
		WHERE request_id=$1 AND event_type='CREATED'
	`, requestID("receipt-finalized", "create")).Scan(&receiptID); err != nil {
		t.Fatalf("find finalized receipt: %v", err)
	}
	receipt, err := seeder.vouchers.Get(
		t.Context(), voudomain.EntitySalesReceipt, voudomain.GetInput{DocumentID: receiptID},
	)
	if err != nil {
		t.Fatalf("get finalized receipt: %v", err)
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

func assertInventoryBalanceRepairIdempotent(
	t *testing.T,
	seeder *Seeder,
	pool *pgxpool.Pool,
) {
	t.Helper()
	warehouse := seeder.bobRefs["warehouse-effective"]
	products := []bobdomain.ObjectView{
		seeder.bobRefs["raw-effective"],
		seeder.bobRefs["finished-effective"],
	}
	productIDs := []string{products[0].ObjectID, products[1].ObjectID}
	if _, err := pool.Exec(t.Context(), `
		DELETE FROM led_inventory_entries
		WHERE entry_type='OPENING' AND warehouse_object_id=$1
		  AND product_object_id=ANY($2::text[])
	`, warehouse.ObjectID, productIDs); err != nil {
		t.Fatalf("remove preview inventory balances: %v", err)
	}
	var first Counts
	if err := seeder.seedInventoryBalance(t.Context(), &first); err != nil {
		t.Fatalf("repair preview inventory balances: %v", err)
	}
	if first.Created != 1 {
		t.Fatalf("inventory repair counts = %+v, want one created task", first)
	}
	var count int
	if err := pool.QueryRow(t.Context(), `
		SELECT count(*) FROM led_inventory_entries
		WHERE entry_type='OPENING' AND warehouse_object_id=$1
		  AND product_object_id=ANY($2::text[])
	`, warehouse.ObjectID, productIDs).Scan(&count); err != nil {
		t.Fatalf("count repaired preview inventory balances: %v", err)
	}
	if count != len(products) {
		t.Fatalf("repaired preview inventory balances = %d, want %d", count, len(products))
	}
	var second Counts
	if err := seeder.seedInventoryBalance(t.Context(), &second); err != nil {
		t.Fatalf("repeat preview inventory repair: %v", err)
	}
	if second.Skipped != 1 {
		t.Fatalf("repeat inventory repair counts = %+v, want one skipped task", second)
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
