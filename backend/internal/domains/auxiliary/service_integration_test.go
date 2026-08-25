//go:build integration

package aux

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func integrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	databaseName := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if databaseURL == "" || !strings.HasSuffix(databaseName, "_test") {
		t.Fatal("safe TEST_DATABASE_URL and TEST_POSTGRES_DB ending in _test are required")
	}
	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect integration database: %v", err)
	}
	t.Cleanup(pool.Close)
	var currentDatabase string
	if err = pool.QueryRow(t.Context(), "select current_database()").Scan(&currentDatabase); err != nil {
		t.Fatalf("read integration database: %v", err)
	}
	if currentDatabase != databaseName {
		t.Fatalf("connected database %q does not match %q", currentDatabase, databaseName)
	}
	return pool
}

func integrationService(t *testing.T) (*Service, *pgxpool.Pool) {
	t.Helper()
	pool := integrationPool(t)
	return NewService(pool, authorization.Func(nil), txevent.NewBus()), pool
}

func trustedIntegrationActor(t *testing.T, requestID string) approval.Actor {
	t.Helper()
	actorID := "01J00000000000000000000000"
	if strings.Contains(requestID, "approve") || strings.Contains(requestID, "reject") {
		actorID = "01J00000000000000000000001"
	}
	actor, err := approval.UserActor(authorization.Principal{ActorID: actorID}, requestID)
	if err != nil {
		t.Fatalf("create trusted actor %q: %v", requestID, err)
	}
	return actor
}

func approvalInput(result MutationResult) ApprovalRevisionInput {
	return ApprovalRevisionInput{
		ObjectID: result.ObjectID, ApprovalEntryID: result.Approval.ApprovalEntryID,
		ApprovalRevision: result.Approval.Revision,
	}
}

func approveAuxiliary(t *testing.T, service *Service, entity string, created MutationResult, label string) MutationResult {
	t.Helper()
	pending, err := service.Submit(t.Context(), entity, approvalInput(created), trustedIntegrationActor(t, label+"-submit"))
	if err != nil {
		t.Fatalf("submit %s: %v", label, err)
	}
	approved, err := service.Approve(t.Context(), entity, approvalInput(pending), trustedIntegrationActor(t, label+"-approve"))
	if err != nil {
		t.Fatalf("approve %s: %v", label, err)
	}
	if approved.Approval.Status != approval.StatusApproved {
		t.Fatalf("approve %s status = %s", label, approved.Approval.Status)
	}
	return approved
}

func createAuxiliary(t *testing.T, service *Service, entity string, data map[string]any, label string) MutationResult {
	t.Helper()
	result, err := service.Create(t.Context(), entity, CreateInput{Data: CreateData{Data: data}}, trustedIntegrationActor(t, label+"-create"))
	if err != nil {
		t.Fatalf("create %s: %v", label, err)
	}
	if result.Approval.Status != approval.StatusDraft || result.Approval.VersionNo != 1 {
		t.Fatalf("create %s approval = %+v, want V1 DRAFT", label, result.Approval)
	}
	return result
}

