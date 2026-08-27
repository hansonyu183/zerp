//go:build integration

package dcl

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func TestVehicleDeclarationControlsBOBCurrentDataIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	typeObjectID, typeEntryID := seedVehicleTypeApproval(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary), authorizer, bus)
	service := NewVehicleService(pool, business, authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }

	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	carrier, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: OperatingEntityData{Name: "车辆承运主体"}}, creator("carrier-create"))
	if err != nil {
		t.Fatalf("create carrier: %v", err)
	}
	carrier = submitAndApproveOperatingEntity(t, operating, carrier, creator("carrier-submit"), reviewer("carrier-approve"))
	carrierID := carrier.ObjectID
	v1, err := service.Create(t.Context(), VehicleCreateInput{Data: VehicleData{
		Name: "一号车辆", PlateNumber: "沪A10001", VehicleType: "DIT-0003",
		CarrierAffiliation: &bobdomain.CarrierAffiliation{Type: "INTERNAL", OperatingEntityID: carrierID},
	}}, creator("create-v1"))
	if err != nil {
		t.Fatalf("create V1: %v", err)
	}
	var storedTypeObjectID, storedTypeEntryID, storedTypeName string
	if err = pool.QueryRow(t.Context(), `SELECT vehicle_type_object_id,vehicle_type_approval_entry_id,vehicle_type_name FROM dcl_vehicle_versions WHERE approval_entry_id=$1`, v1.Approval.ApprovalEntryID).Scan(&storedTypeObjectID, &storedTypeEntryID, &storedTypeName); err != nil {
		t.Fatalf("read vehicle type snapshot: %v", err)
	}
	if storedTypeObjectID != typeObjectID || storedTypeEntryID != typeEntryID || storedTypeName != "厢式货车" {
		t.Fatalf("vehicle type snapshot = (%s,%s,%s)", storedTypeObjectID, storedTypeEntryID, storedTypeName)
	}
	if _, err = business.Get(t.Context(), bobdomain.EntityVehicle, bobdomain.GetInput{ObjectID: v1.ObjectID}); err == nil {
		t.Fatal("BOB get exposed a vehicle candidate")
	}
	v1 = submitAndApproveVehicle(t, service, v1, creator("submit-v1"), reviewer("approve-v1"))
	assertVehicleCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "一号车辆", true)
	page, err := business.Query(t.Context(), bobdomain.EntityVehicle, bobdomain.QueryInput{
		Page: 1, PageSize: 20, Filters: bobdomain.QueryFilters{},
		Sort: []bobdomain.SortItem{{Field: "code", Order: "asc"}},
	})
	if err != nil || len(page.Items) != 1 || page.Items[0].ObjectID != v1.ObjectID {
		t.Fatalf("query BOB vehicle current by code: page=%+v err=%v", page, err)
	}
	declarationPage, err := service.Query(t.Context(), VehicleQueryInput{
		Page: 1, PageSize: 20, Sort: []VehicleSortItem{{Field: "code", Order: "asc"}},
	}, creator("query-v1"))
	if err != nil || len(declarationPage.Items) != 1 || declarationPage.Items[0].ObjectID != v1.ObjectID {
		t.Fatalf("query DCL vehicle declaration by code: page=%+v err=%v", declarationPage, err)
	}

	v2, err := service.Save(t.Context(), VehicleSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Enabled: false, Data: VehicleData{
		Name: "二号车辆", PlateNumber: "沪A10001", VehicleType: "DIT-0003", BulkLiquidCapable: true,
		CarrierAffiliation: &bobdomain.CarrierAffiliation{Type: "INTERNAL", OperatingEntityID: carrierID},
	}}, creator("save-v2"))
	if err != nil {
		t.Fatalf("save V2: %v", err)
	}
	assertVehicleCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "一号车辆", true)
	v2 = submitAndApproveVehicle(t, service, v2, creator("submit-v2"), reviewer("approve-v2"))
	assertVehicleCurrent(t, business, v1.ObjectID, v2.Approval.ApprovalEntryID, "二号车辆", false)
	v2, err = service.Unapprove(t.Context(), VehicleReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "回落验证"}, reviewer("unapprove-v2"))
	if err != nil {
		t.Fatalf("unapprove V2: %v", err)
	}
	assertVehicleCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "一号车辆", true)
	v2, err = service.Reject(t.Context(), VehicleReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "删除回落候选"}, reviewer("reject-v2"))
	if err != nil {
		t.Fatalf("reject unapproved V2: %v", err)
	}
	if err = service.Delete(t.Context(), VehicleDeleteInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision}, creator("delete-v2")); err != nil {
		t.Fatalf("delete V2: %v", err)
	}
	v1, err = service.Unapprove(t.Context(), VehicleReviewInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Reason: "移除首版正式车辆"}, reviewer("unapprove-v1"))
	if err != nil {
		t.Fatalf("unapprove V1: %v", err)
	}
	if _, err = business.Get(t.Context(), bobdomain.EntityVehicle, bobdomain.GetInput{ObjectID: v1.ObjectID}); err == nil {
		t.Fatal("BOB current still exposes first-version unapproved vehicle")
	}
	external, err := business.OtherUnitCreate(t.Context(), bobdomain.OtherUnitCreateInput{
		NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: "外部承运服务商"},
		Data:     bobdomain.OtherUnitData{OperatingEntityID: carrierID},
	}, creator("external-carrier-create"), true)
	if err != nil {
		t.Fatalf("create external carrier: %v", err)
	}
	externalPending, err := business.Submit(t.Context(), bobdomain.EntityOtherUnit, bobdomain.VersionRevisionInput{ObjectID: external.ObjectID, ApprovalEntryID: external.Approval.ApprovalEntryID, ApprovalRevision: external.Approval.Revision}, creator("external-carrier-submit"))
	if err != nil {
		t.Fatalf("submit external carrier: %v", err)
	}
	externalApproved, err := business.Approve(t.Context(), bobdomain.EntityOtherUnit, bobdomain.ReviewInput{ObjectID: externalPending.ObjectID, ApprovalEntryID: externalPending.Approval.ApprovalEntryID, ApprovalRevision: externalPending.Approval.Revision}, reviewer("external-carrier-approve"))
	if err != nil {
		t.Fatalf("approve external carrier: %v", err)
	}
	externalVehicle, err := service.Create(t.Context(), VehicleCreateInput{Data: VehicleData{Name: "外部车辆", PlateNumber: "沪B10001", VehicleType: "DIT-0003", CarrierAffiliation: &bobdomain.CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: externalApproved.ObjectID}}}, creator("external-vehicle-create"))
	if err != nil {
		t.Fatalf("create external vehicle: %v", err)
	}
	externalVehicle = submitAndApproveVehicle(t, service, externalVehicle, creator("external-vehicle-submit"), reviewer("external-vehicle-approve"))
	var serviceObjectID, serviceEntryID string
	if err = pool.QueryRow(t.Context(), `SELECT carrier_service_relationship_object_id,carrier_service_relationship_approval_entry_id FROM dcl_vehicle_versions WHERE approval_entry_id=$1`, externalVehicle.Approval.ApprovalEntryID).Scan(&serviceObjectID, &serviceEntryID); err != nil {
		t.Fatalf("read external carrier snapshot: %v", err)
	}
	if serviceObjectID != externalApproved.ObjectID || serviceEntryID != externalApproved.Approval.ApprovalEntryID {
		t.Fatalf("external carrier snapshot = (%s,%s)", serviceObjectID, serviceEntryID)
	}
}

