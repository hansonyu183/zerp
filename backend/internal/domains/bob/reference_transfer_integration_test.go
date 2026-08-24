//go:build integration

package bob

import (
	"errors"
	"testing"
)

func TestEmployeeReferenceTransferUpdatesEffectiveSupplierAndDisablesSourceIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	suffix := newID()[16:]
	_, source := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Code: "ES" + suffix, Name: "待停用业务员",
	}, "reference-transfer-source")
	_, target := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Code: "ET" + suffix, Name: "接替业务员",
	}, "reference-transfer-target")
	_, supplier := createApprovedIntegration(t, service, EntitySupplier, CreateDetailInput{
		Code: "ST" + suffix, Name: "待转移供应商", DefaultPurchaserEmployeeID: source.ObjectID,
	}, "reference-transfer-supplier")

	if _, err := service.Disable(t.Context(), EntityEmployee, ObjectRevisionInput{
		ObjectID: source.ObjectID, ObjectRevision: source.ObjectRevision,
	}, integrationActorOne, "reference-transfer-blocked-disable"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("disable referenced employee error = %v, want conflict", err)
	}

	candidates, err := service.QueryReferenceCandidates(t.Context(), ReferenceQueryInput{
		Entity: EntityEmployee, SourceObjectID: source.ObjectID, Keyword: "接替业务员",
	})
	if err != nil {
		t.Fatalf("query employee replacement candidates: %v", err)
	}
	foundTarget := false
	for _, candidate := range candidates {
		if candidate.ObjectID == source.ObjectID {
			t.Fatalf("source employee was returned as its own replacement")
		}
		if candidate.ObjectID == target.ObjectID && candidate.Name == "接替业务员" {
			foundTarget = true
		}
	}
	if !foundTarget {
		t.Fatalf("replacement employee %s was not returned: %#v", target.ObjectID, candidates)
	}

	result, err := service.TransferReferences(t.Context(), ReferenceTransferInput{
		Entity: EntityEmployee, SourceObjectID: source.ObjectID, TargetObjectID: target.ObjectID,
		SourceObjectRevision: source.ObjectRevision,
	}, integrationActorOne, "reference-transfer-commit")
	if err != nil {
		var domainErr *DomainError
		if errors.As(err, &domainErr) {
			t.Fatalf("transfer employee references: %v; cause=%v", err, domainErr.Cause)
		}
		t.Fatalf("transfer employee references: %v", err)
	}
	if result.AffectedObjects != 1 {
		t.Fatalf("affected objects = %d, want 1", result.AffectedObjects)
	}

	supplierView, err := service.Get(t.Context(), EntitySupplier, GetInput{ObjectID: supplier.ObjectID})
	if err != nil {
		t.Fatalf("get transferred supplier: %v", err)
	}
	if supplierView.Data.DefaultPurchaserEmployeeID != target.ObjectID ||
		supplierView.CurrentVersionID == supplier.VersionID {
		t.Fatalf("supplier reference was not versioned to target: %#v", supplierView)
	}
	sourceView, err := service.Get(t.Context(), EntityEmployee, GetInput{ObjectID: source.ObjectID})
	if err != nil {
		t.Fatalf("get disabled source employee: %v", err)
	}
	if sourceView.Enabled {
		t.Fatalf("source employee remains enabled after transfer")
	}
}

