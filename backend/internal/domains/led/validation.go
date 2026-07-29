package led

import (
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/oklog/ulid/v2"
)

const dateLayout = "2006-01-02"

var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

type validatedQuery struct {
	Page, PageSize                                       int
	DateFrom, DateTo                                     time.Time
	ObjectID, SourceEntity, DocumentNo, SortField, Order string
	Directions                                           []string
}

func validID(value string) bool {
	_, err := ulid.ParseStrict(value)
	return err == nil
}

func validateReference(input ReferenceInput) error {
	if !validID(input.ObjectID) || !validID(input.VersionID) {
		return domainError(ErrorValidation, "invalid reference", nil, nil)
	}
	return nil
}

func validateSave(input OpeningSaveInput) (time.Time, error) {
	if input.Revision < 1 || len(input.Inventory) > 1000 || len(input.Fund) > 1000 ||
		len(input.Party) > 1000 || len(input.Container) > 1000 {
		return time.Time{}, domainError(ErrorValidation, "invalid opening payload", nil, nil)
	}
	cutover, err := time.Parse(dateLayout, strings.TrimSpace(input.CutoverDate))
	if err != nil {
		return time.Time{}, domainError(ErrorValidation, "invalid cutoverDate", nil, err)
	}
	containerKeys := make(map[string]struct{}, len(input.Container))
	for _, item := range input.Container {
		if err = validateReference(item.Customer); err != nil {
			return time.Time{}, err
		}
		if item.ContainerType != "SOLVENT" && item.ContainerType != "RESIN" {
			return time.Time{}, domainError(ErrorValidation, "invalid containerType", nil, nil)
		}
		key := item.Customer.ObjectID + "/" + item.ContainerType
		if _, exists := containerKeys[key]; exists {
			return time.Time{}, domainError(ErrorValidation, "duplicate container opening dimension", nil, nil)
		}
		containerKeys[key] = struct{}{}
	}
	inventoryKeys := make(map[string]struct{}, len(input.Inventory))
	for _, item := range input.Inventory {
		if err = validateReference(item.Warehouse); err != nil {
			return time.Time{}, err
		}
		if err = validateReference(item.Product); err != nil {
			return time.Time{}, err
		}
		quantity, quantityErr := parsePositiveFixed(item.Quantity, 6, true)
		if quantityErr != nil {
			return time.Time{}, domainError(ErrorValidation, "invalid inventory opening quantity", nil, quantityErr)
		}
		unitPrice, priceErr := parsePositiveFixed(item.UnitPrice, 2, false)
		if priceErr != nil {
			return time.Time{}, domainError(ErrorValidation, "invalid inventory opening unitPrice", nil, priceErr)
		}
		if !currencyPattern.MatchString(strings.ToUpper(strings.TrimSpace(item.Currency))) {
			return time.Time{}, domainError(ErrorValidation, "invalid inventory opening currency", nil, nil)
		}
		if _, amountErr := lineAmountCents(quantity, unitPrice); amountErr != nil {
			return time.Time{}, domainError(ErrorValidation, "invalid inventory opening amount", nil, amountErr)
		}
		key := item.Warehouse.ObjectID + "/" + item.Product.ObjectID
		if _, exists := inventoryKeys[key]; exists {
			return time.Time{}, domainError(ErrorValidation, "duplicate inventory opening dimension", nil, nil)
		}
		inventoryKeys[key] = struct{}{}
	}
	fundKeys := make(map[string]struct{}, len(input.Fund))
	for _, item := range input.Fund {
		if err = validateReference(item.FundAccount); err != nil {
			return time.Time{}, err
		}
		if item.BalanceType != "POSITIVE" && item.BalanceType != "OVERDRAFT" {
			return time.Time{}, domainError(ErrorValidation, "invalid fund opening balanceType", nil, nil)
		}
		if _, err = parsePositiveFixed(item.Amount, 2, true); err != nil {
			return time.Time{}, domainError(ErrorValidation, "invalid fund opening amount", nil, err)
		}
		if _, exists := fundKeys[item.FundAccount.ObjectID]; exists {
			return time.Time{}, domainError(ErrorValidation, "duplicate fund opening dimension", nil, nil)
		}
		fundKeys[item.FundAccount.ObjectID] = struct{}{}
	}
	partyKeys := make(map[string]struct{}, len(input.Party))
	for _, item := range input.Party {
		if item.CounterpartyType != "customer" && item.CounterpartyType != "supplier" {
			return time.Time{}, domainError(ErrorValidation, "invalid counterpartyType", nil, nil)
		}
		if err = validateReference(item.Counterparty); err != nil {
			return time.Time{}, err
		}
		currency := strings.ToUpper(strings.TrimSpace(item.Currency))
		if !currencyPattern.MatchString(currency) {
			return time.Time{}, domainError(ErrorValidation, "invalid party opening currency", nil, nil)
		}
		if item.BalanceType != "RECEIVABLE" && item.BalanceType != "PAYABLE" {
			return time.Time{}, domainError(ErrorValidation, "invalid party opening balanceType", nil, nil)
		}
		if _, err = parsePositiveFixed(item.Amount, 2, true); err != nil {
			return time.Time{}, domainError(ErrorValidation, "invalid party opening amount", nil, err)
		}
		key := item.CounterpartyType + "/" + item.Counterparty.ObjectID + "/" + currency
		if _, exists := partyKeys[key]; exists {
			return time.Time{}, domainError(ErrorValidation, "duplicate party opening dimension", nil, nil)
		}
		partyKeys[key] = struct{}{}
	}
	return cutover, nil
}

