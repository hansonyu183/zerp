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

func TestCustomerCreateAtomicallyCreatesGroupAndFirstAccountIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	service.SetAuxiliaryResolver(customerAuxiliaryResolverStub{})
	_, employee := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Name: "客户归属员工",
	}, "customer-master-employee")

	created, err := service.CustomerCreate(t.Context(), CustomerCreateInput{
		Group: CustomerGroupData{
			CompanyName: "华东园区采购有限公司",
			TaxNumber:   "91310000TESTCUSTOMER",
			BankAccounts: []CustomerGroupBankAccount{{
				AccountName: "华东园区采购有限公司", BankName: "测试银行",
				BankBranch: "上海支行", AccountNumber: "6222000000000001",
			}},
		},
		Data: CustomerAccountData{
			Name: "华东园区一号结算户", CustomerTypeCode: CustomerTypeEndUser,
			PricingPolicy: defaultPricingPolicy(),
			CreditLimits:  []CustomerCreditLimit{{Currency: "CNY", Amount: "50000.00"}},
			PrimarySalesAttribution: CustomerSalesAttributionInput{
				Type: SalesAttributionInternalEmployee, SubjectObjectID: employee.ObjectID,
			},
		},
	}, integrationActorOne, "customer-master-create")
	if err != nil {
		t.Fatalf("create customer master: %v", err)
	}
	var monthlyClosingDay *int32
	if err = pool.QueryRow(t.Context(), `
		SELECT monthly_closing_day FROM bob_customer_versions WHERE version_id=$1
	`, created.VersionID).Scan(&monthlyClosingDay); err != nil {
		t.Fatalf("read removed customer monthly closing day: %v", err)
	}
	if monthlyClosingDay != nil {
		t.Fatalf("monthly closing day = %d, want NULL", *monthlyClosingDay)
	}

	var groupCount, accountCount int
	if err = pool.QueryRow(t.Context(), `
		SELECT
			(SELECT count(*) FROM bob_customer_groups WHERE id=$1),
			(SELECT count(*) FROM bob_customer_accounts WHERE object_id=$2 AND group_id=$1)
	`, created.GroupID, created.ObjectID).Scan(&groupCount, &accountCount); err != nil {
		t.Fatalf("read customer aggregate counts: %v", err)
	}
	if groupCount != 1 || accountCount != 1 {
		t.Fatalf("group/account counts = %d/%d, want 1/1", groupCount, accountCount)
	}

	detail, err := service.CustomerGet(t.Context(), GetInput{ObjectID: created.ObjectID})
	if err != nil {
		t.Fatalf("get customer master: %v", err)
	}
	if detail.Group.Data.TaxNumber != "91310000TESTCUSTOMER" || detail.Candidate == nil {
		t.Fatalf("unexpected customer detail: %#v", detail)
	}
	if detail.Candidate.Data.PricingPolicy.DefaultPremiumUnitPrice != "0.00" {
		t.Fatalf("pricing policy not persisted: %#v", detail.Candidate.Data.PricingPolicy)
	}
}

func TestEffectiveCustomerIsReturnedByReferenceProjectionIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	service.SetAuxiliaryResolver(customerAuxiliaryResolverStub{})
	_, employee := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Name: "客户引用归属员工",
	}, "customer-reference-employee")
	_, operating := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{
		Name: "客户引用经营主体", TaxNumber: "91440300CUSTOMERREF",
	}, "customer-reference-operating")

	created, err := service.CustomerCreate(t.Context(), CustomerCreateInput{
		Group: CustomerGroupData{CompanyName: "客户引用集团", BankAccounts: []CustomerGroupBankAccount{}},
		Data: CustomerAccountData{
			Name: "客户引用结算户", CustomerTypeCode: CustomerTypeEndUser, OperatingEntityID: operating.ObjectID,
			SettlementMethodID: "01J00000000000000000000081", PaymentMethodID: "01J00000000000000000000082",
			DefaultTransportMethodCode: "SELF_PICKUP", DefaultTransportMethodName: "客户自提", TransportSurcharge: "0.00",
			PricingPolicy: defaultPricingPolicy(), CreditLimits: []CustomerCreditLimit{},
			PrimarySalesAttribution: CustomerSalesAttributionInput{
				Type: SalesAttributionInternalEmployee, SubjectObjectID: employee.ObjectID,
			},
		},
	}, integrationActorOne, "customer-reference-create")
	if err != nil {
		t.Fatalf("create customer reference fixture: %v", err)
	}
	submitted, err := service.Submit(t.Context(), EntityCustomer, VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, integrationActorOne, "customer-reference-submit")
	if err != nil {
		t.Fatalf("submit customer reference fixture: %v", err)
	}
	if _, err = service.Approve(t.Context(), EntityCustomer, ReviewInput{
		ObjectID: submitted.ObjectID, VersionID: submitted.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, "customer-reference-approve"); err != nil {
		t.Fatalf("approve customer reference fixture: %v", err)
	}

	candidates, err := service.QueryReferenceCandidates(t.Context(), ReferenceQueryInput{
		Entity: EntityCustomer, Keyword: "客户引用结算户",
	})
	if err != nil {
		t.Fatalf("query customer references: %v", err)
	}
	if len(candidates) != 1 || candidates[0].ObjectID != created.ObjectID || candidates[0].Name != "客户引用结算户" {
		t.Fatalf("customer reference candidates = %#v", candidates)
	}
}

