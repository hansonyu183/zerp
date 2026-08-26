//go:build integration

package bobseed

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	"github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func TestSeedDemoDataIntegration(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	databaseName := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if databaseURL == "" || databaseName == "" {
		t.Fatal("TEST_DATABASE_URL and TEST_POSTGRES_DB are required")
	}
	if !strings.HasSuffix(databaseName, "_test") {
		t.Fatalf("TEST_POSTGRES_DB %q must end with _test", databaseName)
	}

	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect integration database: %v", err)
	}
	t.Cleanup(pool.Close)

	var currentDatabase string
	if err = pool.QueryRow(t.Context(), "select current_database()").Scan(&currentDatabase); err != nil {
		t.Fatalf("read current database: %v", err)
	}
	if currentDatabase != databaseName {
		t.Fatalf("connected database %q does not match TEST_POSTGRES_DB %q", currentDatabase, databaseName)
	}

	first, err := New(pool).Seed(t.Context())
	if err != nil {
		t.Fatalf("seed demo data: %v", err)
	}
	if first.Created+first.Resumed+first.Skipped != len(samples) {
		t.Fatalf("first result = %+v", first)
	}

	second, err := New(pool).Seed(t.Context())
	if err != nil {
		t.Fatalf("repeat seed demo data: %v", err)
	}
	if second != (Result{Skipped: len(samples)}) {
		t.Fatalf("second result = %+v", second)
	}

	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorization.FailClosed{}, bus)
	service := bob.NewService(pool, auxiliaryrefs.New(auxiliary), authorization.Func(nil), bus)
	actor := func(label string) approval.Actor {
		actorID := "01J00000000000000000000000"
		if strings.Contains(label, "approve") || strings.Contains(label, "reject") {
			actorID = "01J00000000000000000000001"
		}
		result, actorErr := approval.UserActor(authorization.Principal{ActorID: actorID}, "pr3-"+label)
		if actorErr != nil {
			t.Fatalf("create actor %s: %v", label, actorErr)
		}
		return result
	}
	var partyID, operatingEntityID string
	if err = pool.QueryRow(t.Context(), `
		SELECT relationship.party_id,relationship.operating_entity_id
		FROM bob_customer_relationships relationship
		JOIN bob_objects object ON object.id=relationship.object_id AND object.entity='customer'
		ORDER BY object.created_at LIMIT 1
	`).Scan(&partyID, &operatingEntityID); err != nil {
		t.Fatalf("load seeded party identity: %v", err)
	}
	salesPartner, err := service.SalesPartnerCreate(t.Context(), bob.SalesPartnerCreateInput{
		PartyID: partyID,
		Data: bob.SalesPartnerData{OperatingEntityID: operatingEntityID,
			Capabilities: []string{bob.SalesCapabilityChannelPartner}},
	}, actor("sales-partner-create"), true)
	if err != nil {
		t.Fatalf("create sales partner: %v", err)
	}
	submittedPartner, err := service.Submit(t.Context(), bob.EntitySalesPartner, bob.VersionRevisionInput{
		ObjectID: salesPartner.ObjectID, ApprovalEntryID: salesPartner.Approval.ApprovalEntryID,
		ApprovalRevision: salesPartner.Approval.Revision,
	}, actor("sales-partner-submit"))
	if err != nil {
		t.Fatalf("submit sales partner: %v", err)
	}
	if _, err = service.Approve(t.Context(), bob.EntitySalesPartner, bob.ReviewInput{
		ObjectID: salesPartner.ObjectID, ApprovalEntryID: salesPartner.Approval.ApprovalEntryID,
		ApprovalRevision: submittedPartner.Approval.Revision,
	}, actor("sales-partner-approve")); err != nil {
		t.Fatalf("approve sales partner: %v", err)
	}

	counts := make(map[string]int)
	lookup := queryLookup{queries: dbsqlc.New(pool), pool: pool}
	for _, item := range samples {
		objectID, found, findErr := lookup.Find(t.Context(), item.entity, item.data.Code)
		if findErr != nil || !found {
			t.Fatalf("find %s %s: found=%t err=%v", item.entity, item.data.Code, found, findErr)
		}
		if auxiliary, ok := auxiliarySeedEntity(item.entity); ok {
			var enabled bool
			if err = pool.QueryRow(t.Context(), `SELECT enabled FROM aux_objects WHERE entity=$1 AND id=$2`, auxiliary, objectID).Scan(&enabled); err != nil || !enabled {
				t.Fatalf("query %s %s enabled=%t err=%v", auxiliary, item.data.Code, enabled, err)
			}
			continue
		}
		var status string
		if err = pool.QueryRow(t.Context(), `
			SELECT entry.status
			FROM approval_entries entry
			WHERE entry.domain='bob' AND entry.entity=$1 AND entry.subject_id=$2
			  AND entry.version_no IS NOT NULL
			ORDER BY entry.version_no DESC
			LIMIT 1
		`, item.entity, objectID).Scan(&status); err != nil {
			t.Fatalf("query %s %s status: %v", item.entity, item.data.Code, err)
		}
		counts[status]++
	}
	expected := map[string]int{
		approvedStatus:                 11,
		string(approval.StatusDraft):   6,
		string(approval.StatusPending): 1,
	}
	if len(counts) != len(expected) {
		t.Fatalf("status counts = %v", counts)
	}
	for status, count := range expected {
		if counts[status] != count {
			t.Fatalf("%s count = %d, want %d", status, counts[status], count)
		}
	}

	allEntities := []string{
		bob.EntityCustomer, bob.EntityCustomerAccount, bob.EntitySupplier, bob.EntityOtherUnit,
		bob.EntityEmployee, bob.EntitySalesPartner, bob.EntityProduct, bob.EntityWarehouse,
		bob.EntityVehicle, bob.EntityFundAccount, bob.EntityOperatingEntity,
	}
	payloadTables := map[string]string{
		bob.EntityCustomer: "bob_customer_relationship_versions", bob.EntityCustomerAccount: "bob_customer_versions",
		bob.EntitySupplier: "bob_supplier_versions", bob.EntityOtherUnit: "bob_service_relationship_versions",
		bob.EntityEmployee: "bob_employee_versions", bob.EntitySalesPartner: "bob_sales_partner_versions",
		bob.EntityProduct: "bob_product_versions", bob.EntityWarehouse: "bob_warehouse_versions",
		bob.EntityVehicle: "bob_vehicle_versions", bob.EntityFundAccount: "bob_fund_account_versions",
		bob.EntityOperatingEntity: "bob_operating_entity_versions",
	}
	for _, entity := range allEntities {
		var objectCount, entryCount, payloadCount int
		if err = pool.QueryRow(t.Context(), `
			SELECT count(*),
			       (SELECT count(*) FROM approval_entries entry WHERE entry.domain='bob' AND entry.entity=$1)
			FROM bob_objects object WHERE object.entity=$1
		`, entity).Scan(&objectCount, &entryCount); err != nil {
			t.Fatalf("query %s central coverage: %v", entity, err)
		}
		payloadQuery := fmt.Sprintf(`SELECT count(*) FROM %s payload JOIN approval_entries entry ON entry.id=payload.approval_entry_id WHERE entry.domain='bob' AND entry.entity=$1`, payloadTables[entity])
		if err = pool.QueryRow(t.Context(), payloadQuery, entity).Scan(&payloadCount); err != nil {
			t.Fatalf("query %s payload coverage: %v", entity, err)
		}
		if objectCount == 0 || entryCount == 0 || payloadCount == 0 {
			t.Fatalf("%s central coverage objects=%d entries=%d payloadEvidence=%d", entity, objectCount, entryCount, payloadCount)
		}
	}
}