func validateReopen(input ReopenInput) (*string, error) {
	reason := strings.TrimSpace(input.Reason)
	if input.Revision < 1 || reason == "" || utf8.RuneCountInString(reason) > 1000 {
		return nil, domainError(ErrorValidation, "invalid reopen request", nil, nil)
	}
	return &reason, nil
}

func validateQuery(entity string, input QueryInput) (validatedQuery, error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 100 || len(input.Sort) > 1 ||
		utf8.RuneCountInString(strings.TrimSpace(input.Filters.DocumentNo)) > 200 {
		return validatedQuery{}, domainError(ErrorValidation, "invalid query", nil, nil)
	}
	from, err := time.Parse(dateLayout, strings.TrimSpace(input.Filters.DateFrom))
	if err != nil {
		return validatedQuery{}, domainError(ErrorValidation, "invalid dateFrom", nil, err)
	}
	to, err := time.Parse(dateLayout, strings.TrimSpace(input.Filters.DateTo))
	if err != nil || to.Before(from) {
		return validatedQuery{}, domainError(ErrorValidation, "invalid dateTo", nil, err)
	}
	if input.Filters.ObjectID != "" && !validID(input.Filters.ObjectID) {
		return validatedQuery{}, domainError(ErrorValidation, "invalid objectId", nil, nil)
	}
	sourceEntity := strings.TrimSpace(input.Filters.SourceEntity)
	if sourceEntity != "" && sourceEntity != EntityOpening {
		allowed := false
		for _, candidate := range vouEntities {
			if sourceEntity == candidate {
				allowed = true
				break
			}
		}
		if !allowed && sourceEntity != "intermediary-receipt" && sourceEntity != "intermediary-signoff" {
			return validatedQuery{}, domainError(ErrorValidation, "invalid sourceEntity", nil, nil)
		}
	}
	result := validatedQuery{
		Page: input.Page, PageSize: input.PageSize, DateFrom: from, DateTo: to,
		ObjectID:     strings.TrimSpace(input.Filters.ObjectID),
		SourceEntity: sourceEntity,
		DocumentNo:   strings.TrimSpace(input.Filters.DocumentNo),
		SortField:    "effectiveDate", Order: "desc",
	}
	allowedDirections := map[string]bool{
		"IN":    entity == EntityInventory || entity == EntityFund,
		"OUT":   entity == EntityInventory || entity == EntityFund,
		"DEBIT": entity == EntityParty, "CREDIT": entity == EntityParty,
	}
	seen := map[string]bool{}
	for _, raw := range input.Filters.Direction {
		direction := strings.ToUpper(strings.TrimSpace(raw))
		if !allowedDirections[direction] || seen[direction] {
			return validatedQuery{}, domainError(ErrorValidation, "invalid direction", nil, nil)
		}
		seen[direction] = true
		result.Directions = append(result.Directions, direction)
	}
	if len(input.Sort) == 1 {
		if input.Sort[0].Field != "effectiveDate" && input.Sort[0].Field != "occurredAt" && input.Sort[0].Field != "documentNo" {
			return validatedQuery{}, domainError(ErrorValidation, "invalid sort field", nil, nil)
		}
		if input.Sort[0].Order != "asc" && input.Sort[0].Order != "desc" {
			return validatedQuery{}, domainError(ErrorValidation, "invalid sort order", nil, nil)
		}
		result.SortField, result.Order = input.Sort[0].Field, input.Sort[0].Order
	}
	return result, nil
}

func validateBalance(input BalanceInput) (time.Time, error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 100 {
		return time.Time{}, domainError(ErrorValidation, "invalid balance query", nil, nil)
	}
	date, err := time.Parse(dateLayout, strings.TrimSpace(input.Filters.AsOfDate))
	if err != nil {
		return time.Time{}, domainError(ErrorValidation, "invalid asOfDate", nil, err)
	}
	if input.Filters.ObjectID != "" && !validID(input.Filters.ObjectID) {
		return time.Time{}, domainError(ErrorValidation, "invalid objectId", nil, nil)
	}
	return date, nil
}
