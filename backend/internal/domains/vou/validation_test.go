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

func TestSplitCashEntitiesFixCounterpartyType(t *testing.T) {
	t.Parallel()
	for _, test := range []struct{ entity, want string }{
		{EntityCustomerReceipt, "customer"}, {EntitySupplierReceipt, "supplier"},
		{EntityOtherReceipt, "other-party"}, {EntityCustomerPayment, "customer"},
		{EntitySupplierPayment, "supplier"}, {EntityOtherPayment, "other-party"},
		{EntityEmployeeLoan, "employee"}, {EntityEmployeeRepayment, "employee"},
	} {
		draft, err := validateDraft(test.entity, DraftInput{
			BusinessDate: "2026-08-03", Currency: "CNY", Counterparty: refInput(),
			FundAccount: refInput(), Handler: refInput(), Amount: "10.00",
		})
		if err != nil || draft.CounterpartyType != test.want {
			t.Fatalf("%s type=%q err=%v", test.entity, draft.CounterpartyType, err)
		}
	}
	if _, err := validateDraft(EntityCustomerReceipt, DraftInput{
		BusinessDate: "2026-08-03", Currency: "CNY", CounterpartyType: "supplier",
		Counterparty: refInput(), FundAccount: refInput(), Handler: refInput(), Amount: "10.00",
	}); err == nil {
		t.Fatal("customer receipt accepted supplier counterparty type")
	}
}

func TestEmployeeLoanWriteoffUsesExpenseLinesOnly(t *testing.T) {
	t.Parallel()
	draft, err := validateDraft(EntityEmployeeLoanWriteoff, DraftInput{
		BusinessDate: "2026-08-03", Currency: "CNY", Employee: refInput(),
		ExpenseLines: []ExpenseLineInput{{Category: "差旅", Description: "借款核销", Amount: "12.30"}},
	})
	if err != nil || draft.TotalAmount != 1230 {
		t.Fatalf("writeoff = %+v, err=%v", draft, err)
	}
	if _, err = validateDraft(EntityEmployeeLoanWriteoff, DraftInput{
		BusinessDate: "2026-08-03", Currency: "CNY", Employee: refInput(),
		FundAccount:  refInput(),
		ExpenseLines: []ExpenseLineInput{{Category: "差旅", Description: "借款核销", Amount: "12.30"}},
	}); err == nil {
		t.Fatal("employee loan writeoff accepted a fund account")
	}
}

func TestValidateLineRemarkBoundaries(t *testing.T) {
	t.Parallel()
	product := *refInput()
	if _, _, err := validateProductLines([]ProductLineInput{{
		Product: product, OrderedQuantity: "1", UnitPrice: "1.00",
		Remark: strings.Repeat("注", 1000),
	}}, false, false); err != nil {
		t.Fatalf("1000-character product remark rejected: %v", err)
	}
	if _, _, err := validateProductLines([]ProductLineInput{{
		Product: product, OrderedQuantity: "1", UnitPrice: "1.00",
		Remark: strings.Repeat("注", 1001),
	}}, false, false); err == nil {
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

func TestValidateFormulaRules(t *testing.T) {
	t.Parallel()
	formula := &FormulaInput{
		BaseOutputQuantity: "100",
		SourceType:         "customer_latest",
		SourceDocumentID:   testObjectID,
		SourceDocumentNo:   "SOR-20260728-0001",
		Components: []FormulaComponentInput{{
			Material: *refInput(),
			Quantity: "25.5",
		}},
	}
	validated, err := validateFormula(formula, true)
	if err != nil {
		t.Fatalf("valid formula rejected: %v", err)
	}
	if validated.SourceType != "CUSTOMER_LATEST" ||
		validated.BaseOutputQuantity != 100_000_000 ||
		validated.Components[0].Quantity != 25_500_000 {
		t.Fatalf("formula normalization = %+v", validated)
	}
	if _, err = validateFormula(formula, false); err == nil {
		t.Fatal("purchase formula accepted")
	}

	duplicate := *formula
	duplicate.SourceType = "MANUAL"
	duplicate.SourceDocumentID = ""
	duplicate.SourceDocumentNo = ""
	duplicate.Components = append(
		[]FormulaComponentInput(nil),
		formula.Components...,
	)
	duplicate.Components = append(duplicate.Components, FormulaComponentInput{
		Material: ReferenceInput{
			ObjectID:  testObjectID,
			VersionID: "01J00000000000000000000003",
		},
		Quantity: "1",
	})
	if _, err = validateFormula(&duplicate, true); err == nil {
		t.Fatal("duplicate formula material accepted")
	}

	formula.SourceDocumentID = ""
	if _, err = validateFormula(formula, true); err == nil {
		t.Fatal("latest formula without source document accepted")
	}
}

func TestValidateSaleExecutionReconcilesQuantities(t *testing.T) {
	t.Parallel()
	valid := FinalizeInput{
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

func TestValidateInventoryCountDraft(t *testing.T) {
	t.Parallel()
	warehouse := *refInput()
	product := ReferenceInput{
		ObjectID: "01J00000000000000000000002", VersionID: "01J00000000000000000000003",
	}
	draft, err := validateDraft(EntityInventoryCount, DraftInput{
		BusinessDate: "2026-08-04", Currency: "CNY", Warehouse: &warehouse,
		InventoryCountLines: []InventoryCountLineInput{{Product: product, ActualQuantity: "0"}},
	})
	if err != nil || len(draft.InventoryCountLines) != 1 || draft.InventoryCountLines[0].ActualQuantity != 0 {
		t.Fatalf("valid inventory count = %+v err=%v", draft, err)
	}
	_, err = validateDraft(EntityInventoryCount, DraftInput{
		BusinessDate: "2026-08-04", Currency: "USD", Warehouse: &warehouse,
		InventoryCountLines: []InventoryCountLineInput{{Product: product, ActualQuantity: "1"}},
	})
	if err == nil {
		t.Fatal("non-CNY inventory count was accepted")
	}
	_, err = validateDraft(EntityInventoryCount, DraftInput{
		BusinessDate: "2026-08-04", Currency: "CNY", Warehouse: &warehouse,
		InventoryCountLines: []InventoryCountLineInput{
			{Product: product, ActualQuantity: "1"},
			{Product: product, ActualQuantity: "2"},
		},
	})
	if err == nil {
		t.Fatal("duplicate inventory count product was accepted")
	}
}
