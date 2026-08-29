//go:build integration

package dcl

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

const (
	wflDefinitionCreatorID  = "01J00000000000000000000993"
	wflDefinitionReviewerID = "01J00000000000000000000994"
)

func resetWflProcessDefinitionIntegrationData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	cleanup := func(ctx context.Context) error {
		statements := []struct {
			sql  string
			args []any
		}{
			{sql: `DELETE FROM app_role_permissions WHERE permission_id IN (SELECT permission.id FROM app_permissions permission JOIN wfl_process_definitions definition ON definition.code=permission.entity WHERE permission.domain='wfl' AND definition.created_by<>'SYSTEM')`},
			{sql: `DELETE FROM app_permissions permission USING wfl_process_definitions definition WHERE permission.domain='wfl' AND permission.entity=definition.code AND definition.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM wfl_action_executions USING wfl_definition_instances instance JOIN wfl_process_definitions definition ON instance.definition_id=definition.id WHERE wfl_action_executions.process_id=instance.id AND definition.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM wfl_create_child_requests USING wfl_definition_instances instance JOIN wfl_process_definitions definition ON instance.definition_id=definition.id WHERE wfl_create_child_requests.process_id=instance.id AND definition.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM wfl_node_instances USING wfl_definition_instances instance JOIN wfl_process_definitions definition ON instance.definition_id=definition.id WHERE wfl_node_instances.process_id=instance.id AND definition.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM wfl_definition_instances instance USING wfl_process_definitions definition WHERE instance.definition_id=definition.id AND definition.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM dcl_wfl_process_definition_versions payload USING wfl_process_definitions definition WHERE payload.definition_id=definition.id AND definition.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM approval_events event USING wfl_process_definitions definition WHERE event.domain='dcl' AND event.entity='wfl-process-definition' AND event.subject_id=definition.id AND definition.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM approval_entries entry USING wfl_process_definitions definition WHERE entry.domain='dcl' AND entry.entity='wfl-process-definition' AND entry.subject_id=definition.id AND definition.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM dcl_subjects subject USING wfl_process_definitions definition WHERE subject.entity='wfl-process-definition' AND subject.id=definition.id AND definition.created_by<>'SYSTEM'`},
			{sql: `DELETE FROM wfl_process_definitions WHERE created_by<>'SYSTEM'`},
			{sql: `DELETE FROM app_users WHERE id IN ($1,$2)`, args: []any{wflDefinitionCreatorID, wflDefinitionReviewerID}},
		}
		for _, statement := range statements {
			if _, err := pool.Exec(ctx, statement.sql, statement.args...); err != nil {
				return err
			}
		}
		return nil
	}
	if err := cleanup(t.Context()); err != nil {
		t.Fatalf("reset workflow definition integration data: %v", err)
	}
	t.Cleanup(func() {
		if err := cleanup(context.Background()); err != nil {
			t.Errorf("clean workflow definition integration data: %v", err)
		}
	})
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO app_users(id,username,display_name,password_hash,status,password_changed_at,created_by,updated_by)
		VALUES
			($1,'dcl-wfl-creator','流程申报人','hash','ENABLED',now(),$1,$1),
			($2,'dcl-wfl-reviewer','流程审核人','hash','ENABLED',now(),$1,$1)`,
		wflDefinitionCreatorID, wflDefinitionReviewerID); err != nil {
		t.Fatalf("seed workflow definition actors: %v", err)
	}
}

func wflValidScript(code string) string {
	return `root = node(key="order", name="采购订单", entity="purchase-order")
child = node(key="inbound", name="采购入库", entity="purchase-inbound")
workflow(code="` + code + `", name="集成流程", root=root, edges=[
  edge(source=root, target=child, relation="inbound", action=purchase_inbound(initial={"warehouseObjectId": "01J00000000000000000000001"})),
])`
}

type wflIntegrationCompiler struct{}

func (wflIntegrationCompiler) Compile(script string) (string, *string, []byte, error) {
	const codePrefix = `workflow(code="`
	codeStart := strings.Index(script, codePrefix)
	if codeStart < 0 {
		message := "workflow script must declare exactly one workflow"
		return "", &message, nil, errors.New(message)
	}
	codeRest := script[codeStart+len(codePrefix):]
	codeEnd := strings.Index(codeRest, `"`)
	if codeEnd < 1 {
		message := "workflow code is required"
		return "", &message, nil, errors.New(message)
	}
	code := codeRest[:codeEnd]
	name := "集成流程"
	if nameStart := strings.Index(codeRest, `name="`); nameStart >= 0 {
		nameRest := codeRest[nameStart+len(`name="`):]
		if nameEnd := strings.Index(nameRest, `"`); nameEnd > 0 {
			name = nameRest[:nameEnd]
		}
	}
	compiled, err := json.Marshal(map[string]any{
		"code": code, "name": name, "rootKey": "order",
		"nodes": []map[string]string{{"key": "order", "name": "采购订单", "entity": "purchase-order"}},
		"edges": []any{},
	})
	return code, nil, compiled, err
}

