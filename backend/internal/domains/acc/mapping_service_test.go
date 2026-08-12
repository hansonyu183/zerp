package acc

import (
	"testing"

	"github.com/oklog/ulid/v2"
)

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
