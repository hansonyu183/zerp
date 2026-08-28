//go:build integration

package dcl

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func dclIntegrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	databaseName := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if databaseURL == "" || databaseName == "" || !strings.HasSuffix(databaseName, "_test") {
		t.Fatal("safe TEST_DATABASE_URL and TEST_POSTGRES_DB ending in _test are required")
	}
	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect DCL integration database: %v", err)
	}
	t.Cleanup(pool.Close)
	var currentDatabase string
	if err = pool.QueryRow(t.Context(), "select current_database()").Scan(&currentDatabase); err != nil {
		t.Fatalf("read current database: %v", err)
	}
	if currentDatabase != databaseName {
		t.Fatalf("connected database %q does not match %q", currentDatabase, databaseName)
	}
	return pool
}

func newDCLIntegrationBOBService(pool *pgxpool.Pool, auxiliary *auxdomain.Service, authorizer approval.Authorizer, bus *txevent.Bus) *bobdomain.Service {
	party := NewPartyService(pool, bobdomain.NewPartyCurrentWriter(pool), bobdomain.NewPartyCurrentReader(pool), bobdomain.NewPartyMergeEngine(pool), authorizer, bus)
	return bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary), authorizer, bus, party)
}

func resetDCLIntegrationData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(t.Context(), `
		TRUNCATE dcl_subjects, bob_parties, bob_objects, aux_objects, approval_events, approval_entries, object_number_counters CASCADE
	`); err != nil {
		t.Fatalf("reset DCL integration data: %v", err)
	}
}

func dclActor(t *testing.T, actorID, requestID string) approval.Actor {
	t.Helper()
	actor, err := approval.UserActor(authorization.Principal{ActorID: actorID}, requestID)
	if err != nil {
		t.Fatalf("create DCL actor: %v", err)
	}
	return actor
}

func TestOperatingEntityDeclarationControlsBOBCurrentDataIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	business := newDCLIntegrationBOBService(pool, auxiliary, authorizer, bus)
	service := NewOperatingEntityService(pool, business, authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }

	v1, err := service.Create(t.Context(), OperatingEntityCreateInput{Data: OperatingEntityData{
		Name: "第一版经营主体", ShortName: "第一版", TaxNumber: "TAX-V1",
	}}, creator("create-v1"))
	if err != nil {
		t.Fatalf("create V1: %v", err)
	}
	assertOperatingEntityAbsent(t, business, v1.ObjectID)

	v1 = submitAndApproveOperatingEntity(t, service, v1, creator("submit-v1"), reviewer("approve-v1"))
	assertOperatingEntityCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "第一版经营主体", true)

	v2, err := service.Save(t.Context(), OperatingEntitySaveInput{
		ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID,
		ApprovalRevision: v1.Approval.Revision, Enabled: false,
		Data: OperatingEntityData{Name: "第二版经营主体", ShortName: "第二版", TaxNumber: "TAX-V2"},
	}, creator("save-v2"))
	if err != nil {
		t.Fatalf("create V2 candidate: %v", err)
	}
	if v2.Approval.VersionNo != 2 || v2.Approval.Status != approval.StatusDraft {
		t.Fatalf("V2 candidate = %+v", v2.Approval)
	}
	assertOperatingEntityCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "第一版经营主体", true)

	v2, err = service.Submit(t.Context(), OperatingEntityVersionInput{
		ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision,
	}, creator("submit-v2"))
	if err != nil {
		t.Fatalf("submit V2: %v", err)
	}
	assertOperatingEntityCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "第一版经营主体", true)

	v2, err = service.Approve(t.Context(), OperatingEntityVersionInput{
		ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision,
	}, reviewer("approve-v2"))
	if err != nil {
		t.Fatalf("approve V2: %v", err)
	}
	assertOperatingEntityCurrent(t, business, v1.ObjectID, v2.Approval.ApprovalEntryID, "第二版经营主体", false)
	if _, err = service.Unapprove(t.Context(), OperatingEntityReviewInput{
		ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID,
		ApprovalRevision: v1.Approval.Revision, Reason: "不得跳过 V2",
	}, reviewer("unapprove-non-latest-v1")); err == nil {
		t.Fatal("unapproved V1 while V2 was the latest approved version")
	} else {
		var domainErr *DomainError
		if !errors.As(err, &domainErr) || domainErr.ErrorKey != "approval_not_latest_approved" {
			t.Fatalf("non-latest V1 unapprove error = %v", err)
		}
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin exact historical reference check: %v", err)
	}
	historical, referenceErr := business.ValidateApprovedSnapshotReference(
		t.Context(), tx, bobdomain.EntityOperatingEntity, v1.ObjectID, v1.Approval.ApprovalEntryID,
	)
	if referenceErr != nil || historical.ApprovalEntryID != v1.Approval.ApprovalEntryID {
		_ = tx.Rollback(t.Context())
		t.Fatalf("historical V1 reference after V2 approval = %+v err=%v", historical, referenceErr)
	}
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatalf("rollback exact historical reference check: %v", err)
	}

	v2, err = service.Unapprove(t.Context(), OperatingEntityReviewInput{
		ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision, Reason: "回落验证",
	}, reviewer("unapprove-v2"))
	if err != nil {
		t.Fatalf("unapprove V2: %v", err)
	}
	assertOperatingEntityCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "第一版经营主体", true)

	v2, err = service.Unsubmit(t.Context(), OperatingEntityReviewInput{
		ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision,
	}, creator("unsubmit-v2"))
	if err != nil {
		t.Fatalf("unsubmit V2 after unapprove: %v", err)
	}
	if err = service.Delete(t.Context(), OperatingEntityDeleteInput{
		ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision,
	}, creator("delete-v2")); err != nil {
		t.Fatalf("delete V2: %v", err)
	}
	v1, err = service.Unapprove(t.Context(), OperatingEntityReviewInput{
		ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID,
		ApprovalRevision: v1.Approval.Revision, Reason: "无更早已批准版本",
	}, reviewer("unapprove-v1"))
	if err != nil {
		t.Fatalf("unapprove V1: %v", err)
	}
	assertOperatingEntityAbsent(t, business, v1.ObjectID)
}