func TestBobApprovalVersionLifecycleIntegration(t *testing.T) {
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

	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorization.FailClosed{}, bus)
	service := bob.NewService(pool, auxiliaryrefs.New(auxiliary), authorization.Func(nil), bus)
	actor := func(label string) approval.Actor {
		actorID := "01J00000000000000000000000"
		if strings.Contains(label, "approve") {
			actorID = "01J00000000000000000000001"
		}
		result, actorErr := approval.UserActor(
			authorization.Principal{ActorID: actorID}, "pr3-bob-lifecycle-"+label,
		)
		if actorErr != nil {
			t.Fatalf("create %s actor: %v", label, actorErr)
		}
		return result
	}

	created, err := service.Create(t.Context(), bob.EntityWarehouse, bob.CreateInput{
		Data: bob.CreateDetailInput{Name: "审批版本集成仓库"},
	}, actor("create"))
	if err != nil {
		t.Fatalf("create V1: %v", err)
	}
	v1Pending, err := service.Submit(t.Context(), bob.EntityWarehouse, bob.VersionRevisionInput{
		ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID,
		ApprovalRevision: created.Approval.Revision,
	}, actor("submit-v1"))
	if err != nil {
		t.Fatalf("submit V1: %v", err)
	}
	v1, err := service.Approve(t.Context(), bob.EntityWarehouse, bob.ReviewInput{
		ObjectID: created.ObjectID, ApprovalEntryID: v1Pending.Approval.ApprovalEntryID,
		ApprovalRevision: v1Pending.Approval.Revision,
	}, actor("approve-v1"))
	if err != nil {
		t.Fatalf("approve V1: %v", err)
	}
	unrelated, err := service.Create(t.Context(), bob.EntityWarehouse, bob.CreateInput{
		Data: bob.CreateDetailInput{Name: "审批版本集成无关仓库"},
	}, actor("create-unrelated"))
	if err != nil {
		t.Fatalf("create unrelated warehouse: %v", err)
	}

	v2, err := service.Save(t.Context(), bob.EntityWarehouse, bob.SaveInput{
		ObjectID: created.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID,
		ApprovalRevision: v1.Approval.Revision,
		Data:             bob.DetailInput{Name: "审批版本集成仓库 V2"},
	}, actor("save-v2"))
	if err != nil {
		t.Fatalf("create V2: %v", err)
	}
	if v2.Approval.VersionNo != 2 || v2.Approval.Status != approval.StatusDraft {
		t.Fatalf("V2 approval = %+v, want V2 DRAFT", v2.Approval)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin reference check: %v", err)
	}
	if _, err = service.ValidateApprovedSnapshotReference(
		t.Context(), tx, bob.EntityWarehouse, created.ObjectID, v2.Approval.ApprovalEntryID,
	); err == nil {
		t.Fatal("draft V2 was resolvable as an approved reference")
	}
	if _, err = service.ValidateApprovedSnapshotReference(
		t.Context(), tx, bob.EntityWarehouse, unrelated.ObjectID, v1.Approval.ApprovalEntryID,
	); err == nil {
		t.Fatal("approval entry resolved for a different BOB object")
	}
	latest, err := service.ResolveLatestApprovedReference(t.Context(), tx, bob.EntityWarehouse, created.ObjectID)
	if err != nil || latest.ApprovalEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("latest during V2 draft = %+v err=%v, want V1", latest, err)
	}
	forgedEntryID := ulid.Make().String()
	if _, err = tx.Exec(t.Context(), `
		INSERT INTO approval_entries (
			id,domain,entity,subject_id,version_no,status,revision,
			created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at
		) VALUES ($1,'bob','warehouse',$2,3,'APPROVED',1,$3,clock_timestamp(),$3,clock_timestamp(),$3,clock_timestamp(),$4,clock_timestamp())
	`, forgedEntryID, created.ObjectID, "01J00000000000000000000000", "01J00000000000000000000001"); err != nil {
		t.Fatalf("insert forged approved BOB metadata: %v", err)
	}
	if _, err = service.ValidateApprovedSnapshotReference(
		t.Context(), tx, bob.EntityWarehouse, created.ObjectID, forgedEntryID,
	); err == nil {
		t.Fatal("approved metadata without a BOB version payload resolved as a snapshot")
	}
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatalf("rollback reference check: %v", err)
	}

	v2Pending, err := service.Submit(t.Context(), bob.EntityWarehouse, bob.VersionRevisionInput{
		ObjectID: created.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision,
	}, actor("submit-v2"))
	if err != nil {
		t.Fatalf("submit V2: %v", err)
	}
	tx, err = pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin pending reference check: %v", err)
	}
	if _, err = service.ValidateApprovedSnapshotReference(
		t.Context(), tx, bob.EntityWarehouse, created.ObjectID, v2Pending.Approval.ApprovalEntryID,
	); err == nil {
		t.Fatal("pending V2 was resolvable as an approved snapshot")
	}
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatalf("rollback pending reference check: %v", err)
	}
	v2Approved, err := service.Approve(t.Context(), bob.EntityWarehouse, bob.ReviewInput{
		ObjectID: created.ObjectID, ApprovalEntryID: v2Pending.Approval.ApprovalEntryID,
		ApprovalRevision: v2Pending.Approval.Revision,
	}, actor("approve-v2"))
	if err != nil {
		t.Fatalf("approve V2: %v", err)
	}
	tx, err = pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin approved reference check: %v", err)
	}
	snapshot, err := service.ValidateApprovedSnapshotReference(
		t.Context(), tx, bob.EntityWarehouse, created.ObjectID, v1.Approval.ApprovalEntryID,
	)
	if err != nil || snapshot.ApprovalEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("validate V1 snapshot after V2 approval = %+v err=%v, want V1", snapshot, err)
	}
	latest, err = service.ResolveLatestApprovedReference(t.Context(), tx, bob.EntityWarehouse, created.ObjectID)
	if err != nil || latest.ApprovalEntryID != v2Approved.Approval.ApprovalEntryID {
		t.Fatalf("latest reference after V2 approval = %+v err=%v, want V2", latest, err)
	}
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatalf("rollback approved reference check: %v", err)
	}
	v2Unapproved, err := service.Unapprove(t.Context(), bob.EntityWarehouse, bob.ReverseInput{
		ObjectID: created.ObjectID, ApprovalEntryID: v2Approved.Approval.ApprovalEntryID,
		ApprovalRevision: v2Approved.Approval.Revision, Reason: "回落到 V1",
	}, actor("unapprove-v2"))
	if err != nil {
		t.Fatalf("unapprove V2: %v", err)
	}
	tx, err = pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin fallback check: %v", err)
	}
	latest, err = service.ResolveLatestApprovedReference(t.Context(), tx, bob.EntityWarehouse, created.ObjectID)
	if err != nil || latest.ApprovalEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("latest after V2 unapprove = %+v err=%v, want V1", latest, err)
	}
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatalf("rollback fallback check: %v", err)
	}

	v2Draft, err := service.Unsubmit(t.Context(), bob.EntityWarehouse, bob.ReverseInput{
		ObjectID: created.ObjectID, ApprovalEntryID: v2Unapproved.Approval.ApprovalEntryID,
		ApprovalRevision: v2Unapproved.Approval.Revision, Reason: "删除候选",
	}, actor("unsubmit-v2"))
	if err != nil {
		t.Fatalf("unsubmit V2: %v", err)
	}
	if err = service.Delete(t.Context(), bob.EntityWarehouse, bob.DeleteInput{
		ObjectID: created.ObjectID, ObjectRevision: v2Draft.ObjectRevision,
		ApprovalEntryID: v2Draft.Approval.ApprovalEntryID, ApprovalRevision: v2Draft.Approval.Revision,
	}, actor("delete-v2")); err != nil {
		t.Fatalf("delete V2: %v", err)
	}
	if _, err = service.Unapprove(t.Context(), bob.EntityWarehouse, bob.ReverseInput{
		ObjectID: created.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID,
		ApprovalRevision: v1.Approval.Revision, Reason: "撤销 V1",
	}, actor("unapprove-v1")); err != nil {
		t.Fatalf("unapprove V1: %v", err)
	}
	tx, err = pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin unavailable check: %v", err)
	}
	if _, err = service.ResolveLatestApprovedReference(t.Context(), tx, bob.EntityWarehouse, created.ObjectID); err == nil {
		t.Fatal("BOB reference remained available after V1 unapprove")
	}
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatalf("rollback unavailable check: %v", err)
	}
}

