package acc

import "testing"

func TestRelationshipDimensionsReplaceLegacyCounterpartyDimensions(t *testing.T) {
	for _, dimension := range []string{
		DimensionCustomerAccount,
		DimensionSupplierRelationship,
		DimensionServiceRelationship,
		DimensionEmploymentRelationship,
		DimensionSalesRelationship,
	} {
		_, err := normalizeSubject(CreateSubjectInput{
			Code: "2241", Name: "其他往来", BalanceDirection: BalanceDirectionCredit,
			Enabled: true, RequiredDimensions: []string{dimension}, SettlementPurpose: SettlementPurposeOther,
		})
		if err != nil {
			t.Fatalf("relationship dimension %s was rejected: %v", dimension, err)
		}
	}
	for _, legacy := range []string{"CUSTOMER", "SUPPLIER", "OTHER_PARTY", "EMPLOYEE"} {
		_, err := normalizeSubject(CreateSubjectInput{
			Code: "2241", Name: "旧往来", BalanceDirection: BalanceDirectionCredit,
			Enabled: true, RequiredDimensions: []string{legacy}, SettlementPurpose: SettlementPurposeOther,
		})
		if !IsKind(err, ErrorValidation) {
			t.Fatalf("legacy dimension %s error = %v", legacy, err)
		}
	}
}

func TestTradeSettlementPurposesRequireTypedTransactionIdentity(t *testing.T) {
	cases := []struct {
		purpose, dimension string
	}{
		{SettlementPurposeReceivable, DimensionCustomerAccount},
		{SettlementPurposeAdvanceReceipt, DimensionCustomerAccount},
		{SettlementPurposePayable, DimensionSupplierRelationship},
		{SettlementPurposePrepaid, DimensionSupplierRelationship},
	}
	for _, tc := range cases {
		_, err := normalizeSubject(CreateSubjectInput{
			Code: "2202", Name: "往来", BalanceDirection: BalanceDirectionCredit,
			Enabled: true, RequiredDimensions: []string{tc.dimension}, SettlementPurpose: tc.purpose,
		})
		if err != nil {
			t.Fatalf("%s with %s was rejected: %v", tc.purpose, tc.dimension, err)
		}
	}
}
