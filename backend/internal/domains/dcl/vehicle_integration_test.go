//go:build integration

package dcl

import (
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/oklog/ulid/v2"
)

func TestVehicleDeclarationControlsBOBCurrentDataIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
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
}

func submitAndApproveVehicle(t *testing.T, service *VehicleService, mutation VehicleMutation, submitter, reviewer approval.Actor) VehicleMutation {
	t.Helper()
	pending, err := service.Submit(t.Context(), VehicleVersionInput{ObjectID: mutation.ObjectID, ApprovalEntryID: mutation.Approval.ApprovalEntryID, ApprovalRevision: mutation.Approval.Revision}, submitter)
	if err != nil {
		t.Fatalf("submit vehicle: %v", err)
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