func TestBobUnapproveUsesExactSnapshotEntryAndDisableUsesStableObjectIntegration(t *testing.T) {
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

	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorization.FailClosed{}, bus)
	service := bob.NewService(pool, auxiliaryrefs.New(auxiliary), authorization.Func(nil), bus)
	actor := func(label string) approval.Actor {
		actorID := "01J00000000000000000000000"
		if strings.Contains(label, "approve") {
			actorID = "01J00000000000000000000001"
		}
		result, actorErr := approval.UserActor(authorization.Principal{ActorID: actorID}, "approval-bob-correctness-"+label)
		if actorErr != nil {
			t.Fatalf("create %s actor: %v", label, actorErr)
		}
		return result
	}
	approve := func(entity string, created bob.MutationResult, label string) bob.MutationResult {
		t.Helper()
		pending, submitErr := service.Submit(t.Context(), entity, bob.VersionRevisionInput{
			ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID,
			ApprovalRevision: created.Approval.Revision,
		}, actor(label+"-submit"))
		if submitErr != nil {
			t.Fatalf("submit %s: %v", label, submitErr)
		}
		approved, approveErr := service.Approve(t.Context(), entity, bob.ReviewInput{
			ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID,
			ApprovalRevision: pending.Approval.Revision,
		}, actor(label+"-approve"))
		if approveErr != nil {
			t.Fatalf("approve %s: %v", label, approveErr)
		}
		return approved
	}
	createFundAccount := func(operatingEntityID, label string) bob.MutationResult {
		t.Helper()
		created, createErr := service.Create(t.Context(), bob.EntityFundAccount, bob.CreateInput{Data: bob.CreateDetailInput{
			Name: label, Currency: "CNY", OperatingEntityID: operatingEntityID,
		}}, actor(label+"-create"))
		if createErr != nil {
			t.Fatalf("create %s: %v", label, createErr)
		}
		return approve(bob.EntityFundAccount, created, label)
	}

	suffix := ulid.Make().String()
	created, err := service.Create(t.Context(), bob.EntityOperatingEntity, bob.CreateInput{Data: bob.CreateDetailInput{
		Name: "exact-entry operating V1 " + suffix,
	}}, actor("operating-create"))
	if err != nil {
		t.Fatalf("create operating entity V1: %v", err)
	}
	v1 := approve(bob.EntityOperatingEntity, created, "operating-v1")
	_ = createFundAccount(v1.ObjectID, "fund-referencing-v1-"+suffix)

	createV2 := func(label string) bob.MutationResult {
		t.Helper()
		v2, saveErr := service.Save(t.Context(), bob.EntityOperatingEntity, bob.SaveInput{
			ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID,
			ApprovalRevision: v1.Approval.Revision,
			Data:             bob.DetailInput{Name: "exact-entry operating V2 " + suffix},
		}, actor(label+"-save"))
		if saveErr != nil {
			t.Fatalf("create %s: %v", label, saveErr)
		}
		return approve(bob.EntityOperatingEntity, v2, label)
	}

	v2 := createV2("operating-v2-unreferenced")
	v2Pending, err := service.Unapprove(t.Context(), bob.EntityOperatingEntity, bob.ReverseInput{
		ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision, Reason: "V1 reference must not block V2",
	}, actor("unapprove-unreferenced-v2"))
	if err != nil {
		t.Fatalf("unapprove unreferenced V2 while V1 remains referenced: %v", err)
	}
	if v2Pending.Approval.Status != approval.StatusPending {
		t.Fatalf("unapproved V2 status = %s", v2Pending.Approval.Status)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin latest fallback check: %v", err)
	}
	latest, latestErr := service.ResolveLatestApprovedReference(t.Context(), tx, bob.EntityOperatingEntity, v1.ObjectID)
	if latestErr != nil || latest.ApprovalEntryID != v1.Approval.ApprovalEntryID {
		_ = tx.Rollback(t.Context())
		t.Fatalf("latest after V2 unapprove = %+v err=%v, want V1", latest, latestErr)
	}
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatalf("rollback latest fallback check: %v", err)
	}

	v2Draft, err := service.Unsubmit(t.Context(), bob.EntityOperatingEntity, bob.ReverseInput{
		ObjectID: v2Pending.ObjectID, ApprovalEntryID: v2Pending.Approval.ApprovalEntryID,
		ApprovalRevision: v2Pending.Approval.Revision, Reason: "replace V2 fixture",
	}, actor("unsubmit-v2"))
	if err != nil {
		t.Fatalf("unsubmit V2: %v", err)
	}
	if err = service.Delete(t.Context(), bob.EntityOperatingEntity, bob.DeleteInput{
		ObjectID: v2Draft.ObjectID, ObjectRevision: v2Draft.ObjectRevision,
		ApprovalEntryID: v2Draft.Approval.ApprovalEntryID, ApprovalRevision: v2Draft.Approval.Revision,
	}, actor("delete-v2")); err != nil {
		t.Fatalf("delete V2 fixture: %v", err)
	}

	v2 = createV2("operating-v2-referenced")
	_ = createFundAccount(v2.ObjectID, "fund-referencing-v2-"+suffix)
	_, err = service.Unapprove(t.Context(), bob.EntityOperatingEntity, bob.ReverseInput{
		ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision, Reason: "exact V2 snapshot must block",
	}, actor("unapprove-referenced-v2"))
	var unapproveErr *bob.DomainError
	if !errors.As(err, &unapproveErr) || unapproveErr.ErrorKey != "bob_unapprove_blocked" {
		t.Fatalf("referenced V2 unapprove error = %v", err)
	}

	_, err = service.Disable(t.Context(), bob.EntityOperatingEntity, bob.ObjectRevisionInput{
		ObjectID: v2.ObjectID, ObjectRevision: v2.ObjectRevision,
	}, actor("disable-referenced-object"))
	var disableErr *bob.DomainError
	if !errors.As(err, &disableErr) || disableErr.ErrorKey != "bob_disable_blocked" {
		t.Fatalf("referenced stable object disable error = %v", err)
	}
}

