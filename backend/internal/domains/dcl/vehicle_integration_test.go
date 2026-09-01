//go:build integration

package dcl

import (
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func TestVehicleDeclarationControlsBOBCurrentDataIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	typeObjectID := seedVehicleType(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool)
	business := newDCLIntegrationBOBService(pool, auxiliary, authorizer, bus)
	typedArchives := NewTypedArchiveService(pool, business, authorizer, bus)
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
	var storedTypeObjectID, storedTypeName string
	if err = pool.QueryRow(t.Context(), `SELECT vehicle_type_object_id,vehicle_type_name FROM dcl_vehicle_versions WHERE approval_entry_id=$1`, v1.Approval.ApprovalEntryID).Scan(&storedTypeObjectID, &storedTypeName); err != nil {
		t.Fatalf("read vehicle type snapshot: %v", err)
	}
	if storedTypeObjectID != typeObjectID || storedTypeName != "厢式货车" {
		t.Fatalf("vehicle type snapshot = (%s,%s)", storedTypeObjectID, storedTypeName)
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
	external, err := typedArchives.CreateOtherUnit(t.Context(), OtherUnitCreateInput{Data: OtherUnitData{
		Kind: "ORGANIZATION", LegalName: "外部承运服务商",
		StrongIdentifiers: []BusinessIdentifierInput{{Type: "UNIFIED_SOCIAL_CREDIT_CODE", Value: "91310000VEH345001"}},
		Enabled:           true, OperatingEntityIDs: []string{carrierID}, DefaultOperatingEntityID: carrierID,
	}}, creator("external-carrier-create"))
	if err != nil {
		t.Fatalf("create external carrier: %v", err)
	}
	externalPending, err := typedArchives.SubmitOtherUnit(t.Context(), TypedArchiveVersionInput{ObjectID: external.ObjectID, ApprovalEntryID: external.Approval.ApprovalEntryID, ApprovalRevision: external.Approval.Revision}, creator("external-carrier-submit"))
	if err != nil {
		t.Fatalf("submit external carrier: %v", err)
	}
	externalApproved, err := typedArchives.ApproveOtherUnit(t.Context(), TypedArchiveVersionInput{ObjectID: externalPending.ObjectID, ApprovalEntryID: externalPending.Approval.ApprovalEntryID, ApprovalRevision: externalPending.Approval.Revision}, reviewer("external-carrier-approve"))
	if err != nil {
		t.Fatalf("approve external carrier: %v", err)
	}
	externalVehicle, err := service.Create(t.Context(), VehicleCreateInput{Data: VehicleData{Name: "外部车辆", PlateNumber: "沪B10001", VehicleType: "DIT-0003", CarrierAffiliation: &bobdomain.CarrierAffiliation{Type: "EXTERNAL", OtherUnitObjectID: externalApproved.ObjectID}}}, creator("external-vehicle-create"))
	if err != nil {
		t.Fatalf("create external vehicle: %v", err)
	}
	externalVehicle = submitAndApproveVehicle(t, service, externalVehicle, creator("external-vehicle-submit"), reviewer("external-vehicle-approve"))
	var serviceObjectID, serviceEntryID string
	if err = pool.QueryRow(t.Context(), `SELECT carrier_other_unit_object_id,carrier_other_unit_approval_entry_id FROM dcl_vehicle_versions WHERE approval_entry_id=$1`, externalVehicle.Approval.ApprovalEntryID).Scan(&serviceObjectID, &serviceEntryID); err != nil {
		t.Fatalf("read external carrier snapshot: %v", err)
	}
	if serviceObjectID != externalApproved.ObjectID || serviceEntryID != externalApproved.Approval.ApprovalEntryID {
		t.Fatalf("external carrier snapshot = (%s,%s)", serviceObjectID, serviceEntryID)
	}
}

func TestVehicleDeclarationIdentifierClaimsAndReferenceDriftIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	typeObjectID := seedVehicleType(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool)
	business := newDCLIntegrationBOBService(pool, auxiliary, authorizer, bus)
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

	typeView, err := auxiliary.Get(t.Context(), auxdomain.EntityDictionaryItem, auxdomain.GetInput{ObjectID: typeObjectID}, creator("get-vehicle-type"))
	if err != nil {
		t.Fatalf("get vehicle type current data: %v", err)
	}
	if _, err = auxiliary.Save(t.Context(), auxdomain.EntityDictionaryItem, auxdomain.SaveInput{
		ObjectID: typeObjectID, ObjectRevision: typeView.ObjectRevision,
		Data: map[string]any{"name": "厢式货车 V2", "sortOrder": 10, "dictionaryTypeId": "01JAVX00000000000000000003"},
	}, creator("save-vehicle-type-v2")); err != nil {
		t.Fatalf("save vehicle type current data: %v", err)
	}
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

func TestVehicleIdentifierClaimsAcrossApprovedAndOpenVersionsIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	seedVehicleType(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	auxiliary := auxdomain.NewService(pool)
	business := newDCLIntegrationBOBService(pool, auxiliary, authorizer, bus)
	service := NewVehicleService(pool, business, authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	carrier, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: OperatingEntityData{Name: "标识回落承运主体"}}, creator("claim-fallback-carrier-create"))
	if err != nil {
		t.Fatalf("create claim fallback carrier: %v", err)
	}
	carrier = submitAndApproveOperatingEntity(t, operating, carrier, creator("claim-fallback-carrier-submit"), reviewer("claim-fallback-carrier-approve"))
	affiliation := &bobdomain.CarrierAffiliation{Type: "INTERNAL", OperatingEntityID: carrier.ObjectID}
	v1Data := VehicleData{Name: "标识回落车辆 V1", PlateNumber: "浙A10001", VehicleType: "DIT-0003", VIN: "LDC613P23A0000101", CarrierAffiliation: affiliation}
	v2Data := VehicleData{Name: "标识回落车辆 V2", PlateNumber: "浙A10002", VehicleType: "DIT-0003", VIN: "LDC613P23A0000102", CarrierAffiliation: affiliation}

	v1, err := service.Create(t.Context(), VehicleCreateInput{Data: v1Data}, creator("claim-fallback-v1-create"))
	if err != nil {
		t.Fatalf("create claim fallback V1: %v", err)
	}
	v1 = submitAndApproveVehicle(t, service, v1, creator("claim-fallback-v1-submit"), reviewer("claim-fallback-v1-approve"))
	v2, err := service.Save(t.Context(), VehicleSaveInput{
		ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID,
		ApprovalRevision: v1.Approval.Revision, Enabled: true, Data: v2Data,
	}, creator("claim-fallback-v2-save"))
	if err != nil {
		t.Fatalf("save claim fallback V2: %v", err)
	}

	for name, data := range map[string]VehicleData{
		"approved plate": {Name: "占用已批准车牌", PlateNumber: v1Data.PlateNumber, VehicleType: "DIT-0003", VIN: "LDC613P23A0000201", CarrierAffiliation: affiliation},
		"approved vin":   {Name: "占用已批准 VIN", PlateNumber: "浙A10201", VehicleType: "DIT-0003", VIN: v1Data.VIN, CarrierAffiliation: affiliation},
		"open plate":     {Name: "占用候选车牌", PlateNumber: v2Data.PlateNumber, VehicleType: "DIT-0003", VIN: "LDC613P23A0000202", CarrierAffiliation: affiliation},
		"open vin":       {Name: "占用候选 VIN", PlateNumber: "浙A10202", VehicleType: "DIT-0003", VIN: v2Data.VIN, CarrierAffiliation: affiliation},
	} {
		_, createErr := service.Create(t.Context(), VehicleCreateInput{Data: data}, creator("claim-conflict-"+name))
		assertDCLVehicleErrorKey(t, createErr, "vehicle_identifier_conflict")
	}

	v2 = submitAndApproveVehicle(t, service, v2, creator("claim-fallback-v2-submit"), reviewer("claim-fallback-v2-approve"))
	reuser, err := service.Create(t.Context(), VehicleCreateInput{Data: VehicleData{
		Name: "复用历史标识车辆", PlateNumber: v1Data.PlateNumber, VehicleType: "DIT-0003", VIN: v1Data.VIN, CarrierAffiliation: affiliation,
	}}, creator("claim-history-reuse"))
	if err != nil {
		t.Fatalf("reuse released V1 identifiers: %v", err)
	}

	_, err = service.Unapprove(t.Context(), VehicleReviewInput{
		ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision, Reason: "回落会重新占用历史标识",
	}, reviewer("claim-fallback-v2-conflicted-unapprove"))
	assertDCLVehicleErrorKey(t, err, "vehicle_identifier_conflict")
	assertApprovalState(t, pool, v2.Approval.ApprovalEntryID, approval.StatusApproved, v2.Approval.Revision)
	assertVehicleCurrent(t, business, v2.ObjectID, v2.Approval.ApprovalEntryID, v2Data.Name, true)
	assertVehicleIdentifierClaim(t, pool, "PLATE", v1Data.PlateNumber, reuser.ObjectID, "", reuser.Approval.ApprovalEntryID)
	assertVehicleIdentifierClaim(t, pool, "VIN", v1Data.VIN, reuser.ObjectID, "", reuser.Approval.ApprovalEntryID)
	assertVehicleIdentifierClaim(t, pool, "PLATE", v2Data.PlateNumber, v2.ObjectID, v2.Approval.ApprovalEntryID, "")
	assertVehicleIdentifierClaim(t, pool, "VIN", v2Data.VIN, v2.ObjectID, v2.Approval.ApprovalEntryID, "")

	if err = service.Delete(t.Context(), VehicleDeleteInput{
		ObjectID: reuser.ObjectID, ApprovalEntryID: reuser.Approval.ApprovalEntryID,
		ApprovalRevision: reuser.Approval.Revision,
	}, creator("claim-history-reuse-delete")); err != nil {
		t.Fatalf("delete history identifier reuser: %v", err)
	}

	v2, err = service.Unapprove(t.Context(), VehicleReviewInput{
		ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID,
		ApprovalRevision: v2.Approval.Revision, Reason: "无冲突时回落 V1",
	}, reviewer("claim-fallback-v2-unapprove"))
	if err != nil {
		t.Fatalf("unapprove V2 after releasing historical identifiers: %v", err)
	}
	assertVehicleCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, v1Data.Name, true)
	assertVehicleIdentifierClaim(t, pool, "PLATE", v1Data.PlateNumber, v1.ObjectID, v1.Approval.ApprovalEntryID, "")
	assertVehicleIdentifierClaim(t, pool, "VIN", v1Data.VIN, v1.ObjectID, v1.Approval.ApprovalEntryID, "")
	assertVehicleIdentifierClaim(t, pool, "PLATE", v2Data.PlateNumber, v2.ObjectID, "", v2.Approval.ApprovalEntryID)
	assertVehicleIdentifierClaim(t, pool, "VIN", v2Data.VIN, v2.ObjectID, "", v2.Approval.ApprovalEntryID)
}

