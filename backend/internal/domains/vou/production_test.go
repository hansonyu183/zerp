package vou

import "testing"

func TestProductionSuggestedQuantityRoundsHalfUp(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name                                      string
		formula, base, output, lossRate, expected int64
	}{
		{
			name:    "one third rounds down",
			formula: 1_000_000, base: 3_000_000, output: 1_000_000,
			expected: 333_333,
		},
		{
			name:    "one sixth rounds up",
			formula: 1_000_000, base: 6_000_000, output: 1_000_000,
			expected: 166_667,
		},
		{
			name:    "loss rate is applied",
			formula: 2_000_000, base: 1_000_000, output: 10_000_000,
			lossRate: 5_000_000, expected: 21_000_000,
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			actual, err := productionSuggestedQuantity(
				test.formula, test.base, test.output, test.lossRate,
			)
			if err != nil {
				t.Fatalf("productionSuggestedQuantity() error = %v", err)
			}
			if actual != test.expected {
				t.Fatalf("productionSuggestedQuantity() = %d, want %d", actual, test.expected)
			}
		})
	}
}

func TestProductionSuggestedQuantityRejectsOverflow(t *testing.T) {
	t.Parallel()
	if _, err := productionSuggestedQuantity(
		9_000_000_000_000_000_000,
		1,
		9_000_000_000_000_000_000,
		productionPercentScale,
	); err == nil {
		t.Fatal("productionSuggestedQuantity() error = nil, want range error")
	}
}
