//go:build integration

package dcl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	rptdomain "github.com/hansonyu183/zerp/backend/internal/domains/rpt"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
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

type rptPermissionAuthorizer struct {
	allowed map[string]bool
}

func (a *rptPermissionAuthorizer) RequirePermission(_ context.Context, _ authorization.Principal, path, _ string) error {
	if a.allowed[path] {
		return nil
	}
	return authorization.NewError(authorization.ErrorForbidden, "permission denied: "+path, nil)
}

func resetRptDefinitionIntegrationData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	cleanup := func(ctx context.Context) error {
		statements := []struct {
			sql  string
			args []any
		}{
			{sql: `DELETE FROM rpt_runtime_audit_events audit USING dcl_subjects subject WHERE audit.definition_id=subject.id AND subject.entity='rpt-definition' AND subject.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM app_role_permissions WHERE permission_id IN (SELECT permission.id FROM app_permissions permission JOIN dcl_subjects subject ON subject.code=permission.entity AND subject.entity='rpt-definition' WHERE permission.domain='rpt' AND subject.created_by<>'SYSTEM')`},
			{sql: `DELETE FROM app_permissions permission USING dcl_subjects subject WHERE permission.domain='rpt' AND permission.entity=subject.code AND subject.entity='rpt-definition' AND subject.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM dcl_rpt_definition_versions payload USING approval_entries entry, dcl_subjects subject WHERE payload.approval_entry_id=entry.id AND entry.subject_id=subject.id AND subject.entity='rpt-definition' AND subject.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM approval_events event USING dcl_subjects subject WHERE event.domain='dcl' AND event.entity='rpt-definition' AND event.subject_id=subject.id AND subject.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM approval_entries entry USING dcl_subjects subject WHERE entry.domain='dcl' AND entry.entity='rpt-definition' AND entry.subject_id=subject.id AND subject.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM dcl_subjects WHERE entity='rpt-definition' AND created_by<>'SYSTEM'`},
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
		Name: "当前版本 V1", Enabled: true, Data: rptDefinitionTestData(t, "v1"),
	}, dclActor(t, rptDefinitionCreatorID, "dcl-rpt-create-v1"))
	if err != nil {
		t.Fatalf("create report definition: %v: %v", err, errors.Unwrap(err))
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
		Enabled: true, Data: rptDefinitionTestData(t, "v2"),
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
	v2Draft, err = service.Unsubmit(t.Context(), RptDefinitionVersionInput{
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

func TestRptDefinitionOwnershipIsSplitAcrossDclApprovalAndRptIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)

	var obsoleteRootExists, validityTableExists bool
	if err := pool.QueryRow(t.Context(), `
		SELECT to_regclass('public.rpt_definitions') IS NOT NULL,
		       to_regclass('public.rpt_definition_validities') IS NOT NULL
	`).Scan(&obsoleteRootExists, &validityTableExists); err != nil {
		t.Fatal(err)
	}
	if obsoleteRootExists {
		t.Fatal("RPT must not retain a second report-definition stable root")
	}
	if !validityTableExists {
		t.Fatal("RPT technical validity must use its own approval-entry keyed table")
	}

	rows, err := pool.Query(t.Context(), `
		SELECT column_name
		FROM information_schema.columns
		WHERE table_schema='public' AND table_name='dcl_rpt_definition_versions'
	`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	columns := map[string]bool{}
	for rows.Next() {
		var column string
		if err = rows.Scan(&column); err != nil {
			t.Fatal(err)
		}
		columns[column] = true
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !columns["enabled"] {
		t.Fatal("DCL report-definition snapshot must own enabled")
	}
	for _, rptOwnedColumn := range []string{"validity", "invalidated_at", "invalid_reason"} {
		if columns[rptOwnedColumn] {
			t.Fatalf("RPT-owned technical state remains in DCL snapshot: %s", rptOwnedColumn)
		}
	}
}

func TestDclRptDefinitionCodesUseGenericCounterConcurrentlyIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetRptDefinitionIntegrationData(t, pool)

	var dedicatedCounterExists bool
	if err := pool.QueryRow(t.Context(), `
		SELECT to_regclass('public.dcl_rpt_definition_code_counters') IS NOT NULL
	`).Scan(&dedicatedCounterExists); err != nil {
		t.Fatal(err)
	}
	if dedicatedCounterExists {
		t.Fatal("RPT definition codes must not retain a dedicated counter table")
	}
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO object_number_counters(domain,entity,last_value)
		VALUES('dcl','rpt-definition',9998)
		ON CONFLICT(domain,entity) DO UPDATE SET last_value=EXCLUDED.last_value
	`); err != nil {
		t.Fatalf("seed generic RPT counter: %v", err)
	}

	rptService, err := rptdomain.NewService(pool)
	if err != nil {
		t.Fatal(err)
	}
	service := NewRptDefinitionService(pool, rptService, authorization.Func(nil), txevent.NewBus())
	const createCount = 4
	inputs := make([]RptDefinitionCreateInput, createCount)
	actors := make([]approval.Actor, createCount)
	for index := range createCount {
		inputs[index] = RptDefinitionCreateInput{
			Name: fmt.Sprintf("并发编号 %d", index),
			Data: rptDefinitionTestData(t, fmt.Sprintf("counter-%d", index)),
		}
		actors[index] = dclActor(t, rptDefinitionCreatorID, fmt.Sprintf("dcl-rpt-counter-%d", index))
	}
	ctx := t.Context()
	codes := make(chan string, createCount)
	errs := make(chan error, createCount)
	var wait sync.WaitGroup
	for index := range createCount {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			mutation, createErr := service.Create(ctx, inputs[index], actors[index])
			if createErr != nil {
				errs <- createErr
				return
			}
			codes <- mutation.Code
		}(index)
	}
	wait.Wait()
	close(codes)
	close(errs)
	for createErr := range errs {
		t.Errorf("concurrent report definition create: %v", createErr)
	}
	if t.Failed() {
		return
	}

	actualCodes := make([]string, 0, createCount)
	for code := range codes {
		actualCodes = append(actualCodes, code)
	}
	sort.Strings(actualCodes)
	wantCodes := []string{"rpt-009999", "rpt-010000", "rpt-010001", "rpt-010002"}
	if fmt.Sprint(actualCodes) != fmt.Sprint(wantCodes) {
		t.Fatalf("concurrent report definition codes = %v, want %v", actualCodes, wantCodes)
	}

	var lastValue int64
	if err = pool.QueryRow(t.Context(), `
		SELECT last_value FROM object_number_counters
		WHERE domain='dcl' AND entity='rpt-definition'
	`).Scan(&lastValue); err != nil {
		t.Fatal(err)
	}
	if lastValue != 10002 {
		t.Fatalf("generic RPT counter last value = %d, want 10002", lastValue)
	}
}

func TestDclRptDefinitionCodesStartFreshAndNeverReuseAfterDeleteIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetRptDefinitionIntegrationData(t, pool)
	if _, err := pool.Exec(t.Context(), `
		DELETE FROM object_number_counters
		WHERE domain='dcl' AND entity='rpt-definition'
	`); err != nil {
		t.Fatalf("reset generic RPT counter: %v", err)
	}

	rptService, err := rptdomain.NewService(pool)
	if err != nil {
		t.Fatal(err)
	}
	service := NewRptDefinitionService(pool, rptService, authorization.Func(nil), txevent.NewBus())
	actor := dclActor(t, rptDefinitionCreatorID, "dcl-rpt-counter-no-reuse")
	first, err := service.Create(t.Context(), RptDefinitionCreateInput{
		Name: "首次编号", Data: rptDefinitionTestData(t, "first-counter"),
	}, actor)
	if err != nil {
		t.Fatalf("create first report definition: %v", err)
	}
	if first.Code != "rpt-000001" {
		t.Fatalf("fresh report definition code = %q, want rpt-000001", first.Code)
	}

	if err = service.Delete(t.Context(), RptDefinitionDeleteInput{
		Code: first.Code, ApprovalEntryID: first.Approval.ApprovalEntryID,
		ApprovalRevision: first.Approval.Revision,
	}, actor); err != nil {
		t.Fatalf("delete first report definition: %v", err)
	}
	second, err := service.Create(t.Context(), RptDefinitionCreateInput{
		Name: "删除后编号", Data: rptDefinitionTestData(t, "second-counter"),
	}, actor)
	if err != nil {
		t.Fatalf("create report definition after delete: %v", err)
	}
	if second.Code != "rpt-000002" {
		t.Fatalf("report definition code after delete = %q, want rpt-000002", second.Code)
	}
}

func TestDclRptDefinitionCreateAndSaveCannotBypassEnabledPermissionsIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetRptDefinitionIntegrationData(t, pool)
	rptService, err := rptdomain.NewService(pool)
	if err != nil {
		t.Fatal(err)
	}
	authorizer := &rptPermissionAuthorizer{allowed: map[string]bool{
		"/dcl/rpt-definition/create": true,
	}}
	service := NewRptDefinitionService(pool, rptService, authorizer, txevent.NewBus())
	actor := dclActor(t, rptDefinitionCreatorID, "dcl-rpt-enabled-permissions")

	_, err = service.Create(t.Context(), RptDefinitionCreateInput{
		Name: "权限验证", Enabled: true, Data: rptDefinitionTestData(t, "enabled"),
	}, actor)
	assertRptDefinitionForbidden(t, err)

	authorizer.allowed["/dcl/rpt-definition/enable"] = true
	created, err := service.Create(t.Context(), RptDefinitionCreateInput{
		Name: "权限验证", Enabled: true, Data: rptDefinitionTestData(t, "enabled"),
	}, actor)
	if err != nil {
		t.Fatalf("create with create and enable permissions: %v", err)
	}

	authorizer.allowed["/dcl/rpt-definition/save"] = true
	name := "权限验证已保存"
	saved, err := service.Save(t.Context(), RptDefinitionSaveInput{
		Code: created.Code, ApprovalEntryID: created.Approval.ApprovalEntryID,
		ApprovalRevision: created.Approval.Revision, Name: &name, Enabled: true,
		Data: rptDefinitionTestData(t, "saved"),
	}, actor)
	if err != nil {
		t.Fatalf("save without changing enabled state: %v", err)
	}

	_, err = service.Save(t.Context(), RptDefinitionSaveInput{
		Code: saved.Code, ApprovalEntryID: saved.Approval.ApprovalEntryID,
		ApprovalRevision: saved.Approval.Revision, Name: &name, Enabled: false,
		Data: rptDefinitionTestData(t, "disabled"),
	}, actor)
	assertRptDefinitionForbidden(t, err)

	authorizer.allowed["/dcl/rpt-definition/disable"] = true
	if _, err = service.Save(t.Context(), RptDefinitionSaveInput{
		Code: saved.Code, ApprovalEntryID: saved.Approval.ApprovalEntryID,
		ApprovalRevision: saved.Approval.Revision, Name: &name, Enabled: false,
		Data: rptDefinitionTestData(t, "disabled"),
	}, actor); err != nil {
		t.Fatalf("save enabled change with disable permission: %v", err)
	}
}

func assertRptDefinitionForbidden(t *testing.T, err error) {
	t.Helper()
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorForbidden {
		t.Fatalf("error = %v, want DCL forbidden", err)
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
	var subjects, versions int
	if scanErr := pool.QueryRow(t.Context(), `
		SELECT
			(SELECT count(*) FROM dcl_subjects WHERE entity='rpt-definition' AND created_by=$1),
			(SELECT count(*) FROM dcl_rpt_definition_versions WHERE created_by=$1)
	`, rptDefinitionCreatorID).Scan(&subjects, &versions); scanErr != nil {
		t.Fatal(scanErr)
	}
	if subjects != 0 || versions != 0 {
		t.Fatalf("subscriber failure committed subject=%d version=%d", subjects, versions)
	}
}
