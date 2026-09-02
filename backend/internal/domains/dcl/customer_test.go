package dcl

import (
	"strings"
	"testing"
)

func customerRootForTest() CustomerRootDataInput {
	return CustomerRootDataInput{Kind: "MAINLAND_ENTERPRISE", LegalIdentifier: "91350211M000100Y46", LegalName: "客户", DefaultOperatingEntityID: "01JAVX00000000000000000001", Enabled: true, RemittanceProfiles: []CustomerRemittanceProfile{}}
}

func customerSubunitForTest() CustomerSubunitDataInput {
	return CustomerSubunitDataInput{Name: "子单位", CustomerTypeID: "01JAVX00000000000000000002", PrimarySalesAttribution: CustomerSalesAttributionInput{Type: CustomerSalesAttributionInternalEmployee, SubjectObjectID: "01JAVX00000000000000000003"}}
}

func TestValidateCustomerSubunitsRequiresEnabledSubunitForEnabledCustomer(t *testing.T) {
	if _, err := validateCustomerSubunits([]CustomerSubunitDataInput{customerSubunitForTest()}, true); err == nil {
		t.Fatal("enabled customer without enabled subunit must fail")
	}
	subunit := customerSubunitForTest()
	subunit.Enabled = true
	if _, err := validateCustomerSubunits([]CustomerSubunitDataInput{subunit}, true); err != nil {
		t.Fatalf("one enabled subunit should pass aggregate validation: %v", err)
	}
	if _, err := validateCustomerSubunits([]CustomerSubunitDataInput{subunit, subunit}, true); err != nil {
		t.Fatalf("multiple new subunits without assigned ids should pass validation: %v", err)
	}
	subunit.SubunitID = "01JAVX00000000000000000004"
	if _, err := validateCustomerSubunits([]CustomerSubunitDataInput{subunit, subunit}, true); err == nil {
		t.Fatal("duplicate subunit ids must fail")
	}
}

func TestValidateCustomerSubunitDataAllowsDistinctCurrencies(t *testing.T) {
	data, err := validateCustomerSubunitData(CustomerSubunitDataInput{Name: "账户", CustomerTypeID: "01JAVX00000000000000000002", PrimarySalesAttribution: CustomerSalesAttributionInput{Type: CustomerSalesAttributionInternalEmployee, SubjectObjectID: "01JAVX00000000000000000003"}, CreditLimits: []CustomerCreditLimit{{Currency: "CNY", Amount: "1"}, {Currency: "USD", Amount: "2.5"}}})
	if err != nil {
		t.Fatalf("multi-currency limits should be valid: %v", err)
	}
	if len(data.CreditLimits) != 2 || data.CreditLimits[1].Amount != "2.50" {
		t.Fatalf("credit limits were not normalized: %#v", data.CreditLimits)
	}
	data.CreditLimits = append(data.CreditLimits, CustomerCreditLimit{Currency: "CNY", Amount: "3"})
	if _, err = validateCustomerSubunitData(data); err == nil {
		t.Fatal("duplicate currency must fail")
	}
}

func TestValidateCustomerRootCountsUnicodeCharactersAndChecksWireLimits(t *testing.T) {
	base := customerRootForTest()
	base.LegalName = strings.Repeat("客", 200)
	if _, err := validateCustomerRootData(base); err != nil {
		t.Fatalf("200 Unicode characters should satisfy maxLength=200: %v", err)
	}
	base.LegalName = strings.Repeat("客", 201)
	if _, err := validateCustomerRootData(base); err == nil {
		t.Fatal("201-character legal name should fail")
	}
	base.LegalName = "客户"
	base.InvoiceAddress = strings.Repeat("址", 501)
	if _, err := validateCustomerRootData(base); err == nil {
		t.Fatal("invoice address beyond the HTTP contract maximum should fail")
	}
}

func TestValidateCustomerRootRequiresPresentArraysAndAllowsMinimalRemittanceProfile(t *testing.T) {
	base := customerRootForTest()
	base.RemittanceProfiles = []CustomerRemittanceProfile{{AccountName: "基本户"}}
	validated, err := validateCustomerRootData(base)
	if err != nil {
		t.Fatalf("account-name-only remittance profile should pass: %v", err)
	}
	if validated.RemittanceProfiles[0].BankName != "" || validated.RemittanceProfiles[0].AccountNumber != "" {
		t.Fatalf("optional remittance fields changed: %#v", validated.RemittanceProfiles[0])
	}
	base.LegalIdentifier = "invalid"
	if _, err = validateCustomerRootData(base); err == nil {
		t.Fatal("invalid mainland enterprise identifier must fail")
	}
	base.RemittanceProfiles = nil
	if _, err = validateCustomerRootData(base); err == nil {
		t.Fatal("missing remittanceProfiles array must fail before persistence")
	} else if domainErr, ok := err.(*DomainError); !ok || domainErr.ErrorKey != "validation_failed" {
		t.Fatalf("missing remittanceProfiles error = %#v", err)
	}
}
