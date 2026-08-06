package fixeddecimal

import (
	"math"
	"testing"
)

func TestParsePositive(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		value     string
		scale     int
		allowZero bool
		want      int64
		wantError string
	}{
		{name: "integer", value: "12", scale: 2, want: 1200},
		{name: "fraction", value: "12.34", scale: 2, want: 1234},
		{name: "trim whitespace", value: " 1.2 ", scale: 6, want: 1_200_000},
		{name: "zero allowed", value: "0.00", scale: 2, allowZero: true, want: 0},
		{name: "zero rejected", value: "0", scale: 2, wantError: "decimal must be greater than zero"},
		{name: "empty", value: "", scale: 2, wantError: "invalid decimal"},
		{name: "signed", value: "+1", scale: 2, wantError: "invalid decimal"},
		{name: "negative", value: "-1", scale: 2, wantError: "invalid decimal"},
		{name: "missing whole", value: ".1", scale: 2, wantError: "invalid decimal"},
		{name: "missing fraction", value: "1.", scale: 2, wantError: "invalid decimal scale"},
		{name: "non digit", value: "1.a", scale: 2, wantError: "invalid decimal"},
		{name: "excess scale", value: "1.001", scale: 2, wantError: "invalid decimal scale"},
		{name: "range", value: "92233720368547758.07", scale: 2, wantError: "decimal out of range"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := ParsePositive(test.value, test.scale, test.allowZero)
			if test.wantError != "" {
				if err == nil || err.Error() != test.wantError {
					t.Fatalf("ParsePositive() error = %v, want %q", err, test.wantError)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParsePositive() error = %v", err)
			}
			if got != test.want {
				t.Fatalf("ParsePositive() = %d, want %d", got, test.want)
			}
		})
	}
}

func TestParseSigned(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		value string
		want  int64
	}{
		{value: "12.34", want: 1234},
		{value: "-12.34", want: -1234},
		{value: "0.00", want: 0},
	} {
		got, err := ParseSigned(test.value, 2, true)
		if err != nil || got != test.want {
			t.Fatalf("ParseSigned(%q) = %d, %v; want %d", test.value, got, err, test.want)
		}
	}
	if _, err := ParseSigned("+1.00", 2, true); err == nil {
		t.Fatal("ParseSigned accepted an explicit plus sign")
	}
}

func TestLineAmountCents(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		quantity  int64
		unitPrice int64
		want      int64
		wantError bool
	}{
		{name: "exact", quantity: 2_000_000, unitPrice: 125, want: 250},
		{name: "round down", quantity: 1, unitPrice: 499_999, wantError: true},
		{name: "half up", quantity: 1, unitPrice: 500_000, want: 1},
		{name: "zero", quantity: 0, unitPrice: 100, wantError: true},
		{name: "negative", quantity: -1, unitPrice: 100, wantError: true},
		{name: "overflow", quantity: math.MaxInt64, unitPrice: math.MaxInt64, wantError: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := LineAmountCents(test.quantity, test.unitPrice)
			if test.wantError {
				if err == nil {
					t.Fatalf("LineAmountCents() error = nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("LineAmountCents() error = %v", err)
			}
			if got != test.want {
				t.Fatalf("LineAmountCents() = %d, want %d", got, test.want)
			}
		})
	}
}

func TestFormat(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name         string
		value        int64
		scale        int
		trimFraction bool
		want         string
	}{
		{name: "fixed money", value: 1234, scale: 2, want: "12.34"},
		{name: "padded money", value: 5, scale: 2, want: "0.05"},
		{name: "trimmed quantity", value: 1_200_000, scale: 6, trimFraction: true, want: "1.2"},
		{name: "trimmed integer", value: 2_000_000, scale: 6, trimFraction: true, want: "2"},
		{name: "signed", value: -250, scale: 2, want: "-2.50"},
		{name: "minimum integer", value: math.MinInt64, scale: 0, want: "-9223372036854775808"},
		{name: "zero scale", value: -2, scale: 0, want: "-2"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := Format(test.value, test.scale, test.trimFraction); got != test.want {
				t.Fatalf("Format() = %q, want %q", got, test.want)
			}
		})
	}
}