func TestVehicleDeclarationIdentifierClaimsAndReferenceDriftIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	typeObjectID, typeV1EntryID := seedVehicleTypeApproval(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary), authorizer, bus)
	service := NewVehicleService(pool, business, authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	carrier, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: OperatingEntityData{Name: "唯一性承运主体"}}, creator("claims-carrier-create"))
	if err != nil {
		t.Fatalf("create claims carrier: %v", err)
	}
	carrier = submitAndApproveOperatingEntity(t, operating, carrier, creator("claims-carrier-submit"), reviewer("claims-carrier-approve"))
	data := VehicleData{Name: "并发车辆", PlateNumber: "粤A10001", VehicleType: "DIT-0003", VIN: "LDC613P23A0000001", CarrierAffiliation: &bobdomain.CarrierAffiliation{Type: "INTERNAL", OperatingEntityID: carrier.ObjectID}}

	type result struct {
		mutation VehicleMutation
		err      error
	}
	results := make(chan result, 2)
	var wg sync.WaitGroup
	for index := range 2 {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			mutation, createErr := service.Create(t.Context(), VehicleCreateInput{Data: data}, creator("concurrent-create-"+string(rune('a'+index))))
			results <- result{mutation: mutation, err: createErr}
		}(index)
	}
	wg.Wait()
	close(results)
	var created VehicleMutation
	var succeeded, conflicted int
	for item := range results {
		if item.err == nil {
			created, succeeded = item.mutation, succeeded+1
			continue
		}
		var domainErr *DomainError
		if errors.As(item.err, &domainErr) && domainErr.ErrorKey == "vehicle_identifier_conflict" {
			conflicted++
			continue
		}
		t.Fatalf("concurrent create error = %v", item.err)
	}
	if succeeded != 1 || conflicted != 1 {
		t.Fatalf("concurrent create results: success=%d conflict=%d", succeeded, conflicted)
	}

	_, err = service.Create(t.Context(), VehicleCreateInput{Data: VehicleData{Name: "VIN 冲突车辆", PlateNumber: "粤A10002", VehicleType: "DIT-0003", VIN: data.VIN, CarrierAffiliation: data.CarrierAffiliation}}, creator("vin-conflict"))
	assertDCLVehicleErrorKey(t, err, "vehicle_identifier_conflict")

	saved, err := service.Save(t.Context(), VehicleSaveInput{ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: created.Approval.Revision, Enabled: true, Data: VehicleData{Name: "并发车辆已编辑", PlateNumber: data.PlateNumber, VehicleType: data.VehicleType, VIN: data.VIN, CarrierAffiliation: data.CarrierAffiliation}}, creator("save-current-revision"))
	if err != nil {
		t.Fatalf("save current revision: %s", vehicleErrorChain(err))
	}
	_, err = service.Save(t.Context(), VehicleSaveInput{ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: created.Approval.Revision, Enabled: true, Data: data}, creator("save-stale-revision"))
	assertDCLVehicleErrorKey(t, err, "approval_stale_revision")

	typeV2EntryID := ulid.Make().String()
	now := time.Now().UTC()
	if _, err = pool.Exec(t.Context(), `INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at) VALUES($1,'aux','dictionary-item',$2,2,'APPROVED',1,$3,$4,$3,$4,$3,$4,$5,$4)`, typeV2EntryID, typeObjectID, creatorID, now, reviewerID); err != nil {
		t.Fatalf("insert vehicle type V2 approval: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO aux_version_payloads(approval_entry_id,object_id,entity,data) VALUES($1,$2,'dictionary-item',$3::jsonb)`, typeV2EntryID, typeObjectID, `{"name":"厢式货车 V2","sortOrder":10,"dictionaryTypeCode":"DCT-0002"}`); err != nil {
		t.Fatalf("insert vehicle type V2 payload: %v", err)
	}
	if typeV1EntryID == typeV2EntryID {
		t.Fatal("vehicle type source entries unexpectedly equal")
	}
	_, err = service.Submit(t.Context(), VehicleVersionInput{ObjectID: saved.ObjectID, ApprovalEntryID: saved.Approval.ApprovalEntryID, ApprovalRevision: saved.Approval.Revision}, creator("submit-stale-type"))
	assertDCLVehicleErrorKey(t, err, "vehicle_type_reference_stale")
	refreshed, err := service.Save(t.Context(), VehicleSaveInput{ObjectID: saved.ObjectID, ApprovalEntryID: saved.Approval.ApprovalEntryID, ApprovalRevision: saved.Approval.Revision, Enabled: true, Data: data}, creator("refresh-type"))
	if err != nil {
		t.Fatalf("refresh vehicle type source: %v", err)
	}
	carrierV2, err := operating.Save(t.Context(), OperatingEntitySaveInput{ObjectID: carrier.ObjectID, ApprovalEntryID: carrier.Approval.ApprovalEntryID, ApprovalRevision: carrier.Approval.Revision, Enabled: true, Data: OperatingEntityData{Name: "唯一性承运主体 V2"}}, creator("save-carrier-v2"))
	if err != nil {
		t.Fatalf("save carrier V2: %v", err)
	}
	carrierV2 = submitAndApproveOperatingEntity(t, operating, carrierV2, creator("submit-carrier-v2"), reviewer("approve-carrier-v2"))
	_, err = service.Submit(t.Context(), VehicleVersionInput{ObjectID: refreshed.ObjectID, ApprovalEntryID: refreshed.Approval.ApprovalEntryID, ApprovalRevision: refreshed.Approval.Revision}, creator("submit-stale-carrier"))
	assertDCLVehicleErrorKey(t, err, "vehicle_carrier_reference_stale")
	refreshed, err = service.Save(t.Context(), VehicleSaveInput{ObjectID: refreshed.ObjectID, ApprovalEntryID: refreshed.Approval.ApprovalEntryID, ApprovalRevision: refreshed.Approval.Revision, Enabled: true, Data: data}, creator("refresh-carrier"))
	if err != nil {
		t.Fatalf("refresh vehicle carrier source: %v", err)
	}
	if _, err = service.Submit(t.Context(), VehicleVersionInput{ObjectID: refreshed.ObjectID, ApprovalEntryID: refreshed.Approval.ApprovalEntryID, ApprovalRevision: refreshed.Approval.Revision}, creator("submit-refreshed-references")); err != nil {
		t.Fatalf("submit refreshed vehicle references: %v", err)
	}
}

