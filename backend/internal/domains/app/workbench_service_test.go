package app

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestWorkbenchPermissionScopeRequiresQueryAndStageAction(t *testing.T) {
	scope := newWorkbenchPermissionScope([]string{
		"/bob/customer/query", "/bob/customer/submit", "/bob/customer/unsubmit",
		"/vou/sale-order/query", "/vou/sale-order/submit",
		"/vou/purchase-payment/query", "/vou/purchase-payment/unsubmit",
	})

	draftBob := scope.entitiesWith("bob", func(entity string) bool {
		return scope.can("bob", entity, "submit")
	})
	pendingBob := scope.entitiesWith("bob", func(entity string) bool {
		return scope.can("bob", entity, "approve") ||
			scope.can("bob", entity, "reject") ||
			scope.can("bob", entity, "unsubmit")
	})
	draftVou := scope.entitiesWith("vou", func(entity string) bool {
		return scope.can("vou", entity, "submit")
	})

	if !reflect.DeepEqual(draftBob, []string{"customer"}) {
		t.Fatalf("draft BOB entities = %v", draftBob)
	}
	pendingVou := scope.entitiesWith("vou", func(entity string) bool {
		return scope.can("vou", entity, "approve") ||
			scope.can("vou", entity, "unsubmit")
	})
	if !reflect.DeepEqual(pendingBob, []string{"customer"}) {
		t.Fatalf("pending BOB entities = %v", pendingBob)
	}
	if !reflect.DeepEqual(pendingVou, []string{"purchase-payment"}) {
		t.Fatalf("pending VOU entities = %v", pendingVou)
	}
	if !reflect.DeepEqual(draftVou, []string{"sale-order"}) {
		t.Fatalf("draft VOU entities = %v", draftVou)
	}
}

func TestWorkbenchIncludesDCLDeclarationLifecycles(t *testing.T) {
	scope := newWorkbenchPermissionScope([]string{
		"/dcl/party/query", "/dcl/party/submit", "/dcl/party/get", "/dcl/party/save",
		"/dcl/employee/query", "/dcl/employee/submit",
		"/dcl/supplier/query", "/dcl/supplier/submit",
		"/dcl/other-unit/query", "/dcl/other-unit/submit",
		"/dcl/sales-partner/query", "/dcl/sales-partner/submit",
	})
	entities := appendDCLWorkbenchEntities(scope, nil, func(domain, entity string) bool {
		return scope.can(domain, entity, "submit")
	})
	if !reflect.DeepEqual(entities, []string{"party", "employee", "supplier", "other-unit", "sales-partner"}) {
		t.Fatalf("DCL submit entities = %v", entities)
	}
	if domain := workbenchApprovalDomain("party"); domain != "dcl" {
		t.Fatalf("Party workbench domain = %q", domain)
	}
	if domain := workbenchApprovalDomain("employee"); domain != "dcl" {
		t.Fatalf("Employee workbench domain = %q", domain)
	}
	if domain := workbenchApprovalDomain("supplier"); domain != "dcl" {
		t.Fatalf("Supplier workbench domain = %q", domain)
	}
	if domain := workbenchApprovalDomain("other-unit"); domain != "dcl" {
		t.Fatalf("Other-unit workbench domain = %q", domain)
	}
	if domain := workbenchApprovalDomain("sales-partner"); domain != "dcl" {
		t.Fatalf("Sales-partner workbench domain = %q", domain)
	}
}

func TestValidateWorkbenchQueryNormalizesAndRejectsInvalidInput(t *testing.T) {
	input, spec, err := validateWorkbenchQuery(WorkbenchQueryInput{
		Category: " bob ", Keyword: " 客户 ", Entities: []string{" Customer "},
		PendingStages: []string{" submit "},
		Page:          1,
		PageSize:      20,
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.Category != WorkbenchCategoryBob || input.Keyword != "客户" ||
		!reflect.DeepEqual(input.Entities, []string{"customer"}) ||
		!reflect.DeepEqual(input.PendingStages, []string{"SUBMIT"}) ||
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
	for _, pageSize := range []int{0, 1, 19, 21, 200} {
		if _, _, err = validateWorkbenchQuery(WorkbenchQueryInput{
			Category: WorkbenchCategoryVou, Page: 1, PageSize: pageSize,
		}); !errorIsKind(err, ErrorValidation) {
			t.Fatalf("page size %d error = %v, want validation error", pageSize, err)
		}
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
	if !includesWorkbenchStage(nil, "SUBMIT") || includesWorkbenchStage([]string{"APPROVE"}, "SUBMIT") {
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

func TestWorkbenchDocumentItemSerializesEmptyRequiredStrings(t *testing.T) {
	item := WorkbenchItem{
		Category:  WorkbenchCategoryVou,
		PartyName: requiredWorkbenchString(""),
		Currency:  requiredWorkbenchString(""),
	}
	payload, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(payload, &fields); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"partyName", "currency"} {
		value, exists := fields[field]
		if !exists || value != "" {
			t.Fatalf("%s = %#v, exists = %t", field, value, exists)
		}
	}

	objectPayload, err := json.Marshal(WorkbenchItem{Category: WorkbenchCategoryBob})
	if err != nil {
		t.Fatal(err)
	}
	fields = nil
	if err := json.Unmarshal(objectPayload, &fields); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"partyName", "currency"} {
		if _, exists := fields[field]; exists {
			t.Fatalf("BOB item unexpectedly contains %s", field)
		}
	}
}