func TestOperatingEntityDraftDeletionRenumbersNextCandidateIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	business, service := newDCLIntegrationServices(t, pool, txevent.NewBus(), nil)
	_ = business
	creator := dclActor(t, ulid.Make().String(), "creator")
	reviewer := dclActor(t, ulid.Make().String(), "reviewer")
	v1, err := service.Create(t.Context(), OperatingEntityCreateInput{Data: OperatingEntityData{Name: "编号主体"}}, creator)
	if err != nil {
		t.Fatalf("create V1: %v", err)
	}
	v1 = submitAndApproveOperatingEntity(t, service, v1, dclActor(t, creator.ID(), "submit-v1"), reviewer)
	v2, err := service.Save(t.Context(), operatingEntitySave(v1, "将删除的 V2"), dclActor(t, creator.ID(), "save-v2"))
	if err != nil {
		t.Fatalf("create V2: %v", err)
	}
	if err = service.Delete(t.Context(), OperatingEntityDeleteInput{
		ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision,
	}, dclActor(t, creator.ID(), "delete-v2")); err != nil {
		t.Fatalf("delete V2: %v", err)
	}
	replacement, err := service.Save(t.Context(), operatingEntitySave(v1, "替代 V2"), dclActor(t, creator.ID(), "save-replacement"))
	if err != nil {
		t.Fatalf("create replacement V2: %v", err)
	}
	if replacement.Approval.VersionNo != 2 {
		t.Fatalf("replacement version = %+v, want V2", replacement.Approval.VersionNo)
	}
}

