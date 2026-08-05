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
