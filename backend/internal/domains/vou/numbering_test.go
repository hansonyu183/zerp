package vou

import "testing"

func TestDocumentPrefixes(t *testing.T) {
	t.Parallel()
	expected := map[string]string{
		EntitySaleOrder: "SOR", EntitySaleOutbound: "SOB", EntitySaleDelivery: "SDL",
		EntitySaleSignoff: "SSF", EntitySaleReturn: "SRT", EntityPurchaseOrder: "POR",
		EntityPurchaseInbound: "PIN", EntityPurchaseReturn: "PRT", EntityReceipt: "REC",
		EntityPayment: "PAY", EntityExpenseReimbursement: "EXR", EntityOtherIncome: "OIN",
	}
	for entity, prefix := range expected {
		if actual := entityPrefix(entity); actual != prefix {
			t.Fatalf("entityPrefix(%q) = %q, want %q", entity, actual, prefix)
		}
	}
}