func TestOperatingEntityConcurrentCandidateIsUniqueIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	_, service := newDCLIntegrationServices(t, pool, txevent.NewBus(), nil)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	v1, err := service.Create(t.Context(), OperatingEntityCreateInput{Data: OperatingEntityData{Name: "并发主体"}}, dclActor(t, creatorID, "create"))
	if err != nil {
		t.Fatalf("create V1: %v", err)
	}
	v1 = submitAndApproveOperatingEntity(t, service, v1, dclActor(t, creatorID, "submit"), dclActor(t, reviewerID, "approve"))

	results := make(chan error, 2)
	var start sync.WaitGroup
	start.Add(2)
	for index := 1; index <= 2; index++ {
		index := index
		go func() {
			start.Done()
			start.Wait()
			_, saveErr := service.Save(t.Context(), operatingEntitySave(v1, "并发候选 "+string(rune('0'+index))), dclActor(t, creatorID, "concurrent-save-"+string(rune('0'+index))))
			results <- saveErr
		}()
	}
	var successes, conflicts int
	for range 2 {
		saveErr := <-results
		if saveErr == nil {
			successes++
			continue
		}
		var domainErr *DomainError
		if errors.As(saveErr, &domainErr) && domainErr.ErrorKey == "approval_open_version_exists" {
			conflicts++
			continue
		}
		t.Fatalf("unexpected concurrent save error: %v", saveErr)
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent saves: successes=%d conflicts=%d", successes, conflicts)
	}
	var candidates int
	if err = pool.QueryRow(t.Context(), `
		SELECT count(*) FROM approval_entries
		WHERE domain='dcl' AND entity='operating-entity' AND subject_id=$1 AND version_no=2
	`, v1.ObjectID).Scan(&candidates); err != nil {
		t.Fatalf("count V2 candidates: %v", err)
	}
	if candidates != 1 {
		t.Fatalf("V2 candidate count = %d", candidates)
	}
}

