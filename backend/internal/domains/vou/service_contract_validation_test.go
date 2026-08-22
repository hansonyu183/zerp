package vou

import "testing"

func TestSalesContractValidationRequiresTypedCapabilityAndDates(t *testing.T) {
	_, err := validateServiceContractDraft(DraftInput{
		CounterpartyType: "sales-partner", Counterparty: refInput(), Handler: refInput(),
		ServiceContract: &ServiceContractInput{Capabilities: []string{"EXTERNAL_PART_TIME"}, ApplicableFrom: "2026-08-01"},
	}, validatedDraft{CounterpartyType: "sales-partner"})
	if err != nil {
		t.Fatalf("valid sales contract rejected: %v", err)
	}
	_, err = validateServiceContractDraft(DraftInput{
		CounterpartyType: "sales-partner", Counterparty: refInput(), Handler: refInput(),
		ServiceContract: &ServiceContractInput{Capabilities: []string{"EXTERNAL_PART_TIME"}},
	}, validatedDraft{CounterpartyType: "sales-partner"})
	if err == nil {
		t.Fatal("sales contract without applicableFrom was accepted")
	}
}

func TestServiceAcceptanceValidationRejectsSalesContractShape(t *testing.T) {
	_, err := validateServiceAcceptanceDraft(DraftInput{
		Amount: "1.00", ServiceAcceptance: &ServiceAcceptanceInput{
			ContractDocumentID: "01J00000000000000000000001", ServiceDate: "2026-08-01", AcceptanceDate: "2026-08-01", SettlementDirection: "PAYABLE",
		}, Counterparty: refInput(),
	}, validatedDraft{})
	if err == nil {
		t.Fatal("acceptance with counterparty was accepted")
	}
}

func TestServiceContractValidationAllowsRelationshipSettlementDefault(t *testing.T) {
	validated, err := validateServiceContractDraft(DraftInput{
		CounterpartyType: "other-unit", Counterparty: refInput(), Handler: refInput(),
		ServiceContract: &ServiceContractInput{},
	}, validatedDraft{CounterpartyType: "other-unit"})
	if err != nil {
		t.Fatalf("service contract with relationship settlement default rejected: %v", err)
	}
	if validated.ServiceContract == nil || validated.ServiceContract.Capabilities == nil || len(validated.ServiceContract.Capabilities) != 0 {
		t.Fatalf("service contract capabilities = %#v, want persisted empty array", validated.ServiceContract)
	}
}
