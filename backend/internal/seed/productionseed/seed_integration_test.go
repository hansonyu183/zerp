//go:build integration

package productionseed

import (
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/seed/bobseed"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestProductionDemoSeedIsIdempotentAndPostsInventoryIntegration(t *testing.T) {
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

	if _, err = bobseed.New(pool).Seed(t.Context()); err != nil {
		t.Fatalf("seed BOB prerequisites: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	seeder, err := New(pool, t.TempDir(), logger)
	if err != nil {
		t.Fatalf("new production demo seeder: %v", err)
	}
	first, err := seeder.Seed(t.Context())
	if err != nil {
		t.Fatalf("seed production demo data: %v", err)
	}
	if first.Created+first.Resumed+first.Skipped != 5 {
		t.Fatalf("first result = %+v", first)
	}
	second, err := seeder.Seed(t.Context())
	if err != nil {
		t.Fatalf("repeat production demo seed: %v", err)
	}
	if second != (Result{Skipped: 5}) {
		t.Fatalf("second result = %+v", second)
	}
	orderProductionID, err := seeder.findDocumentID(
		t.Context(),
		requestID("order-production-draft-create"),
	)
	if err != nil {
		t.Fatalf("find draft order production: %v", err)
	}
	orderProduction, err := seeder.vouchers.Get(
		t.Context(),
		voudomain.EntityOrderProduction,
		voudomain.GetInput{DocumentID: orderProductionID},
	)
	if err != nil {
		t.Fatalf("get draft order production: %v", err)
	}
	if _, err = seeder.vouchers.Check(
		t.Context(),
		voudomain.EntityOrderProduction,
		voudomain.DocumentRevisionInput{
			DocumentID: orderProduction.DocumentID,
			Revision:   orderProduction.Revision,
		},
		actorID,
		requestID("integration-advance-order-production"),
	); err != nil {
		t.Fatalf("advance draft order production: %v", err)
	}
	third, err := seeder.Seed(t.Context())
	if err != nil {
		t.Fatalf("repeat production demo seed after tester advance: %v", err)
	}
	if third != (Result{Skipped: 5}) {
		t.Fatalf("third result after tester advance = %+v", third)
	}

	var productionDocuments int
	if err = pool.QueryRow(t.Context(), `
		SELECT count(*)
		FROM vou_documents
		WHERE created_by=$1
		  AND entity IN ('order-production', 'self-production')
	`, actorID).Scan(&productionDocuments); err != nil {
		t.Fatalf("count production documents: %v", err)
	}
	if productionDocuments != 3 {
		t.Fatalf("production document count = %d, want 3", productionDocuments)
	}
}