func TestOperatingEntityApprovalSubscriberFailureRollsBackIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	bus := txevent.NewBus()
	failure := errors.New("DCL subscriber failure")
	if err := dclapproval.OperatingEntityTopic.Subscribe(bus, "reject-approved", func(_ context.Context, _ pgx.Tx, event approval.Event[dclapproval.OperatingEntityPayload]) error {
		if event.Action == approval.ActionApproved {
			return failure
		}
		return nil
	}); err != nil {
		t.Fatalf("subscribe rejecting DCL handler: %v", err)
	}
	business, service := newDCLIntegrationServices(t, pool, bus, nil)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	draft, err := service.Create(t.Context(), OperatingEntityCreateInput{Data: OperatingEntityData{Name: "订阅失败主体"}}, dclActor(t, creatorID, "create"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	pending, err := service.Submit(t.Context(), OperatingEntityVersionInput{
		ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision,
	}, dclActor(t, creatorID, "submit"))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	_, err = service.Approve(t.Context(), OperatingEntityVersionInput{
		ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision,
	}, dclActor(t, reviewerID, "approve"))
	if !errors.Is(err, failure) {
		t.Fatalf("approve error = %v, want subscriber failure", err)
	}
	assertApprovalState(t, pool, pending.Approval.ApprovalEntryID, approval.StatusPending, pending.Approval.Revision)
	assertOperatingEntityAbsent(t, business, pending.ObjectID)
}

type failingOperatingEntityCurrentWriter struct {
	operatingEntityCurrentWriter
	failure error
}

func (w failingOperatingEntityCurrentWriter) ApplyOperatingEntityCurrent(
	ctx context.Context,
	tx pgx.Tx,
	objectID string,
	entryID string,
	enabled bool,
	data bobdomain.OperatingEntityData,
	actorID string,
) (bobdomain.OperatingEntityCurrent, error) {
	current, err := w.operatingEntityCurrentWriter.ApplyOperatingEntityCurrent(ctx, tx, objectID, entryID, enabled, data, actorID)
	if err != nil {
		return bobdomain.OperatingEntityCurrent{}, err
	}
	return current, w.failure
}

func TestOperatingEntityCurrentApplyFailureRollsBackIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	bus := txevent.NewBus()
	business, service := newDCLIntegrationServices(t, pool, bus, nil)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	draft, err := service.Create(t.Context(), OperatingEntityCreateInput{Data: OperatingEntityData{Name: "应用失败主体"}}, dclActor(t, creatorID, "create"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	pending, err := service.Submit(t.Context(), OperatingEntityVersionInput{
		ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision,
	}, dclActor(t, creatorID, "submit"))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	failure := errors.New("BOB current apply failure")
	failingService := NewOperatingEntityService(pool, failingOperatingEntityCurrentWriter{
		operatingEntityCurrentWriter: business, failure: failure,
	}, authorization.Func(nil), bus)
	_, err = failingService.Approve(t.Context(), OperatingEntityVersionInput{
		ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision,
	}, dclActor(t, reviewerID, "approve"))
	if !errors.Is(err, failure) {
		t.Fatalf("approve error = %v, want current apply failure", err)
	}
	assertApprovalState(t, pool, pending.Approval.ApprovalEntryID, approval.StatusPending, pending.Approval.Revision)
	assertOperatingEntityAbsent(t, business, pending.ObjectID)
}

func newDCLIntegrationServices(
	t *testing.T,
	pool *pgxpool.Pool,
	bus *txevent.Bus,
	current operatingEntityCurrentWriter,
) (*bobdomain.Service, *OperatingEntityService) {
	t.Helper()
	authorizer := authorization.Func(nil)
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	business := newDCLIntegrationBOBService(pool, auxiliary, authorizer, bus)
	if current == nil {
		current = business
	}
	return business, NewOperatingEntityService(pool, current, authorizer, bus)
}

func operatingEntitySave(v1 OperatingEntityMutation, name string) OperatingEntitySaveInput {
	return OperatingEntitySaveInput{
		ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision,
		Enabled: true, Data: OperatingEntityData{Name: name},
	}
}

func assertApprovalState(t *testing.T, pool *pgxpool.Pool, entryID string, status approval.Status, revision int64) {
	t.Helper()
	var gotStatus string
	var gotRevision int64
	if err := pool.QueryRow(t.Context(), `SELECT status, revision FROM approval_entries WHERE id=$1`, entryID).Scan(&gotStatus, &gotRevision); err != nil {
		t.Fatalf("get approval state: %v", err)
	}
	if gotStatus != string(status) || gotRevision != revision {
		t.Fatalf("approval state = %s r%d, want %s r%d", gotStatus, gotRevision, status, revision)
	}
}

func submitAndApproveOperatingEntity(
	t *testing.T,
	service *OperatingEntityService,
	mutation OperatingEntityMutation,
	submitter approval.Actor,
	reviewer approval.Actor,
) OperatingEntityMutation {
	t.Helper()
	pending, err := service.Submit(t.Context(), OperatingEntityVersionInput{
		ObjectID: mutation.ObjectID, ApprovalEntryID: mutation.Approval.ApprovalEntryID,
		ApprovalRevision: mutation.Approval.Revision,
	}, submitter)
	if err != nil {
		t.Fatalf("submit operating entity: %v", err)
	}
	approved, err := service.Approve(t.Context(), OperatingEntityVersionInput{
		ObjectID: mutation.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID,
		ApprovalRevision: pending.Approval.Revision,
	}, reviewer)
	if err != nil {
		t.Fatalf("approve operating entity: %v", err)
	}
	return approved
}

func assertOperatingEntityAbsent(t *testing.T, business *bobdomain.Service, objectID string) {
	t.Helper()
	_, err := business.Get(t.Context(), bobdomain.EntityOperatingEntity, bobdomain.GetInput{ObjectID: objectID})
	if err == nil {
		t.Fatal("ordinary BOB get exposed an operating-entity candidate")
	}
	page, queryErr := business.Query(t.Context(), bobdomain.EntityOperatingEntity, bobdomain.QueryInput{Page: 1, PageSize: 20})
	if queryErr != nil {
		t.Fatalf("query BOB operating entities: %v", queryErr)
	}
	if page.Total != 0 || len(page.Items) != 0 {
		t.Fatalf("BOB query exposed candidate: %+v", page)
	}
}

func assertOperatingEntityCurrent(
	t *testing.T,
	business *bobdomain.Service,
	objectID string,
	approvalEntryID string,
	name string,
	enabled bool,
) {
	t.Helper()
	view, err := business.Get(t.Context(), bobdomain.EntityOperatingEntity, bobdomain.GetInput{ObjectID: objectID})
	if err != nil {
		t.Fatalf("get BOB operating entity: %v", err)
	}
	if view.Approval.ApprovalEntryID != approvalEntryID || view.Data.Name != name || view.Enabled != enabled {
		t.Fatalf("BOB current view = %+v", view)
	}
	page, err := business.Query(t.Context(), bobdomain.EntityOperatingEntity, bobdomain.QueryInput{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("query BOB operating entities: %v", err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].LatestApproved == nil ||
		page.Items[0].LatestApproved.Approval.ApprovalEntryID != approvalEntryID {
		t.Fatalf("BOB current page = %+v", page)
	}
}
