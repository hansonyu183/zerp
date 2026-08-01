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
		"/vou/payment/query", "/vou/payment/finalize",
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
	if !reflect.DeepEqual(approvedVou, []string{"payment"}) {
		t.Fatalf("approved VOU entities = %v", approvedVou)
	}
}

func TestValidateWorkbenchQueryDefaultsAndRejectsInvalidInput(t *testing.T) {
	input, spec, err := validateWorkbenchQuery(WorkbenchQueryInput{
		Category: " bob ", Keyword: " 客户 ",
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.Category != WorkbenchCategoryBob || input.Keyword != "客户" || spec.Page != 1 || spec.PageSize != 20 {
		t.Fatalf("normalized input = %+v, spec = %+v", input, spec)
	}

	if _, _, err = validateWorkbenchQuery(WorkbenchQueryInput{Category: "AUX"}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("invalid category error = %v", err)
	}
}

func TestFormatWorkbenchMoney(t *testing.T) {
	for cents, expected := range map[int64]string{0: "0.00", 105: "1.05", -230: "-2.30"} {
		if actual := formatWorkbenchMoney(cents); actual != expected {
			t.Fatalf("formatWorkbenchMoney(%d) = %q, want %q", cents, actual, expected)
		}
	}
}
