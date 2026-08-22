package vou

import (
	"sort"
	"strings"
	"unicode/utf8"
)

const (
	contractCounterpartyService = "other-unit"
	contractCounterpartySales   = "sales-partner"
)

type validatedServiceContract struct {
	Capabilities                 []string
	ApplicableFrom, ApplicableTo *string
	Terms                        string
}

type validatedServiceAcceptance struct {
	ContractDocumentID                                   string
	ServiceDate, AcceptanceDate                          string
	SettlementDirection, FulfillmentFact, AcceptanceFact string
}

func validateServiceContractDraft(input DraftInput, result validatedDraft) (validatedDraft, error) {
	if input.ServiceContract == nil || input.ServiceAcceptance != nil || input.Counterparty == nil || input.Handler == nil {
		return validatedDraft{}, domainError(ErrorValidation, "service contract counterparty, handler, and detail are required", nil, nil)
	}
	if err := validateReference(input.Counterparty, "counterparty", true); err != nil {
		return validatedDraft{}, err
	}
	if err := validateReference(input.Handler, "handler", true); err != nil {
		return validatedDraft{}, err
	}
	if result.CounterpartyType != contractCounterpartyService && result.CounterpartyType != contractCounterpartySales {
		return validatedDraft{}, domainError(ErrorValidation, "service contract requires a typed service or sales relationship", nil, nil)
	}
	if input.Customer != nil || input.Supplier != nil || input.Employee != nil || input.Salesperson != nil || input.Purchaser != nil ||
		input.Warehouse != nil || input.FundAccount != nil || len(input.ProductLines) != 0 || len(input.PriceLines) != 0 || len(input.ExpenseLines) != 0 ||
		strings.TrimSpace(input.Amount) != "" || input.IntermediaryCalculation != nil {
		return validatedDraft{}, domainError(ErrorValidation, "fields do not match service contract", nil, nil)
	}
	detail := input.ServiceContract
	if utf8.RuneCountInString(strings.TrimSpace(detail.Terms)) > 10000 {
		return validatedDraft{}, domainError(ErrorValidation, "service contract terms are too long", nil, nil)
	}
	validated := &validatedServiceContract{Capabilities: []string{}, Terms: strings.TrimSpace(detail.Terms)}
	if result.CounterpartyType == contractCounterpartyService {
		if err := validateReference(input.SettlementMethod, "settlementMethod", false); err != nil {
			return validatedDraft{}, err
		}
		if len(detail.Capabilities) != 0 || strings.TrimSpace(detail.ApplicableFrom) != "" || strings.TrimSpace(detail.ApplicableTo) != "" {
			return validatedDraft{}, domainError(ErrorValidation, "service contract does not accept sales applicability", nil, nil)
		}
	} else {
		if input.SettlementMethod != nil {
			return validatedDraft{}, domainError(ErrorValidation, "sales contract does not accept settlementMethod", nil, nil)
		}
		capabilities, err := normalizeContractCapabilities(detail.Capabilities)
		if err != nil {
			return validatedDraft{}, err
		}
		if len(capabilities) == 0 {
			return validatedDraft{}, domainError(ErrorValidation, "sales contract requires capabilities", nil, nil)
		}
		from := strings.TrimSpace(detail.ApplicableFrom)
		if _, err := parseContractDate(from); err != nil {
			return validatedDraft{}, domainError(ErrorValidation, "invalid applicableFrom", nil, err)
		}
		validated.Capabilities = capabilities
		validated.ApplicableFrom = &from
		if to := strings.TrimSpace(detail.ApplicableTo); to != "" {
			fromDate, _ := parseContractDate(from)
			toDate, err := parseContractDate(to)
			if err != nil || toDate.Before(fromDate) {
				return validatedDraft{}, domainError(ErrorValidation, "invalid applicableTo", nil, err)
			}
			validated.ApplicableTo = &to
		}
	}
	result.ServiceContract = validated
	result.TotalAmount = 0
	return result, nil
}

func validateServiceAcceptanceDraft(input DraftInput, result validatedDraft) (validatedDraft, error) {
	if input.ServiceAcceptance == nil || input.ServiceContract != nil || input.Counterparty != nil || input.Handler != nil || input.SettlementMethod != nil {
		return validatedDraft{}, domainError(ErrorValidation, "service acceptance detail is invalid", nil, nil)
	}
	detail := input.ServiceAcceptance
	if !validID(detail.ContractDocumentID) {
		return validatedDraft{}, domainError(ErrorValidation, "invalid contractDocumentId", nil, nil)
	}
	serviceDate, err := parseContractDate(strings.TrimSpace(detail.ServiceDate))
	if err != nil {
		return validatedDraft{}, domainError(ErrorValidation, "invalid serviceDate", nil, err)
	}
	acceptanceDate, err := parseContractDate(strings.TrimSpace(detail.AcceptanceDate))
	if err != nil || acceptanceDate.Before(serviceDate) {
		return validatedDraft{}, domainError(ErrorValidation, "invalid acceptanceDate", nil, err)
	}
	direction := strings.ToUpper(strings.TrimSpace(detail.SettlementDirection))
	if direction != "PAYABLE" && direction != "RECEIVABLE" {
		return validatedDraft{}, domainError(ErrorValidation, "invalid settlementDirection", nil, nil)
	}
	fulfillment, acceptance := strings.TrimSpace(detail.FulfillmentFact), strings.TrimSpace(detail.AcceptanceFact)
	if utf8.RuneCountInString(fulfillment) > 10000 || utf8.RuneCountInString(acceptance) > 10000 {
		return validatedDraft{}, domainError(ErrorValidation, "acceptance fact is too long", nil, nil)
	}
	amount, err := moneyCents(input.Amount)
	if err != nil || amount <= 0 {
		return validatedDraft{}, domainError(ErrorValidation, "service acceptance amount must be positive", nil, err)
	}
	result.ServiceAcceptance = &validatedServiceAcceptance{ContractDocumentID: detail.ContractDocumentID, ServiceDate: serviceDate.Format(dateLayout), AcceptanceDate: acceptanceDate.Format(dateLayout), SettlementDirection: direction, FulfillmentFact: fulfillment, AcceptanceFact: acceptance}
	result.TotalAmount = amount
	return result, nil
}

func normalizeContractCapabilities(input []string) ([]string, error) {
	seen := map[string]struct{}{}
	for _, raw := range input {
		value := strings.TrimSpace(raw)
		if value != "EXTERNAL_PART_TIME" && value != "CHANNEL_PARTNER" {
			return nil, domainError(ErrorValidation, "invalid sales contract capability", nil, nil)
		}
		seen[value] = struct{}{}
	}
	result := make([]string, 0, len(seen))
	for value := range seen {
		result = append(result, value)
	}
	sort.Strings(result)
	return result, nil
}
