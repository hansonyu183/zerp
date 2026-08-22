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

func productLineInput(quantity, price string) ProductLineInput {
	return ProductLineInput{
		Product:         ProductReferenceInput{ObjectID: testObjectID},
		EnteredQuantity: quantity,
		EnteredUnit:     UnitReferenceInput{ObjectID: testObjectID},
		BaseQuantity:    quantity,
		UnitPrice:       price,
	}
}

func TestValidateDraftByEntity(t *testing.T) {
	t.Parallel()
	sale, err := validateDraft(EntitySaleOrder, DraftInput{
		BusinessDate: "2026-07-24", Currency: "cny", Customer: refInput(),
		Salesperson: refInput(), Warehouse: refInput(),
		ProductLines: []ProductLineInput{productLineInput("2.5", "10.00")},
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

func TestCashEntitiesFixOrAcceptCounterpartyType(t *testing.T) {
	t.Parallel()
	for _, test := range []struct{ entity, want string }{
		{EntitySalesReceipt, "customer-account"}, {EntityPurchaseRefund, "supplier"},
		{EntitySalesRefund, "customer-account"}, {EntityPurchasePayment, "supplier"},
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
	if _, err := validateDraft(EntitySalesReceipt, DraftInput{
		BusinessDate: "2026-08-03", Currency: "CNY", CounterpartyType: "supplier",
		Counterparty: refInput(), FundAccount: refInput(), Handler: refInput(), Amount: "10.00",
	}); err == nil {
		t.Fatal("customer receipt accepted supplier counterparty type")
	}
	for _, entity := range []string{EntityOtherReceipt, EntityOtherPayment} {
		for _, counterpartyType := range []string{"customer-account", "supplier", "other-unit", "employee", "sales-partner"} {
			draft, err := validateDraft(entity, DraftInput{
				BusinessDate: "2026-08-03", Currency: "CNY", CounterpartyType: counterpartyType,
				Counterparty: refInput(), FundAccount: refInput(), Handler: refInput(), Amount: "10.00",
				OtherCategory: "commission",
			})
			if err != nil || draft.CounterpartyType != counterpartyType || draft.OtherCategory != "COMMISSION" {
				t.Fatalf("%s type=%q category=%q err=%v", entity, draft.CounterpartyType, draft.OtherCategory, err)
			}
		}
	}
	if _, err := validateDraft(EntitySalesReceipt, DraftInput{
		BusinessDate: "2026-08-03", Currency: "CNY", Counterparty: refInput(),
		FundAccount: refInput(), Handler: refInput(), Amount: "10.00", OtherCategory: "REBATE",
	}); err == nil {
		t.Fatal("trade receipt accepted an other transaction category")
	}
	if _, err := validateDraft(EntitySaleOrder, DraftInput{
		BusinessDate: "2026-08-03", Currency: "CNY", OtherCategory: "REBATE",
	}); err == nil || !strings.Contains(err.Error(), "otherCategory") {
		t.Fatalf("sale order otherCategory error = %v", err)
	}
	if _, err := validateDraft(EntityBillReceipt, DraftInput{
		BusinessDate: "2026-08-03", Currency: "CNY", OtherCategory: "REBATE",
	}); err == nil || !strings.Contains(err.Error(), "otherCategory") {
		t.Fatalf("bill receipt otherCategory error = %v", err)
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

func TestEmployeeLoanEntitiesEnforceTheirFinancialShape(t *testing.T) {
	t.Parallel()

	if !paymentEntity(EntityEmployeeLoan) {
		t.Fatal("employee loan is not classified as a payment")
	}
	if !receiptEntity(EntityEmployeeRepayment) {
		t.Fatal("employee repayment is not classified as a receipt")
	}
	if paymentEntity(EntityEmployeeRepayment) || receiptEntity(EntityEmployeeLoan) {
		t.Fatal("employee loan transaction direction is reversed")
	}

	base := DraftInput{
		BusinessDate: "2026-08-03", Currency: "CNY", Counterparty: refInput(),
		FundAccount: refInput(), Handler: refInput(), Amount: "10.00",
	}
	tests := []struct {
		name   string
		entity string
		mutate func(*DraftInput)
	}{
		{
			name: "loan rejects a non-employee counterparty type", entity: EntityEmployeeLoan,
			mutate: func(input *DraftInput) { input.CounterpartyType = "customer-account" },
		},
		{
			name: "repayment requires an employee counterparty", entity: EntityEmployeeRepayment,
			mutate: func(input *DraftInput) { input.Counterparty = nil },
		},
		{
			name: "loan requires a fund account", entity: EntityEmployeeLoan,
			mutate: func(input *DraftInput) { input.FundAccount = nil },
		},
		{
			name: "repayment requires a handler", entity: EntityEmployeeRepayment,
			mutate: func(input *DraftInput) { input.Handler = nil },
		},
		{
			name: "loan rejects an invalid amount", entity: EntityEmployeeLoan,
			mutate: func(input *DraftInput) { input.Amount = "0" },
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			input := base
			test.mutate(&input)
			if _, err := validateDraft(test.entity, input); err == nil {
				t.Fatal("invalid employee loan transaction was accepted")
			}
		})
	}
}

func TestValidateLineRemarkBoundaries(t *testing.T) {
	t.Parallel()
	line := productLineInput("1", "1.00")
	line.Remark = strings.Repeat("注", 1000)
	if _, _, err := validateProductLines([]ProductLineInput{line}, false, false); err != nil {
		t.Fatalf("1000-character product remark rejected: %v", err)
	}
	line.Remark = strings.Repeat("注", 1001)
	if _, _, err := validateProductLines([]ProductLineInput{line}, false, false); err == nil {
		t.Fatalf("1001-character product remark error = %v", err)
	}
	if _, _, err := validateExpenseLines([]ExpenseLineInput{{
		Category: "交通", Description: "出租车", Amount: "1.00",
		Remark: strings.Repeat("注", 1001),
	}}); err == nil {
		t.Fatalf("1001-character expense remark error = %v", err)
	}
}

func TestValidateReverseRequiresReason(t *testing.T) {
	t.Parallel()
	valid := ReverseInput{DocumentID: testObjectID, Revision: 1, Reason: " 修正数据 "}
	reason, err := validateReverse(valid)
	if err != nil || reason == nil || *reason != "修正数据" {
		t.Fatalf("validated reason=%v err=%v", reason, err)
	}
	for _, reason := range []string{"", "  ", strings.Repeat("原", 1001)} {
		input := valid
		input.Reason = reason
		if _, err := validateReverse(input); err == nil {
			t.Fatalf("reason %q was accepted", reason)
		}
	}
}

func TestValidateDraftRejectsCrossEntityAndDuplicateProduct(t *testing.T) {
	t.Parallel()
	_, err := validateDraft(EntitySaleOrder, DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: refInput(), FundAccount: refInput(),
		Salesperson: refInput(), Warehouse: refInput(),
		ProductLines: []ProductLineInput{productLineInput("1", "1.00")},
	})
	if err == nil {
		t.Fatal("sale accepted fund account")
	}
	_, err = validateDraft(EntityPurchaseOrder, DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Supplier: refInput(),
		Purchaser: refInput(), Warehouse: refInput(),
		ProductLines: []ProductLineInput{productLineInput("1", "1.00"), productLineInput("2", "1.00")},
	})
	if err == nil {
		t.Fatal("purchase accepted duplicate product")
	}
}

func TestValidateFormulaRules(t *testing.T) {
	t.Parallel()
	formula := &FormulaInput{
		Output:           QuantitySnapshotInput{EnteredQuantity: "100", EnteredUnit: UnitReferenceInput{ObjectID: testObjectID}, BaseQuantity: "100"},
		SourceType:       "customer_latest",
		SourceDocumentID: testObjectID,
		SourceDocumentNo: "SOR-20260728-0001",
		Components: []FormulaComponentInput{{
			Material: ProductReferenceInput{ObjectID: testObjectID},
			Quantity: QuantitySnapshotInput{EnteredQuantity: "25.5", EnteredUnit: UnitReferenceInput{ObjectID: testObjectID}, BaseQuantity: "25.5"},
		}},
	}
	validated, err := validateFormula(formula, true)
	if err != nil {
		t.Fatalf("valid formula rejected: %v", err)
	}
	if validated.SourceType != "CUSTOMER_LATEST" ||
		validated.Output.BaseQuantity != 100_000_000 ||
		validated.Components[0].Quantity.BaseQuantity != 25_500_000 {
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
		Material: ProductReferenceInput{ObjectID: testObjectID},
		Quantity: QuantitySnapshotInput{EnteredQuantity: "1", EnteredUnit: UnitReferenceInput{ObjectID: testObjectID}, BaseQuantity: "1"},
	})
	if _, err = validateFormula(&duplicate, true); err == nil {
		t.Fatal("duplicate formula material accepted")
	}

	formula.SourceDocumentID = ""
	if _, err = validateFormula(formula, true); err == nil {
		t.Fatal("latest formula without source document accepted")
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
	product := ProductReferenceInput{ObjectID: "01J00000000000000000000002"}
	countLine := func(quantity string) InventoryCountLineInput {
		return InventoryCountLineInput{
			Product: product, EnteredQuantity: quantity,
			EnteredUnit: UnitReferenceInput{ObjectID: testObjectID}, BaseQuantity: quantity,
		}
	}
	draft, err := validateDraft(EntityInventoryCount, DraftInput{
		BusinessDate: "2026-08-04", Currency: "CNY", Warehouse: &warehouse,
		InventoryCountLines: []InventoryCountLineInput{countLine("0")},
	})
	if err != nil || len(draft.InventoryCountLines) != 1 || draft.InventoryCountLines[0].ActualQuantity != 0 {
		t.Fatalf("valid inventory count = %+v err=%v", draft, err)
	}
	_, err = validateDraft(EntityInventoryCount, DraftInput{
		BusinessDate: "2026-08-04", Currency: "USD", Warehouse: &warehouse,
		InventoryCountLines: []InventoryCountLineInput{countLine("1")},
	})
	if err == nil {
		t.Fatal("non-CNY inventory count was accepted")
	}
	_, err = validateDraft(EntityInventoryCount, DraftInput{
		BusinessDate: "2026-08-04", Currency: "CNY", Warehouse: &warehouse,
		InventoryCountLines: []InventoryCountLineInput{countLine("1"), countLine("2")},
	})
	if err == nil {
		t.Fatal("duplicate inventory count product was accepted")
	}
}
