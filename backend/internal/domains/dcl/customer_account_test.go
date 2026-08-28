package dcl

import (
	"testing"
)

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

func TestAccountUpdateParamsCarriesAuxiliarySnapshotCodes(t *testing.T) {
	t.Parallel()
	data := CustomerAccountData{
		CustomerAccountDataInput: CustomerAccountDataInput{Name: "客户账户", CustomerTypeID: "customer-type", PricingPolicy: CustomerPricingPolicy{}},
		CustomerType:             &CustomerAuxiliarySnapshot{SourceObjectID: "customer-type", Code: "DIT-0001", Name: "终端客户"},
		OperatingEntityID:        "operating-entity",
		OperatingEntity:          &CustomerSnapshot{SourceObjectID: "operating-entity", ApprovalEntryID: "operating-entry", Code: "OPE-0001", Name: "经营主体"},
		SettlementMethod:         &CustomerAuxiliarySnapshot{SourceObjectID: "settlement", Code: "SET-0002", Name: "月结"},
		PaymentMethod:            &CustomerAuxiliarySnapshot{SourceObjectID: "payment", Code: "PMT-0002", Name: "转账"},
	}
	params, err := accountUpdateParams("account-entry", true, data)
	if err != nil {
		t.Fatal(err)
	}
	if params.SettlementMethodCode == nil || *params.SettlementMethodCode != "SET-0002" || params.PaymentMethodCode == nil || *params.PaymentMethodCode != "PMT-0002" {
		t.Fatalf("snapshot codes were not copied: settlement=%v payment=%v", params.SettlementMethodCode, params.PaymentMethodCode)
	}
}
