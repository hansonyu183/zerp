package app

import "testing"

func TestNormalizeSystemParameterValue(t *testing.T) {
	tests := []struct {
		name      string
		valueType string
		input     string
		want      string
		valid     bool
	}{
		{name: "string", valueType: SystemParameterString, input: "  文本  ", want: "文本", valid: true},
		{name: "integer", valueType: SystemParameterInteger, input: "0012", want: "12", valid: true},
		{name: "decimal", valueType: SystemParameterDecimal, input: "-12.50", want: "-12.50", valid: true},
		{name: "boolean", valueType: SystemParameterBoolean, input: "true", want: "true", valid: true},
		{name: "integer fraction", valueType: SystemParameterInteger, input: "1.2", valid: false},
		{name: "decimal exponent", valueType: SystemParameterDecimal, input: "1e3", valid: false},
		{name: "boolean uppercase", valueType: SystemParameterBoolean, input: "TRUE", valid: false},
		{name: "unsupported", valueType: "JSON", input: "{}", valid: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := normalizeSystemParameterValue(test.valueType, test.input)
			if test.valid && (err != nil || got != test.want) {
				t.Fatalf("normalize = %q, %v; want %q", got, err, test.want)
			}
			if !test.valid && !errorIsKind(err, ErrorValidation) {
				t.Fatalf("error = %v, want validation", err)
			}
		})
	}
}

func TestSystemParameterKeyValidation(t *testing.T) {
	for _, key := range []string{"app.menu.mode", "sales.invoice.rounding-mode"} {
		if !validSystemParameterKey(key) {
			t.Fatalf("valid key %q rejected", key)
		}
	}
	for _, key := range []string{"menu", "App.menu", "app..menu", "app.menu_"} {
		if validSystemParameterKey(key) {
			t.Fatalf("invalid key %q accepted", key)
		}
	}
}

func TestValidateSystemParameterValueUsesRegisteredConstraints(t *testing.T) {
	minimum := "1"
	maximum := "4"
	constraints := &SystemParameterConstraints{
		Required: true, Minimum: &minimum, Maximum: &maximum,
		AllowedValues: []string{},
	}
	for _, test := range []struct {
		name  string
		value string
		want  string
		valid bool
	}{
		{name: "minimum", value: "1", want: "1", valid: true},
		{name: "normalized", value: "004", want: "4", valid: true},
		{name: "below", value: "0", valid: false},
		{name: "above", value: "5", valid: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := validateSystemParameterValue(SystemParameterInteger, test.value, constraints)
			if test.valid && (err != nil || got != test.want) {
				t.Fatalf("validate value = %q, %v; want %q", got, err, test.want)
			}
			if !test.valid && !errorIsKind(err, ErrorValidation) {
				t.Fatalf("validation error = %v, want validation", err)
			}
		})
	}
}

func TestValidateSystemParameterDefinitionRequiresConstraintsForEditableValues(t *testing.T) {
	if err := validateSystemParameterDefinition(SystemParameterString, "value", "default", true, nil); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("missing editable constraints error = %v, want validation", err)
	}
	maxLength := int32(10)
	constraints := &SystemParameterConstraints{MaxLength: &maxLength, AllowedValues: []string{}}
	if err := validateSystemParameterDefinition(SystemParameterString, "value", "default", true, constraints); err != nil {
		t.Fatalf("valid definition rejected: %v", err)
	}
	if err := validateSystemParameterDefinition(SystemParameterString, "value", "default value too long", true, constraints); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("invalid default error = %v, want validation", err)
	}
}
