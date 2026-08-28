//go:build integration

package vou

import (
	"errors"
	"testing"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
)

func TestServiceContractsAcceptanceAndSalesContractSelectionIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	bobService := newBOBIntegrationService(pool)
	bus := txevent.NewBus()
	parties := dcldomain.NewPartyService(pool, bobdomain.NewPartyCurrentWriter(pool), bobdomain.NewPartyCurrentReader(pool), bobdomain.NewPartyMergeEngine(pool), authorization.Func(nil), bus)
	relationships := dcldomain.NewRelationshipService(pool, bobService, parties, bobdomain.NewPartyCurrentReader(pool), authorization.Func(nil), bus)
	accounts := dcldomain.NewCustomerAccountService(pool, bobService, authorization.Func(nil), bus)
	service := newIntegrationService(t, pool)

	serviceContract := approveServiceContractIntegration(t, service, DraftInput{
		BusinessDate: "2026-08-01", Currency: "CNY", CounterpartyType: bobdomain.EntityOtherUnit,
		Counterparty: &refs.carrier, Handler: &refs.employee,
		ServiceContract: &ServiceContractInput{Terms: "财税顾问服务，以履约验收确认结算事实"},
	}, "service-contract")
	acceptance, err := service.Create(t.Context(), EntityServiceAcceptance, CreateInput{Data: DraftInput{
		BusinessDate: "2026-08-10", Currency: "CNY", Amount: "1200.00",
		ServiceAcceptance: &ServiceAcceptanceInput{ContractDocumentID: serviceContract.DocumentID,
			ServiceDate: "2026-08-01", AcceptanceDate: "2026-08-10", SettlementDirection: "PAYABLE",
			FulfillmentFact: "已完成月度申报", AcceptanceFact: "验收通过"},
	}}, integrationApprovalActor(t, integrationActorOne, "service-acceptance-create"))
	if err != nil {
		t.Fatalf("create service acceptance: %v", err)
	}
	checked, err := service.Submit(t.Context(), EntityServiceAcceptance, DocumentRevisionInput{
		DocumentID: acceptance.DocumentID, Revision: acceptance.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "service-acceptance-check"))
	if err != nil {
		t.Fatalf("check service acceptance: %v", err)
	}
	if _, err = service.Approve(t.Context(), EntityServiceAcceptance, DocumentRevisionInput{
		DocumentID: checked.DocumentID, Revision: checked.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorTwo, "service-acceptance-approve")); err != nil {
		t.Fatalf("approve service acceptance: %v", err)
	}

	var customerRelationshipID, customerPartyID, operatingEntityID string
	if err = pool.QueryRow(t.Context(), `
		SELECT relationship.object_id,relationship.party_id,relationship.operating_entity_id
		FROM bob_customer_accounts account
		JOIN bob_customer_relationships relationship ON relationship.object_id=account.customer_relationship_id
		WHERE account.object_id=$1
	`, refs.customer.ObjectID).Scan(&customerRelationshipID, &customerPartyID, &operatingEntityID); err != nil {
		t.Fatalf("load customer relationship identity: %v", err)
	}
	party, err := parties.Get(t.Context(), dcldomain.PartyGetInput{PartyID: customerPartyID}, bobdomain.PartyRelationshipVisibility{}, trustedIntegrationActor(t, "customer-party-get"))
	if err != nil {
		t.Fatalf("get customer Party declaration: %v", err)
	}
	if party.Approval.Status != "APPROVED" {
		pendingParty, submitErr := parties.Submit(t.Context(), dcldomain.PartyVersionInput{PartyID: customerPartyID, ApprovalEntryID: party.Approval.ApprovalEntryID, ApprovalRevision: party.Approval.Revision}, trustedIntegrationActor(t, "customer-party-submit"))
		if submitErr != nil {
			t.Fatalf("submit customer Party declaration: %v", submitErr)
		}
		if _, err = parties.Approve(t.Context(), dcldomain.PartyVersionInput{PartyID: customerPartyID, ApprovalEntryID: pendingParty.Approval.ApprovalEntryID, ApprovalRevision: pendingParty.Approval.Revision}, trustedIntegrationActor(t, "customer-party-approve")); err != nil {
			t.Fatalf("approve customer Party declaration: %v", err)
		}
	}
	salesPartner, err := relationships.CreateSalesPartner(t.Context(), dcldomain.SalesPartnerCreateInput{
		PartyID:           customerPartyID,
		OperatingEntityID: operatingEntityID,
		Data: dcldomain.SalesPartnerData{
			Capabilities: []string{bobdomain.SalesCapabilityChannelPartner}},
	}, trustedIntegrationActor(t, "customer-channel-create"))
	if err != nil {
		t.Fatalf("create channel relationship on customer Party: %v", err)
	}
	submitted, err := relationships.SubmitSalesPartner(t.Context(), dcldomain.RelationshipVersionInput{
		ObjectID: salesPartner.ObjectID, ApprovalEntryID: salesPartner.Approval.ApprovalEntryID, ApprovalRevision: salesPartner.Approval.Revision,
	}, trustedIntegrationActor(t, "customer-channel-submit"))
	if err != nil {
		t.Fatalf("submit channel relationship: %v", err)
	}
	approvedSalesPartner, err := relationships.ApproveSalesPartner(t.Context(), dcldomain.RelationshipVersionInput{
		ObjectID: submitted.ObjectID, ApprovalEntryID: submitted.Approval.ApprovalEntryID, ApprovalRevision: submitted.Approval.Revision,
	}, trustedIntegrationActor(t, "customer-channel-approve"))
	if err != nil {
		t.Fatalf("approve channel relationship: %v", err)
	}
	if _, err = accounts.Create(t.Context(), dcldomain.CustomerAccountCreateInput{
		CustomerRelationshipID: customerRelationshipID,
		Data: dcldomain.CustomerAccountDataInput{
			Name: "禁止自归属账户", CustomerTypeCode: bobdomain.CustomerTypeEndUser,
			PricingPolicy: dcldomain.CustomerPricingPolicy{
				DefaultPremiumUnitPrice: "0.00", DefaultDiscountUnitPrice: "0.00",
				ThirdPartyIntermediaryFixedUnitCost: "0.00", ThirdPartyIntermediaryVariableUnitCost: "0.00",
				CostItems: []dcldomain.CustomerPricingCostItem{},
			},
			CreditLimits: []dcldomain.CustomerCreditLimit{},
			PrimarySalesAttribution: dcldomain.CustomerSalesAttributionInput{
				Type: dcldomain.CustomerSalesAttributionChannelPartner, SubjectObjectID: approvedSalesPartner.ObjectID,
			},
		},
	}, trustedIntegrationActor(t, "customer-channel-self-attribution")); err == nil {
		t.Fatal("customer account accepted its own Party sales relationship attribution")
	}
	salesReference := ReferenceInput{ObjectID: approvedSalesPartner.ObjectID, ApprovalEntryID: approvedSalesPartner.Approval.ApprovalEntryID}
	contractStatus, contractSnapshot, err := service.intermediarySalesContract(t.Context(), dbsqlc.New(pool),
		bobdomain.SalesCapabilityChannelPartner, salesReference.ObjectID,
		time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC))
	if err != nil || contractStatus != "MISSING" || contractSnapshot != nil {
		t.Fatalf("missing sales contract = status:%s snapshot:%#v err:%v", contractStatus, contractSnapshot, err)
	}
	approveServiceContractIntegration(t, service, DraftInput{
		BusinessDate: "2026-01-01", Currency: "CNY", CounterpartyType: bobdomain.EntitySalesPartner,
		Counterparty: &salesReference, Handler: &refs.employee,
		ServiceContract: &ServiceContractInput{Capabilities: []string{bobdomain.SalesCapabilityChannelPartner},
			ApplicableFrom: "2026-01-01", Terms: "基础渠道合作"},
	}, "sales-contract-old")
	latestContract := approveServiceContractIntegration(t, service, DraftInput{
		BusinessDate: "2026-06-01", Currency: "CNY", CounterpartyType: bobdomain.EntitySalesPartner,
		Counterparty: &salesReference, Handler: &refs.employee,
		ServiceContract: &ServiceContractInput{Capabilities: []string{bobdomain.SalesCapabilityChannelPartner},
			ApplicableFrom: "2026-06-01", Terms: "最新版渠道合作"},
	}, "sales-contract-latest")

	selected, err := service.SelectLatestSalesContract(t.Context(), dbsqlc.New(pool), salesReference.ObjectID,
		bobdomain.SalesCapabilityChannelPartner, time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC))
	if err != nil || selected.DocumentID != latestContract.DocumentID {
		t.Fatalf("selected sales contract = %s, err=%v, want %s", selected.DocumentID, err, latestContract.DocumentID)
	}
	contractStatus, contractSnapshot, err = service.intermediarySalesContract(t.Context(), dbsqlc.New(pool),
		bobdomain.SalesCapabilityChannelPartner, salesReference.ObjectID,
		time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC))
	if err != nil || contractStatus != "APPLICABLE" || contractSnapshot == nil ||
		contractSnapshot.DocumentID != latestContract.DocumentID {
		t.Fatalf("applicable sales contract = status:%s snapshot:%#v err:%v", contractStatus, contractSnapshot, err)
	}
	payment, err := service.Create(t.Context(), EntityOtherPayment, CreateInput{Data: DraftInput{
		BusinessDate: "2026-08-12", Currency: "CNY", Amount: "100.00",
		CounterpartyType: bobdomain.EntitySalesPartner, Counterparty: &salesReference,
		FundAccount: &refs.fundAccount, Handler: &refs.employee, OtherCategory: "COMMISSION",
	}}, integrationApprovalActor(t, integrationActorOne, "sales-partner-payment-create"))
	if err != nil {
		t.Fatalf("create sales relationship payment: %v", err)
	}
	var paymentCounterpartyEntity, paymentCounterpartyObjectID string
	if err = pool.QueryRow(t.Context(), `
		SELECT counterparty_entity,counterparty_object_id
		FROM vou_payment_details WHERE document_id=$1
	`, payment.DocumentID).Scan(&paymentCounterpartyEntity, &paymentCounterpartyObjectID); err != nil {
		t.Fatalf("read sales relationship payment: %v", err)
	}
	if paymentCounterpartyEntity != bobdomain.EntitySalesPartner || paymentCounterpartyObjectID != approvedSalesPartner.ObjectID {
		t.Fatalf("payment counterparty=%s/%s, want sales relationship %s", paymentCounterpartyEntity, paymentCounterpartyObjectID, approvedSalesPartner.ObjectID)
	}
	if _, err = service.Create(t.Context(), EntityServiceAcceptance, CreateInput{Data: DraftInput{
		BusinessDate: "2026-08-10", Currency: "CNY", Amount: "100.00",
		ServiceAcceptance: &ServiceAcceptanceInput{ContractDocumentID: latestContract.DocumentID,
			ServiceDate: "2026-08-01", AcceptanceDate: "2026-08-10", SettlementDirection: "PAYABLE"},
	}}, integrationApprovalActor(t, integrationActorOne, "sales-contract-acceptance-rejected")); err == nil {
		t.Fatal("sales cooperation contract was accepted by service acceptance")
	}
}

func approveServiceContractIntegration(t *testing.T, service *Service, draft DraftInput, requestPrefix string) MutationResult {
	t.Helper()
	created, err := service.Create(t.Context(), EntityServiceContract, CreateInput{Data: draft},
		integrationApprovalActor(t, integrationActorOne, requestPrefix+"-create"))
	if err != nil {
		t.Fatalf("create service contract: %v (cause: %v)", err, errors.Unwrap(err))
	}
	checked, err := service.Submit(t.Context(), EntityServiceContract, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, requestPrefix+"-submit"))
	if err != nil {
		t.Fatalf("check service contract: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntityServiceContract, DocumentRevisionInput{
		DocumentID: checked.DocumentID, Revision: checked.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorTwo, requestPrefix+"-approve"))
	if err != nil {
		t.Fatalf("approve service contract: %v", err)
	}
	return approved
}