func TestAuxiliaryEntitiesCreateAndApprovalLifecycleIntegration(t *testing.T) {
	service, _ := integrationService(t)
	suffix := ulid.Make().String()

	// Dictionary items validate their type against an enabled approved type, so
	// the type is deliberately created first and then reused by the matrix.
	dictionaryType := createAuxiliary(t, service, EntityDictionaryType, map[string]any{
		"name": "集成字典类型-" + suffix,
	}, "dictionary-type-"+suffix)
	dictionaryTypeApproved := approveAuxiliary(t, service, EntityDictionaryType, dictionaryType, "dictionary-type-"+suffix)
	dictionaryTypeView, err := service.Get(t.Context(), EntityDictionaryType, GetInput{ObjectID: dictionaryTypeApproved.ObjectID}, trustedIntegrationActor(t, "dictionary-type-get-"+suffix))
	if err != nil {
		t.Fatalf("get approved dictionary type: %v", err)
	}

	cases := []struct {
		entity string
		data   map[string]any
	}{
		{EntityProductCategory, map[string]any{"name": "集成产品分类-" + suffix}},
		{EntityProductType, map[string]any{"name": "集成产品类型-" + suffix, "behaviorProfile": "RAW_MATERIAL"}},
		{EntityDepartment, map[string]any{"name": "集成部门-" + suffix}},
		{EntityPosition, map[string]any{"name": "集成岗位-" + suffix}},
		{EntityPaymentMethod, map[string]any{"name": "集成收款方式-" + suffix}},
		{EntityDictionaryItem, map[string]any{
			"name": "集成字典项-" + suffix, "dictionaryTypeCode": dictionaryTypeView.Code, "sortOrder": 1,
		}},
		{EntityMeasurementUnit, map[string]any{"name": "集成计量单位-" + suffix, "symbol": "集", "quantityScale": 2}},
		{EntityIncomeExpense, map[string]any{"name": "集成收入分类-" + suffix, "direction": "INCOME"}},
		{EntityAssetCategory, map[string]any{
			"name": "集成资产类别-" + suffix, "defaultUsefulLifeMonths": 60, "defaultResidualRate": "5.00",
		}},
	}
	for _, tc := range cases {
		t.Run(tc.entity, func(t *testing.T) {
			created := createAuxiliary(t, service, tc.entity, tc.data, tc.entity+"-"+suffix)
			approved := approveAuxiliary(t, service, tc.entity, created, tc.entity+"-"+suffix)
			view, err := service.Get(t.Context(), tc.entity, GetInput{ObjectID: created.ObjectID}, trustedIntegrationActor(t, tc.entity+"-get-"+suffix))
			if err != nil {
				t.Fatalf("get %s: %v", tc.entity, err)
			}
			if view.LatestApproved == nil || view.LatestApproved.Approval.ApprovalEntryID != approved.Approval.ApprovalEntryID || view.LatestApproved.Approval.Status != approval.StatusApproved {
				t.Fatalf("%s latest approval = %+v, want approved V1", tc.entity, view.LatestApproved)
			}
			if view.OpenVersion != nil {
				t.Fatalf("%s has unexpected open version after approval: %+v", tc.entity, view.OpenVersion)
			}
		})
	}

	// Settlement methods are system-defined: creation is intentionally rejected,
	// while the baseline provides their approved V1 lifecycle records.
	if _, err = service.Create(t.Context(), EntitySettlementMethod, CreateInput{Data: CreateData{Data: map[string]any{
		"name": "不允许自定义结算方式", "termCode": "PREPAID", "ruleType": "PREPAID",
	}}}, trustedIntegrationActor(t, "settlement-create-rejected-"+suffix)); !errorKind(err, ErrorValidation) {
		t.Fatalf("settlement create error = %v, want validation", err)
	}
	settlements, err := service.Query(t.Context(), EntitySettlementMethod, QueryInput{Page: 1, PageSize: 20}, trustedIntegrationActor(t, "settlement-query-"+suffix))
	if err != nil || settlements.Total == 0 {
		t.Fatalf("query fixed settlement methods total=%d err=%v", settlements.Total, err)
	}
	for _, item := range settlements.Items {
		if item.LatestApproved != nil && item.LatestApproved.Approval.Status != approval.StatusApproved {
			t.Fatalf("fixed settlement %s latest status = %s", item.ObjectID, item.LatestApproved.Approval.Status)
		}
	}
}