func seedVehicleType(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	const objectID = "01JAVX00000000000000000009"
	if _, err := pool.Exec(t.Context(), `INSERT INTO aux_objects(id,entity,code,data,created_by,updated_by) VALUES('01JAVX00000000000000000003','dictionary-type','DCT-0002',$1::jsonb,$2,$2) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`, `{"name":"车辆类型","description":"车辆展示和筛选类型"}`, "01J00000000000000000000000"); err != nil {
		t.Fatalf("insert vehicle dictionary type fixture: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO aux_objects(id,entity,code,data,created_by,updated_by) VALUES($1,'dictionary-item','DIT-0003',$2::jsonb,$3,$3) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`, objectID, `{"name":"厢式货车","sortOrder":10,"dictionaryTypeId":"01JAVX00000000000000000003","dictionaryTypeCode":"DCT-0002","dictionaryTypeName":"车辆类型"}`, "01J00000000000000000000000"); err != nil {
		t.Fatalf("insert vehicle type object fixture: %v", err)
	}
	return objectID
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
	if view.SourceApprovalEntryID != entryID || view.Data.Name != name || view.Enabled != enabled {
		t.Fatalf("BOB vehicle current = %+v", view)
	}
}

func assertVehicleIdentifierClaim(t *testing.T, pool *pgxpool.Pool, kind, value, objectID, approvedEntryID, openEntryID string) {
	t.Helper()
	var actualObjectID string
	var actualApprovedEntryID, actualOpenEntryID *string
	if err := pool.QueryRow(t.Context(), `SELECT object_id,approved_entry_id,open_entry_id FROM dcl_vehicle_identifier_claims WHERE identifier_kind=$1 AND normalized_value=upper(btrim($2))`, kind, value).Scan(&actualObjectID, &actualApprovedEntryID, &actualOpenEntryID); err != nil {
		t.Fatalf("read %s vehicle identifier claim %q: %v", kind, value, err)
	}
	actualApproved, actualOpen := "", ""
	if actualApprovedEntryID != nil {
		actualApproved = *actualApprovedEntryID
	}
	if actualOpenEntryID != nil {
		actualOpen = *actualOpenEntryID
	}
	if actualObjectID != objectID || actualApproved != approvedEntryID || actualOpen != openEntryID {
		t.Fatalf("%s vehicle identifier claim %q = object:%s approved:%s open:%s, want object:%s approved:%s open:%s", kind, value, actualObjectID, actualApproved, actualOpen, objectID, approvedEntryID, openEntryID)
	}
}