func approveWflProcessDefinition(t *testing.T, service *WflProcessDefinitionService, mutation WflProcessDefinitionMutation) WflProcessDefinitionMutation {
	t.Helper()
	// Record trial evidence directly for integration test
	if _, err := service.pool.Exec(t.Context(),
		`UPDATE dcl_wfl_process_definition_versions SET last_trial_approval_revision=$1 WHERE approval_entry_id=$2`,
		mutation.Approval.Revision, mutation.Approval.ApprovalEntryID); err != nil {
		t.Fatalf("record trial evidence: %v", err)
	}

	pending, err := service.Submit(t.Context(), WflProcessDefinitionVersionInput{
		Code: mutation.Code, ApprovalEntryID: mutation.Approval.ApprovalEntryID,
		ApprovalRevision: mutation.Approval.Revision,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-submit-"+mutation.Code))
	if err != nil {
		t.Fatalf("submit workflow definition: %v", err)
	}
	approved, err := service.Approve(t.Context(), WflProcessDefinitionVersionInput{
		Code: mutation.Code, ApprovalEntryID: pending.Approval.ApprovalEntryID,
		ApprovalRevision: pending.Approval.Revision,
	}, dclActor(t, wflDefinitionReviewerID, "dcl-wfl-approve-"+mutation.Code))
	if err != nil {
		t.Fatalf("approve workflow definition: %v", err)
	}
	return approved
}

func TestDclWflProcessDefinitionCreateDefaultsDisabledIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetWflProcessDefinitionIntegrationData(t, pool)
	service := NewWflProcessDefinitionService(pool, wflIntegrationCompiler{}, authorization.Func(nil), txevent.NewBus())
	created, err := service.Create(t.Context(), WflProcessDefinitionCreateInput{Script: wflValidScript("test-disabled")},
		dclActor(t, wflDefinitionCreatorID, "dcl-wfl-create-disabled"))
	if err != nil {
		t.Fatalf("create workflow definition: %v", err)
	}
	if created.Enabled {
		t.Fatal("create should default to disabled")
	}
	var enabled bool
	if err := pool.QueryRow(t.Context(), `SELECT enabled FROM wfl_process_definitions WHERE id=$1`, created.DefinitionID).Scan(&enabled); err != nil {
		t.Fatal(err)
	}
	if enabled {
		t.Fatal("database enabled should be false")
	}
}

func TestDclWflProcessDefinitionEnabledUsesLatestApprovalTokenIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetWflProcessDefinitionIntegrationData(t, pool)
	service := NewWflProcessDefinitionService(pool, wflIntegrationCompiler{}, authorization.Func(nil), txevent.NewBus())
	created, err := service.Create(t.Context(), WflProcessDefinitionCreateInput{Script: wflValidScript("test-enabled-token")},
		dclActor(t, wflDefinitionCreatorID, "dcl-wfl-create-enabled-token"))
	if err != nil {
		t.Fatal(err)
	}
	approved := approveWflProcessDefinition(t, service, created)
	token := WflProcessDefinitionEnableInput{
		Code: approved.Code, ApprovalEntryID: approved.Approval.ApprovalEntryID,
		ApprovalRevision: approved.Approval.Revision,
	}
	enabled, err := service.Enable(t.Context(), token, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-enable-token"))
	if err != nil || !enabled.Enabled {
		t.Fatalf("enable = %+v, err=%v", enabled, err)
	}

	stale := token
	stale.ApprovalRevision--
	if _, err = service.Disable(t.Context(), stale, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-disable-stale")); err == nil {
		t.Fatal("expected stale Approval revision to be rejected")
	}
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "approval_stale_revision" {
		t.Fatalf("stale disable error = %v", err)
	}

	disabled, err := service.Disable(t.Context(), token, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-disable-token"))
	if err != nil || disabled.Enabled {
		t.Fatalf("disable = %+v, err=%v", disabled, err)
	}
}

func TestDclWflProcessDefinitionInvalidScriptCreateFailsIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetWflProcessDefinitionIntegrationData(t, pool)
	service := NewWflProcessDefinitionService(pool, wflIntegrationCompiler{}, authorization.Func(nil), txevent.NewBus())
	_, err := service.Create(t.Context(), WflProcessDefinitionCreateInput{Script: "invalid script !!!"},
		dclActor(t, wflDefinitionCreatorID, "dcl-wfl-create-invalid"))
	if err == nil {
		t.Fatal("expected invalid script create to fail")
	}
}

func TestDclWflProcessDefinitionSavePreservesLastValidCompiledIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetWflProcessDefinitionIntegrationData(t, pool)
	service := NewWflProcessDefinitionService(pool, wflIntegrationCompiler{}, authorization.Func(nil), txevent.NewBus())
	code := "save-preserve-" + strings.ToLower(ulid.Make().String()[:8])
	validScript := wflValidScript(code)
	created, err := service.Create(t.Context(), WflProcessDefinitionCreateInput{Script: validScript},
		dclActor(t, wflDefinitionCreatorID, "dcl-wfl-create-save"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Save with invalid script - should store diagnostic but preserve last valid compiled
	invalidScript := "invalid script !!!"
	saved, err := service.Save(t.Context(), WflProcessDefinitionSaveInput{
		Code: code, ApprovalEntryID: created.Approval.ApprovalEntryID,
		ApprovalRevision: created.Approval.Revision, Script: invalidScript,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-save-invalid"))
	if err != nil {
		t.Fatalf("save with invalid script should not fail: %v", err)
	}

	// Verify diagnostic is set and compiled is preserved
	var diagnostic *string
	var compiled []byte
	if err := pool.QueryRow(t.Context(),
		`SELECT diagnostic, compiled FROM dcl_wfl_process_definition_versions WHERE approval_entry_id=$1`,
		created.Approval.ApprovalEntryID).Scan(&diagnostic, &compiled); err != nil {
		t.Fatal(err)
	}
	if diagnostic == nil {
		t.Fatal("diagnostic should be set after invalid save")
	}
	if len(compiled) == 0 {
		t.Fatal("compiled should be preserved from last valid")
	}

	// Save with valid script again - should clear diagnostic
	validScript2 := `root = node(key="order", name="采购订单V2", entity="purchase-order")
workflow(code="` + code + `", name="集成流程V2", root=root, edges=[])`
	_, err = service.Save(t.Context(), WflProcessDefinitionSaveInput{
		Code: code, ApprovalEntryID: created.Approval.ApprovalEntryID,
		ApprovalRevision: saved.Approval.Revision, Script: validScript2,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-save-valid"))
	if err != nil {
		t.Fatalf("save with valid script: %v", err)
	}
	if err := pool.QueryRow(t.Context(),
		`SELECT diagnostic FROM dcl_wfl_process_definition_versions WHERE approval_entry_id=$1`,
		created.Approval.ApprovalEntryID).Scan(&diagnostic); err != nil {
		t.Fatal(err)
	}
	if diagnostic != nil {
		t.Fatalf("diagnostic should be nil after valid save, got %q", *diagnostic)
	}
}

func TestDclWflProcessDefinitionApproveRejectsWithoutTrialIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetWflProcessDefinitionIntegrationData(t, pool)
	service := NewWflProcessDefinitionService(pool, wflIntegrationCompiler{}, authorization.Func(nil), txevent.NewBus())
	code := "approve-no-trial-" + strings.ToLower(ulid.Make().String()[:8])
	created, err := service.Create(t.Context(), WflProcessDefinitionCreateInput{Script: wflValidScript(code)},
		dclActor(t, wflDefinitionCreatorID, "dcl-wfl-create-no-trial"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// Submit without trial
	pending, err := service.Submit(t.Context(), WflProcessDefinitionVersionInput{
		Code: code, ApprovalEntryID: created.Approval.ApprovalEntryID,
		ApprovalRevision: created.Approval.Revision,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-submit-no-trial"))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	// Approve should fail because no trial was recorded
	_, err = service.Approve(t.Context(), WflProcessDefinitionVersionInput{
		Code: code, ApprovalEntryID: pending.Approval.ApprovalEntryID,
		ApprovalRevision: pending.Approval.Revision,
	}, dclActor(t, wflDefinitionReviewerID, "dcl-wfl-approve-no-trial"))
	if err == nil {
		t.Fatal("expected approve to fail without trial")
	}
}

func TestDclWflProcessDefinitionApproveRejectsStaleTrialRevisionIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetWflProcessDefinitionIntegrationData(t, pool)
	service := NewWflProcessDefinitionService(pool, wflIntegrationCompiler{}, authorization.Func(nil), txevent.NewBus())
	code := "approve-stale-trial-" + strings.ToLower(ulid.Make().String()[:8])
	created, err := service.Create(t.Context(), WflProcessDefinitionCreateInput{Script: wflValidScript(code)},
		dclActor(t, wflDefinitionCreatorID, "dcl-wfl-create-stale"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// Record trial with wrong revision (revision 999 instead of current)
	if _, err := pool.Exec(t.Context(),
		`UPDATE dcl_wfl_process_definition_versions SET last_trial_approval_revision=999 WHERE approval_entry_id=$1`,
		created.Approval.ApprovalEntryID); err != nil {
		t.Fatal(err)
	}
	pending, err := service.Submit(t.Context(), WflProcessDefinitionVersionInput{
		Code: code, ApprovalEntryID: created.Approval.ApprovalEntryID,
		ApprovalRevision: created.Approval.Revision,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-submit-stale"))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	_, err = service.Approve(t.Context(), WflProcessDefinitionVersionInput{
		Code: code, ApprovalEntryID: pending.Approval.ApprovalEntryID,
		ApprovalRevision: pending.Approval.Revision,
	}, dclActor(t, wflDefinitionReviewerID, "dcl-wfl-approve-stale"))
	if err == nil {
		t.Fatal("expected approve to fail with stale trial revision")
	}
}

func TestDclWflProcessDefinitionCurrentSwitchFallbackAndAuditIdentityIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetWflProcessDefinitionIntegrationData(t, pool)
	service := NewWflProcessDefinitionService(pool, wflIntegrationCompiler{}, authorization.Func(nil), txevent.NewBus())
	code := "lifecycle-" + strings.ToLower(ulid.Make().String()[:8])

	// V1: create, save, trial, submit, approve
	v1, err := service.Create(t.Context(), WflProcessDefinitionCreateInput{Script: wflValidScript(code)},
		dclActor(t, wflDefinitionCreatorID, "dcl-wfl-create-v1"))
	if err != nil {
		t.Fatalf("create V1: %v", err)
	}
	if v1.Enabled {
		t.Fatal("V1 should be disabled by default")
	}
	v1Script := `root = node(key="order", name="采购订单V1", entity="purchase-order")
workflow(code="` + code + `", name="集成流程V1", root=root, edges=[])`
	v1, err = service.Save(t.Context(), WflProcessDefinitionSaveInput{
		Code: code, ApprovalEntryID: v1.Approval.ApprovalEntryID,
		ApprovalRevision: v1.Approval.Revision, Script: v1Script,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-save-v1"))
	if err != nil {
		t.Fatalf("save V1: %v", err)
	}
	v1 = approveWflProcessDefinition(t, service, v1)

	// Verify V1 is latest approved
	var approvedEntryID string
	if err := pool.QueryRow(t.Context(),
		`SELECT id FROM approval_entries WHERE domain='dcl' AND entity='wfl-process-definition' AND subject_id=$1 AND status='APPROVED' ORDER BY version_no DESC LIMIT 1`,
		v1.DefinitionID).Scan(&approvedEntryID); err != nil {
		t.Fatal(err)
	}
	if approvedEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("latest approved = %q, want %q", approvedEntryID, v1.Approval.ApprovalEntryID)
	}

	// V2: create next, save, trial, submit, approve
	v2, err := service.CreateNext(t.Context(), WflProcessDefinitionVersionInput{
		Code: code, ApprovalEntryID: v1.Approval.ApprovalEntryID,
		ApprovalRevision: v1.Approval.Revision,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-create-v2"))
	if err != nil {
		t.Fatalf("create V2: %v", err)
	}
	v2Script := `root = node(key="order", name="采购订单V2", entity="purchase-order")
workflow(code="` + code + `", name="集成流程V2", root=root, edges=[])`
	v2, err = service.Save(t.Context(), WflProcessDefinitionSaveInput{
		Code: code, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision, Script: v2Script,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-save-v2"))
	if err != nil {
		t.Fatalf("save V2: %v", err)
	}
	v2 = approveWflProcessDefinition(t, service, v2)

	// Verify V2 is now latest approved
	if err := pool.QueryRow(t.Context(),
		`SELECT id FROM approval_entries WHERE domain='dcl' AND entity='wfl-process-definition' AND subject_id=$1 AND status='APPROVED' ORDER BY version_no DESC LIMIT 1`,
		v2.DefinitionID).Scan(&approvedEntryID); err != nil {
		t.Fatal(err)
	}
	if approvedEntryID != v2.Approval.ApprovalEntryID {
		t.Fatalf("latest approved = %q, want V2 %q", approvedEntryID, v2.Approval.ApprovalEntryID)
	}
	versions, err := service.Versions(t.Context(), WflProcessDefinitionHistoryInput{
		Code: code, Page: 1, PageSize: 20,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-versions"))
	if err != nil {
		t.Fatalf("list versions: %v", err)
	}
	if versions.Total != 2 || len(versions.Items) != 2 {
		t.Fatalf("versions = %#v, want two immutable payloads", versions)
	}
	for _, version := range versions.Items {
		if len(version.Nodes) != 1 || version.Nodes[0].Key != "order" || len(version.Edges) != 0 {
			t.Fatalf("version graph = %#v, want stored order node", version)
		}
	}
	audit, err := service.AuditHistory(t.Context(), WflProcessDefinitionHistoryInput{
		Code: code, Page: 1, PageSize: 50,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-audit"))
	if err != nil {
		t.Fatalf("audit history: %v", err)
	}
	auditIdentity := map[string]map[approval.Action]bool{}
	for _, event := range audit.Items {
		if event.RequestID == "" {
			t.Fatalf("audit event %q lost request identity", event.ID)
		}
		if auditIdentity[event.ApprovalEntryID] == nil {
			auditIdentity[event.ApprovalEntryID] = map[approval.Action]bool{}
		}
		auditIdentity[event.ApprovalEntryID][event.Action] = true
	}
	for label, entryID := range map[string]string{"V1": v1.Approval.ApprovalEntryID, "V2": v2.Approval.ApprovalEntryID} {
		if !auditIdentity[entryID][approval.ActionCreated] || !auditIdentity[entryID][approval.ActionApproved] {
			t.Fatalf("%s audit identity %q missing CREATED/APPROVED events: %#v", label, entryID, auditIdentity[entryID])
		}
	}

	// Unapprove V2 - should fall back to V1
	v2Draft, err := service.Unapprove(t.Context(), WflProcessDefinitionReviewInput{
		Code: code, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision, Reason: "回落验证",
	}, dclActor(t, wflDefinitionReviewerID, "dcl-wfl-unapprove-v2"))
	if err != nil {
		t.Fatalf("unapprove V2: %v", err)
	}

	// Verify V1 is again latest approved
	if err := pool.QueryRow(t.Context(),
		`SELECT id FROM approval_entries WHERE domain='dcl' AND entity='wfl-process-definition' AND subject_id=$1 AND status='APPROVED' ORDER BY version_no DESC LIMIT 1`,
		v1.DefinitionID).Scan(&approvedEntryID); err != nil {
		t.Fatal(err)
	}
	if approvedEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("after unapprove V2, latest approved = %q, want V1 %q", approvedEntryID, v1.Approval.ApprovalEntryID)
	}

	// Unapprove moves V2 to PENDING; unsubmit returns it to DRAFT so it can be deleted.
	v2Draft, err = service.Unsubmit(t.Context(), WflProcessDefinitionReviewInput{
		Code: code, ApprovalEntryID: v2Draft.Approval.ApprovalEntryID,
		ApprovalRevision: v2Draft.Approval.Revision,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-unsubmit-v2"))
	if err != nil {
		t.Fatalf("unsubmit V2: %v", err)
	}

	// Delete V2 draft and recreate - should reuse version number 2
	if err = service.Delete(t.Context(), WflProcessDefinitionDeleteInput{
		Code: code, ApprovalEntryID: v2Draft.Approval.ApprovalEntryID,
		ApprovalRevision: v2Draft.Approval.Revision,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-delete-v2")); err != nil {
		t.Fatalf("delete V2 draft: %v", err)
	}
	v2Replacement, err := service.CreateNext(t.Context(), WflProcessDefinitionVersionInput{
		Code: code, ApprovalEntryID: v1.Approval.ApprovalEntryID,
		ApprovalRevision: v1.Approval.Revision,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-recreate-v2"))
	if err != nil {
		t.Fatalf("recreate V2: %v", err)
	}
	if v2Replacement.Approval.VersionNo != 2 {
		t.Fatalf("replacement candidate version=%d, want 2", v2Replacement.Approval.VersionNo)
	}
}

func TestDclWflProcessDefinitionRuntimePinSerializesWithUnapproveIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetWflProcessDefinitionIntegrationData(t, pool)
	service := NewWflProcessDefinitionService(pool, wflIntegrationCompiler{}, authorization.Func(nil), txevent.NewBus())
	code := "unapprove-race-" + strings.ToLower(ulid.Make().String()[:8])
	created, err := service.Create(t.Context(), WflProcessDefinitionCreateInput{Script: wflValidScript(code)},
		dclActor(t, wflDefinitionCreatorID, "dcl-wfl-create-race"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	approved := approveWflProcessDefinition(t, service, created)

	runtimeTx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = runtimeTx.Rollback(context.Background()) }()
	if err = approval.LockVersionSubject(t.Context(), runtimeTx, "dcl", EntityWflProcessDefinition, approved.DefinitionID); err != nil {
		t.Fatalf("lock runtime definition version: %v", err)
	}

	unapproveActor := dclActor(t, wflDefinitionReviewerID, "dcl-wfl-unapprove-race")
	unapproveResult := make(chan error, 1)
	go func() {
		_, unapproveErr := service.Unapprove(context.Background(), WflProcessDefinitionReviewInput{
			Code: code, ApprovalEntryID: approved.Approval.ApprovalEntryID,
			ApprovalRevision: approved.Approval.Revision, Reason: "concurrent runtime pin",
		}, unapproveActor)
		unapproveResult <- unapproveErr
	}()

	select {
	case result := <-unapproveResult:
		t.Fatalf("unapprove bypassed runtime subject lock: %v", result)
	case <-time.After(100 * time.Millisecond):
	}
	if _, err = runtimeTx.Exec(t.Context(), `
		INSERT INTO wfl_definition_instances(id,definition_id,definition_approval_entry_id,definition_code,definition_name,root_document_no,root_entity,root_deleted_at,created_by,updated_by)
		VALUES($1,$2,$3,$4,'test','TEST-RACE','purchase-order',now(),'SYSTEM','SYSTEM')
	`, ulid.Make().String(), approved.DefinitionID, approved.Approval.ApprovalEntryID, code); err != nil {
		t.Fatal(err)
	}
	if err = runtimeTx.Commit(t.Context()); err != nil {
		t.Fatalf("commit runtime pin: %v", err)
	}

	err = <-unapproveResult
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "wfl_process_definition_unapprove_blocked" {
		t.Fatalf("unapprove after concurrent runtime pin = %v, want persisted-instance blocker", err)
	}
	var status string
	if err = pool.QueryRow(t.Context(), `SELECT status FROM approval_entries WHERE id=$1`, approved.Approval.ApprovalEntryID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != string(approval.StatusApproved) {
		t.Fatalf("approval status = %q, want APPROVED", status)
	}
}

func TestDclWflProcessDefinitionUnapproveBlocksPersistedInstancesIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetWflProcessDefinitionIntegrationData(t, pool)
	service := NewWflProcessDefinitionService(pool, wflIntegrationCompiler{}, authorization.Func(nil), txevent.NewBus())
	code := "unapprove-block-" + strings.ToLower(ulid.Make().String()[:8])
	created, err := service.Create(t.Context(), WflProcessDefinitionCreateInput{Script: wflValidScript(code)},
		dclActor(t, wflDefinitionCreatorID, "dcl-wfl-create-block"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	approved := approveWflProcessDefinition(t, service, created)

	// Insert a persisted instance referencing this version
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO wfl_definition_instances(id,definition_id,definition_approval_entry_id,definition_code,definition_name,root_document_no,root_entity,root_deleted_at,created_by,updated_by)
		VALUES($1,$2,$3,$4,'test','TEST-001','purchase-order',now(),'SYSTEM','SYSTEM')
	`, ulid.Make().String(), approved.DefinitionID, approved.Approval.ApprovalEntryID, code); err != nil {
		t.Fatal(err)
	}

	// Unapprove should be blocked
	_, err = service.Unapprove(t.Context(), WflProcessDefinitionReviewInput{
		Code: code, ApprovalEntryID: approved.Approval.ApprovalEntryID,
		ApprovalRevision: approved.Approval.Revision, Reason: "should fail",
	}, dclActor(t, wflDefinitionReviewerID, "dcl-wfl-unapprove-block"))
	if err == nil {
		t.Fatal("expected unapprove to be blocked by persisted instances")
	}
	var domainErr *DomainError
	if !errors.As(err, &domainErr) {
		t.Fatalf("expected DomainError, got %T: %v", err, err)
	}
	if domainErr.ErrorKey != "wfl_process_definition_unapprove_blocked" {
		t.Fatalf("error key = %q, want wfl_process_definition_unapprove_blocked", domainErr.ErrorKey)
	}
	data, ok := domainErr.Data.(map[string]any)
	if !ok || len(data["instanceIds"].([]string)) != 1 {
		t.Fatalf("blocker data = %#v, want one persisted instance id", domainErr.Data)
	}
}

func TestDclWflProcessDefinitionSubscriberFailureRollsBackIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetWflProcessDefinitionIntegrationData(t, pool)
	bus := txevent.NewBus()
	failure := errors.New("reject DCL workflow definition event")
	if err := bus.Subscribe(dclapproval.WflProcessDefinitionTopic.Name(), "dcl-wfl-rejector", func(context.Context, pgx.Tx, txevent.Event) error {
		return failure
	}); err != nil {
		t.Fatal(err)
	}
	service := NewWflProcessDefinitionService(pool, wflIntegrationCompiler{}, authorization.Func(nil), bus)
	_, err := service.Create(t.Context(), WflProcessDefinitionCreateInput{Script: wflValidScript("rollback-test")},
		dclActor(t, wflDefinitionCreatorID, "dcl-wfl-rollback"))
	if err == nil {
		t.Fatal("expected subscriber failure")
	}
	var definitions, subjects, versions int
	if scanErr := pool.QueryRow(t.Context(), `
		SELECT
			(SELECT count(*) FROM wfl_process_definitions WHERE created_by=$1),
			(SELECT count(*) FROM dcl_subjects WHERE entity='wfl-process-definition' AND created_by=$1),
			(SELECT count(*) FROM dcl_wfl_process_definition_versions WHERE created_by=$1)
	`, wflDefinitionCreatorID).Scan(&definitions, &subjects, &versions); scanErr != nil {
		t.Fatal(scanErr)
	}
	if definitions != 0 || subjects != 0 || versions != 0 {
		t.Fatalf("subscriber failure committed definition=%d subject=%d version=%d", definitions, subjects, versions)
	}
}

func TestDclWflProcessDefinitionApproveSubscriberFailureKeepsPreviousCurrentIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetWflProcessDefinitionIntegrationData(t, pool)
	bus := txevent.NewBus()
	service := NewWflProcessDefinitionService(pool, wflIntegrationCompiler{}, authorization.Func(nil), bus)
	code := "approve-rollback-" + strings.ToLower(ulid.Make().String()[:8])
	v1, err := service.Create(t.Context(), WflProcessDefinitionCreateInput{Script: wflValidScript(code)},
		dclActor(t, wflDefinitionCreatorID, "dcl-wfl-approve-rollback-v1"))
	if err != nil {
		t.Fatal(err)
	}
	v1 = approveWflProcessDefinition(t, service, v1)
	v2, err := service.CreateNext(t.Context(), WflProcessDefinitionVersionInput{
		Code: code, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-approve-rollback-v2"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(t.Context(), `UPDATE dcl_wfl_process_definition_versions SET last_trial_approval_revision=$1 WHERE approval_entry_id=$2`, v2.Approval.Revision, v2.Approval.ApprovalEntryID); err != nil {
		t.Fatal(err)
	}
	v2, err = service.Submit(t.Context(), WflProcessDefinitionVersionInput{
		Code: code, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-approve-rollback-submit"))
	if err != nil {
		t.Fatal(err)
	}
	if err = bus.Subscribe(dclapproval.WflProcessDefinitionTopic.Name(), "dcl-wfl-approve-rejector", func(context.Context, pgx.Tx, txevent.Event) error {
		return errors.New("reject approve event")
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Approve(t.Context(), WflProcessDefinitionVersionInput{
		Code: code, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision,
	}, dclActor(t, wflDefinitionReviewerID, "dcl-wfl-approve-rollback")); err == nil {
		t.Fatal("expected approve subscriber failure")
	}
	var status, currentID string
	var revision int64
	if err = pool.QueryRow(t.Context(), `SELECT status,revision FROM approval_entries WHERE id=$1`, v2.Approval.ApprovalEntryID).Scan(&status, &revision); err != nil {
		t.Fatal(err)
	}
	if status != string(approval.StatusPending) || revision != v2.Approval.Revision {
		t.Fatalf("failed approve committed status=%q revision=%d", status, revision)
	}
	if err = pool.QueryRow(t.Context(), `SELECT id FROM approval_entries WHERE domain='dcl' AND entity='wfl-process-definition' AND subject_id=$1 AND status='APPROVED' ORDER BY version_no DESC LIMIT 1`, v1.DefinitionID).Scan(&currentID); err != nil {
		t.Fatal(err)
	}
	if currentID != v1.Approval.ApprovalEntryID {
		t.Fatalf("failed approve changed current to %q, want V1 %q", currentID, v1.Approval.ApprovalEntryID)
	}
}

func TestDclWflProcessDefinitionUnapproveSubscriberFailureKeepsCurrentIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetWflProcessDefinitionIntegrationData(t, pool)
	bus := txevent.NewBus()
	service := NewWflProcessDefinitionService(pool, wflIntegrationCompiler{}, authorization.Func(nil), bus)
	code := "unapprove-rollback-" + strings.ToLower(ulid.Make().String()[:8])
	v1, err := service.Create(t.Context(), WflProcessDefinitionCreateInput{Script: wflValidScript(code)},
		dclActor(t, wflDefinitionCreatorID, "dcl-wfl-unapprove-rollback-v1"))
	if err != nil {
		t.Fatal(err)
	}
	v1 = approveWflProcessDefinition(t, service, v1)
	v2, err := service.CreateNext(t.Context(), WflProcessDefinitionVersionInput{
		Code: code, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision,
	}, dclActor(t, wflDefinitionCreatorID, "dcl-wfl-unapprove-rollback-v2"))
	if err != nil {
		t.Fatal(err)
	}
	v2 = approveWflProcessDefinition(t, service, v2)
	if err = bus.Subscribe(dclapproval.WflProcessDefinitionTopic.Name(), "dcl-wfl-unapprove-rejector", func(context.Context, pgx.Tx, txevent.Event) error {
		return errors.New("reject unapprove event")
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Unapprove(t.Context(), WflProcessDefinitionReviewInput{
		Code: code, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision, Reason: "rollback",
	}, dclActor(t, wflDefinitionReviewerID, "dcl-wfl-unapprove-rollback")); err == nil {
		t.Fatal("expected unapprove subscriber failure")
	}
	var status, currentID string
	var revision int64
	if err = pool.QueryRow(t.Context(), `SELECT status,revision FROM approval_entries WHERE id=$1`, v2.Approval.ApprovalEntryID).Scan(&status, &revision); err != nil {
		t.Fatal(err)
	}
	if status != string(approval.StatusApproved) || revision != v2.Approval.Revision {
		t.Fatalf("failed unapprove committed status=%q revision=%d", status, revision)
	}
	if err = pool.QueryRow(t.Context(), `SELECT id FROM approval_entries WHERE domain='dcl' AND entity='wfl-process-definition' AND subject_id=$1 AND status='APPROVED' ORDER BY version_no DESC LIMIT 1`, v2.DefinitionID).Scan(&currentID); err != nil {
		t.Fatal(err)
	}
	if currentID != v2.Approval.ApprovalEntryID {
		t.Fatalf("failed unapprove changed current to %q, want V2 %q", currentID, v2.Approval.ApprovalEntryID)
	}
}
