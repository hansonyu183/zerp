//go:build integration

package aux

import (
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func directIntegrationService(t *testing.T) (*Service, *pgxpool.Pool, approval.Actor) {
	t.Helper()
	url, db := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL")), strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if url == "" || !strings.HasSuffix(db, "_test") {
		t.Fatal("safe integration database required")
	}
	pool, err := pgxpool.New(t.Context(), url)
	if err != nil {
		t.Fatalf("connect test database: %v", err)
	}
	t.Cleanup(pool.Close)
	actor, err := approval.TrustedSystemActor("aux-direct-" + ulid.Make().String())
	if err != nil {
		t.Fatal(err)
	}
	return NewService(pool), pool, actor
}

func TestDirectCRUDIntegration(t *testing.T) {
	s, pool, actor := directIntegrationService(t)
	suffix := ulid.Make().String()
	created, err := s.Create(t.Context(), EntityPaymentMethod, CreateInput{Data: CreateData{Data: map[string]any{"name": "直接创建-" + suffix}}}, actor)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	view, err := s.Get(t.Context(), EntityPaymentMethod, GetInput{ObjectID: created.ObjectID}, actor)
	if err != nil || stringValue(view.Data["name"]) != "直接创建-"+suffix {
		t.Fatalf("read created current data: %+v %v", view, err)
	}
	page, err := s.Query(t.Context(), EntityPaymentMethod, QueryInput{Page: 1, PageSize: 20, Filters: QueryFilters{Keyword: "直接创建-" + suffix}}, actor)
	if err != nil || len(page.Items) != 1 || page.Items[0].ObjectID != created.ObjectID {
		t.Fatalf("query created current data: %+v %v", page, err)
	}
	renamed, err := s.Save(t.Context(), EntityPaymentMethod, SaveInput{ObjectID: created.ObjectID, ObjectRevision: created.ObjectRevision, Data: map[string]any{"name": "直接改名-" + suffix}}, actor)
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if renamed.ObjectID != created.ObjectID {
		t.Fatalf("stable identity changed on rename: created=%s renamed=%s", created.ObjectID, renamed.ObjectID)
	}
	if _, err = s.Save(t.Context(), EntityPaymentMethod, SaveInput{ObjectID: created.ObjectID, ObjectRevision: created.ObjectRevision, Data: map[string]any{"name": "stale"}}, actor); !errorKind(err, ErrorConflict) {
		t.Fatalf("stale save = %v", err)
	}
	disabled, err := s.Disable(t.Context(), EntityPaymentMethod, ObjectRevisionInput{ObjectID: created.ObjectID, ObjectRevision: renamed.ObjectRevision}, actor)
	if err != nil || disabled.Enabled {
		t.Fatalf("disable: %+v %v", disabled, err)
	}
	if _, err = s.ResolveCurrentReference(t.Context(), nil, EntityPaymentMethod, created.ObjectID); !errorKind(err, ErrorConflict) {
		t.Fatalf("disabled new reference = %v", err)
	}
	enabled, err := s.Enable(t.Context(), EntityPaymentMethod, ObjectRevisionInput{ObjectID: created.ObjectID, ObjectRevision: disabled.ObjectRevision}, actor)
	if err != nil || !enabled.Enabled {
		t.Fatalf("enable: %+v %v", enabled, err)
	}
	disabled, err = s.Disable(t.Context(), EntityPaymentMethod, ObjectRevisionInput{ObjectID: created.ObjectID, ObjectRevision: enabled.ObjectRevision}, actor)
	if err != nil || disabled.Enabled {
		t.Fatalf("disable again: %+v %v", disabled, err)
	}
	var approvalCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_entries WHERE domain='aux' AND subject_id=$1`, created.ObjectID).Scan(&approvalCount); err != nil || approvalCount != 0 {
		t.Fatalf("AUX approval rows=%d err=%v", approvalCount, err)
	}
	if err = s.Delete(t.Context(), EntityPaymentMethod, DeleteInput{ObjectID: created.ObjectID, ObjectRevision: disabled.ObjectRevision}, actor); err != nil {
		t.Fatalf("delete unreferenced object: %v", err)
	}
}

func TestDirectDeleteBlockerAndDisabledHistoryIntegration(t *testing.T) {
	s, pool, actor := directIntegrationService(t)
	suffix := ulid.Make().String()
	created, err := s.Create(t.Context(), EntityDepartment, CreateInput{Data: CreateData{Data: map[string]any{"name": "历史部门-" + suffix}}}, actor)
	if err != nil {
		t.Fatalf("create department: %v", err)
	}
	disabled, err := s.Disable(t.Context(), EntityDepartment, ObjectRevisionInput{ObjectID: created.ObjectID, ObjectRevision: created.ObjectRevision}, actor)
	if err != nil {
		t.Fatalf("disable department: %v", err)
	}
	historical, err := s.Get(t.Context(), EntityDepartment, GetInput{ObjectID: created.ObjectID}, actor)
	if err != nil || historical.Enabled || stringValue(historical.Data["name"]) != "历史部门-"+suffix {
		t.Fatalf("disabled historical read: %+v %v", historical, err)
	}

	entryID, subjectID := ulid.Make().String(), ulid.Make().String()
	if _, err = pool.Exec(t.Context(), `INSERT INTO approval_entries
		(id,domain,entity,subject_id,version_no,status,created_by,created_at,updated_by,updated_at)
		VALUES($1,'dcl','employee',$2,1,'DRAFT',$3,now(),$3,now())`, entryID, subjectID, actor.ID()); err != nil {
		t.Fatalf("insert DCL approval entry: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO dcl_employee_versions
		(approval_entry_id,department_id,department_code,department_name,enabled)
		VALUES($1,$2,$3,$4,true)`, entryID, created.ObjectID, historical.Code, stringValue(historical.Data["name"])); err != nil {
		t.Fatalf("insert historical DCL snapshot: %v", err)
	}

	err = s.Delete(t.Context(), EntityDepartment, DeleteInput{ObjectID: created.ObjectID, ObjectRevision: disabled.ObjectRevision}, actor)
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorConflict {
		t.Fatalf("delete referenced department = %v", err)
	}
	data, ok := domainErr.Data.(map[string]any)
	blockers, blockersOK := data["blockers"].([]map[string]any)
	if !ok || !blockersOK || len(blockers) != 1 || blockers[0]["source"] != "dcl_employee_versions" {
		t.Fatalf("delete blockers = %#v", domainErr.Data)
	}

	if _, err = pool.Exec(t.Context(), `DELETE FROM dcl_employee_versions WHERE approval_entry_id=$1`, entryID); err != nil {
		t.Fatalf("delete DCL snapshot: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `DELETE FROM approval_entries WHERE id=$1`, entryID); err != nil {
		t.Fatalf("delete DCL approval entry: %v", err)
	}
	if err = s.Delete(t.Context(), EntityDepartment, DeleteInput{ObjectID: created.ObjectID, ObjectRevision: disabled.ObjectRevision}, actor); err != nil {
		t.Fatalf("delete after blocker removal: %v", err)
	}
}

func errorKind(err error, kind ErrorKind) bool {
	var domainErr *DomainError
	return errors.As(err, &domainErr) && domainErr.Kind == kind
}