func TestBobAuxiliaryApprovalBoundaryIntegration(t *testing.T) {
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

	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorization.Func(nil), bus)
	bobService := bob.NewService(pool, auxiliaryrefs.New(auxiliary), authorization.Func(nil), bus)
	actor := func(label string) approval.Actor {
		actorID := "01J00000000000000000000000"
		if strings.Contains(label, "approve") || strings.Contains(label, "unapprove") {
			actorID = "01J00000000000000000000001"
		}
		result, actorErr := approval.UserActor(authorization.Principal{ActorID: actorID}, "pr3-boundary-"+label)
		if actorErr != nil {
			t.Fatalf("create %s actor: %v", label, actorErr)
		}
		return result
	}
	createApprovedAuxiliary := func(entity string, data map[string]any, label string) auxdomain.MutationResult {
		created, createErr := auxiliary.Create(t.Context(), entity, auxdomain.CreateInput{
			Data: auxdomain.CreateData{Data: data},
		}, actor(label+"-create"))
		if createErr != nil {
			t.Fatalf("create %s: %v", label, createErr)
		}
		pending, submitErr := auxiliary.Submit(t.Context(), entity, auxdomain.ApprovalRevisionInput{
			ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID,
			ApprovalRevision: created.Approval.Revision,
		}, actor(label+"-submit"))
		if submitErr != nil {
			t.Fatalf("submit %s: %v", label, submitErr)
		}
		approved, approveErr := auxiliary.Approve(t.Context(), entity, auxdomain.ApprovalRevisionInput{
			ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID,
			ApprovalRevision: pending.Approval.Revision,
		}, actor(label+"-approve"))
		if approveErr != nil {
			t.Fatalf("approve %s: %v", label, approveErr)
		}
		return approved
	}
	approveProduct := func(created bob.MutationResult, label string) bob.MutationResult {
		pending, submitErr := bobService.Submit(t.Context(), bob.EntityProduct, bob.VersionRevisionInput{
			ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID,
			ApprovalRevision: created.Approval.Revision,
		}, actor(label+"-submit"))
		if submitErr != nil {
			t.Fatalf("submit %s: %v", label, submitErr)
		}
		approved, approveErr := bobService.Approve(t.Context(), bob.EntityProduct, bob.ReviewInput{
			ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID,
			ApprovalRevision: pending.Approval.Revision,
		}, actor(label+"-approve"))
		if approveErr != nil {
			t.Fatalf("approve %s: %v", label, approveErr)
		}
		return approved
	}

	suffix := ulid.Make().String()
	productType := createApprovedAuxiliary(auxdomain.EntityProductType, map[string]any{
		"name": "PR3 原材料类型-" + suffix, "behaviorProfile": "RAW_MATERIAL",
	}, "product-type-"+suffix)
	unit, err := auxiliary.ResolveCode(t.Context(), nil, auxdomain.EntityMeasurementUnit, "UNT-0001")
	if err != nil {
		t.Fatalf("resolve baseline kilogram unit: %v", err)
	}
	newProduct := func(categoryID, name string) bob.MutationResult {
		created, createErr := bobService.Create(t.Context(), bob.EntityProduct, bob.CreateInput{Data: bob.CreateDetailInput{
			Name: name, CategoryID: categoryID, ProductTypeID: productType.ObjectID,
			DefaultInputUnitID: unit.ObjectID, PricingUnitID: unit.ObjectID,
			UnitConversions:      []bob.ProductUnitConversion{{Unit: bob.MeasurementUnitSnapshot{ObjectID: unit.ObjectID}, Factor: "1"}},
			DefaultPackagingSpec: "1",
		}}, actor(name+"-create"))
		if createErr != nil {
			t.Fatalf("create %s: %v", name, createErr)
		}
		return created
	}

	// A pending BOB candidate is not a formal reference, so it must not block
	// AUX unapprove. The subsequent BOB approve must revalidate its frozen AUX
	// approval-entry snapshot and reject the now-unavailable category.
	candidateCategory := createApprovedAuxiliary(auxdomain.EntityProductCategory, map[string]any{
		"name": "PR3 候选分类-" + suffix,
	}, "candidate-category-"+suffix)
	candidateProduct := newProduct(candidateCategory.ObjectID, "PR3 候选产品-"+suffix)
	candidatePending, err := bobService.Submit(t.Context(), bob.EntityProduct, bob.VersionRevisionInput{
		ObjectID: candidateProduct.ObjectID, ApprovalEntryID: candidateProduct.Approval.ApprovalEntryID,
		ApprovalRevision: candidateProduct.Approval.Revision,
	}, actor("candidate-product-submit-"+suffix))
	if err != nil {
		t.Fatalf("submit candidate product: %v", err)
	}
	reason := "verify candidate reference boundary"
	if _, err = auxiliary.Unapprove(t.Context(), auxdomain.EntityProductCategory, auxdomain.ReviewInput{
		ApprovalRevisionInput: auxdomain.ApprovalRevisionInput{
			ObjectID: candidateCategory.ObjectID, ApprovalEntryID: candidateCategory.Approval.ApprovalEntryID,
			ApprovalRevision: candidateCategory.Approval.Revision,
		}, Reason: &reason,
	}, actor("candidate-category-unapprove-"+suffix)); err != nil {
		t.Fatalf("pending BOB candidate incorrectly blocked AUX unapprove: %v", err)
	}
	if _, err = bobService.Approve(t.Context(), bob.EntityProduct, bob.ReviewInput{
		ObjectID: candidatePending.ObjectID, ApprovalEntryID: candidatePending.Approval.ApprovalEntryID,
		ApprovalRevision: candidatePending.Approval.Revision,
	}, actor("candidate-product-approve-"+suffix)); err == nil {
		t.Fatal("BOB approve accepted an AUX snapshot that was no longer latest approved")
	}

	// A latest APPROVED BOB version is a formal reference and must block AUX
	// unapprove. Querying by the same category also exercises the SQL-side
	// filter/count path so pagination totals cannot be distorted post-page.
	formalCategory := createApprovedAuxiliary(auxdomain.EntityProductCategory, map[string]any{
		"name": "PR3 正式分类-" + suffix,
	}, "formal-category-"+suffix)
	formalName := "PR3 正式产品-" + suffix
	formalProduct := approveProduct(newProduct(formalCategory.ObjectID, formalName), "formal-product-"+suffix)
	formalCategoryV2, err := auxiliary.Save(t.Context(), auxdomain.EntityProductCategory, auxdomain.SaveInput{
		ObjectID: formalCategory.ObjectID, ApprovalEntryID: formalCategory.Approval.ApprovalEntryID,
		ApprovalRevision: formalCategory.Approval.Revision,
		Data:             map[string]any{"name": "PR3 正式分类 V2-" + suffix},
	}, actor("formal-category-v2-save-"+suffix))
	if err != nil {
		t.Fatalf("create formal category V2: %v", err)
	}
	formalCategoryV2, err = auxiliary.Submit(t.Context(), auxdomain.EntityProductCategory, auxdomain.ApprovalRevisionInput{
		ObjectID: formalCategoryV2.ObjectID, ApprovalEntryID: formalCategoryV2.Approval.ApprovalEntryID,
		ApprovalRevision: formalCategoryV2.Approval.Revision,
	}, actor("formal-category-v2-submit-"+suffix))
	if err != nil {
		t.Fatalf("submit formal category V2: %v", err)
	}
	formalCategoryV2, err = auxiliary.Approve(t.Context(), auxdomain.EntityProductCategory, auxdomain.ApprovalRevisionInput{
		ObjectID: formalCategoryV2.ObjectID, ApprovalEntryID: formalCategoryV2.Approval.ApprovalEntryID,
		ApprovalRevision: formalCategoryV2.Approval.Revision,
	}, actor("formal-category-v2-approve-"+suffix))
	if err != nil {
		t.Fatalf("approve formal category V2: %v", err)
	}
	formalCategoryV2, err = auxiliary.Unapprove(t.Context(), auxdomain.EntityProductCategory, auxdomain.ReviewInput{
		ApprovalRevisionInput: auxdomain.ApprovalRevisionInput{
			ObjectID: formalCategoryV2.ObjectID, ApprovalEntryID: formalCategoryV2.Approval.ApprovalEntryID,
			ApprovalRevision: formalCategoryV2.Approval.Revision,
		}, Reason: &reason,
	}, actor("formal-category-v2-unapprove-"+suffix))
	if err != nil {
		t.Fatalf("V1 BOB snapshot incorrectly blocked AUX V2 unapprove: %v", err)
	}
	formalCategoryV2, err = auxiliary.Unsubmit(t.Context(), auxdomain.EntityProductCategory, auxdomain.ApprovalRevisionInput{
		ObjectID: formalCategoryV2.ObjectID, ApprovalEntryID: formalCategoryV2.Approval.ApprovalEntryID,
		ApprovalRevision: formalCategoryV2.Approval.Revision,
	}, actor("formal-category-v2-unsubmit-"+suffix))
	if err != nil {
		t.Fatalf("unsubmit formal category V2: %v", err)
	}
	if err = auxiliary.Delete(t.Context(), auxdomain.EntityProductCategory, auxdomain.DeleteInput{
		ObjectID: formalCategoryV2.ObjectID, ApprovalEntryID: formalCategoryV2.Approval.ApprovalEntryID,
		ApprovalRevision: formalCategoryV2.Approval.Revision,
	}, actor("formal-category-v2-delete-"+suffix)); err != nil {
		t.Fatalf("delete formal category V2: %v", err)
	}
	if _, err = auxiliary.Unapprove(t.Context(), auxdomain.EntityProductCategory, auxdomain.ReviewInput{
		ApprovalRevisionInput: auxdomain.ApprovalRevisionInput{
			ObjectID: formalCategory.ObjectID, ApprovalEntryID: formalCategory.Approval.ApprovalEntryID,
			ApprovalRevision: formalCategory.Approval.Revision,
		}, Reason: &reason,
	}, actor("formal-category-unapprove-"+suffix)); err == nil {
		t.Fatal("latest APPROVED BOB reference did not block AUX unapprove")
	}
	page, err := bobService.Query(t.Context(), bob.EntityProduct, bob.QueryInput{
		Page: 1, PageSize: 20,
		Filters: bob.QueryFilters{Keyword: formalName, CategoryID: formalCategory.ObjectID, Status: []string{string(approval.StatusApproved)}},
	})
	if err != nil {
		t.Fatalf("query formal product by category: %v", err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ObjectID != formalProduct.ObjectID {
		t.Fatalf("filtered formal products = total %d items %+v", page.Total, page.Items)
	}
}

func TestBobUnapproveBlocksAnyVoucherStateUntilPhysicalDeletionIntegration(t *testing.T) {
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

	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorization.FailClosed{}, bus)
	service := bob.NewService(pool, auxiliaryrefs.New(auxiliary), authorization.Func(nil), bus)
	actor := func(label string) approval.Actor {
		actorID := "01J00000000000000000000000"
		if strings.Contains(label, "approve") || strings.Contains(label, "unapprove") {
			actorID = "01J00000000000000000000001"
		}
		result, actorErr := approval.UserActor(authorization.Principal{ActorID: actorID}, "pr3-vou-blocker-"+label)
		if actorErr != nil {
			t.Fatalf("create %s actor: %v", label, actorErr)
		}
		return result
	}
	created, err := service.Create(t.Context(), bob.EntityWarehouse, bob.CreateInput{
		Data: bob.CreateDetailInput{Name: "PR3 VOU 阻断仓库 " + ulid.Make().String()},
	}, actor("warehouse-create"))
	if err != nil {
		t.Fatalf("create warehouse: %v", err)
	}
	pending, err := service.Submit(t.Context(), bob.EntityWarehouse, bob.VersionRevisionInput{
		ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID,
		ApprovalRevision: created.Approval.Revision,
	}, actor("warehouse-submit"))
	if err != nil {
		t.Fatalf("submit warehouse: %v", err)
	}
	approved, err := service.Approve(t.Context(), bob.EntityWarehouse, bob.ReviewInput{
		ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID,
		ApprovalRevision: pending.Approval.Revision,
	}, actor("warehouse-approve"))
	if err != nil {
		t.Fatalf("approve warehouse: %v", err)
	}
	v2, err := service.Save(t.Context(), bob.EntityWarehouse, bob.SaveInput{
		ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID,
		ApprovalRevision: approved.Approval.Revision,
		Data:             bob.DetailInput{Name: "PR3 VOU 阻断仓库 V2"},
	}, actor("warehouse-v2-save"))
	if err != nil {
		t.Fatalf("create warehouse V2: %v", err)
	}
	v2Pending, err := service.Submit(t.Context(), bob.EntityWarehouse, bob.VersionRevisionInput{
		ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision,
	}, actor("warehouse-v2-submit"))
	if err != nil {
		t.Fatalf("submit warehouse V2: %v", err)
	}
	approved, err = service.Approve(t.Context(), bob.EntityWarehouse, bob.ReviewInput{
		ObjectID: v2Pending.ObjectID, ApprovalEntryID: v2Pending.Approval.ApprovalEntryID,
		ApprovalRevision: v2Pending.Approval.Revision,
	}, actor("warehouse-v2-approve"))
	if err != nil {
		t.Fatalf("approve warehouse V2: %v", err)
	}
	approvedView, err := service.Get(t.Context(), bob.EntityWarehouse, bob.GetInput{
		ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID,
	})
	if err != nil {
		t.Fatalf("get approved warehouse: %v", err)
	}

	// The blocker deliberately scans typed VOU snapshots without filtering the
	// document state. A DRAFT inventory count therefore blocks unapprove until
	// its physical snapshot row is deleted.
	documentID, approvalEntryID := ulid.Make().String(), ulid.Make().String()
	voucherTx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin draft VOU insert: %v", err)
	}
	if _, err = voucherTx.Exec(t.Context(), `
		INSERT INTO approval_entries(id,domain,entity,subject_id,status,revision,created_by,created_at,updated_by,updated_at)
		VALUES($1,'vou','inventory-count',$2,'DRAFT',1,$3,now(),$3,now())
	`, approvalEntryID, documentID, "01J00000000000000000000000"); err != nil {
		_ = voucherTx.Rollback(t.Context())
		t.Fatalf("insert draft VOU approval: %v", err)
	}
	if _, err = voucherTx.Exec(t.Context(), `
		INSERT INTO vou_documents(id,entity,document_no,approval_entry_id,business_date,currency,total_amount_cents)
		VALUES($1,'inventory-count',$2,$3,CURRENT_DATE,'CNY',0)
	`, documentID, "CNT-20260825-9999", approvalEntryID); err != nil {
		_ = voucherTx.Rollback(t.Context())
		t.Fatalf("insert draft VOU document: %v", err)
	}
	if _, err = voucherTx.Exec(t.Context(), `
		INSERT INTO vou_inventory_count_details(document_id,warehouse_object_id,warehouse_approval_entry_id,warehouse_code,warehouse_name)
		VALUES($1,$2,$3,$4,$5)
	`, documentID, approved.ObjectID,
		approved.Approval.ApprovalEntryID, approvedView.Code, "PR3 VOU 阻断仓库"); err != nil {
		_ = voucherTx.Rollback(t.Context())
		t.Fatalf("insert draft VOU snapshot: %v", err)
	}
	if err = voucherTx.Commit(t.Context()); err != nil {
		t.Fatalf("commit draft VOU snapshot: %v", err)
	}
	reason := "verify VOU snapshot blocker"
	if _, err = service.Unapprove(t.Context(), bob.EntityWarehouse, bob.ReverseInput{
		ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID,
		ApprovalRevision: approved.Approval.Revision, Reason: reason,
	}, actor("warehouse-unapprove-blocked")); err == nil {
		t.Fatal("draft VOU snapshot did not block BOB unapprove")
	}
	voucherTx, err = pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin physical VOU deletion: %v", err)
	}
	if _, err = voucherTx.Exec(t.Context(), `DELETE FROM vou_inventory_count_details WHERE document_id=$1`, documentID); err != nil {
		_ = voucherTx.Rollback(t.Context())
		t.Fatalf("physically delete draft VOU snapshot: %v", err)
	}
	if _, err = voucherTx.Exec(t.Context(), `DELETE FROM vou_documents WHERE id=$1`, documentID); err != nil {
		_ = voucherTx.Rollback(t.Context())
		t.Fatalf("physically delete draft VOU snapshot: %v", err)
	}
	if _, err = voucherTx.Exec(t.Context(), `DELETE FROM approval_entries WHERE id=$1`, approvalEntryID); err != nil {
		_ = voucherTx.Rollback(t.Context())
		t.Fatalf("physically delete draft VOU approval: %v", err)
	}
	if err = voucherTx.Commit(t.Context()); err != nil {
		t.Fatalf("commit physical VOU deletion: %v", err)
	}
	if _, err = service.Unapprove(t.Context(), bob.EntityWarehouse, bob.ReverseInput{
		ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID,
		ApprovalRevision: approved.Approval.Revision, Reason: reason,
	}, actor("warehouse-unapprove-released")); err != nil {
		t.Fatalf("physical VOU deletion did not release BOB unapprove: %v", err)
	}
}