func TestVehicleCarrierReferenceTransferPreservesCarrierTypeIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	suffix := newID()[16:]

	_, internalSource := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{
		Code: "OS" + suffix, Name: "待停用自有承运主体", TaxNumber: "TAX" + newID()[3:],
	}, "vehicle-carrier-internal-source")
	_, internalTarget := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{
		Code: "OT" + suffix, Name: "接替自有承运主体", TaxNumber: "TAX" + newID()[3:],
	}, "vehicle-carrier-internal-target")
	_, internalVehicle := createApprovedIntegration(t, service, EntityVehicle, CreateDetailInput{
		Code: "VI" + suffix, Name: "自有承运车辆", PlateNumber: "粤I" + newID(), VehicleType: "Truck",
		CarrierAffiliation: &CarrierAffiliation{Type: "INTERNAL", OperatingEntityID: internalSource.ObjectID},
	}, "vehicle-carrier-internal")

	_, externalSource := createApprovedIntegration(t, service, EntityOtherUnit, CreateDetailInput{
		Code: "XS" + suffix, Name: "待停用外部承运关系",
	}, "vehicle-carrier-external-source")
	_, externalTarget := createApprovedIntegration(t, service, EntityOtherUnit, CreateDetailInput{
		Code: "XT" + suffix, Name: "接替外部承运关系",
	}, "vehicle-carrier-external-target")
	_, externalVehicle := createApprovedIntegration(t, service, EntityVehicle, CreateDetailInput{
		Code: "VE" + suffix, Name: "外部承运车辆", PlateNumber: "粤E" + newID(), VehicleType: "Truck",
		CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: externalSource.ObjectID},
	}, "vehicle-carrier-external")

	for _, transfer := range []struct {
		name, entity, sourceID, targetID, vehicleID string
		revision                                    int64
		wantType, wantCarrierID                     string
	}{
		{
			name: "internal", entity: EntityOperatingEntity, sourceID: internalSource.ObjectID,
			targetID: internalTarget.ObjectID, vehicleID: internalVehicle.ObjectID,
			revision: internalSource.ObjectRevision, wantType: "INTERNAL", wantCarrierID: internalTarget.ObjectID,
		},
		{
			name: "external", entity: EntityOtherUnit, sourceID: externalSource.ObjectID,
			targetID: externalTarget.ObjectID, vehicleID: externalVehicle.ObjectID,
			revision: externalSource.ObjectRevision, wantType: "EXTERNAL", wantCarrierID: externalTarget.ObjectID,
		},
	} {
		t.Run(transfer.name, func(t *testing.T) {
			result, err := service.TransferReferences(t.Context(), ReferenceTransferInput{
				Entity: transfer.entity, SourceObjectID: transfer.sourceID, TargetObjectID: transfer.targetID,
				SourceObjectRevision: transfer.revision,
			}, integrationActorOne, "vehicle-carrier-transfer-"+transfer.name)
			if err != nil {
				t.Fatalf("transfer vehicle carrier reference: %v", err)
			}
			if result.AffectedObjects != 1 {
				t.Fatalf("affected vehicles = %d, want 1", result.AffectedObjects)
			}
			vehicle, err := service.Get(t.Context(), EntityVehicle, GetInput{ObjectID: transfer.vehicleID})
			if err != nil {
				t.Fatalf("get transferred vehicle: %v", err)
			}
			affiliation := vehicle.Data.CarrierAffiliation
			if affiliation == nil || affiliation.Type != transfer.wantType {
				t.Fatalf("vehicle affiliation type = %#v, want %s", affiliation, transfer.wantType)
			}
			carrierID := affiliation.OperatingEntityID
			if transfer.wantType == "EXTERNAL" {
				carrierID = affiliation.ServiceRelationshipObjectID
			}
			if carrierID != transfer.wantCarrierID || vehicle.CurrentVersionID == "" {
				t.Fatalf("vehicle affiliation = %#v, want carrier %s", affiliation, transfer.wantCarrierID)
			}
			enabled := true
			if transfer.entity == EntityOtherUnit {
				source, getErr := service.OtherUnitGet(t.Context(), GetInput{ObjectID: transfer.sourceID})
				err, enabled = getErr, source.Enabled
			} else {
				source, getErr := service.Get(t.Context(), transfer.entity, GetInput{ObjectID: transfer.sourceID})
				err, enabled = getErr, source.Enabled
			}
			if err != nil || enabled {
				t.Fatalf("transferred carrier source enabled=%t err=%v", enabled, err)
			}
		})
	}
}
