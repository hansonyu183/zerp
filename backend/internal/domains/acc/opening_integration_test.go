//go:build integration

package acc

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/events/accapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
)

func openingLifecycleActor(t *testing.T, actorID, requestID string) approval.Actor {
	t.Helper()
	actor, err := approval.UserActor(authorization.Principal{
		ActorID: actorID,
		Permissions: []string{
			"/acc/opening/submit",
			"/acc/opening/unsubmit",
			"/acc/opening/reject",
			"/acc/opening/approve",
			"/acc/opening/unapprove",
		},
	}, requestID)
	if err != nil {
		t.Fatal(err)
	}
	return actor
}

func requireOpeningErrorKey(t *testing.T, err error, want string) {
	t.Helper()
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != want {
		t.Fatalf("error = %v, want %s", err, want)
	}
}

func TestAccountingOpeningCentralApprovalLifecycleAndEventRollbackIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	bus := txevent.NewBus()
	service := integrationACCService(pool, bus)
	operator := openingLifecycleActor(t, operatorID, "acc-opening-operator")
	reviewer := openingLifecycleActor(t, adminID, "acc-opening-reviewer")
	book, err := service.CreateBook(t.Context(), CreateBookInput{Name: "中央审批期初", StartMonth: "2026-08", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty, QueryUserIDs: []string{operatorID}, OperateUserIDs: []string{operatorID}}, adminID)
	if err != nil {
		t.Fatal(err)
	}

	opening, err := service.SaveOpening(t.Context(), SaveOpeningInput{BookID: book.ID, Revision: 0, Lines: []OpeningLineInput{}, Assets: []OpeningAssetInput{}, Bills: []OpeningBillInput{}, Containers: []OpeningContainerInput{}}, operator)
	if err != nil || opening.Approval.Status != approval.StatusDraft || opening.Approval.Revision != 1 || !slices.Equal(opening.AvailableApprovalActions, []approval.LifecycleAction{approval.LifecycleSubmit}) {
		t.Fatalf("save = %+v, err=%v", opening, err)
	}
	var versionNo *int32
	if err = pool.QueryRow(t.Context(), `SELECT version_no FROM approval_entries WHERE domain='acc' AND entity='opening' AND subject_id=$1`, book.ID).Scan(&versionNo); err != nil || versionNo != nil {
		t.Fatalf("opening version_no=%v err=%v", versionNo, err)
	}

	pending, err := service.SubmitOpening(t.Context(), book.ID, opening.Approval.Revision, operator)
	if err != nil || pending.Approval.Status != approval.StatusPending || !slices.Equal(pending.AvailableApprovalActions, []approval.LifecycleAction{approval.LifecycleUnsubmit}) {
		t.Fatalf("submit = %+v err=%v", pending, err)
	}
	reviewerPending, err := service.GetOpening(t.Context(), book.ID, reviewer)
	if err != nil || !slices.Equal(reviewerPending.AvailableApprovalActions, []approval.LifecycleAction{approval.LifecycleUnsubmit, approval.LifecycleReject, approval.LifecycleApprove}) {
		t.Fatalf("reviewer query = %+v err=%v", reviewerPending, err)
	}
	_, err = service.ApproveOpening(t.Context(), book.ID, pending.Approval.Revision, operator)
	requireOpeningErrorKey(t, err, "approval_self_review_forbidden")
	_, err = service.RejectOpening(t.Context(), book.ID, pending.Approval.Revision, "self reject", operator)
	requireOpeningErrorKey(t, err, "approval_self_review_forbidden")
	_, err = service.RejectOpening(t.Context(), book.ID, pending.Approval.Revision, "", reviewer)
	requireOpeningErrorKey(t, err, "approval_reason_required")
	rejected, err := service.RejectOpening(t.Context(), book.ID, pending.Approval.Revision, "adjust opening", reviewer)
	if err != nil || rejected.Approval.Status != approval.StatusDraft || !slices.Equal(rejected.AvailableApprovalActions, []approval.LifecycleAction{approval.LifecycleSubmit}) {
		t.Fatalf("reject = %+v err=%v", rejected, err)
	}
	pending, err = service.SubmitOpening(t.Context(), book.ID, rejected.Approval.Revision, operator)
	if err != nil || pending.Approval.Status != approval.StatusPending {
		t.Fatalf("resubmit = %+v err=%v", pending, err)
	}
	_, err = service.ApproveOpening(t.Context(), book.ID, pending.Approval.Revision-1, reviewer)
	requireOpeningErrorKey(t, err, "approval_stale_revision")
	if _, err = service.SaveOpening(t.Context(), SaveOpeningInput{BookID: book.ID, Revision: pending.Approval.Revision}, operator); !IsKind(err, ErrorConflict) {
		t.Fatalf("save pending err=%v", err)
	}

	failingBus := txevent.NewBus()
	if err = accapproval.Topic("opening").Subscribe(failingBus, "reject-approval", func(context.Context, pgx.Tx, approval.Event[accapproval.Payload]) error {
		return errors.New("subscriber failed")
	}); err != nil {
		t.Fatal(err)
	}
	failing := integrationACCService(pool, failingBus)
	if _, err = failing.ApproveOpening(t.Context(), book.ID, pending.Approval.Revision, reviewer); !IsKind(err, ErrorInternal) {
		t.Fatalf("approve failure=%v", err)
	}
	unchanged, err := service.GetOpening(t.Context(), book.ID, operator)
	if err != nil || unchanged.Approval.Status != approval.StatusPending || unchanged.Approval.Revision != pending.Approval.Revision || unchanged.VoucherID != nil {
		t.Fatalf("rollback = %+v err=%v", unchanged, err)
	}

	approved, err := service.ApproveOpening(t.Context(), book.ID, pending.Approval.Revision, reviewer)
	if err != nil || approved.Approval.Status != approval.StatusApproved || approved.VoucherID == nil || !slices.Equal(approved.AvailableApprovalActions, []approval.LifecycleAction{approval.LifecycleUnapprove}) {
		t.Fatalf("approve = %+v err=%v", approved, err)
	}
	reopened, err := service.UnapproveOpening(t.Context(), book.ID, approved.Approval.Revision, "期初重开", reviewer)
	if err != nil || reopened.Approval.Status != approval.StatusPending || reopened.VoucherID != nil {
		t.Fatalf("unapprove = %+v err=%v", reopened, err)
	}
}
