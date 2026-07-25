package wfl

import "testing"

func TestFixedDecimalAndLineAmount(t *testing.T) {
	value, err := fixedDecimal("12.345678", 6, false)
	if err != nil || value != 12_345_678 {
		t.Fatalf("quantity = %d, err=%v", value, err)
	}
	if _, err = fixedDecimal("1.0000001", 6, false); err == nil {
		t.Fatal("seven decimal places must be rejected")
	}
	amount, err := lineAmount(1_500_000, 1_025)
	if err != nil || amount != 1_538 {
		t.Fatalf("rounded amount = %d, err=%v", amount, err)
	}
}

func TestSemanticStatusesAndReasons(t *testing.T) {
	cases := map[string]string{
		StageProcurement: "ORDERED",
		StageReceipt:     "CONFIRMED",
		StageDelivery:    "EXECUTED",
		StageSignoff:     "CONFIRMED",
	}
	for stage, want := range cases {
		if got := semanticStatus(stage, "APPROVED"); got != want {
			t.Fatalf("%s status = %s, want %s", stage, got, want)
		}
	}
	if _, err := requiredReason(""); err == nil {
		t.Fatal("empty reverse reason must be rejected")
	}
	if _, err := requiredReason("修正数量"); err != nil {
		t.Fatalf("valid reason: %v", err)
	}
}
