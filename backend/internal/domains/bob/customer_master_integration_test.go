//go:build integration

package bob

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
)

type customerAuxiliaryResolverStub struct{}

func defaultPricingPolicy() PricingPolicy {
	return PricingPolicy{
		DefaultPremiumUnitPrice:                "0.00",
		DefaultDiscountUnitPrice:               "0.00",
		CostItems:                              []PricingCostItem{},
		ThirdPartyIntermediaryFixedUnitCost:    "0.00",
		ThirdPartyIntermediaryVariableUnitCost: "0.00",
	}
}

func (customerAuxiliaryResolverStub) ResolveAuxiliaryReference(
	_ context.Context, _ pgx.Tx, entity, objectID, _ string,
) (AuxiliaryReference, error) {
	data := map[string]any{"name": "银行转账", "defaultSalesSurcharge": "0.00"}
	code := "PAY-0001"
	if entity == "settlement-method" {
		code = "STM-0001"
		data = map[string]any{"name": "月结30天", "termCode": "MONTHLY_30", "ruleType": "MONTH_END",
			"dueDays": 0, "monthOffset": 1, "cutoffDay": 0, "defaultSalesSurcharge": "0.00"}
	}
	return AuxiliaryReference{ObjectID: objectID, VersionID: "01J00000000000000000000091", Entity: entity, Code: code, Data: data}, nil
}

func (customerAuxiliaryResolverStub) ResolveAuxiliaryCode(
	_ context.Context, _ pgx.Tx, entity, code string,
) (AuxiliaryReference, error) {
	return AuxiliaryReference{ObjectID: "01J00000000000000000000092", VersionID: "01J00000000000000000000093",
		Entity: entity, Code: code, Data: map[string]any{"dictionaryTypeCode": "DCT-0001", "name": "终端客户"}}, nil
}

func TestCustomerCreateAtomicallyCreatesRelationshipAndFirstAccountIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool, customerAuxiliaryResolverStub{})
	_, employee := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{Name: "客户归属员工"}, "customer-master-employee")
	_, operating := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{Name: "客户经营主体"}, "customer-master-operating")
	created, err := service.CustomerCreate(t.Context(), CustomerCreateInput{
		NewParty: &PartyCreateData{Kind: PartyKindOrganization, LegalName: "客户主体", TaxNumber: "91310000TESTCUSTOMER"},
		Data:     CustomerAccountData{Name: "首个结算户", CustomerTypeCode: CustomerTypeEndUser, OperatingEntityID: operating.ObjectID, PricingPolicy: defaultPricingPolicy(), CreditLimits: []CustomerCreditLimit{}, PrimarySalesAttribution: CustomerSalesAttributionInput{Type: SalesAttributionInternalEmployee, SubjectObjectID: employee.ObjectID}},
	}, integrationActorOne, "customer-master-create", true)
	if err != nil {
		t.Fatalf("create customer relationship: %v", err)
	}
	if created.DefaultAccount.ObjectID == "" || created.PartyID == "" {
		t.Fatalf("missing atomic relationship/account result: %#v", created)
	}
	page, err := service.CustomerQuery(t.Context(), QueryInput{
		Page:     1,
		PageSize: 20,
		Filters:  QueryFilters{Keyword: "首个结算户"},
	})
	if err != nil {
		t.Fatalf("query draft customer account: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ObjectID != created.DefaultAccount.ObjectID {
		t.Fatalf("draft customer account query = %#v, want %s", page.Items, created.DefaultAccount.ObjectID)
	}
	detail, err := service.CustomerGet(t.Context(), GetInput{ObjectID: created.ObjectID})
	if err != nil {
		t.Fatalf("get customer relationship: %v", err)
	}
	if len(detail.Accounts) != 1 {
		t.Fatalf("accounts=%d, want 1", len(detail.Accounts))
	}
	second, err := service.CustomerAccountAdd(t.Context(), CustomerAccountAddInput{CustomerRelationshipID: created.ObjectID, Data: CustomerAccountData{Name: "第二结算户", CustomerTypeCode: CustomerTypeEndUser, OperatingEntityID: operating.ObjectID, PricingPolicy: defaultPricingPolicy(), CreditLimits: []CustomerCreditLimit{}, PrimarySalesAttribution: CustomerSalesAttributionInput{Type: SalesAttributionInternalEmployee, SubjectObjectID: employee.ObjectID}}}, integrationActorOne, "customer-account-add")
	if err != nil {
		t.Fatalf("add customer account: %v", err)
	}
	if second.ObjectID == "" {
		t.Fatal("added account id is empty")
	}
}

func TestCustomerAccountSubmitValidatesSalesRelationshipAttributionIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool, customerAuxiliaryResolverStub{})
	_, operating := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{Name: "外部归属经营主体"}, "customer-sales-operating")
	partner, err := service.SalesPartnerCreate(t.Context(), SalesPartnerCreateInput{
		NewParty: &PartyCreateData{Kind: PartyKindPerson, LegalName: "外部兼职销售"},
		Data: SalesPartnerData{OperatingEntityID: operating.ObjectID,
			Capabilities: []string{SalesCapabilityExternalPartTime}},
	}, integrationActorOne, "customer-sales-partner-create", true)
	if err != nil {
		t.Fatalf("create sales relationship: %v", err)
	}
	submittedPartner, err := service.Submit(t.Context(), EntitySalesPartner, VersionRevisionInput{
		ObjectID: partner.ObjectID, VersionID: partner.VersionID, Revision: partner.Revision,
	}, integrationActorOne, "customer-sales-partner-submit")
	if err != nil {
		t.Fatalf("submit sales relationship: %v", err)
	}
	if _, err = service.Approve(t.Context(), EntitySalesPartner, ReviewInput{
		ObjectID: submittedPartner.ObjectID, VersionID: submittedPartner.VersionID, Revision: submittedPartner.Revision,
	}, integrationActorTwo, "customer-sales-partner-approve"); err != nil {
		t.Fatalf("approve sales relationship: %v", err)
	}

	created, err := service.CustomerCreate(t.Context(), CustomerCreateInput{
		NewParty: &PartyCreateData{Kind: PartyKindOrganization, LegalName: "外部归属客户"},
		Data: CustomerAccountData{
			Name: "外部归属结算户", CustomerTypeCode: CustomerTypeEndUser,
			OperatingEntityID:          operating.ObjectID,
			SettlementMethodID:         "01J00000000000000000000094",
			PaymentMethodID:            "01J00000000000000000000095",
			DefaultTransportMethodCode: "SELF_PICKUP", DefaultTransportMethodName: "客户自提",
			TransportSurcharge: "0.00", PricingPolicy: defaultPricingPolicy(), CreditLimits: []CustomerCreditLimit{},
			PrimarySalesAttribution: CustomerSalesAttributionInput{Type: SalesAttributionExternalPartTime, SubjectObjectID: partner.ObjectID},
		},
	}, integrationActorOne, "customer-external-create", true)
	if err != nil {
		t.Fatalf("create externally attributed customer: %v", err)
	}
	account := created.DefaultAccount
	if account.Candidate == nil {
		t.Fatal("created account has no candidate version")
	}
	if _, err = service.Submit(t.Context(), EntityCustomerAccount, VersionRevisionInput{
		ObjectID: account.ObjectID, VersionID: account.Candidate.Version.VersionID, Revision: account.Candidate.Version.Revision,
	}, integrationActorOne, "customer-external-submit"); err != nil {
		t.Fatalf("submit externally attributed account: %v", err)
	}
}
