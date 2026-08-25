//go:build integration

package bobseed

import (
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
	if _, err = service.ResolveApprovedReference(
		t.Context(), tx, bob.EntityWarehouse, created.ObjectID, v2.Approval.ApprovalEntryID,
	); err == nil {
		t.Fatal("draft V2 was resolvable as an approved reference")
	}
	latest, err := service.ResolveLatestApprovedReference(t.Context(), tx, bob.EntityWarehouse, created.ObjectID)
	if err != nil || latest.ApprovalEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("latest during V2 draft = %+v err=%v, want V1", latest, err)
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
	v2Approved, err := service.Approve(t.Context(), bob.EntityWarehouse, bob.ReviewInput{
		ObjectID: created.ObjectID, ApprovalEntryID: v2Pending.Approval.ApprovalEntryID,
		ApprovalRevision: v2Pending.Approval.Revision,
	}, actor("approve-v2"))
	if err != nil {
		t.Fatalf("approve V2: %v", err)
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
