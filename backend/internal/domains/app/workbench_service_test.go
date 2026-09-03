package app

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestWorkbenchPermissionScopeRequiresQueryAndStageAction(t *testing.T) {
	scope := newWorkbenchPermissionScope([]string{
		"/bob/customer/query", "/dcl/customer/submit", "/dcl/customer/unsubmit",
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

	if len(draftBob) != 0 {
		t.Fatalf("draft BOB entities = %v", draftBob)
	}
	pendingVou := scope.entitiesWith("vou", func(entity string) bool {
		return scope.can("vou", entity, "approve") ||
			scope.can("vou", entity, "unsubmit")
	})
	if len(pendingBob) != 0 {
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
		"/dcl/employee/query", "/dcl/employee/submit",
		"/dcl/supplier/query", "/dcl/supplier/submit",
		"/dcl/other-unit/query", "/dcl/other-unit/submit",
		"/dcl/sales-partner/query", "/dcl/sales-partner/submit",
		"/dcl/customer/query", "/dcl/customer/submit",
		"/dcl/acc-mapping/query", "/dcl/acc-mapping/submit",
		"/dcl/rpt-definition/query", "/dcl/rpt-definition/submit",
		"/dcl/wfl-process-definition/query", "/dcl/wfl-process-definition/submit",
	})
	entities := appendDCLWorkbenchEntities(scope, nil, func(domain, entity string) bool {
		return scope.can(domain, entity, "submit")
	})
	if !reflect.DeepEqual(entities, []string{"employee", "supplier", "other-unit", "sales-partner", "customer", "acc-mapping", "rpt-definition", "wfl-process-definition"}) {
		t.Fatalf("DCL submit entities = %v", entities)
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
		Category:         WorkbenchCategoryVou,
		CounterpartyName: requiredWorkbenchString(""),
		Currency:         requiredWorkbenchString(""),
	}
	payload, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(payload, &fields); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"counterpartyName", "currency"} {
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
	for _, field := range []string{"counterpartyName", "currency"} {
		if _, exists := fields[field]; exists {
			t.Fatalf("BOB item unexpectedly contains %s", field)
		}
	}
}

func TestWorkbenchMappingItemSerializesTypedDeepLinkCoordinates(t *testing.T) {
	payload, err := json.Marshal(WorkbenchItem{
		Category: WorkbenchCategoryBob, Entity: "acc-mapping", ObjectID: "mapping-1",
		ApprovalEntryID: "entry-1", BookID: "book-1", VouEntity: "sale-order",
	})
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(payload, &fields); err != nil {
		t.Fatal(err)
	}
	for field, want := range map[string]string{
		"versionId": "entry-1", "bookId": "book-1", "vouEntity": "sale-order",
	} {
		if fields[field] != want {
			t.Fatalf("%s = %#v, want %q", field, fields[field], want)
		}
	}
	if _, exists := fields["approvalEntryId"]; exists {
		t.Fatal("workbench item leaked the non-contract approvalEntryId field")
	}
}

func TestWorkbenchBusinessCodePreservesMappingExceptionAndRejectsMissingSubjectCode(t *testing.T) {
	mappingCode := "sale-order"
	if got, err := workbenchBusinessCode("acc-mapping", nil, &mappingCode); err != nil || got != mappingCode {
		t.Fatalf("mapping code = %q, %v", got, err)
	}
	if _, err := workbenchBusinessCode("product", nil, nil); err == nil {
		t.Fatal("missing coded subject was accepted")
	}
}
