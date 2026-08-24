//go:build integration

package bob

import (
	"errors"
	"testing"
)

func TestWarehouseDisablePrecheckAndDisableIntegration(t *testing.T) {
	service := NewService(integrationPool(t))
	warehouse, approved := createApprovedIntegration(t, service, EntityWarehouse, CreateDetailInput{
		Name: "可停用仓库 " + newID(),
	}, "warehouse-disable")

	precheck, err := service.WarehouseDisablePrecheck(t.Context(), WarehouseDisablePrecheckInput{
		ObjectID: warehouse.ObjectID,
	})
	if err != nil {
		t.Fatalf("warehouse disable precheck: %v", err)
	}
	if precheck.HasConflicts() {
		t.Fatalf("empty warehouse precheck has conflicts: %+v", precheck)
	}

	disabled, err := service.Disable(t.Context(), EntityWarehouse, ObjectRevisionInput{
		ObjectID: warehouse.ObjectID, ObjectRevision: approved.ObjectRevision,
	}, integrationActorOne, "warehouse-disable")
	if err != nil {
		t.Fatalf("disable empty warehouse: %v", err)
	}
	if disabled.Enabled {
		t.Fatalf("disabled warehouse remains enabled: %+v", disabled)
	}
}

func TestEmployeeDisableReturnsWarehouseManagerBlockerIntegration(t *testing.T) {
	service := NewService(integrationPool(t))
	_, employee := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Name: "仓库负责人 " + newID(),
	}, "warehouse-manager")
	warehouse, warehouseApproved := createApprovedIntegration(t, service, EntityWarehouse, CreateDetailInput{
		Name: "负责人仓库 " + newID(), ManagerEmployeeID: employee.ObjectID,
	}, "warehouse-manager")

	_, err := service.Disable(t.Context(), EntityEmployee, ObjectRevisionInput{
		ObjectID: employee.ObjectID, ObjectRevision: employee.ObjectRevision,
	}, integrationActorOne, "disable-warehouse-manager")
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorConflict {
		t.Fatalf("disable warehouse manager error = %v, want conflict", err)
	}
	data, ok := domainErr.Data.(map[string]any)
	if !ok {
		t.Fatalf("blocker data = %#v, want object", domainErr.Data)
	}
	references, ok := data["references"].([]ActiveReferenceCount)
	if !ok || len(references) != 1 || references[0].Entity != EntityWarehouse ||
		references[0].Field != "warehouse-manager" || references[0].Count != 1 {
		t.Fatalf("reference blocker = %#v", data["references"])
	}

	employeeView, err := service.Get(t.Context(), EntityEmployee, GetInput{ObjectID: employee.ObjectID})
	if err != nil {
		t.Fatalf("get employee after blocked disable: %v", err)
	}
	if !employeeView.Enabled || employeeView.ObjectRevision != employee.ObjectRevision ||
		employeeView.CurrentVersionID != employee.VersionID {
		t.Fatalf("employee changed after blocker: %#v", employeeView)
	}
	warehouseView, err := service.Get(t.Context(), EntityWarehouse, GetInput{ObjectID: warehouse.ObjectID})
	if err != nil {
		t.Fatalf("get warehouse after blocked employee disable: %v", err)
	}
	if warehouseView.CurrentVersionID != warehouseApproved.VersionID ||
		warehouseView.Data.ManagerEmployeeID != employee.ObjectID {
		t.Fatalf("warehouse changed after blocker: %#v", warehouseView)
	}
}
