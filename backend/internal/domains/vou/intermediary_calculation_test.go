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

func TestAddSignedIntermediaryAmount(t *testing.T) {
	t.Parallel()

	if total, ok := addSignedIntermediaryAmount(125, -75); !ok || total != 50 {
		t.Fatalf("addSignedIntermediaryAmount(125, -75) = (%d, %t), want (50, true)", total, ok)
	}
	if _, ok := addSignedIntermediaryAmount(math.MaxInt64, 1); ok {
		t.Fatal("addSignedIntermediaryAmount(MaxInt64, 1) accepted positive overflow")
	}
	if _, ok := addSignedIntermediaryAmount(math.MinInt64, -1); ok {
		t.Fatal("addSignedIntermediaryAmount(MinInt64, -1) accepted negative overflow")
	}
}

func TestProratedIntermediaryAmountUsesCumulativeRounding(t *testing.T) {
	t.Parallel()

	first, ok := proratedIntermediaryAmount(100, 1, 3)
	if !ok || first != 33 {
		t.Fatalf("first returned third = (%d, %t), want (33, true)", first, ok)
	}
	throughSecond, ok := proratedIntermediaryAmount(100, 2, 3)
	if !ok || throughSecond-first != 34 {
		t.Fatalf("second returned third = (%d, %t), want (34, true)", throughSecond-first, ok)
	}
	full, ok := proratedIntermediaryAmount(100, 3, 3)
	if !ok || full != 100 {
		t.Fatalf("full return = (%d, %t), want (100, true)", full, ok)
	}
	if _, ok = proratedIntermediaryAmount(100, 4, 3); ok {
		t.Fatal("proration accepted a return quantity above the original")
	}
}
