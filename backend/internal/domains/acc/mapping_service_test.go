package acc

import (
	"strings"
	"testing"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/oklog/ulid/v2"
)

func TestMappingViewNormalizesOptionalDimensionMapsForTheWireContract(t *testing.T) {
	entryID, subjectID := ulid.Make().String(), ulid.Make().String()
	versionNo := int32(1)
	view, err := mappingView(
		ulid.Make().String(),
		"sale-order",
		MappingResultPost,
		[]byte(`{"defaultTemplateId":"standard","rules":[],"templates":[{"templateId":"standard","collection":null,"lines":[{"subjectSource":"FIXED","subjectValue":"01JACC00000000000000000010","direction":"DEBIT","amountField":"totalAmount","currencyField":"currency","dimensions":null,"quantityField":null,"costCounterpartSubjectId":null,"costCounterpartDimensions":null}]}]}`),
		approval.Entry{EntryRef: approval.EntryRef{ID: entryID, SubjectID: subjectID, VersionNo: &versionNo}, Status: approval.StatusDraft, Revision: 1},
	)
	if err != nil {
		t.Fatal(err)
	}
	line := view.Definition.Templates[0].Lines[0]
	if line.Dimensions == nil || line.CostCounterpartDimensions == nil {
		t.Fatalf("dimension maps were not normalized: %#v", line)
	}
}

func TestValidateMappingRejectsUnknownFieldsAndOverlappingRules(t *testing.T) {
	catalog, err := MappingFieldCatalog("sale-order")
	if err != nil {
		t.Fatal(err)
	}
	definition := MappingDefinition{
		Rules: []MappingRule{
			{Conditions: []MappingCondition{{Field: "currency", Operator: "EQ", Values: []string{"CNY"}}}, Result: MappingResultUnpost},
			{Conditions: []MappingCondition{{Field: "status", Operator: "EQ", Values: []string{"APPROVED"}}}, Result: MappingResultUnpost},
		},
		Templates: []PostingTemplate{},
	}
	if err = validateMapping(MappingResultUnpost, definition, catalog); !IsKind(err, ErrorValidation) {
		t.Fatalf("overlapping rules error = %v", err)
	}
	definition.Rules = []MappingRule{{Conditions: []MappingCondition{{Field: "runtimeScript", Operator: "EQ", Values: []string{"x"}}}, Result: MappingResultUnpost}}
	if err = validateMapping(MappingResultUnpost, definition, catalog); !IsKind(err, ErrorValidation) {
		t.Fatalf("unknown field error = %v", err)
	}
}

func TestMappingFieldCatalogOnlyExposesEntityCollections(t *testing.T) {
	catalog, err := MappingFieldCatalog("sale-pricing")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := catalog.Collections["priceLines"]; !ok {
		t.Fatal("sale-pricing catalog is missing priceLines")
	}
	if _, ok := catalog.Collections["assetAcquisitionLines"]; ok {
		t.Fatal("sale-pricing catalog exposes asset acquisition fields")
	}
	for _, field := range catalog.HeaderFields {
		if field == "fundAccount.objectId" {
			t.Fatal("sale-pricing catalog exposes an inapplicable fund account field")
		}
	}
	collection := "assetAcquisitionLines"
	definition := MappingDefinition{Templates: []PostingTemplate{{
		ID: "invalid", Collection: &collection,
		Lines: []PostingLineTemplate{{SubjectSource: "FIXED", SubjectValue: ulid.Make().String(), Direction: BalanceDirectionDebit, AmountField: "originalValue", CurrencyField: "currency"}, {SubjectSource: "FIXED", SubjectValue: ulid.Make().String(), Direction: BalanceDirectionCredit, AmountField: "originalValue", CurrencyField: "currency"}},
	}}}
	if err = validateMapping(MappingResultUnpost, definition, catalog); !IsKind(err, ErrorValidation) {
		t.Fatalf("invalid entity collection error = %v", err)
	}
}

