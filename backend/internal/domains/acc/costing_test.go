package acc

import "testing"

func TestLatestPurchaseCostUsesMostRecentMatchingInbound(t *testing.T) {
	entry := inventoryCostEntry{subjectID: "inventory", productID: "product", warehouseID: "warehouse", quantity: 2_000_000}
	results := []inventoryCostResult{
		{entry: inventoryCostEntry{sourceEntity: "purchase-inbound", subjectID: "inventory", productID: "product", warehouseID: "warehouse", quantity: 4_000_000}, cost: 400},
		{entry: inventoryCostEntry{sourceEntity: "purchase-inbound", subjectID: "inventory", productID: "other", warehouseID: "warehouse", quantity: 1_000_000}, cost: 999},
		{entry: inventoryCostEntry{sourceEntity: "purchase-inbound", subjectID: "inventory", productID: "product", warehouseID: "warehouse", quantity: 3_000_000}, cost: 450},
	}
	cost, found := latestPurchaseCost(results, entry)
	if !found || cost != 300 {
		t.Fatalf("latest purchase cost = %d, found=%v", cost, found)
	}
}
