//go:build integration

package rpt

import (
	"context"
	"errors"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/events/rptapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

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

func approveRPTVersion(t *testing.T, service *Service, code string, value MutationResult) MutationResult {
	t.Helper()
	pending, err := service.Submit(t.Context(), VersionActionInput{
		Code: code, ApprovalEntryID: value.Approval.ApprovalEntryID, Revision: value.Approval.Revision,
	}, rptActor(t, rptSubmitterID, "rpt-submit-"+code))
	if err != nil {
		t.Fatalf("submit report version: %v", err)
	}
	approved, err := service.Approve(t.Context(), VersionActionInput{
		Code: code, ApprovalEntryID: pending.Approval.ApprovalEntryID, Revision: pending.Approval.Revision,
	}, rptActor(t, rptReviewerID, "rpt-approve-"+code))
	if err != nil {
		t.Fatalf("approve report version: %v", err)
	}
	return approved
}

func TestRPTCentralVersioningCandidateLatestAndHistoricalSnapshotIntegration(t *testing.T) {
	pool := rptIntegrationPool(t)
	seedRPTActors(t, pool)
	service, err := NewService(pool, authorization.Func(nil), txevent.NewBus())
	if err != nil {
		t.Fatal(err)
	}
	code := rptCode()
	first, err := service.CreateDefinition(t.Context(), DefinitionCreateInput{
		Code: code, Name: "中央版本报表", Data: rptData(`SELECT 'v1'::text AS value`, "value"),
	}, rptActor(t, rptSubmitterID, "rpt-create-"+code))
	if err != nil || first.Approval.VersionNo != 1 || first.Approval.Status != approval.StatusDraft {
		t.Fatalf("create = %+v, err=%v", first, err)
	}
	first = approveRPTVersion(t, service, code, first)

	second, err := service.CreateVersion(t.Context(), VersionCreateInput{Code: code}, rptActor(t, rptSubmitterID, "rpt-next-"+code))
	if err != nil || second.Approval.VersionNo != 2 || second.Approval.Status != approval.StatusDraft {
		t.Fatalf("create next = %+v, err=%v", second, err)
	}
	if _, err = service.CreateVersion(t.Context(), VersionCreateInput{Code: code}, rptActor(t, rptSubmitterID, "rpt-next-conflict-"+code)); !rptErrorKind(err, ErrorConflict) {
		t.Fatalf("second open candidate err=%v", err)
	}
	preferred, err := service.GetDefinition(t.Context(), DefinitionGetInput{Code: code}, rptActor(t, rptSubmitterID, "rpt-get-open-"+code))
	if err != nil || preferred.Approval.ApprovalEntryID != second.Approval.ApprovalEntryID {
		t.Fatalf("preferred = %+v, err=%v", preferred, err)
	}
	exactFirst, err := service.GetDefinition(t.Context(), DefinitionGetInput{Code: code, ApprovalEntryID: first.Approval.ApprovalEntryID}, rptActor(t, rptSubmitterID, "rpt-get-v1-"+code))
	if err != nil || exactFirst.Data.SQL != `SELECT 'v1'::text AS value` {
		t.Fatalf("exact v1 = %+v, err=%v", exactFirst, err)
	}
	if _, err = service.Unapprove(t.Context(), VersionReasonActionInput{VersionActionInput: VersionActionInput{Code: code, ApprovalEntryID: first.Approval.ApprovalEntryID, Revision: first.Approval.Revision}, Reason: "重开"}, rptActor(t, rptReviewerID, "rpt-unapprove-blocked-"+code)); !rptErrorKind(err, ErrorConflict) {
		t.Fatalf("unapprove with candidate err=%v", err)
	}
	if err = service.DeleteVersion(t.Context(), VersionDeleteInput{Code: code, ApprovalEntryID: second.Approval.ApprovalEntryID, Revision: second.Approval.Revision}, rptActor(t, rptSubmitterID, "rpt-delete-v2-"+code)); err != nil {
		t.Fatal(err)
	}

	second, err = service.CreateVersion(t.Context(), VersionCreateInput{Code: code}, rptActor(t, rptSubmitterID, "rpt-next-again-"+code))
	if err != nil {
		t.Fatal(err)
	}
	second, err = service.SaveVersion(t.Context(), VersionSaveInput{Code: code, ApprovalEntryID: second.Approval.ApprovalEntryID, Revision: second.Approval.Revision, Data: rptData(`SELECT 'v2'::text AS value`, "value")}, rptActor(t, rptSubmitterID, "rpt-save-v2-"+code))
	if err != nil {
		t.Fatal(err)
	}
	second = approveRPTVersion(t, service, code, second)
	exactFirst, err = service.GetDefinition(t.Context(), DefinitionGetInput{Code: code, ApprovalEntryID: first.Approval.ApprovalEntryID}, rptActor(t, rptSubmitterID, "rpt-get-history-"+code))
	if err != nil || exactFirst.Data.SQL != `SELECT 'v1'::text AS value` || second.Approval.VersionNo != 2 {
		t.Fatalf("historical snapshot = %+v, current=%+v err=%v", exactFirst, second, err)
	}
}

func TestRPTBuiltInQueryAndExportUseLatestApprovedVersionIntegration(t *testing.T) {
	pool := rptIntegrationPool(t)
	seedRPTActors(t, pool)
	service, err := NewService(pool, authorization.Func(nil), txevent.NewBus())
	if err != nil {
		t.Fatal(err)
	}
	input := ExecuteInput{Parameters: map[string]any{
		"bookId": "", "subjectId": "", "currency": "",
		"dateRange": []any{"1900-01-01", "9999-12-31"},
	}}
	result, err := service.Execute(t.Context(), "account-journal", input, rptSubmitterID, "rpt-query-built-in")
	if err != nil {
		t.Fatalf("execute built-in report: %v", err)
	}
	if len(result.Columns) != 10 {
		t.Fatalf("query columns=%d", len(result.Columns))
	}
	exported := false
	err = service.StreamExport(t.Context(), "account-journal", input, rptSubmitterID, "rpt-export-built-in", func(columns []ResultColumn, rows pgx.Rows) error {
		exported = len(columns) == len(result.Columns)
		for rows.Next() {
			if _, scanErr := rows.Values(); scanErr != nil {
				return scanErr
			}
		}
		return rows.Err()
	})
	if err != nil {
		t.Fatalf("export built-in report: %v", err)
	}
	if !exported {
		t.Fatal("export did not receive the approved report columns")
	}
}

func TestRPTApprovalSubscriberFailureRollsBackIntegration(t *testing.T) {
	pool := rptIntegrationPool(t)
	seedRPTActors(t, pool)
	bus := txevent.NewBus()
	failure := errors.New("subscriber rejected report")
	if err := bus.Subscribe(rptapproval.Topic().Name(), "rpt-integration-rejector", func(context.Context, pgx.Tx, txevent.Event) error { return failure }); err != nil {
		t.Fatal(err)
	}
	service, err := NewService(pool, authorization.Func(nil), bus)
	if err != nil {
		t.Fatal(err)
	}
	code := rptCode()
	_, err = service.CreateDefinition(t.Context(), DefinitionCreateInput{Code: code, Name: "回滚报表", Data: rptData(`SELECT 'rollback'::text AS value`, "value")}, rptActor(t, rptSubmitterID, "rpt-rollback-create"))
	if err == nil {
		t.Fatal("expected subscriber failure")
	}
	var definitions int
	if scanErr := pool.QueryRow(t.Context(), `SELECT count(*) FROM rpt_definitions WHERE code=$1`, code).Scan(&definitions); scanErr != nil {
		t.Fatal(scanErr)
	}
	if definitions != 0 {
		t.Fatalf("subscriber failure committed definitions=%d", definitions)
	}
}

func rptErrorKind(err error, want ErrorKind) bool {
	var target *DomainError
	return errors.As(err, &target) && target.Kind == want
}