func TestExpenseReimbursementMappingCatalogOmitsRemovedDirectSettlementFields(t *testing.T) {
	catalog, err := MappingFieldCatalog("expense-reimbursement")
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range catalog.HeaderFields {
		if field == "fundAccount.objectId" || field == "settlementMode" {
			t.Fatalf("expense reimbursement catalog exposes removed field %q", field)
		}
	}
}

func TestServiceAcceptanceMappingCatalogExposesTypedRelationshipFacts(t *testing.T) {
	catalog, err := MappingFieldCatalog("service-acceptance")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{
		"serviceAcceptance.contractDocumentId":  false,
		"serviceAcceptance.settlementDirection": false,
		"counterparty.objectId":                 false,
	}
	for _, field := range catalog.HeaderFields {
		if _, ok := want[field]; ok {
			want[field] = true
		}
	}
	for field, found := range want {
		if !found {
			t.Fatalf("service acceptance catalog is missing %q", field)
		}
	}
}

func TestValidateMappingRejectsFieldsFromAnotherAllowedCollection(t *testing.T) {
	catalog, err := MappingFieldCatalog("sale-signoff")
	if err != nil {
		t.Fatal(err)
	}
	collection := "signoffLines"
	definition := MappingDefinition{Templates: []PostingTemplate{{
		ID: "invalid", Collection: &collection,
		Lines: []PostingLineTemplate{
			{SubjectSource: "FIXED", SubjectValue: ulid.Make().String(), Direction: BalanceDirectionDebit, AmountField: "quantity", CurrencyField: "currency"},
			{SubjectSource: "FIXED", SubjectValue: ulid.Make().String(), Direction: BalanceDirectionCredit, AmountField: "quantity", CurrencyField: "currency"},
		},
	}}}
	if err = validateMapping(MappingResultUnpost, definition, catalog); !IsKind(err, ErrorValidation) {
		t.Fatalf("cross-collection field error = %v", err)
	}
}

func TestValidateMappingAcceptsDisjointPostingRules(t *testing.T) {
	catalog, _ := MappingFieldCatalog("sale-order")
	templateID := "standard"
	definition := MappingDefinition{
		DefaultTemplateID: &templateID,
		Rules: []MappingRule{
			{Conditions: []MappingCondition{{Field: "currency", Operator: "EQ", Values: []string{"CNY"}}}, Result: MappingResultPost, TemplateID: &templateID},
			{Conditions: []MappingCondition{{Field: "currency", Operator: "EQ", Values: []string{"USD"}}}, Result: MappingResultUnpost},
		},
		Templates: []PostingTemplate{{ID: templateID, Lines: []PostingLineTemplate{
			{SubjectSource: "FIXED", SubjectValue: "01JACC00000000000000000010", Direction: BalanceDirectionDebit, AmountField: "totalAmount", CurrencyField: "currency", Dimensions: map[string]string{}},
			{SubjectSource: "FIXED", SubjectValue: "01JACC00000000000000000011", Direction: BalanceDirectionCredit, AmountField: "totalAmount", CurrencyField: "currency", Dimensions: map[string]string{}},
		}}},
	}
	if err := validateMapping(MappingResultPost, definition, catalog); err != nil {
		t.Fatalf("valid mapping rejected: %v", err)
	}
}

func TestSelectMappingResultUsesOneRuleOrDefault(t *testing.T) {
	defaultTemplateID := "default"
	matchedTemplateID := "matched"
	definition := MappingDefinition{
		DefaultTemplateID: &defaultTemplateID,
		Rules: []MappingRule{{
			Conditions: []MappingCondition{{Field: "currency", Operator: "EQ", Values: []string{"CNY"}}},
			Result:     MappingResultPost,
			TemplateID: &matchedTemplateID,
		}},
	}
	result, templateID, err := selectMappingResult(MappingResultPost, definition, map[string]string{"currency": "CNY"})
	if err != nil || result != MappingResultPost || templateID != matchedTemplateID {
		t.Fatalf("matched selection = %s/%s, err=%v", result, templateID, err)
	}
	result, templateID, err = selectMappingResult(MappingResultPost, definition, map[string]string{"currency": "USD"})
	if err != nil || result != MappingResultPost || templateID != defaultTemplateID {
		t.Fatalf("default selection = %s/%s, err=%v", result, templateID, err)
	}
}

