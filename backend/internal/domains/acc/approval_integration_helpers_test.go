//go:build integration

package acc

import (
	"fmt"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
)

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
