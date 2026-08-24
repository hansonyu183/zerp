//go:build integration

package bobseed

import (
	"os"
	"strings"
	"testing"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSeedDemoDataIntegration(t *testing.T) {
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

	var currentDatabase string
	if err = pool.QueryRow(t.Context(), "select current_database()").Scan(&currentDatabase); err != nil {
		t.Fatalf("read current database: %v", err)
	}
	if currentDatabase != databaseName {
		t.Fatalf("connected database %q does not match TEST_POSTGRES_DB %q", currentDatabase, databaseName)
	}

	first, err := New(pool).Seed(t.Context())
	if err != nil {
		t.Fatalf("seed demo data: %v", err)
	}
	if first.Created+first.Resumed+first.Skipped != len(samples) {
		t.Fatalf("first result = %+v", first)
	}

	second, err := New(pool).Seed(t.Context())
	if err != nil {
		t.Fatalf("repeat seed demo data: %v", err)
	}
	if second != (Result{Skipped: len(samples)}) {
		t.Fatalf("second result = %+v", second)
	}

	counts := make(map[string]int)
	lookup := queryLookup{queries: dbsqlc.New(pool), pool: pool}
	for _, item := range samples {
		objectID, found, findErr := lookup.Find(t.Context(), item.entity, item.data.Code)
		if findErr != nil || !found {
			t.Fatalf("find %s %s: found=%t err=%v", item.entity, item.data.Code, found, findErr)
		}
		if auxiliary, ok := auxiliarySeedEntity(item.entity); ok {
			var enabled bool
			if err = pool.QueryRow(t.Context(), `SELECT enabled FROM aux_objects WHERE entity=$1 AND id=$2`, auxiliary, objectID).Scan(&enabled); err != nil || !enabled {
				t.Fatalf("query %s %s enabled=%t err=%v", auxiliary, item.data.Code, enabled, err)
			}
			continue
		}
		var status string
		if err = pool.QueryRow(t.Context(), `
			SELECT v.status
			FROM bob_objects o
			JOIN bob_versions v ON v.id = o.current_version_id
			WHERE o.entity = $1 AND o.id = $2
		`, item.entity, objectID).Scan(&status); err != nil {
			t.Fatalf("query %s %s status: %v", item.entity, item.data.Code, err)
		}
		counts[status]++
	}
	expected := map[string]int{
		bob.StatusEffective: 11,
		bob.StatusDraft:     6,
		bob.StatusPending:   1,
	}
	if len(counts) != len(expected) {
		t.Fatalf("status counts = %v", counts)
	}
	for status, count := range expected {
		if counts[status] != count {
			t.Fatalf("%s count = %d, want %d", status, counts[status], count)
		}
	}
}
