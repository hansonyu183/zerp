//go:build integration

package acc

import (
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type accountingProductSnapshot struct {
	ObjectID, ApprovalEntryID, Code, Name string
}

var accountingProductCodeSequence uint32 = 8000

func createAccountingProductSnapshot(t *testing.T, pool *pgxpool.Pool, objectID, name string) accountingProductSnapshot {
	t.Helper()
	entryID := ulid.Make().String()
	code := fmt.Sprintf("PRD-%04d", atomic.AddUint32(&accountingProductCodeSequence, 1))
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin accounting product snapshot: %v", err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO bob_objects(id,entity,code,enabled,revision,created_by,updated_by) VALUES($1,'product',$2,TRUE,1,$3,$3)`, []any{objectID, code, adminID}},
		{`INSERT INTO dcl_subjects(id,entity,created_by) VALUES($1,'product',$2)`, []any{objectID, adminID}},
		{`INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at) VALUES($1,'dcl','product',$2,1,'APPROVED',1,$3,now(),$3,now(),$3,now(),$4,now())`, []any{entryID, objectID, adminID, operatorID}},
		{`INSERT INTO dcl_product_versions(approval_entry_id,name,enabled) VALUES($1,$2,TRUE)`, []any{entryID, name}},
		{`INSERT INTO bob_products(object_id,source_approval_entry_id,enabled,updated_by) VALUES($1,$2,TRUE,$3)`, []any{objectID, entryID, adminID}},
	} {
		if _, err := tx.Exec(t.Context(), statement.sql, statement.args...); err != nil {
			t.Fatalf("create accounting product snapshot: %v", err)
		}
	}
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit accounting product snapshot: %v", err)
	}
	return accountingProductSnapshot{ObjectID: objectID, ApprovalEntryID: entryID, Code: code, Name: name}
}

func createAccountingProductVersion(t *testing.T, pool *pgxpool.Pool, previous accountingProductSnapshot, name string) accountingProductSnapshot {
	t.Helper()
	entryID := ulid.Make().String()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin accounting product version: %v", err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at) VALUES($1,'dcl','product',$2,2,'APPROVED',1,$3,now(),$3,now(),$3,now(),$4,now())`, []any{entryID, previous.ObjectID, adminID, operatorID}},
		{`INSERT INTO dcl_product_versions(approval_entry_id,name,enabled) VALUES($1,$2,TRUE)`, []any{entryID, name}},
		{`UPDATE bob_products SET source_approval_entry_id=$1,updated_by=$2,updated_at=now() WHERE object_id=$3`, []any{entryID, adminID, previous.ObjectID}},
	} {
		if _, err := tx.Exec(t.Context(), statement.sql, statement.args...); err != nil {
			t.Fatalf("create accounting product version: %v", err)
		}
	}
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit accounting product version: %v", err)
	}
	return accountingProductSnapshot{ObjectID: previous.ObjectID, ApprovalEntryID: entryID, Code: previous.Code, Name: name}
}

func integrationACCService(pool *pgxpool.Pool, bus *txevent.Bus) *Service {
	return NewService(pool, authorization.Func(nil), bus)
}

func defaultIntegrationACCService(pool *pgxpool.Pool) *Service {
	return integrationACCService(pool, txevent.NewBus())
}

func integrationACCActor(t *testing.T, actorID, requestID string) approval.Actor {
	t.Helper()
	actor, err := approval.UserActor(authorization.Principal{ActorID: actorID}, requestID)
	if err != nil {
		t.Fatal(err)
	}
	return actor
}

func ensureIntegrationBookAccess(t *testing.T, service *Service, bookID, userID string) {
	t.Helper()
	if _, err := service.pool.Exec(t.Context(), `
		INSERT INTO acc_book_user_scopes(book_id,user_id,query_access,operate_access,created_by)
		VALUES($1,$2,TRUE,TRUE,$3)
		ON CONFLICT (book_id,user_id) DO UPDATE
		SET query_access=TRUE, operate_access=TRUE
	`, bookID, userID, adminID); err != nil {
		t.Fatalf("grant integration book access: %v", err)
	}
}

func approveIntegrationOpening(t *testing.T, service *Service, bookID string, draft OpeningView) OpeningView {
	t.Helper()
	ensureIntegrationBookAccess(t, service, bookID, operatorID)
	submitter := integrationACCActor(t, adminID, fmt.Sprintf("acc-opening-submit-%s", bookID))
	reviewer := integrationACCActor(t, operatorID, fmt.Sprintf("acc-opening-approve-%s", bookID))
	pending, err := service.SubmitOpening(t.Context(), bookID, draft.Approval.Revision, submitter)
	if err != nil {
		t.Fatalf("submit integration opening: %v", err)
	}
	approved, err := service.ApproveOpening(t.Context(), bookID, pending.Approval.Revision, reviewer)
	if err != nil {
		t.Fatalf("approve integration opening: %v", err)
	}
	return approved
}

func createApprovedZeroOpening(t *testing.T, service *Service, book BookView) {
	t.Helper()
	draft, err := service.SaveOpening(t.Context(), SaveOpeningInput{
		BookID: book.ID, Revision: 0,
		Lines: []OpeningLineInput{}, Assets: []OpeningAssetInput{}, Bills: []OpeningBillInput{}, Containers: []OpeningContainerInput{},
	}, integrationACCActor(t, adminID, "acc-zero-opening-save-"+book.ID))
	if err != nil {
		t.Fatalf("save zero opening for %s: %v", book.Code, err)
	}
	approved := approveIntegrationOpening(t, service, book.ID, draft)
	if approved.Approval.Status != approval.StatusApproved {
		t.Fatalf("approve zero opening for %s: %+v", book.Code, approved)
	}
}

func approveIntegrationMapping(t *testing.T, service *Service, bookID, entity string, draft MappingView) MappingView {
	t.Helper()
	ensureIntegrationBookAccess(t, service, bookID, operatorID)
	submitter := integrationACCActor(t, adminID, fmt.Sprintf("acc-mapping-submit-%s-%s", bookID, entity))
	reviewer := integrationACCActor(t, operatorID, fmt.Sprintf("acc-mapping-approve-%s-%s", bookID, entity))
	pending, err := service.SubmitMapping(t.Context(), mappingInput(bookID, entity, draft), submitter)
	if err != nil {
		t.Fatalf("submit integration mapping: %v", err)
	}
	approved, err := service.ApproveMapping(t.Context(), mappingInput(bookID, entity, pending), reviewer)
	if err != nil {
		t.Fatalf("approve integration mapping: %v", err)
	}
	return approved
}
