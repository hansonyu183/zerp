//go:build integration

package bob

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
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

func TestEmployeeDisableClearsWarehouseManagerIntegration(t *testing.T) {
	service := NewService(integrationPool(t))
	_, employee := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Name: "仓库负责人 " + newID(),
	}, "warehouse-manager")
	warehouse, warehouseApproved := createApprovedIntegration(t, service, EntityWarehouse, CreateDetailInput{
		Name: "负责人仓库 " + newID(), ManagerEmployeeID: employee.ObjectID,
	}, "warehouse-manager")

	if _, err := service.Disable(t.Context(), EntityEmployee, ObjectRevisionInput{
		ObjectID: employee.ObjectID, ObjectRevision: employee.ObjectRevision,
	}, integrationActorOne, "disable-warehouse-manager"); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			t.Fatalf("disable warehouse manager employment: %s (%s)", pgErr.Message, pgErr.ConstraintName)
		}
		t.Fatalf("disable warehouse manager employment: %v", err)
	}

	view, err := service.Get(t.Context(), EntityWarehouse, GetInput{ObjectID: warehouse.ObjectID})
	if err != nil {
		t.Fatalf("get warehouse after manager disable: %v", err)
	}
	if view.Data.ManagerEmployeeID != "" {
		t.Fatalf("warehouse manager = %q, want cleared", view.Data.ManagerEmployeeID)
	}
	if view.Version.Version <= warehouseApproved.Version {
		t.Fatalf("warehouse manager cleanup did not create a new version: %+v", view.Version)
	}
}

func TestEmployeeDisableConflictsWhenWarehouseManagerHasCandidateIntegration(t *testing.T) {
	service := NewService(integrationPool(t))
	_, employee := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Name: "候选仓库负责人 " + newID(),
	}, "warehouse-manager-candidate")
	warehouse, approved := createApprovedIntegration(t, service, EntityWarehouse, CreateDetailInput{
		Name: "候选负责人仓库 " + newID(), ManagerEmployeeID: employee.ObjectID,
	}, "warehouse-manager-candidate")

	candidate, err := service.Save(t.Context(), EntityWarehouse, SaveInput{
		ObjectID: warehouse.ObjectID, VersionID: approved.VersionID, Revision: approved.Revision,
		Data: DetailInput{Name: "候选负责人仓库变更 " + newID()},
	}, integrationActorOne, "warehouse-manager-candidate-save")
	if err != nil {
		t.Fatalf("create warehouse candidate: %v", err)
	}
	if candidate.Status != StatusDraft {
		t.Fatalf("warehouse candidate status = %s, want DRAFT", candidate.Status)
	}

	_, err = service.Disable(t.Context(), EntityEmployee, ObjectRevisionInput{
		ObjectID: employee.ObjectID, ObjectRevision: employee.ObjectRevision,
	}, integrationActorOne, "disable-warehouse-manager-with-candidate")
	if !errorIsKind(err, ErrorConflict) {
		t.Fatalf("disable employee with warehouse candidate error = %#v, want conflict", err)
	}

	view, err := service.Get(t.Context(), EntityWarehouse, GetInput{ObjectID: warehouse.ObjectID})
	if err != nil {
		t.Fatalf("get warehouse after blocked employee disable: %v", err)
	}
	if view.Data.ManagerEmployeeID != employee.ObjectID {
		t.Fatalf("warehouse manager = %q, want %q after rollback", view.Data.ManagerEmployeeID, employee.ObjectID)
	}
}
