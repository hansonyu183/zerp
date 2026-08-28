package aux

import "testing"

func TestObjectPrefixes(t *testing.T) {
	t.Parallel()
	expected := map[string]string{
		EntityProductCategory:  "PCT",
		EntityEmployeeCategory: "ECT",
		EntityProductType:      "PTP",
		EntityDepartment:       "DEP",
		EntityPosition:         "POS",
		EntitySettlementMethod: "STM",
		EntityPaymentMethod:    "PAY",
		EntityDictionaryType:   "DCT",
		EntityDictionaryItem:   "DIT",
		EntityMeasurementUnit:  "UNT",
		EntityIncomeExpense:    "IET",
		EntityAssetCategory:    "ACT",
	}
	for entity, prefix := range expected {
		if actual := objectPrefix(entity); actual != prefix {
			t.Fatalf("objectPrefix(%q) = %q, want %q", entity, actual, prefix)
		}
	}
}
