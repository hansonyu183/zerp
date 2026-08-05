package vou

import (
	"fmt"
	"strings"
	"testing"
)

func billPrimary() BillLineInput {
	return BillLineInput{PositionType: "ASSET", Direction: "IN", Purpose: "PRIMARY", BillType: "BANK_ACCEPTANCE", BillNo: "B-001", Medium: "ELECTRONIC", Currency: "CNY", FaceAmount: "100.00", IssueDate: "2026-08-01", MaturityDate: "2026-09-01", Drawer: "出票人", Acceptor: "承兑人", Payee: "收款人", AnnualRateBps: 120}
}
func TestBillReceiptValidation(t *testing.T) {
	input := DraftInput{BusinessDate: "2026-08-01", Currency: "CNY", Counterparty: refInput(), Handler: refInput(), InternalCostRateBps: 365, BillLines: []BillLineInput{billPrimary()}, BillCashLines: []BillCashLineInput{{FundAccount: *refInput(), Direction: "IN", AmountType: "FEE", Amount: "1.00"}}}
	draft, err := validateDraft(EntityBillReceipt, input)
	if err != nil {
		t.Fatalf("validate bill receipt: %v", err)
	}
	if draft.TotalAmount != 10000 || len(draft.BillLines) != 1 || draft.BillLines[0].CustomerCostAmount != 31 {
		t.Fatalf("unexpected bill draft: %+v", draft)
	}
	input.BillLines[0].Purpose = "CHANGE"
	input.BillLines[0].Direction = "IN"
	if _, err = validateDraft(EntityBillReceipt, input); err == nil {
		t.Fatal("accepted CHANGE with IN direction")
	}
	input.BillLines = make([]BillLineInput, 21)
	for i := range input.BillLines {
		input.BillLines[i] = billPrimary()
	}
	if _, err = validateDraft(EntityBillReceipt, input); err == nil {
		t.Fatal("accepted more than 20 bill lines")
	}
	input.BillLines = make([]BillLineInput, 20)
	for i := range input.BillLines {
		input.BillLines[i] = billPrimary()
		input.BillLines[i].BillNo = fmt.Sprintf("B-%03d", i)
	}
	input.BillCashLines = make([]BillCashLineInput, 20)
	for i := range input.BillCashLines {
		input.BillCashLines[i] = BillCashLineInput{
			FundAccount: *refInput(), Direction: "IN", AmountType: "OTHER", Amount: "0.01",
		}
	}
	if _, err = validateDraft(EntityBillReceipt, input); err != nil {
		t.Fatalf("rejected exactly 20 bill and cash lines: %v", err)
	}
	input.BillLines[0].Remark = strings.Repeat("票", 1001)
	if _, err = validateDraft(EntityBillReceipt, input); err == nil {
		t.Fatal("accepted overlong bill line remark")
	}
	input.BillLines[0].Remark = ""
	input.BillCashLines[0].Remark = strings.Repeat("款", 1001)
	if _, err = validateDraft(EntityBillReceipt, input); err == nil {
		t.Fatal("accepted overlong bill cash line remark")
	}
}

func TestRoundedBillAmountUsesIntegerHalfUp(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		face       int64
		bps, days  int32
		wantAmount int64
	}{
		{name: "exact cent", face: 10_000, bps: 365, days: 1, wantAmount: 1},
		{name: "below half cent", face: 1, bps: 1, days: 1, wantAmount: 0},
		{name: "half cent rounds up", face: 1_825_000, bps: 1, days: 1, wantAmount: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := roundedBillAmount(test.face, test.bps, test.days)
			if err != nil || got != test.wantAmount {
				t.Fatalf("roundedBillAmount() = %d, %v; want %d", got, err, test.wantAmount)
			}
		})
	}
}

func TestBillReceiptRejectsDuplicateAndNonPositiveNet(t *testing.T) {
	t.Parallel()
	primary := billPrimary()
	input := DraftInput{
		BusinessDate: "2026-08-01", Currency: "CNY", Counterparty: refInput(),
		Handler: refInput(), BillLines: []BillLineInput{primary, primary},
	}
	if _, err := validateDraft(EntityBillReceipt, input); err == nil {
		t.Fatal("accepted duplicate bill business key")
	}
	input.BillLines = []BillLineInput{primary}
	input.BillCashLines = []BillCashLineInput{{
		FundAccount: *refInput(), Direction: "OUT", AmountType: "OTHER", Amount: "100.00",
	}}
	if _, err := validateDraft(EntityBillReceipt, input); err == nil {
		t.Fatal("accepted zero customer net settlement")
	}
}

func TestBillPaymentValidation(t *testing.T) {
	t.Parallel()
	availableBillID := "01J00000000000000000000003"
	input := DraftInput{
		BusinessDate: "2026-08-01", Currency: "CNY", Supplier: refInput(),
		BillLines: []BillLineInput{{BillID: availableBillID, Purpose: "PRIMARY"}},
	}
	draft, err := validateDraft(EntityBillPayment, input)
	if err != nil {
		t.Fatalf("validate bill payment: %v", err)
	}
	if len(draft.BillLines) != 1 || draft.BillLines[0].PositionType != "ASSET" || draft.BillLines[0].Direction != "OUT" {
		t.Fatalf("bill payment line = %+v", draft.BillLines)
	}
	input.Supplier = nil
	if _, err = validateDraft(EntityBillPayment, input); err == nil {
		t.Fatal("accepted bill payment without supplier")
	}
	input.Supplier = refInput()
	input.BillLines = []BillLineInput{{BillID: availableBillID, Purpose: "CHANGE"}}
	if _, err = validateDraft(EntityBillPayment, input); err == nil {
		t.Fatal("accepted bill payment change line")
	}
	input.BillLines = []BillLineInput{{BillID: availableBillID, Purpose: "PRIMARY"}, {BillID: availableBillID, Purpose: "PRIMARY"}}
	if _, err = validateDraft(EntityBillPayment, input); err == nil {
		t.Fatal("accepted duplicate payment bill")
	}
}

func TestBillIssueValidation(t *testing.T) {
	t.Parallel()
	line := billPrimary()
	line.PositionType, line.Direction = "LIABILITY", "IN"
	input := DraftInput{
		BusinessDate: "2026-08-01", Currency: "CNY", Supplier: refInput(), InterestMode: "THIRD_PARTY_PAYABLE",
		InterestParty: refInput(), BillLines: []BillLineInput{line},
		BillCashLines: []BillCashLineInput{{FundAccount: *refInput(), Direction: "IN", AmountType: "MARGIN", Amount: "1.00"}},
	}
	draft, err := validateDraft(EntityBillIssue, input)
	if err != nil || draft.TotalAmount != 10000 || draft.BillLines[0].BillID == "" || draft.BillLines[0].InterestAmount == 0 {
		t.Fatalf("validate bill issue = %+v, %v", draft, err)
	}
	input.InterestMode, input.InterestParty = "BANK_DEDUCTED", refInput()
	if _, err = validateDraft(EntityBillIssue, input); err == nil {
		t.Fatal("accepted interest party for bank deducted issue")
	}
	input.InterestMode, input.InterestParty = "THIRD_PARTY_PAYABLE", nil
	if _, err = validateDraft(EntityBillIssue, input); err == nil {
		t.Fatal("accepted third-party issue without interest party")
	}
	input.InterestParty = refInput()
	input.BillLines[0].PositionType = "ASSET"
	if _, err = validateDraft(EntityBillIssue, input); err == nil {
		t.Fatal("accepted non-liability bill issue line")
	}
}