type failingVehicleCurrentWriter struct {
	vehicleCurrentWriter
	failure error
}

func (writer failingVehicleCurrentWriter) ApplyVehicleCurrent(ctx context.Context, tx pgx.Tx, objectID, entryID string, enabled bool, data bobdomain.VehicleData, actorID string) (bobdomain.VehicleCurrent, error) {
	current, err := writer.vehicleCurrentWriter.ApplyVehicleCurrent(ctx, tx, objectID, entryID, enabled, data, actorID)
	if err != nil {
		return bobdomain.VehicleCurrent{}, err
	}
	return current, writer.failure
}

func TestVehicleCurrentApplyFailureRollsBackIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	seedVehicleTypeApproval(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary), authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	carrier, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: OperatingEntityData{Name: "回滚承运主体"}}, creator("rollback-carrier-create"))
	if err != nil {
		t.Fatalf("create rollback carrier: %v", err)
	}
	carrier = submitAndApproveOperatingEntity(t, operating, carrier, creator("rollback-carrier-submit"), reviewer("rollback-carrier-approve"))
	service := NewVehicleService(pool, business, authorizer, bus)
	draft, err := service.Create(t.Context(), VehicleCreateInput{Data: VehicleData{Name: "回滚车辆", PlateNumber: "苏A10001", VehicleType: "DIT-0003", CarrierAffiliation: &bobdomain.CarrierAffiliation{Type: "INTERNAL", OperatingEntityID: carrier.ObjectID}}}, creator("rollback-vehicle-create"))
	if err != nil {
		t.Fatalf("create rollback vehicle: %v", err)
	}
	pending, err := service.Submit(t.Context(), VehicleVersionInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision}, creator("rollback-vehicle-submit"))
	if err != nil {
		t.Fatalf("submit rollback vehicle: %v", err)
	}
	failure := errors.New("BOB vehicle current apply failure")
	failingService := NewVehicleService(pool, failingVehicleCurrentWriter{vehicleCurrentWriter: business, failure: failure}, authorizer, bus)
	_, err = failingService.Approve(t.Context(), VehicleVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer("rollback-vehicle-approve"))
	if !errors.Is(err, failure) {
		t.Fatalf("approve error = %s, want injected failure", vehicleErrorChain(err))
	}
	assertApprovalState(t, pool, pending.Approval.ApprovalEntryID, approval.StatusPending, pending.Approval.Revision)
	if _, err = business.Get(t.Context(), bobdomain.EntityVehicle, bobdomain.GetInput{ObjectID: pending.ObjectID}); err == nil {
		t.Fatal("BOB current exists after failed vehicle apply")
	}
	var openEntryID *string
	if err = pool.QueryRow(t.Context(), `SELECT open_entry_id FROM dcl_vehicle_identifier_claims WHERE identifier_kind='PLATE' AND normalized_value='苏A10001'`).Scan(&openEntryID); err != nil {
		t.Fatalf("read rolled-back vehicle claim: %v", err)
	}
	if openEntryID == nil || *openEntryID != pending.Approval.ApprovalEntryID {
		t.Fatalf("rolled-back vehicle claim open entry = %v", openEntryID)
	}
}

