package vou

import (
	"strings"
	"testing"
)

const (
	testObjectID  = "01J00000000000000000000001"
	testVersionID = "01J00000000000000000000002"
)

func refInput() *ReferenceInput {
	return &ReferenceInput{ObjectID: testObjectID, VersionID: testVersionID}
}

func TestValidateDraftByEntity(t *testing.T) {
	t.Parallel()
	product := *refInput()
	sale, err := validateDraft(EntitySaleOrder, DraftInput{
		BusinessDate: "2026-07-24", Currency: "cny", Customer: refInput(),
		Salesperson: refInput(), Warehouse: refInput(),
		ProductLines: []ProductLineInput{{Product: product, OrderedQuantity: "2.5", UnitPrice: "10.00"}},
	})
	if err != nil {
		t.Fatalf("validate sale: %v", err)
	}
	if sale.TotalAmount != 2500 || sale.Currency != "CNY" {
		t.Fatalf("sale = %+v", sale)
	}
	expense, err := validateDraft(EntityExpenseReimbursement, DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Employee: refInput(), FundAccount: refInput(),
		ExpenseLines: []ExpenseLineInput{
			{Category: "交通", Description: "出租车", Amount: "12.30"},
			{Category: "住宿", Description: "酒店", Amount: "100.00"},
		},
	})
	if err != nil || expense.TotalAmount != 11230 {
		t.Fatalf("expense = %+v, err=%v", expense, err)
	}
}

func TestValidateLineRemarkBoundaries(t *testing.T) {
	t.Parallel()
	product := *refInput()
	if _, _, err := validateProductLines([]ProductLineInput{{
		Product: product, OrderedQuantity: "1", UnitPrice: "1.00",
		Remark: strings.Repeat("注", 1000),
	}}, false); err != nil {
		t.Fatalf("1000-character product remark rejected: %v", err)
	}
	if _, _, err := validateProductLines([]ProductLineInput{{
		Product: product, OrderedQuantity: "1", UnitPrice: "1.00",
		Remark: strings.Repeat("注", 1001),
	}}, false); err == nil {
		t.Fatalf("1001-character product remark error = %v", err)
	}
	if _, _, err := validateExpenseLines([]ExpenseLineInput{{
		Category: "交通", Description: "出租车", Amount: "1.00",
		Remark: strings.Repeat("注", 1001),
	}}); err == nil {
		t.Fatalf("1001-character expense remark error = %v", err)
	}
}

func TestValidateDraftRejectsCrossEntityAndDuplicateProduct(t *testing.T) {
	t.Parallel()
	product := *refInput()
	_, err := validateDraft(EntitySaleOrder, DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: refInput(), FundAccount: refInput(),
		Salesperson: refInput(), Warehouse: refInput(),
		ProductLines: []ProductLineInput{{Product: product, OrderedQuantity: "1", UnitPrice: "1.00"}},
	})
	if err == nil {
		t.Fatal("sale accepted fund account")
	}
	_, err = validateDraft(EntityPurchaseOrder, DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Supplier: refInput(),
		Purchaser: refInput(), Warehouse: refInput(),
		ProductLines: []ProductLineInput{
			{Product: product, OrderedQuantity: "1", UnitPrice: "1.00"},
			{Product: product, OrderedQuantity: "2", UnitPrice: "1.00"},
		},
	})
	if err == nil {
		t.Fatal("purchase accepted duplicate product")
	}
}

func TestIntermediaryRequiresPurchaseUnitPrice(t *testing.T) {
	t.Parallel()
	product := *refInput()
	customer := *refInput()
	supplier := *refInput()
	_, err := validateDraft(EntityIntermediarySaleOrder, DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: &customer, Supplier: &supplier,
		ProductLines: []ProductLineInput{{
			Product: product, OrderedQuantity: "1", UnitPrice: "12.00",
		}},
	})
	if err == nil {
		t.Fatal("intermediary line without purchaseUnitPrice was accepted")
	}
	validated, err := validateDraft(EntityIntermediarySaleOrder, DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: &customer, Supplier: &supplier,
		ProductLines: []ProductLineInput{{
			Product: product, OrderedQuantity: "1", UnitPrice: "12.00", PurchaseUnitPrice: "10.00",
		}},
	})
	if err != nil || validated.ProductLines[0].PurchaseUnitPrice == nil ||
		*validated.ProductLines[0].PurchaseUnitPrice != 1000 {
		t.Fatalf("validated intermediary = %+v, err=%v", validated, err)
	}
}

func TestValidateSaleExecutionReconcilesQuantities(t *testing.T) {
	t.Parallel()
	valid := ExecuteInput{
		DocumentID: testObjectID, Revision: 3, OutboundDate: "2026-07-25", SignoffDate: "2026-07-26",
		Platform: refInput(), Vehicle: refInput(),
		SaleLines: []SaleExecutionLineInput{{
			LineID: testVersionID, OutboundQuantity: "10", SignedQuantity: "8",
			RejectedQuantity: "1", LossQuantity: "1",
		}},
	}
	if _, err := validateSaleExecution(valid); err != nil {
		t.Fatalf("valid execution rejected: %v", err)
	}
	valid.SaleLines[0].LossQuantity = "0"
	if _, err := validateSaleExecution(valid); err == nil {
		t.Fatal("unbalanced sale quantities accepted")
	}
}

func TestValidateAttachmentInitiate(t *testing.T) {
	t.Parallel()
	input := AttachmentInitiateInput{
		DocumentID: testObjectID, Revision: 1, FileName: "invoice.pdf",
		ContentType: "application/pdf", Size: 12, SHA256: strings.Repeat("a", 64),
	}
	if _, err := validateAttachmentInitiate(input); err != nil {
		t.Fatalf("valid attachment rejected: %v", err)
	}
	input.FileName = "../../secret.pdf"
	if _, err := validateAttachmentInitiate(input); err == nil {
		t.Fatal("path traversal filename accepted")
	}
}
