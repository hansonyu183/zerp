//go:build integration

package rpt

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5/pgxpool"
)

const rptIntegrationActor = "01JAPPSYST3MACTR0000000000"

const (
	rptSubmitterID = "01JRPT00000000000000000001"
	rptReviewerID  = "01JRPT00000000000000000002"
)

func rptActor(t *testing.T, id, requestID string) approval.Actor {
	t.Helper()
	actor, err := approval.UserActor(authorization.Principal{ActorID: id}, requestID)
	if err != nil {
		t.Fatal(err)
	}
	return actor
}

func seedRPTActors(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(t.Context(), `
		INSERT INTO app_users(id,username,display_name,password_hash,status,password_changed_at,created_by,updated_by)
		VALUES
			($1,'rpt-submitter','报表提交人','hash','ENABLED',now(),$1,$1),
			($2,'rpt-reviewer','报表审批人','hash','ENABLED',now(),$1,$1)
		ON CONFLICT (id) DO NOTHING`, rptSubmitterID, rptReviewerID)
	if err != nil {
		t.Fatal(err)
	}
}

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
		WHERE permission_id IN (SELECT p.id FROM app_permissions p WHERE p.domain='rpt'
			AND NOT EXISTS(SELECT 1 FROM rpt_definitions d WHERE d.code=p.entity AND d.created_by='SYSTEM'));
		DELETE FROM rpt_definitions WHERE created_by<>'SYSTEM';
		DELETE FROM app_permissions p WHERE p.domain='rpt'
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

func rptErrorKind(err error, want ErrorKind) bool {
	var rptErr *DomainError
	if errors.As(err, &rptErr) {
		return rptErr.Kind == want
	}
	var dclErr *dcldomain.DomainError
	if !errors.As(err, &dclErr) {
		return false
	}
	return (want == ErrorValidation && dclErr.Kind == dcldomain.ErrorValidation) ||
		(want == ErrorConflict && dclErr.Kind == dcldomain.ErrorConflict) ||
		(want == ErrorInternal && dclErr.Kind == dcldomain.ErrorInternal)
}
