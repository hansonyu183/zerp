package vou

import "testing"

func TestFixedDecimalParsingAndFormatting(t *testing.T) {
	t.Parallel()
	tests := []struct {
		value     string
		scale     int
		allowZero bool
		want      int64
		wantErr   bool
	}{
		{value: "1", scale: 6, want: 1_000_000},
		{value: "1.234567", scale: 6, want: 1_234_567},
		{value: "0", scale: 6, allowZero: true, want: 0},
		{value: "0.000001", scale: 6, want: 1},
		{value: "12.34", scale: 2, want: 1234},
		{value: "1.234", scale: 2, wantErr: true},
		{value: "-1", scale: 2, wantErr: true},
		{value: "0", scale: 2, wantErr: true},
	}
	for _, test := range tests {
		got, err := parseFixed(test.value, test.scale, test.allowZero)
		if test.wantErr {
			if err == nil {
				t.Fatalf("parseFixed(%q) unexpectedly succeeded", test.value)
			}
			continue
		}
		if err != nil || got != test.want {
			t.Fatalf("parseFixed(%q) = %d, %v; want %d", test.value, got, err, test.want)
		}
	}
	if got := formatQuantity(1_234_500); got != "1.2345" {
		t.Fatalf("quantity = %q", got)
	}
	if got := formatMoney(100); got != "1.00" {
		t.Fatalf("money = %q", got)
	}
}

func TestLineAmountRoundsHalfUp(t *testing.T) {
	t.Parallel()
	amount, err := lineAmountCents(1_500_000, 101)
	if err != nil || amount != 152 {
		t.Fatalf("amount = %d, err=%v; want 152", amount, err)
	}
}
