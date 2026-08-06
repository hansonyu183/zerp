package vou

import (
	"math"
	"testing"
)

func TestAddIntermediaryAmount(t *testing.T) {
	t.Parallel()

	if total, ok := addIntermediaryAmount(125, 75); !ok || total != 200 {
		t.Fatalf("addIntermediaryAmount(125, 75) = (%d, %t), want (200, true)", total, ok)
	}
	if _, ok := addIntermediaryAmount(math.MaxInt64, 1); ok {
		t.Fatal("addIntermediaryAmount(MaxInt64, 1) accepted an overflowing total")
	}
	if _, ok := addIntermediaryAmount(0, -1); ok {
		t.Fatal("addIntermediaryAmount(0, -1) accepted a negative amount")
	}
}
