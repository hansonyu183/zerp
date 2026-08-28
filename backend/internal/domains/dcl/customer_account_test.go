package dcl

import "testing"

func TestValidateCustomerAccountDataRejectsInvalidAttribution(t *testing.T) {
	_, err := validateCustomerAccountData(CustomerAccountDataInput{
		Name:           "North plant",
		CustomerTypeID: "01JAVX00000000000000000005",
		PricingPolicy:  CustomerPricingPolicy{},
		CreditLimits:   []CustomerCreditLimit{},
		PrimarySalesAttribution: CustomerSalesAttributionInput{
			Type: "UNKNOWN", SubjectObjectID: "01J00000000000000000000000",
		},
	})
	if err == nil {
		t.Fatal("expected invalid attribution to be rejected")
	}
}

func TestValidateCustomerAccountDataNormalizesMoneyAndCreditLimits(t *testing.T) {
	data, err := validateCustomerAccountData(CustomerAccountDataInput{
		Name:                    " North plant ",
		CustomerTypeID:          " 01JAVX00000000000000000005 ",
		TransportSurcharge:      "1",
		PricingPolicy:           CustomerPricingPolicy{DefaultPremiumUnitPrice: "1", DefaultDiscountUnitPrice: "0", ThirdPartyIntermediaryFixedUnitCost: "0", ThirdPartyIntermediaryVariableUnitCost: "0", CostItems: []CustomerPricingCostItem{}},
		CreditLimits:            []CustomerCreditLimit{{Currency: "CNY", Amount: "100"}},
		PrimarySalesAttribution: CustomerSalesAttributionInput{Type: CustomerSalesAttributionInternalEmployee, SubjectObjectID: "01J00000000000000000000000"},
	})
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if data.Name != "North plant" || data.TransportSurcharge != "1.00" || data.CreditLimits[0].Amount != "100.00" {
		t.Fatalf("unexpected normalized data: %#v", data)
	}
}
