package vou

import (
	"testing"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
)

func TestInventoryCountBalanceUsesStoredProductSnapshot(t *testing.T) {
	t.Parallel()
	item := inventoryCountBalanceItem(dbsqlc.ListVouInventoryCountBookBalancesRow{
		ProductObjectID: "01JPRODUCT00000000000000001", ProductApprovalEntryID: "01JPRODUCT00000000000000000002",
		ProductCode: "PRD-0001", ProductName: "历史产品名称", EnteredUnitSymbol: "件",
		BaseQuantityMicros: 2_500_000,
	}, bobdomain.DetailView{
		BehaviorProfile: "RAW_MATERIAL", DefaultInputUnitID: "01JUNIT00000000000000000001",
		PricingUnitID: "01JUNIT00000000000000000002",
		UnitConversions: []bobdomain.ProductUnitConversion{{
			Unit: bobdomain.MeasurementUnitSnapshot{ObjectID: "01JUNIT00000000000000000001", Symbol: "件"}, Factor: "1",
		}},
	})
	if item.Product.ObjectID != "01JPRODUCT00000000000000001" || item.Product.ApprovalEntryID != "01JPRODUCT00000000000000000002" ||
		item.Product.Code != "PRD-0001" || item.Product.Name != "历史产品名称" || item.Product.Unit != "件" || item.Quantity != "2.5" ||
		item.Product.DefaultInputUnitID != "01JUNIT00000000000000000001" || item.Product.PricingUnitID != "01JUNIT00000000000000000002" ||
		len(item.Product.UnitConversions) != 1 {
		t.Fatalf("inventory balance item = %+v", item)
	}
}