func seedVehicleTypeApproval(t *testing.T, pool *pgxpool.Pool) (string, string) {
	t.Helper()
	var objectID string
	if err := pool.QueryRow(t.Context(), `SELECT id FROM aux_objects WHERE entity='dictionary-item' AND code='DIT-0003'`).Scan(&objectID); err != nil {
		t.Fatalf("find seeded vehicle type: %v", err)
	}
	entryID, creatorID, reviewerID := ulid.Make().String(), ulid.Make().String(), ulid.Make().String()
	now := time.Now().UTC()
	if _, err := pool.Exec(t.Context(), `INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at) VALUES($1,'aux','dictionary-item',$2,1,'APPROVED',1,$3,$4,$3,$4,$3,$4,$5,$4)`, entryID, objectID, creatorID, now, reviewerID); err != nil {
		t.Fatalf("seed vehicle type approval: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO aux_version_payloads(approval_entry_id,object_id,entity,data) VALUES($1,$2,'dictionary-item',$3::jsonb)`, entryID, objectID, `{"name":"厢式货车","sortOrder":10,"dictionaryTypeCode":"DCT-0002"}`); err != nil {
		t.Fatalf("seed vehicle type payload: %v", err)
	}
	return objectID, entryID
}

func assertDCLVehicleErrorKey(t *testing.T, err error, want string) {
	t.Helper()
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != want {
		t.Fatalf("error = %v, want %s", err, want)
	}
}

func vehicleErrorChain(err error) string {
	chain := ""
	for err != nil {
		if chain != "" {
			chain += ": "
		}
		chain += fmt.Sprintf("%T %v", err, err)
		err = errors.Unwrap(err)
	}
	return chain
}

func submitAndApproveVehicle(t *testing.T, service *VehicleService, mutation VehicleMutation, submitter, reviewer approval.Actor) VehicleMutation {
	t.Helper()
	pending, err := service.Submit(t.Context(), VehicleVersionInput{ObjectID: mutation.ObjectID, ApprovalEntryID: mutation.Approval.ApprovalEntryID, ApprovalRevision: mutation.Approval.Revision}, submitter)
	if err != nil {
		t.Fatalf("submit vehicle: %s", vehicleErrorChain(err))
	}
	approved, err := service.Approve(t.Context(), VehicleVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer)
	if err != nil {
		t.Fatalf("approve vehicle: %v", err)
	}
	return approved
}

func assertVehicleCurrent(t *testing.T, business *bobdomain.Service, objectID, entryID, name string, enabled bool) {
	t.Helper()
	view, err := business.Get(t.Context(), bobdomain.EntityVehicle, bobdomain.GetInput{ObjectID: objectID})
	if err != nil {
		t.Fatalf("get BOB vehicle: %v", err)
	}
	if view.Approval.ApprovalEntryID != entryID || view.Data.Name != name || view.Enabled != enabled {
		t.Fatalf("BOB vehicle current = %+v", view)
	}
}