func TestCustomerCreateAddsAnotherAccountToExistingGroupIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	service.SetAuxiliaryResolver(customerAuxiliaryResolverStub{})
	_, employee := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{Name: "多账户业务员"}, "customer-multi-account-employee")
	first, err := service.CustomerCreate(t.Context(), CustomerCreateInput{Group: CustomerGroupData{
		CompanyName: "同一付款集团有限公司", BankAccounts: []CustomerGroupBankAccount{},
	}, Data: CustomerAccountData{Name: "一号结算户", CustomerTypeCode: CustomerTypeEndUser,
		PricingPolicy: defaultPricingPolicy(), CreditLimits: []CustomerCreditLimit{{Currency: "CNY", Amount: "1000.00"}},
		PrimarySalesAttribution: CustomerSalesAttributionInput{Type: SalesAttributionInternalEmployee, SubjectObjectID: employee.ObjectID},
	}}, integrationActorOne, "customer-multi-account-first")
	if err != nil {
		t.Fatalf("create first account: %v", err)
	}
	second, err := service.CustomerCreate(t.Context(), CustomerCreateInput{GroupID: first.GroupID,
		Data: CustomerAccountData{Name: "二号结算户", CustomerTypeCode: CustomerTypeEndUser,
			PricingPolicy: defaultPricingPolicy(), CreditLimits: []CustomerCreditLimit{{Currency: "CNY", Amount: "2000.00"}},
			PrimarySalesAttribution: CustomerSalesAttributionInput{Type: SalesAttributionInternalEmployee, SubjectObjectID: employee.ObjectID},
		}}, integrationActorOne, "customer-multi-account-second")
	if err != nil {
		t.Fatalf("create second account: %v", err)
	}
	if second.GroupID != first.GroupID || second.ObjectID == first.ObjectID {
		t.Fatalf("second account not linked to existing group: first=%#v second=%#v", first, second)
	}
	var accountCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM bob_customer_accounts WHERE group_id=$1`, first.GroupID).Scan(&accountCount); err != nil {
		t.Fatalf("count accounts: %v", err)
	}
	if accountCount != 2 {
		t.Fatalf("account count = %d, want 2", accountCount)
	}
}

func TestCustomerCandidateKeepsEffectiveVersionUntilAtomicApprovalIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	service.SetAuxiliaryResolver(customerAuxiliaryResolverStub{})
	_, employee := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{Name: "连续生效业务员"}, "customer-candidate-employee")
	_, operating := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{
		Name: "深圳经营主体有限公司", TaxNumber: "91440300CUSTOMEROPE",
	}, "customer-candidate-operating")
	created, err := service.CustomerCreate(t.Context(), CustomerCreateInput{Group: CustomerGroupData{
		CompanyName: "连续生效集团有限公司", BankAccounts: []CustomerGroupBankAccount{},
	}, Data: CustomerAccountData{
		Name: "连续生效账户", CustomerTypeCode: CustomerTypeEndUser, OperatingEntityID: operating.ObjectID,
		SettlementMethodID: "01J00000000000000000000081", PaymentMethodID: "01J00000000000000000000082",
		DefaultTransportMethodCode: "SELF_PICKUP", DefaultTransportMethodName: "客户自提", TransportSurcharge: "0.00",
		PricingPolicy: defaultPricingPolicy(), CreditLimits: []CustomerCreditLimit{{Currency: "CNY", Amount: "1000.00"}},
		PrimarySalesAttribution: CustomerSalesAttributionInput{Type: SalesAttributionInternalEmployee, SubjectObjectID: employee.ObjectID},
	}}, integrationActorOne, "customer-candidate-create")
	if err != nil {
		t.Fatalf("create customer: %v", err)
	}
	pending, err := service.Submit(t.Context(), EntityCustomer, VersionRevisionInput{ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision}, integrationActorOne, "customer-candidate-submit-v1")
	if err != nil {
		t.Fatalf("submit first version: %v", err)
	}
	effective, err := service.Approve(t.Context(), EntityCustomer, ReviewInput{ObjectID: created.ObjectID, VersionID: pending.VersionID, Revision: pending.Revision}, integrationActorTwo, "customer-candidate-approve-v1")
	if err != nil {
		t.Fatalf("approve first version: %v", err)
	}
	detail, err := service.CustomerGet(t.Context(), GetInput{ObjectID: created.ObjectID})
	if err != nil || detail.Effective == nil || detail.Candidate != nil {
		t.Fatalf("read first effective version: detail=%#v err=%v", detail, err)
	}
	changed := detail.Effective.Data
	changed.Name = "连续生效账户二版"
	candidate, err := service.CustomerSave(t.Context(), CustomerSaveInput{ObjectID: created.ObjectID,
		VersionID: effective.VersionID, Revision: effective.Revision, GroupRevision: detail.Group.Revision,
		Group: detail.Group.Data, Data: changed}, integrationActorOne, "customer-candidate-save-v2")
	if err != nil {
		t.Fatalf("create candidate: %v", err)
	}
	detail, err = service.CustomerGet(t.Context(), GetInput{ObjectID: created.ObjectID})
	if err != nil || detail.Effective == nil || detail.Candidate == nil || detail.Effective.Data.Name != "连续生效账户" {
		t.Fatalf("effective version was not preserved: detail=%#v err=%v", detail, err)
	}
	pending, err = service.Submit(t.Context(), EntityCustomer, VersionRevisionInput{ObjectID: created.ObjectID,
		VersionID: candidate.VersionID, Revision: candidate.Revision}, integrationActorOne, "customer-candidate-submit-v2")
	if err != nil {
		t.Fatalf("submit candidate: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntityCustomer, ReviewInput{ObjectID: created.ObjectID,
		VersionID: pending.VersionID, Revision: pending.Revision}, integrationActorTwo, "customer-candidate-approve-v2")
	if err != nil {
		t.Fatalf("approve candidate: %v", err)
	}
	detail, err = service.CustomerGet(t.Context(), GetInput{ObjectID: created.ObjectID})
	if err != nil || detail.Effective == nil || detail.Candidate != nil || detail.Effective.Data.Name != "连续生效账户二版" {
		t.Fatalf("candidate did not become effective: detail=%#v err=%v", detail, err)
	}
	changed = detail.Effective.Data
	changed.Name = "应放弃的三版"
	candidate, err = service.CustomerSave(t.Context(), CustomerSaveInput{ObjectID: created.ObjectID,
		VersionID: approved.VersionID, Revision: approved.Revision, GroupRevision: detail.Group.Revision,
		Group: detail.Group.Data, Data: changed}, integrationActorOne, "customer-candidate-save-v3")
	if err != nil {
		t.Fatalf("create removable candidate: %v", err)
	}
	if err = service.Delete(t.Context(), EntityCustomer, DeleteInput{ObjectID: created.ObjectID,
		ObjectRevision: candidate.ObjectRevision, VersionID: candidate.VersionID, Revision: candidate.Revision}); err != nil {
		t.Fatalf("delete candidate: %v", err)
	}
	detail, err = service.CustomerGet(t.Context(), GetInput{ObjectID: created.ObjectID})
	if err != nil || detail.Candidate != nil || detail.Effective == nil || detail.Effective.Data.Name != "连续生效账户二版" {
		t.Fatalf("effective version was not restored: detail=%#v err=%v", detail, err)
	}
}
