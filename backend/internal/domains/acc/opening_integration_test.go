//go:build integration

package acc

import (
	"context"
	"errors"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/events/accapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
)

func TestAccountingOpeningCentralApprovalLifecycleAndEventRollbackIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	bus := txevent.NewBus()
	service := integrationACCService(pool, bus)
	operator := integrationACCActor(t, operatorID, "acc-opening-operator")
	reviewer := integrationACCActor(t, adminID, "acc-opening-reviewer")
	book, err := service.CreateBook(t.Context(), CreateBookInput{Name: "中央审批期初", StartMonth: "2026-08", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty, QueryUserIDs: []string{operatorID}, OperateUserIDs: []string{operatorID}}, adminID)
	if err != nil {
		t.Fatal(err)
	}

	opening, err := service.SaveOpening(t.Context(), SaveOpeningInput{BookID: book.ID, Revision: 0, Lines: []OpeningLineInput{}, Assets: []OpeningAssetInput{}, Bills: []OpeningBillInput{}, Containers: []OpeningContainerInput{}}, operator)
	if err != nil || opening.Approval.Status != approval.StatusDraft || opening.Approval.Revision != 1 {
		t.Fatalf("save = %+v, err=%v", opening, err)
	}
	var versionNo *int32
	if err = pool.QueryRow(t.Context(), `SELECT version_no FROM approval_entries WHERE domain='acc' AND entity='opening' AND subject_id=$1`, book.ID).Scan(&versionNo); err != nil || versionNo != nil {
		t.Fatalf("opening version_no=%v err=%v", versionNo, err)
	}

	pending, err := service.SubmitOpening(t.Context(), book.ID, opening.Approval.Revision, operator)
	if err != nil || pending.Approval.Status != approval.StatusPending {
		t.Fatalf("submit = %+v err=%v", pending, err)
	}
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
	if err != nil || approved.Approval.Status != approval.StatusApproved || approved.VoucherID == nil {
		t.Fatalf("approve = %+v err=%v", approved, err)
	}
	reopened, err := service.UnapproveOpening(t.Context(), book.ID, approved.Approval.Revision, "期初重开", reviewer)
	if err != nil || reopened.Approval.Status != approval.StatusPending || reopened.VoucherID != nil {
		t.Fatalf("unapprove = %+v err=%v", reopened, err)
	}
}
