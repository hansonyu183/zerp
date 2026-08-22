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
	firstHalf, ok := proratedIntermediaryAmount(1, 500_000, 1_000_000)
	if !ok || firstHalf != 1 {
		t.Fatalf("first returned half-cent = (%d, %t), want (1, true)", firstHalf, ok)
	}
	throughSecondHalf, ok := proratedIntermediaryAmount(1, 1_000_000, 1_000_000)
	if !ok || throughSecondHalf-firstHalf != 0 {
		t.Fatalf("second returned half-cent = (%d, %t), want (0, true)", throughSecondHalf-firstHalf, ok)
	}
}

func TestIntermediarySalesAttributionRequiresStoredSnapshot(t *testing.T) {
	t.Parallel()
	id := "01J00000000000000000000001"
	if !validIntermediarySalesAttribution("EXTERNAL_PART_TIME", id, id, "SP-01", "外部销售") {
		t.Fatal("valid external sales attribution snapshot was rejected")
	}
	if validIntermediarySalesAttribution("DEALER", id, id, "SP-01", "旧渠道") {
		t.Fatal("legacy sales attribution was accepted")
	}
	if validIntermediarySalesAttribution("CHANNEL_PARTNER", id, "", "SP-01", "渠道") {
		t.Fatal("attribution without a saved version was accepted")
	}
}

func TestIntermediarySalesSummaryCategorySeparatesEmploymentAndSalesRelationships(t *testing.T) {
	t.Parallel()
	for attribution, want := range map[string]string{
		"INTERNAL_EMPLOYEE":  "COMMISSION",
		"EXTERNAL_PART_TIME": "EXTERNAL_PART_TIME",
		"CHANNEL_PARTNER":    "CHANNEL_PARTNER",
	} {
		if got := intermediarySalesSummaryCategory(attribution); got != want {
			t.Fatalf("category for %s = %s, want %s", attribution, got, want)
		}
	}
}

func TestEqualIntermediaryQuantityUsesFixedDecimalValue(t *testing.T) {
	t.Parallel()
	if !equalIntermediaryQuantity("1", "1.0") {
		t.Fatal("equal fixed-decimal quantities were rejected")
	}
	if equalIntermediaryQuantity("1.000001", "1") {
		t.Fatal("different fixed-decimal quantities were accepted")
	}
	if equalIntermediaryQuantity("invalid", "1") {
		t.Fatal("invalid quantity was accepted")
	}
}
