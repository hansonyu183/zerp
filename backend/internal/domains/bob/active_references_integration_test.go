//go:build integration

package bob

import (
	"errors"
	"testing"
)

func TestDisableReturnsActiveReferenceBlockerWithoutChangingObjectsIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	suffix := newID()[16:]
	_, employee := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Code: "ES" + suffix, Name: "被引用采购员",
	}, "active-reference-employee")
	_, supplier := createApprovedIntegration(t, service, EntitySupplier, CreateDetailInput{
		Code: "SR" + suffix, Name: "引用采购员的供应商", DefaultPurchaserEmployeeID: employee.ObjectID,
	}, "active-reference-supplier")

	_, err := service.Disable(t.Context(), EntityEmployee, ObjectRevisionInput{
		ObjectID: employee.ObjectID, ObjectRevision: employee.ObjectRevision,
	}, integrationActorOne, "active-reference-disable")
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorConflict {
		t.Fatalf("disable referenced employee error = %v, want conflict", err)
	}
	if domainErr.ErrorKey != "object_has_active_references" {
		t.Fatalf("disable referenced employee errorKey = %q", domainErr.ErrorKey)
	}
	data, ok := domainErr.Data.(map[string]any)
	if !ok {
		t.Fatalf("blocker data = %#v, want object", domainErr.Data)
	}
	references, ok := data["references"].([]ActiveReferenceCount)
	if !ok || len(references) != 1 || references[0].Entity != EntitySupplier ||
		references[0].Field != "supplier-purchaser" || references[0].Count != 1 {
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
	supplierView, err := service.Get(t.Context(), EntitySupplier, GetInput{ObjectID: supplier.ObjectID})
	if err != nil {
		t.Fatalf("get supplier after blocked disable: %v", err)
	}
	if supplierView.CurrentVersionID != supplier.VersionID ||
		supplierView.Data.DefaultPurchaserEmployeeID != employee.ObjectID {
		t.Fatalf("supplier changed after blocker: %#v", supplierView)
	}
}
