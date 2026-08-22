package bob

import (
	"encoding/json"
	"testing"
)

func TestNormalizeSupplierDraftAllowsMissingSettlementAndPurchaser(t *testing.T) {
	data, err := normalizeSupplier(SupplierData{
		Name:      "  华东原料  ",
		TaxNumber: " ab-123 ",
	})
	if err != nil {
		t.Fatalf("normalize supplier draft: %v", err)
	}
	if data.Name != "华东原料" || data.TaxNumber != "AB-123" {
		t.Fatalf("normalized supplier = %#v", data)
	}
	if data.SettlementMethod != nil || data.DefaultPurchaserEmployeeID != "" {
		t.Fatalf("draft unexpectedly gained required-on-submit values: %#v", data)
	}
}

func TestValidateSupplierEffectiveRequiresSnapshotAndPurchaser(t *testing.T) {
	base := SupplierData{Name: "华东原料"}
	if err := validateSupplierEffective(base); err == nil {
		t.Fatal("missing settlement snapshot and purchaser accepted")
	}
	base.SettlementMethodID = "01J00000000000000000000001"
	base.SettlementMethod = &SupplierSettlementSnapshot{
		SourceObjectID: base.SettlementMethodID,
		Code:           "ARRIVAL_30",
		Name:           "货到30天",
		TermCode:       SettlementTermArrival30,
		RuleType:       SettlementRuleRelativeDays,
		DayOffset:      30,
	}
	if err := validateSupplierEffective(base); err == nil {
		t.Fatal("missing purchaser accepted")
	}
	base.DefaultPurchaserEmployeeID = "01J00000000000000000000002"
	if err := validateSupplierEffective(base); err != nil {
		t.Fatalf("complete supplier rejected: %v", err)
	}
}

func TestSupplierWireRejectsRemovedSupplierType(t *testing.T) {
	var data SupplierData
	if err := json.Unmarshal([]byte(`{"operatingEntityId":"01J00000000000000000000001","supplierType":"GENERAL"}`), &data); err == nil {
		t.Fatal("removed supplierType field accepted")
	}
}
