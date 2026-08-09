package led

import "testing"

func TestClosingCostRoundingAndFullDepletion(t *testing.T) {
	t.Parallel()
	if got := roundedRatio(101, 1, 2); got != 51 {
		t.Fatalf("roundedRatio(101,1,2) = %d, want 51", got)
	}
	balance := &inventoryCostBalance{quantity: 3_000_000, amount: 100}
	first, err := consumeInventoryCost(balance, 1_000_000)
	if err != nil || first != 33 || balance.quantity != 2_000_000 || balance.amount != 67 {
		t.Fatalf("first consume = %d, balance=%+v, err=%v", first, balance, err)
	}
	last, err := consumeInventoryCost(balance, 2_000_000)
	if err != nil || last != 67 || balance.quantity != 0 || balance.amount != 0 {
		t.Fatalf("full depletion = %d, balance=%+v, err=%v", last, balance, err)
	}
}

func TestClosingRejectsInvalidCostConsumption(t *testing.T) {
	t.Parallel()
	balance := &inventoryCostBalance{quantity: 1, amount: 1}
	if _, err := consumeInventoryCost(balance, 2); err == nil {
		t.Fatal("consumeInventoryCost accepted insufficient inventory")
	}
}

func TestClosingPartyRowIDUsesFullSnapshotDimension(t *testing.T) {
	t.Parallel()
	trade := closingPartyRowID("TRADE", "customer", "01JTESTCUSTOMER0000000000", "CNY")
	other := closingPartyRowID("OTHER", "customer", "01JTESTCUSTOMER0000000000", "CNY")
	foreign := closingPartyRowID("TRADE", "customer", "01JTESTCUSTOMER0000000000", "USD")
	if trade != "TRADE/customer/01JTESTCUSTOMER0000000000/CNY" {
		t.Fatalf("trade closing party row id = %q", trade)
	}
	if trade == other || trade == foreign || other == foreign {
		t.Fatalf("closing party row ids are not unique: %q %q %q", trade, other, foreign)
	}
}
