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
		Code: "ST" + suffix, Name: "待转移供应商", SalespersonEmployeeID: source.ObjectID,
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
	if supplierView.Data.SalespersonEmployeeID != target.ObjectID ||
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