func TestAutomaticTrialBalanceIsPerCurrency(t *testing.T) {
	lines := []automaticPostingLine{
		{subjectID: ulid.Make().String(), currency: "CNY", debitMinor: 100},
		{subjectID: ulid.Make().String(), currency: "USD", creditMinor: 100},
	}
	if err := validateAutomaticTrialBalance(lines); !IsKind(err, ErrorConflict) {
		t.Fatalf("cross-currency balancing error = %v", err)
	}
	lines = append(lines,
		automaticPostingLine{subjectID: ulid.Make().String(), currency: "CNY", creditMinor: 100},
		automaticPostingLine{subjectID: ulid.Make().String(), currency: "USD", debitMinor: 100},
	)
	if err := validateAutomaticTrialBalance(lines); err != nil {
		t.Fatalf("per-currency balanced lines rejected: %v", err)
	}
}

func TestAutomaticTrialBalanceAllowsQuantityOnlyFacts(t *testing.T) {
	quantity := int64(1_000_000)
	lines := []automaticPostingLine{{
		subjectID: ulid.Make().String(), currency: "CNY", quantityMicros: &quantity,
	}}
	if err := validateAutomaticTrialBalance(lines); err != nil {
		t.Fatalf("quantity-only facts rejected: %v", err)
	}
}

func TestIntermediaryCalculationMappingUsesSalesRelationshipSummaryFields(t *testing.T) {
	t.Parallel()
	catalog, err := MappingFieldCatalog("intermediary-calculation")
	if err != nil {
		t.Fatal(err)
	}
	fields := strings.Join(catalog.Collections["intermediarySalesPartnerPayables"], ",")
	for _, want := range []string{"payee.objectId", "category", "amount"} {
		if !strings.Contains(fields, want) {
			t.Fatalf("intermediary mapping fields %q missing %q", fields, want)
		}
	}
	if strings.Contains(fields, "payee.entity") {
		t.Fatalf("intermediary sales-partner payable mapping must not expose a mutable Party/entity field: %q", fields)
	}
}

func TestIntermediaryPostingSnapshotFlattensSummaryPayee(t *testing.T) {
	t.Parallel()
	document := voudomain.DocumentView{DocumentID: "CALC-1", Entity: voudomain.EntityIntermediaryCalculation, DocumentNo: "IC-1", Approval: approval.Meta{Status: approval.StatusApproved, Revision: 1},
		Data: voudomain.DocumentDataView{BusinessDate: "2026-08-31", Currency: "CNY", IntermediaryCalculation: &voudomain.IntermediaryCalculationInput{
			Result: voudomain.IntermediaryCalculationResult{Summaries: []voudomain.IntermediarySummary{
				{Category: "EXTERNAL_PART_TIME", Amount: "10.00", Payee: voudomain.IntermediaryReference{ObjectID: "01J00000000000000000000001", Entity: "sales-partner"}},
				{Category: "REBATE", Amount: "5.00", Payee: voudomain.IntermediaryReference{ObjectID: "01J00000000000000000000002", Entity: "customer"}},
			}},
		}},
	}
	snapshot, err := newPostingSnapshot(document)
	if err != nil {
		t.Fatal(err)
	}
	items := snapshot.collections["intermediarySalesPartnerPayables"]
	if len(items) != 1 || items[0]["payee.objectId"] != "01J00000000000000000000001" || items[0]["payee.entity"] != "sales-partner" {
		t.Fatalf("unexpected intermediary summary items: %#v", items)
	}
}
