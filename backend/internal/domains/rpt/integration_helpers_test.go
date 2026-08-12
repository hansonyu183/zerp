//go:build integration

package rpt

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

const rptIntegrationActor = "01JAPPSYST3MACTR0000000000"

func rptIntegrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	expectedDatabase := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if databaseURL == "" || !strings.HasSuffix(expectedDatabase, "_test") {
		t.Fatal("safe TEST_DATABASE_URL and TEST_POSTGRES_DB ending in _test are required")
	}
	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect integration database: %v", err)
	}
	t.Cleanup(pool.Close)
	var actualDatabase, table string
	if err = pool.QueryRow(t.Context(), "SELECT current_database(), to_regclass('rpt_definitions')::text").Scan(&actualDatabase, &table); err != nil {
		t.Fatalf("read RPT integration database: %v", err)
	}
	if actualDatabase != expectedDatabase || table != "rpt_definitions" {
		t.Fatalf("RPT migrations are not applied: database=%q table=%q", actualDatabase, table)
	}
	resetRPTIntegrationData(t, pool)
	t.Cleanup(func() { resetRPTIntegrationData(t, pool) })
	return pool
}

func resetRPTIntegrationData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		DELETE FROM app_role_permissions
		WHERE permission_id IN (SELECT p.id FROM app_permissions p WHERE p.domain='rpt' AND p.entity <> 'definition'
			AND NOT EXISTS(SELECT 1 FROM rpt_definitions d WHERE d.code=p.entity AND d.created_by='SYSTEM'));
		DELETE FROM rpt_definitions WHERE created_by<>'SYSTEM';
		DELETE FROM app_permissions p WHERE p.domain='rpt' AND p.entity <> 'definition'
			AND NOT EXISTS(SELECT 1 FROM rpt_definitions d WHERE d.code=p.entity AND d.created_by='SYSTEM');`)
	if err != nil {
		t.Fatalf("reset RPT integration data: %v", err)
	}
}

func rptCode() string { return "it-" + strings.ToLower(newID()) }

func rptData(sql, alias string) VersionData {
	return VersionData{
		SQL:        sql,
		Parameters: []Parameter{},
		Columns:    []ResultColumn{{Alias: alias, Name: alias, Order: 1, Type: ResultTypeText, Width: 160, Visible: true}},
	}
}