func TestAuxiliaryEnableDisableAndDraftDeletionIntegration(t *testing.T) {
	service, _ := integrationService(t)
	suffix := ulid.Make().String()
	root := createAuxiliary(t, service, EntityDepartment, map[string]any{
		"name": "集成部门根-" + suffix,
	}, "department-root-"+suffix)
	approvedRoot := approveAuxiliary(t, service, EntityDepartment, root, "department-root-"+suffix)
	child := createAuxiliary(t, service, EntityDepartment, map[string]any{
		"name": "集成部门子-" + suffix, "parentId": root.ObjectID,
	}, "department-child-"+suffix)
	approvedChild := approveAuxiliary(t, service, EntityDepartment, child, "department-child-"+suffix)

	if _, err := service.Save(t.Context(), EntityDepartment, SaveInput{
		ObjectID: root.ObjectID, ApprovalEntryID: approvedRoot.Approval.ApprovalEntryID,
		ApprovalRevision: approvedRoot.Approval.Revision, Data: map[string]any{"name": "集成部门根-" + suffix, "code": "DEP-9999"},
	}, trustedIntegrationActor(t, "department-invalid-save-"+suffix)); !errorKind(err, ErrorValidation) {
		t.Fatalf("reserved code save error = %v, want validation", err)
	}

	disabled, err := service.Disable(t.Context(), EntityDepartment, ObjectRevisionInput{
		ObjectID: child.ObjectID, ObjectRevision: approvedChild.ObjectRevision,
	}, trustedIntegrationActor(t, "department-disable-"+suffix))
	if err != nil || disabled.Enabled {
		t.Fatalf("disable child result=%+v err=%v", disabled, err)
	}
	if _, err = service.Resolve(t.Context(), nil, EntityDepartment, child.ObjectID, ""); err == nil {
		t.Fatal("disabled auxiliary object remained resolvable")
	}
	if _, err = service.Enable(t.Context(), EntityDepartment, ObjectRevisionInput{
		ObjectID: child.ObjectID, ObjectRevision: disabled.ObjectRevision,
	}, trustedIntegrationActor(t, "department-enable-"+suffix)); err != nil {
		t.Fatalf("enable child: %v", err)
	}
	if _, err = service.Resolve(t.Context(), nil, EntityDepartment, child.ObjectID, approvedChild.Approval.ApprovalEntryID); err != nil {
		t.Fatalf("resolve enabled child: %v", err)
	}

	draft := createAuxiliary(t, service, EntityProductCategory, map[string]any{
		"name": "集成待删除草稿-" + suffix,
	}, "draft-delete-"+suffix)
	if err = service.Delete(t.Context(), EntityProductCategory, DeleteInput(approvalInput(draft)), trustedIntegrationActor(t, "draft-delete-"+suffix)); err != nil {
		t.Fatalf("delete initial draft: %v", err)
	}
	if _, err = service.Get(t.Context(), EntityProductCategory, GetInput{ObjectID: draft.ObjectID}, trustedIntegrationActor(t, "draft-delete-get-"+suffix)); !errorKind(err, ErrorValidation) {
		t.Fatalf("deleted draft get error = %v, want validation", err)
	}
}

