package app

import (
	"reflect"
	"testing"
)

func TestWorkbenchPermissionScopeRequiresQueryAndStageAction(t *testing.T) {
	scope := newWorkbenchPermissionScope([]string{
		"/bob/customer/query", "/bob/customer/submit",
		"/bob/supplier/approve",
		"/bob/product/query", "/bob/product/reject",
		"/vou/sale-order/query", "/vou/sale-order/check",
		"/vou/supplier-payment/query", "/vou/supplier-payment/finalize",
	})

	draftBob := scope.entitiesWith("bob", func(entity string) bool {
		return scope.can("bob", entity, "submit")
	})
	pendingBob := scope.entitiesWith("bob", func(entity string) bool {
		return scope.can("bob", entity, "approve") || scope.can("bob", entity, "reject")
	})
	draftVou := scope.entitiesWith("vou", func(entity string) bool {
		return scope.can("vou", entity, "check")
	})
	approvedVou := scope.entitiesWith("vou", func(entity string) bool {
		return scope.can("vou", entity, "finalize")
	})

	if !reflect.DeepEqual(draftBob, []string{"customer"}) {
		t.Fatalf("draft BOB entities = %v", draftBob)
	}
	if !reflect.DeepEqual(pendingBob, []string{"product"}) {
		t.Fatalf("pending BOB entities = %v", pendingBob)
	}
	if !reflect.DeepEqual(draftVou, []string{"sale-order"}) {
		t.Fatalf("draft VOU entities = %v", draftVou)
	}
	if !reflect.DeepEqual(approvedVou, []string{"supplier-payment"}) {
		t.Fatalf("approved VOU entities = %v", approvedVou)
	}
}

func TestValidateWorkbenchQueryDefaultsAndRejectsInvalidInput(t *testing.T) {
	input, spec, err := validateWorkbenchQuery(WorkbenchQueryInput{
		Category: " bob ", Keyword: " 客户 ", Entities: []string{" Customer "},
		PendingStages: []string{" check "},
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.Category != WorkbenchCategoryBob || input.Keyword != "客户" ||
		!reflect.DeepEqual(input.Entities, []string{"customer"}) ||
		!reflect.DeepEqual(input.PendingStages, []string{"CHECK"}) ||
		spec.Page != 1 || spec.PageSize != 20 {
		t.Fatalf("normalized input = %+v, spec = %+v", input, spec)
	}

	if _, _, err = validateWorkbenchQuery(WorkbenchQueryInput{Category: "AUX"}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("invalid category error = %v", err)
	}
	if _, _, err = validateWorkbenchQuery(WorkbenchQueryInput{
		Category: WorkbenchCategoryBob, PendingStages: []string{"FINALIZE"},
	}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("invalid BOB stage error = %v", err)
	}
	if _, _, err = validateWorkbenchQuery(WorkbenchQueryInput{
		Category: WorkbenchCategoryVou, Entities: []string{"sale-order", "sale-order"},
	}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("duplicate entity error = %v", err)
	}
}

func TestFilterWorkbenchEntitiesAndStages(t *testing.T) {
	available := []string{"customer", "product", "supplier"}
	if actual := filterWorkbenchEntities(available, nil); !reflect.DeepEqual(actual, available) {
		t.Fatalf("unfiltered entities = %v", actual)
	}
	if actual := filterWorkbenchEntities(available, []string{"supplier", "warehouse"}); !reflect.DeepEqual(actual, []string{"supplier"}) {
		t.Fatalf("filtered entities = %v", actual)
	}
	if !includesWorkbenchStage(nil, "CHECK") || includesWorkbenchStage([]string{"APPROVE"}, "CHECK") {
		t.Fatal("unexpected pending stage selection")
	}
}

func TestFormatWorkbenchMoney(t *testing.T) {
	for cents, expected := range map[int64]string{0: "0.00", 105: "1.05", -230: "-2.30"} {
		if actual := formatWorkbenchMoney(cents); actual != expected {
			t.Fatalf("formatWorkbenchMoney(%d) = %q, want %q", cents, actual, expected)
		}
	}
}
