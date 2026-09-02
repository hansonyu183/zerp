package vou

import "testing"

func TestSalesReceiptRequiresExactPositiveSubunitAllocations(t *testing.T) {
	t.Parallel()
	input := DraftInput{
		BusinessDate: "2026-09-01", Currency: "CNY", Customer: refInput(),
		OperatingEntity: refInput(), FundAccount: refInput(), Handler: refInput(), Amount: "100.00",
		SubunitAllocations: []SalesReceiptSubunitAllocationInput{
			{Subunit: *refInput(), Amount: "60.00"},
			{Subunit: ReferenceInput{ObjectID: "01J00000000000000000000003", ApprovalEntryID: testApprovalEntryID}, Amount: "40.00"},
		},
	}
	draft, err := validateDraft(EntitySalesReceipt, input)
	if err != nil {
		t.Fatalf("validate sales receipt: %v", err)
	}
	if draft.TotalAmount != 10000 || len(draft.SubunitAllocations) != 2 {
		t.Fatalf("sales receipt draft = %+v", draft)
	}

	for _, mutate := range []func(*DraftInput){
		func(v *DraftInput) { v.SubunitAllocations[1].Subunit.ObjectID = testObjectID },
		func(v *DraftInput) { v.SubunitAllocations[1].Amount = "0" },
		func(v *DraftInput) { v.SubunitAllocations[1].Amount = "39.99" },
		func(v *DraftInput) { v.OperatingEntity = nil },
		func(v *DraftInput) { v.Customer = nil },
		func(v *DraftInput) { v.Counterparty = refInput() },
	} {
		candidate := input
		candidate.SubunitAllocations = append([]SalesReceiptSubunitAllocationInput(nil), input.SubunitAllocations...)
		mutate(&candidate)
		if _, err := validateDraft(EntitySalesReceipt, candidate); err == nil {
			t.Fatal("invalid sales receipt draft was accepted")
		}
	}
}
