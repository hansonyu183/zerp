//go:build integration

package dcl

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	rptdomain "github.com/hansonyu183/zerp/backend/internal/domains/rpt"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	rptDefinitionCreatorID  = "01JDCRPT000000000000000001"
	rptDefinitionReviewerID = "01JDCRPT000000000000000002"
)

type rptQueryOnlyAuthorizer struct{}

func (rptQueryOnlyAuthorizer) RequirePermission(_ context.Context, _ authorization.Principal, path, _ string) error {
	if path == "/dcl/rpt-definition/query" {
		return nil
	}
	return errors.New("permission denied: " + path)
}

func resetRptDefinitionIntegrationData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	cleanup := func(ctx context.Context) error {
		statements := []struct {
			sql  string
			args []any
		}{
			{sql: `DELETE FROM rpt_runtime_audit_events audit USING rpt_definitions definition WHERE audit.definition_id=definition.id AND definition.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM app_role_permissions WHERE permission_id IN (SELECT permission.id FROM app_permissions permission JOIN rpt_definitions definition ON definition.code=permission.entity WHERE permission.domain='rpt' AND definition.created_by<>'SYSTEM')`},
			{sql: `DELETE FROM app_permissions permission USING rpt_definitions definition WHERE permission.domain='rpt' AND permission.entity=definition.code AND definition.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM dcl_rpt_definition_versions payload USING rpt_definitions definition WHERE payload.definition_id=definition.id AND definition.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM approval_events event USING rpt_definitions definition WHERE event.domain='dcl' AND event.entity='rpt-definition' AND event.subject_id=definition.id AND definition.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM approval_entries entry USING rpt_definitions definition WHERE entry.domain='dcl' AND entry.entity='rpt-definition' AND entry.subject_id=definition.id AND definition.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM dcl_subjects subject USING rpt_definitions definition WHERE subject.entity='rpt-definition' AND subject.id=definition.id AND definition.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM rpt_definitions WHERE created_by<>'SYSTEM'`},
			{sql: `DELETE FROM app_users WHERE id IN ($1,$2)`, args: []any{rptDefinitionCreatorID, rptDefinitionReviewerID}},
		}
		for _, statement := range statements {
			if _, err := pool.Exec(ctx, statement.sql, statement.args...); err != nil {
				return err
			}
		}
		return nil
	}
	if err := cleanup(t.Context()); err != nil {
		t.Fatalf("reset report definition integration data: %v", err)
	}
	t.Cleanup(func() {
		if err := cleanup(context.Background()); err != nil {
			t.Errorf("clean report definition integration data: %v", err)
		}
	})
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO app_users(id,username,display_name,password_hash,status,password_changed_at,created_by,updated_by)
		VALUES
			($1,'dcl-rpt-creator','报表申报人','hash','ENABLED',now(),$1,$1),
			($2,'dcl-rpt-reviewer','报表审核人','hash','ENABLED',now(),$1,$1)`,
		rptDefinitionCreatorID, rptDefinitionReviewerID); err != nil {
		t.Fatalf("seed report definition actors: %v", err)
	}
}

func rptDefinitionTestData(t *testing.T, value string) RptDefinitionData {
	t.Helper()
	parameters, err := json.Marshal([]rptdomain.Parameter{})
	if err != nil {
		t.Fatal(err)
	}
	columns, err := json.Marshal([]rptdomain.ResultColumn{{
		Alias: "value", Name: "值", Order: 1, Type: rptdomain.ResultTypeText,
		Width: 120, Visible: true,
	}})
	if err != nil {
		t.Fatal(err)
	}
	return RptDefinitionData{
		SQL:        `SELECT '` + value + `'::text AS value`,
		Parameters: parameters,
		Columns:    columns,
	}
}

func approveRptDefinition(t *testing.T, service *RptDefinitionService, mutation RptDefinitionMutation) RptDefinitionMutation {
	t.Helper()
	pending, err := service.Submit(t.Context(), RptDefinitionVersionInput{
		Code: mutation.Code, ApprovalEntryID: mutation.Approval.ApprovalEntryID,
		ApprovalRevision: mutation.Approval.Revision, ValidationParameters: map[string]any{},
	}, dclActor(t, rptDefinitionCreatorID, "dcl-rpt-submit-"+mutation.Code))
	if err != nil {
		t.Fatalf("submit report definition: %v", err)
	}
	approved, err := service.Approve(t.Context(), RptDefinitionVersionInput{
		Code: mutation.Code, ApprovalEntryID: pending.Approval.ApprovalEntryID,
		ApprovalRevision: pending.Approval.Revision, ValidationParameters: map[string]any{},
	}, dclActor(t, rptDefinitionReviewerID, "dcl-rpt-approve-"+mutation.Code))
	if err != nil {
		t.Fatalf("approve report definition: %v", err)
	}
	return approved
}

func TestDclRptDefinitionCurrentSwitchFallbackAndAuditIdentityIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetRptDefinitionIntegrationData(t, pool)
	bus := txevent.NewBus()
	rptService, err := rptdomain.NewService(pool)
	if err != nil {
		t.Fatal(err)
	}
	service := NewRptDefinitionService(pool, rptService, authorization.Func(nil), bus)
	v1, err := service.Create(t.Context(), RptDefinitionCreateInput{
		Name: "当前版本 V1", Data: rptDefinitionTestData(t, "v1"),
	}, dclActor(t, rptDefinitionCreatorID, "dcl-rpt-create-v1"))
	if err != nil {
		t.Fatal(err)
	}
	code := v1.Code
	v1 = approveRptDefinition(t, service, v1)
	queryOnlyService := NewRptDefinitionService(pool, rptService, rptQueryOnlyAuthorizer{}, txevent.NewBus())
	page, err := queryOnlyService.Query(t.Context(), RptDefinitionQueryInput{
		Page: 1, PageSize: 20, Filters: RptDefinitionFilters{IncludeDisabled: true},
		Sort: []RptDefinitionSort{{Field: "code", Order: "asc"}},
	}, dclActor(t, rptDefinitionCreatorID, "dcl-rpt-query-only"))
	var queried *RptDefinitionListItem
	for index := range page.Items {
		if page.Items[index].Code == code {
			queried = &page.Items[index]
			break
		}
	}
	if err != nil || queried == nil || queried.LatestApproved == nil || queried.LatestApproved.Approval.ApprovalEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("query-only summary = %+v, err=%v", page, err)
	}
	result, err := rptService.Execute(t.Context(), code, rptdomain.ExecuteInput{Parameters: map[string]any{}}, rptDefinitionCreatorID, "dcl-rpt-execute-v1")
	if err != nil || len(result.Items) != 1 || result.Items[0]["value"] != "v1" {
		t.Fatalf("execute V1 = %+v, err=%v", result, err)
	}
	var auditEntryID string
	if err = pool.QueryRow(t.Context(), `SELECT approval_entry_id FROM rpt_runtime_audit_events WHERE request_id='dcl-rpt-execute-v1'`).Scan(&auditEntryID); err != nil {
		t.Fatal(err)
	}
	if auditEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("runtime audit entry=%q, want %q", auditEntryID, v1.Approval.ApprovalEntryID)
	}

	v2, err := service.CreateNext(t.Context(), RptDefinitionVersionInput{
		Code: code, ApprovalEntryID: v1.Approval.ApprovalEntryID,
		ApprovalRevision: v1.Approval.Revision,
	}, dclActor(t, rptDefinitionCreatorID, "dcl-rpt-create-v2"))
	if err != nil {
		t.Fatal(err)
	}
	name, description := "当前版本 V2", "V2 描述"
	v2, err = service.Save(t.Context(), RptDefinitionSaveInput{
		Code: code, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision, Name: &name, Description: &description,
		Data: rptDefinitionTestData(t, "v2"),
	}, dclActor(t, rptDefinitionCreatorID, "dcl-rpt-save-v2"))
	if err != nil {
		t.Fatal(err)
	}
	v2 = approveRptDefinition(t, service, v2)
	result, err = rptService.Execute(t.Context(), code, rptdomain.ExecuteInput{Parameters: map[string]any{}}, rptDefinitionCreatorID, "dcl-rpt-execute-v2")
	if err != nil || result.Items[0]["value"] != "v2" {
		t.Fatalf("execute V2 = %+v, err=%v", result, err)
	}

	v2Draft, err := service.Unapprove(t.Context(), RptDefinitionReviewInput{
		Code: code, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision, Reason: "回落验证",
	}, dclActor(t, rptDefinitionReviewerID, "dcl-rpt-unapprove-v2"))
	if err != nil {
		t.Fatal(err)
	}
	result, err = rptService.Execute(t.Context(), code, rptdomain.ExecuteInput{Parameters: map[string]any{}}, rptDefinitionCreatorID, "dcl-rpt-execute-fallback")
	if err != nil || result.Items[0]["value"] != "v1" {
		t.Fatalf("execute fallback V1 = %+v, err=%v", result, err)
	}
	v2Draft, err = service.Unsubmit(t.Context(), RptDefinitionReviewInput{
		Code: code, ApprovalEntryID: v2Draft.Approval.ApprovalEntryID,
		ApprovalRevision: v2Draft.Approval.Revision,
	}, dclActor(t, rptDefinitionCreatorID, "dcl-rpt-unsubmit-v2"))
	if err != nil {
		t.Fatal(err)
	}
	if err = service.Delete(t.Context(), RptDefinitionDeleteInput{
		Code: code, ApprovalEntryID: v2Draft.Approval.ApprovalEntryID,
		ApprovalRevision: v2Draft.Approval.Revision,
	}, dclActor(t, rptDefinitionCreatorID, "dcl-rpt-delete-v2")); err != nil {
		t.Fatal(err)
	}
	v2Replacement, err := service.CreateNext(t.Context(), RptDefinitionVersionInput{
		Code: code, ApprovalEntryID: v1.Approval.ApprovalEntryID,
		ApprovalRevision: v1.Approval.Revision,
	}, dclActor(t, rptDefinitionCreatorID, "dcl-rpt-recreate-v2"))
	if err != nil {
		t.Fatal(err)
	}
	if v2Replacement.Approval.VersionNo != 2 {
		t.Fatalf("replacement candidate version=%d, want 2", v2Replacement.Approval.VersionNo)
	}
}

func TestDclRptDefinitionSubscriberFailureRollsBackIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetRptDefinitionIntegrationData(t, pool)
	bus := txevent.NewBus()
	failure := errors.New("reject DCL report definition event")
	if err := bus.Subscribe(dclapproval.RptDefinitionTopic.Name(), "dcl-rpt-rejector", func(context.Context, pgx.Tx, txevent.Event) error {
		return failure
	}); err != nil {
		t.Fatal(err)
	}
	rptService, err := rptdomain.NewService(pool)
	if err != nil {
		t.Fatal(err)
	}
	service := NewRptDefinitionService(pool, rptService, authorization.Func(nil), bus)
	_, err = service.Create(t.Context(), RptDefinitionCreateInput{
		Name: "事务回滚", Data: rptDefinitionTestData(t, "rollback"),
	}, dclActor(t, rptDefinitionCreatorID, "dcl-rpt-rollback"))
	if err == nil {
		t.Fatal("expected subscriber failure")
	}
	var definitions, subjects, versions int
	if scanErr := pool.QueryRow(t.Context(), `
		SELECT
			(SELECT count(*) FROM rpt_definitions WHERE created_by=$1),
			(SELECT count(*) FROM dcl_subjects WHERE entity='rpt-definition' AND created_by=$1),
			(SELECT count(*) FROM dcl_rpt_definition_versions WHERE created_by=$1)
	`, rptDefinitionCreatorID).Scan(&definitions, &subjects, &versions); scanErr != nil {
		t.Fatal(scanErr)
	}
	if definitions != 0 || subjects != 0 || versions != 0 {
		t.Fatalf("subscriber failure committed definition=%d subject=%d version=%d", definitions, subjects, versions)
	}
}
