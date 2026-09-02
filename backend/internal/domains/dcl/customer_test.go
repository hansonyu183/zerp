package dcl

import (
	"strings"
	"testing"
)

func TestValidateCustomerDataRequiresOneEnabledDefault(t *testing.T) {
	base := CustomerDataInput{Kind: "MAINLAND_ENTERPRISE", LegalIdentifier: "91350211M000100Y46", LegalName: "客户", DefaultOperatingEntityID: "01JAVX00000000000000000001", Enabled: true, RemittanceProfiles: []CustomerRemittanceProfile{}, Accounts: []CustomerAccountDataInput{{Name: "账户", CustomerTypeID: "01JAVX00000000000000000002", PrimarySalesAttribution: CustomerSalesAttributionInput{Type: CustomerSalesAttributionInternalEmployee, SubjectObjectID: "01JAVX00000000000000000003"}}}}
	if _, err := validateCustomerData(base); err == nil {
		t.Fatal("enabled customer without default account must fail")
	}
	base.Accounts[0].IsDefault = true
	base.Accounts[0].Enabled = true
	if _, err := validateCustomerData(base); err != nil {
		t.Fatalf("one enabled default account should pass aggregate validation: %v", err)
	}
	base.Accounts = append(base.Accounts, base.Accounts[0])
	if _, err := validateCustomerData(base); err == nil {
		t.Fatal("multiple defaults must fail")
	}
}

func TestValidateCustomerAccountDataAllowsDistinctCurrencies(t *testing.T) {
	data, err := validateCustomerAccountData(CustomerAccountDataInput{Name: "账户", CustomerTypeID: "01JAVX00000000000000000002", PrimarySalesAttribution: CustomerSalesAttributionInput{Type: CustomerSalesAttributionInternalEmployee, SubjectObjectID: "01JAVX00000000000000000003"}, CreditLimits: []CustomerCreditLimit{{Currency: "CNY", Amount: "1"}, {Currency: "USD", Amount: "2.5"}}})
	if err != nil {
		t.Fatalf("multi-currency limits should be valid: %v", err)
	}
	if len(data.CreditLimits) != 2 || data.CreditLimits[1].Amount != "2.50" {
		t.Fatalf("credit limits were not normalized: %#v", data.CreditLimits)
	}
	data.CreditLimits = append(data.CreditLimits, CustomerCreditLimit{Currency: "CNY", Amount: "3"})
	if _, err = validateCustomerAccountData(data); err == nil {
		t.Fatal("duplicate currency must fail")
	}
}

func TestValidateCustomerDataCountsUnicodeCharactersAndChecksWireLimits(t *testing.T) {
	base := CustomerDataInput{
		Kind: "MAINLAND_ENTERPRISE", LegalIdentifier: "91350211M000100Y46", LegalName: strings.Repeat("客", 200), DefaultOperatingEntityID: "01JAVX00000000000000000001", Enabled: true,
		RemittanceProfiles: []CustomerRemittanceProfile{},
		Accounts:           []CustomerAccountDataInput{{Enabled: true, IsDefault: true, Name: strings.Repeat("账", 200), CustomerTypeID: "01JAVX00000000000000000002", PrimarySalesAttribution: CustomerSalesAttributionInput{Type: CustomerSalesAttributionInternalEmployee, SubjectObjectID: "01JAVX00000000000000000003"}}},
	}
	if _, err := validateCustomerData(base); err != nil {
		t.Fatalf("200 Unicode characters should satisfy maxLength=200: %v", err)
	}
	base.LegalName = strings.Repeat("客", 201)
	if _, err := validateCustomerData(base); err == nil {
		t.Fatal("201-character legal name should fail")
	}
	base.LegalName = "客户"
	base.InvoiceAddress = strings.Repeat("址", 501)
	if _, err := validateCustomerData(base); err == nil {
		t.Fatal("invoice address beyond the HTTP contract maximum should fail")
	}
}

func TestValidateCustomerDataRequiresPresentArraysAndAllowsMinimalRemittanceProfile(t *testing.T) {
	base := CustomerDataInput{
		Kind: "MAINLAND_ENTERPRISE", LegalIdentifier: "91350211M000100Y46", LegalName: "客户", DefaultOperatingEntityID: "01JAVX00000000000000000001", Enabled: true,
		RemittanceProfiles: []CustomerRemittanceProfile{{AccountName: "基本户"}},
		Accounts:           []CustomerAccountDataInput{{Enabled: true, IsDefault: true, Name: "账户", CustomerTypeID: "01JAVX00000000000000000002", PrimarySalesAttribution: CustomerSalesAttributionInput{Type: CustomerSalesAttributionInternalEmployee, SubjectObjectID: "01JAVX00000000000000000003"}}},
	}
	validated, err := validateCustomerData(base)
	if err != nil {
		t.Fatalf("account-name-only remittance profile should pass: %v", err)
	}
	if validated.RemittanceProfiles[0].BankName != "" || validated.RemittanceProfiles[0].AccountNumber != "" {
		t.Fatalf("optional remittance fields changed: %#v", validated.RemittanceProfiles[0])
	}
	base.LegalIdentifier = "invalid"
	if _, err = validateCustomerData(base); err == nil {
		t.Fatal("invalid mainland enterprise identifier must fail")
	}
	base.RemittanceProfiles = nil
	if _, err = validateCustomerData(base); err == nil {
		t.Fatal("missing remittanceProfiles array must fail before persistence")
	} else if domainErr, ok := err.(*DomainError); !ok || domainErr.ErrorKey != "validation_failed" {
		t.Fatalf("missing remittanceProfiles error = %#v", err)
	}
}