func TestAuxiliaryApprovalVersionLifecycleIntegration(t *testing.T) {
	service, pool := integrationService(t)
	suffix := ulid.Make().String()
	created := createAuxiliary(t, service, EntityProductCategory, map[string]any{
		"name": "集成审批生命周期-" + suffix,
	}, "approval-lifecycle-"+suffix)

	if _, err := service.Resolve(t.Context(), nil, EntityProductCategory, created.ObjectID, created.Approval.ApprovalEntryID); err == nil {
		t.Fatal("draft candidate resolved before approval")
	}
	v1 := approveAuxiliary(t, service, EntityProductCategory, created, "approval-lifecycle-v1-"+suffix)
	v1Ref, err := service.Resolve(t.Context(), nil, EntityProductCategory, created.ObjectID, "")
	if err != nil {
		t.Fatalf("resolve approved V1: %v", err)
	}
	if v1Ref.ApprovalEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("resolved V1 entry = %s, want %s", v1Ref.ApprovalEntryID, v1.Approval.ApprovalEntryID)
	}

	updated := cloneData(map[string]any{"name": "集成审批生命周期-V2-" + suffix})
	v2, err := service.Save(t.Context(), EntityProductCategory, SaveInput{
		ObjectID: created.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID,
		ApprovalRevision: v1.Approval.Revision, Data: updated,
	}, trustedIntegrationActor(t, "approval-lifecycle-v2-create-"+suffix))
	if err != nil {
		t.Fatalf("create V2 candidate: %v", err)
	}
	if v2.Approval.VersionNo != 2 || v2.Approval.Status != approval.StatusDraft {
		t.Fatalf("V2 candidate approval = %+v, want V2 DRAFT", v2.Approval)
	}
	if _, err = service.Resolve(t.Context(), nil, EntityProductCategory, created.ObjectID, v2.Approval.ApprovalEntryID); err == nil {
		t.Fatal("V2 candidate resolved before approval")
	}
	if ref, resolveErr := service.Resolve(t.Context(), nil, EntityProductCategory, created.ObjectID, ""); resolveErr != nil || ref.ApprovalEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("latest reference during V2 candidate = %+v err=%v, want V1", ref, resolveErr)
	}

	// Saving the open draft advances only its central approval revision. Reusing
	// the old revision must be rejected as stale.
	updated["description"] = "V2 草稿"
	v2Saved, err := service.Save(t.Context(), EntityProductCategory, SaveInput{
		ObjectID: created.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision, Data: updated,
	}, trustedIntegrationActor(t, "approval-lifecycle-v2-save-"+suffix))
	if err != nil {
		t.Fatalf("save V2 draft: %v", err)
	}
	if _, err = service.Save(t.Context(), EntityProductCategory, SaveInput{
		ObjectID: created.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision, Data: updated,
	}, trustedIntegrationActor(t, "approval-lifecycle-stale-save-"+suffix)); errorKey(err) != "approval_stale_revision" {
		t.Fatalf("stale V2 save error = %v, want approval_stale_revision", err)
	}

	v2Pending, err := service.Submit(t.Context(), EntityProductCategory, approvalInput(v2Saved), trustedIntegrationActor(t, "approval-lifecycle-v2-submit-"+suffix))
	if err != nil {
		t.Fatalf("submit V2: %v", err)
	}
	v2Approved, err := service.Approve(t.Context(), EntityProductCategory, approvalInput(v2Pending), trustedIntegrationActor(t, "approval-lifecycle-v2-approve-"+suffix))
	if err != nil {
		t.Fatalf("approve V2: %v", err)
	}
	v2Ref, err := service.Resolve(t.Context(), nil, EntityProductCategory, created.ObjectID, "")
	if err != nil || v2Ref.ApprovalEntryID != v2Approved.Approval.ApprovalEntryID || stringValue(v2Ref.Data["name"]) != "集成审批生命周期-V2-"+suffix {
		t.Fatalf("latest reference after V2 approval = %+v err=%v, want V2", v2Ref, err)
	}

	v2Unapproved, err := service.Unapprove(t.Context(), EntityProductCategory, ReviewInput{
		ApprovalRevisionInput: approvalInput(v2Approved), Reason: stringPtr("回落到 V1"),
	}, trustedIntegrationActor(t, "approval-lifecycle-v2-unapprove-"+suffix))
	if err != nil {
		t.Fatalf("unapprove V2: %v", err)
	}
	if v2Unapproved.Approval.Status != approval.StatusPending {
		t.Fatalf("V2 unapprove status = %s, want PENDING", v2Unapproved.Approval.Status)
	}
	if ref, resolveErr := service.Resolve(t.Context(), nil, EntityProductCategory, created.ObjectID, ""); resolveErr != nil || ref.ApprovalEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("latest reference after V2 unapprove = %+v err=%v, want V1", ref, resolveErr)
	}

	// Return V2 to DRAFT and delete the open version before unapproving V1;
	// central Approval permits at most one DRAFT/PENDING entry per subject.
	v2Draft, err := service.Unsubmit(t.Context(), EntityProductCategory, approvalInput(v2Unapproved), trustedIntegrationActor(t, "approval-lifecycle-v2-unsubmit-"+suffix))
	if err != nil {
		t.Fatalf("unsubmit V2: %v", err)
	}
	if err = service.Delete(t.Context(), EntityProductCategory, DeleteInput(approvalInput(v2Draft)), trustedIntegrationActor(t, "approval-lifecycle-v2-delete-"+suffix)); err != nil {
		t.Fatalf("delete V2 draft: %v", err)
	}
	var versionCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_entries WHERE domain='aux' AND entity=$1 AND subject_id=$2`, EntityProductCategory, created.ObjectID).Scan(&versionCount); err != nil {
		t.Fatalf("count remaining versions: %v", err)
	}
	if versionCount != 1 {
		t.Fatalf("remaining version count = %d, want V1 only", versionCount)
	}

	// V1 is now the latest approved version and no open entry exists.
	// Unapproving it leaves no approved version, so references become unavailable.
	if _, err = service.Unapprove(t.Context(), EntityProductCategory, ReviewInput{
		ApprovalRevisionInput: approvalInput(v1), Reason: stringPtr("撤销 V1"),
	}, trustedIntegrationActor(t, "approval-lifecycle-v1-unapprove-"+suffix)); err != nil {
		t.Fatalf("unapprove V1: %v", err)
	}
	if _, err = service.Resolve(t.Context(), nil, EntityProductCategory, created.ObjectID, ""); err == nil {
		t.Fatal("reference remained resolvable after V1 unapprove")
	}
}

func TestAuxiliaryApproveRevalidatesCandidateIntegration(t *testing.T) {
	service, pool := integrationService(t)
	suffix := ulid.Make().String()
	created := createAuxiliary(t, service, EntityProductType, map[string]any{
		"name": "集成审批重验-" + suffix, "behaviorProfile": "RAW_MATERIAL",
	}, "approval-revalidation-"+suffix)
	pending, err := service.Submit(t.Context(), EntityProductType, approvalInput(created), trustedIntegrationActor(t, "approval-revalidation-submit-"+suffix))
	if err != nil {
		t.Fatalf("submit candidate: %v", err)
	}
	invalidPayload := `{"name":"集成审批重验-` + suffix + `","behaviorProfile":"NOT_SUPPORTED"}`
	if _, err = pool.Exec(t.Context(), `UPDATE aux_version_payloads SET data=$1 WHERE approval_entry_id=$2`, invalidPayload, pending.Approval.ApprovalEntryID); err != nil {
		t.Fatalf("corrupt pending payload for revalidation test: %v", err)
	}
	if _, err = service.Approve(t.Context(), EntityProductType, approvalInput(pending), trustedIntegrationActor(t, "approval-revalidation-approve-"+suffix)); !errorKind(err, ErrorValidation) {
		t.Fatalf("approve invalid candidate error = %v, want validation", err)
	}
}

func TestAuxiliaryWritesUseTransactionDomainLockIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool, authorization.Func(nil), txevent.NewBus())
	blocker, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin blocker transaction: %v", err)
	}
	defer blocker.Rollback(t.Context()) //nolint:errcheck
	if err = lockAuxiliaryWrites(t.Context(), blocker); err != nil {
		t.Fatalf("lock auxiliary writes: %v", err)
	}

	result := make(chan error, 1)
	go func() {
		actor, actorErr := approval.TrustedSystemActor("aux-domain-lock-create")
		if actorErr != nil {
			result <- actorErr
			return
		}
		_, createErr := service.Create(
			context.Background(), EntityPosition,
			CreateInput{Data: CreateData{Data: map[string]any{"name": "并发岗位-" + ulid.Make().String()}}},
			actor,
		)
		result <- createErr
	}()

	select {
	case createErr := <-result:
		t.Fatalf("concurrent AUX write bypassed transaction lock: %v", createErr)
	case <-time.After(100 * time.Millisecond):
	}

	if err = blocker.Rollback(t.Context()); err != nil {
		t.Fatalf("release blocker transaction: %v", err)
	}
	select {
	case createErr := <-result:
		if createErr != nil {
			t.Fatalf("create after lock release: %v", createErr)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("AUX write remained blocked after transaction ended")
	}
}

func TestAuxiliaryCreateRejectsExhaustedObjectNumberIntegration(t *testing.T) {
	pool := integrationPool(t)
	var previous int32
	err := pool.QueryRow(t.Context(), `
		SELECT last_value FROM object_number_counters
		WHERE domain = 'aux' AND entity = $1
	`, EntityPosition).Scan(&previous)
	existed := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("read object counter: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `
		INSERT INTO object_number_counters(domain, entity, last_value)
		VALUES ('aux', $1, 9999)
		ON CONFLICT(domain, entity) DO UPDATE SET last_value = 9999
	`, EntityPosition); err != nil {
		t.Fatalf("exhaust object counter: %v", err)
	}
	t.Cleanup(func() {
		var cleanupErr error
		if existed {
			_, cleanupErr = pool.Exec(context.Background(), `
				UPDATE object_number_counters SET last_value = $1
				WHERE domain = 'aux' AND entity = $2
			`, previous, EntityPosition)
		} else {
			_, cleanupErr = pool.Exec(context.Background(), `
				DELETE FROM object_number_counters WHERE domain = 'aux' AND entity = $1
			`, EntityPosition)
		}
		if cleanupErr != nil {
			t.Errorf("restore object counter: %v", cleanupErr)
		}
	})

	service := NewService(pool, authorization.Func(nil), txevent.NewBus())
	_, err = service.Create(t.Context(), EntityPosition, CreateInput{
		Data: CreateData{Data: map[string]any{"name": "编号溢出岗位-" + ulid.Make().String()}},
	}, trustedIntegrationActor(t, "aux-number-exhausted"))
	if !errorKind(err, ErrorConflict) {
		t.Fatalf("exhausted object counter error = %v", err)
	}
}

func errorKind(err error, kind ErrorKind) bool {
	var domainErr *DomainError
	return errors.As(err, &domainErr) && domainErr.Kind == kind
}

func errorKey(err error) string {
	var domainErr *DomainError
	if errors.As(err, &domainErr) {
		return domainErr.ErrorKey
	}
	return ""
}

func stringPtr(value string) *string { return &value }
