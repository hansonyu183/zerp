package vou

import (
	"encoding/hex"
	"math"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/oklog/ulid/v2"
)

const dateLayout = "2006-01-02"

var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

type fixedProductLine struct {
	Product             ReferenceInput
	BaseUnitPrice       int64
	SettlementSurcharge int64
	SurchargeProvided   bool
	Quantity            int64
	UnitPrice           int64
	PurchaseUnitPrice   *int64
	LineAmount          int64
	Remark              *string
	Formula             *fixedFormula
	Reference           priceReference
}

type fixedPriceLine struct {
	Product   ReferenceInput
	UnitPrice int64
	Remark    *string
}

type priceReference struct {
	UnitPrice                      int64
	DocumentID, DocumentNo, LineID string
	BusinessDate                   *time.Time
}

type fixedFormula struct {
	BaseOutputQuantity int64
	SourceType         string
	SourceDocumentID   string
	SourceDocumentNo   string
	Components         []fixedFormulaComponent
}

type fixedFormulaComponent struct {
	Material ReferenceInput
	Quantity int64
}

type fixedExpenseLine struct {
	Category, Description string
	Amount                int64
	Remark                *string
}

type fixedInventoryCountLine struct {
	Product        ReferenceInput
	ActualQuantity int64
	Remark         *string
}

type validatedDraft struct {
	BusinessDate                                            time.Time
	DueDate                                                 *time.Time
	Currency                                                string
	Remark                                                  *string
	Customer, Supplier, Counterparty, Employee, FundAccount *ReferenceInput
	Salesperson, Purchaser, Handler, Warehouse              *ReferenceInput
	CounterpartyType                                        string
	OtherCategory                                           string
	SourceName                                              string
	ProductLines                                            []fixedProductLine
	PriceLines                                              []fixedPriceLine
	ExpenseLines                                            []fixedExpenseLine
	InventoryCountLines                                     []fixedInventoryCountLine
	BillLines                                               []fixedBillLine
	BillCashLines                                           []fixedBillCashLine
	InternalCostRateBps                                     int32
	MaturityType, InterestMode                              string
	InterestParty                                           *ReferenceInput
	WithRecourse                                            bool
	SpecialApproval                                         bool
	TotalAmount                                             int64
}

type validatedQuery struct {
	Page, PageSize                               int
	Keyword, PartyObjectID, SortField, SortOrder string
	Statuses                                     []string
	DateFrom, DateTo                             *time.Time
}

func validEntity(entity string) bool {
	for _, candidate := range entities {
		if candidate == entity {
			return true
		}
	}
	return false
}

func receiptEntity(entity string) bool {
	return entity == EntitySalesReceipt || entity == EntityPurchaseRefund ||
		entity == EntityOtherReceipt || entity == EntityEmployeeRepayment
}

func paymentEntity(entity string) bool {
	return entity == EntitySalesRefund || entity == EntityPurchasePayment ||
		entity == EntityOtherPayment || entity == EntityEmployeeLoan
}

func fixedCounterpartyType(entity string) string {
	switch entity {
	case EntitySalesReceipt, EntitySalesRefund:
		return "customer"
	case EntityPurchaseRefund, EntityPurchasePayment:
		return "supplier"
	case EntityEmployeeLoan, EntityEmployeeRepayment:
		return "employee"
	default:
		return ""
	}
}

func isSalesChainEntity(entity string) bool {
	return entity == EntitySaleOutbound || entity == EntitySaleDelivery || entity == EntitySaleSignoff
}

func validID(value string) bool {
	_, err := ulid.ParseStrict(value)
	return err == nil
}

func validateReference(ref *ReferenceInput, field string, required bool) error {
	if ref == nil {
		if required {
			return domainError(ErrorValidation, field+" is required", nil, nil)
		}
		return nil
	}
	if !validID(ref.ObjectID) || !validID(ref.VersionID) {
		return domainError(ErrorValidation, "invalid "+field, nil, nil)
	}
	return nil
}

func validateDraft(entity string, input DraftInput) (validatedDraft, error) {
	if !validEntity(entity) {
		return validatedDraft{}, domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	if entity != EntityInventoryCount && len(input.InventoryCountLines) != 0 {
		return validatedDraft{}, domainError(ErrorValidation, "inventoryCountLines do not match entity", nil, nil)
	}
	businessDate, err := time.Parse(dateLayout, strings.TrimSpace(input.BusinessDate))
	if err != nil {
		return validatedDraft{}, domainError(ErrorValidation, "invalid businessDate", nil, nil)
	}
	currency := strings.ToUpper(strings.TrimSpace(input.Currency))
	if !currencyPattern.MatchString(currency) {
		return validatedDraft{}, domainError(ErrorValidation, "invalid currency", nil, nil)
	}
	remark := optionalText(input.Remark)
	if remark != nil && utf8.RuneCountInString(*remark) > 1000 {
		return validatedDraft{}, domainError(ErrorValidation, "remark is too long", nil, nil)
	}
	result := validatedDraft{
		BusinessDate: businessDate, Currency: currency, Remark: remark,
		Customer: input.Customer, Supplier: input.Supplier, Counterparty: input.Counterparty,
		Employee: input.Employee, FundAccount: input.FundAccount,
		Salesperson: input.Salesperson, Purchaser: input.Purchaser,
		Handler: input.Handler, Warehouse: input.Warehouse,
		CounterpartyType: strings.ToLower(strings.TrimSpace(input.CounterpartyType)),
		SourceName:       strings.TrimSpace(input.SourceName),
		SpecialApproval:  input.SpecialApproval,
	}
	otherCategory := strings.ToUpper(strings.TrimSpace(input.OtherCategory))
	if otherCategory != "" && entity != EntityOtherReceipt && entity != EntityOtherPayment {
		return validatedDraft{}, domainError(ErrorValidation, "otherCategory only applies to other transactions", nil, nil)
	}
	if entity == EntityBillReceipt {
		return validateBillReceiptDraft(input, result)
	}
	if entity == EntityBillPayment {
		return validateBillPaymentDraft(input, result)
	}
	if entity == EntityBillIssue {
		return validateBillIssueDraft(input, result)
	}
	if entity == EntityBillDiscount {
		return validateBillDiscountDraft(input, result)
	}
	if entity == EntityBillMaturity {
		return validateBillMaturityDraft(input, result)
	}

	switch entity {
	case EntitySalePricing:
		if input.Customer != nil || input.Supplier != nil || input.Counterparty != nil ||
			input.Employee != nil || input.Salesperson != nil || input.Purchaser != nil ||
			input.Handler != nil || input.Warehouse != nil || input.FundAccount != nil ||
			len(input.ProductLines) != 0 || len(input.ExpenseLines) != 0 {
			return validatedDraft{}, domainError(ErrorValidation, "fields do not match entity", nil, nil)
		}
		result.PriceLines, err = validatePriceLines(input.PriceLines)
	case EntityPurchaseInquiry:
		if err = validateReference(input.Supplier, "supplier", true); err != nil {
			return validatedDraft{}, err
		}
		if input.Customer != nil || input.Counterparty != nil || input.Employee != nil ||
			input.Salesperson != nil || input.Purchaser != nil || input.Handler != nil ||
			input.Warehouse != nil || input.FundAccount != nil || len(input.ProductLines) != 0 ||
			len(input.ExpenseLines) != 0 {
			return validatedDraft{}, domainError(ErrorValidation, "fields do not match entity", nil, nil)
		}
		result.PriceLines, err = validatePriceLines(input.PriceLines)
	case EntitySaleOrder:
		if err = requireOnlyDraftRefs(input, true, false, false, false, true, false, false, true, false, false); err != nil {
			return validatedDraft{}, err
		}
		if err = validateReference(input.Customer, "customer", true); err != nil {
			return validatedDraft{}, err
		}
		if err = validateReference(input.Salesperson, "salesperson", false); err != nil {
			return validatedDraft{}, err
		}
		if err = validateReference(input.Warehouse, "warehouse", true); err != nil {
			return validatedDraft{}, err
		}
		result.ProductLines, result.TotalAmount, err = validateProductLines(input.ProductLines, false, true)
	case EntityPurchaseOrder:
		if err = requireOnlyDraftRefs(input, false, true, false, false, false, true, false, true, false, false); err != nil {
			return validatedDraft{}, err
		}
		if err = validateReference(input.Supplier, "supplier", true); err != nil {
			return validatedDraft{}, err
		}
		if err = validateReference(input.Purchaser, "purchaser", false); err != nil {
			return validatedDraft{}, err
		}
		if err = validateReference(input.Warehouse, "warehouse", true); err != nil {
			return validatedDraft{}, err
		}
		result.ProductLines, result.TotalAmount, err = validateProductLines(input.ProductLines, false, false)
	case EntityInventoryCount:
		if err = requireOnlyDraftRefs(input, false, false, false, false, false, false, false, true, false, false); err != nil {
			return validatedDraft{}, err
		}
		if currency != "CNY" {
			return validatedDraft{}, domainError(ErrorValidation, "inventory count currency must be CNY", nil, nil)
		}
		if err = validateReference(input.Warehouse, "warehouse", true); err != nil {
			return validatedDraft{}, err
		}
		if strings.TrimSpace(input.Amount) != "" || input.MaterialWarehouse != nil ||
			input.FinishedWarehouse != nil || len(input.ProductionLines) != 0 ||
			len(input.ReturnLines) != 0 {
			return validatedDraft{}, domainError(ErrorValidation, "fields do not match entity", nil, nil)
		}
		result.InventoryCountLines, err = validateInventoryCountLines(input.InventoryCountLines)
	case EntitySalesReceipt, EntityPurchaseRefund, EntityOtherReceipt,
		EntitySalesRefund, EntityPurchasePayment, EntityOtherPayment, EntityEmployeeLoan, EntityEmployeeRepayment:
		if err = requireOnlyDraftRefs(input, false, false, true, false, false, false, true, false, true, false); err != nil {
			return validatedDraft{}, err
		}
		if fixed := fixedCounterpartyType(entity); fixed != "" {
			if result.CounterpartyType != "" && result.CounterpartyType != fixed {
				return validatedDraft{}, domainError(ErrorValidation, "counterparty type does not match entity", nil, nil)
			}
			result.CounterpartyType = fixed
		}
		if result.CounterpartyType != "customer" && result.CounterpartyType != "supplier" && result.CounterpartyType != "other-party" && result.CounterpartyType != "employee" {
			return validatedDraft{}, domainError(ErrorValidation, "invalid counterpartyType", nil, nil)
		}
		if err = validateReference(input.Counterparty, "counterparty", true); err != nil {
			return validatedDraft{}, err
		}
		if err = validateReference(input.FundAccount, "fundAccount", true); err != nil {
			return validatedDraft{}, err
		}
		if err = validateReference(input.Handler, "handler", true); err != nil {
			return validatedDraft{}, err
		}
		result.TotalAmount, err = moneyCents(input.Amount)
		result.OtherCategory = otherCategory
		if result.OtherCategory != "" && result.OtherCategory != "COMMISSION" &&
			result.OtherCategory != "INTERMEDIARY" && result.OtherCategory != "REBATE" {
			return validatedDraft{}, domainError(ErrorValidation, "invalid otherCategory", nil, nil)
		}
	case EntityEmployeeLoanWriteoff:
		if err = requireOnlyDraftRefs(input, false, false, false, true, false, false, false, false, false, false); err != nil {
			return validatedDraft{}, err
		}
		if err = validateReference(input.Employee, "employee", true); err != nil {
			return validatedDraft{}, err
		}
		result.ExpenseLines, result.TotalAmount, err = validateExpenseLines(input.ExpenseLines)
	case EntityExpenseReimbursement:
		if err = requireOnlyDraftRefs(input, false, false, false, true, false, false, false, false, true, false); err != nil {
			return validatedDraft{}, err
		}
		if err = validateReference(input.Employee, "employee", true); err != nil {
			return validatedDraft{}, err
		}
		if err = validateReference(input.FundAccount, "fundAccount", false); err != nil {
			return validatedDraft{}, err
		}
		result.ExpenseLines, result.TotalAmount, err = validateExpenseLines(input.ExpenseLines)
	case EntityOtherIncome:
		if err = requireOnlyDraftRefs(input, false, false, input.Counterparty != nil, false, false, false, true, false, true, true); err != nil {
			return validatedDraft{}, err
		}
		if input.Counterparty != nil {
			if result.CounterpartyType != "customer" && result.CounterpartyType != "supplier" {
				return validatedDraft{}, domainError(ErrorValidation, "invalid counterpartyType", nil, nil)
			}
			if err = validateReference(input.Counterparty, "counterparty", true); err != nil {
				return validatedDraft{}, err
			}
		} else if result.CounterpartyType != "" {
			return validatedDraft{}, domainError(ErrorValidation, "counterpartyType requires counterparty", nil, nil)
		}
		if err = validateReference(input.FundAccount, "fundAccount", true); err != nil {
			return validatedDraft{}, err
		}
		if err = validateReference(input.Handler, "handler", true); err != nil {
			return validatedDraft{}, err
		}
		if result.SourceName == "" || utf8.RuneCountInString(result.SourceName) > 200 {
			return validatedDraft{}, domainError(ErrorValidation, "invalid sourceName", nil, nil)
		}
		result.TotalAmount, err = moneyCents(input.Amount)
	}
	if err != nil {
		return validatedDraft{}, domainError(ErrorValidation, "invalid document amount or lines", nil, err)
	}
	return result, nil
}

func requireOnlyDraftRefs(
	input DraftInput,
	customer, supplier, counterparty, employee, salesperson, purchaser, handler, warehouse, fundAccount, source bool,
) error {
	if (!customer && input.Customer != nil) || (!supplier && input.Supplier != nil) ||
		(!counterparty && (input.Counterparty != nil || strings.TrimSpace(input.CounterpartyType) != "")) ||
		(!employee && input.Employee != nil) || (!salesperson && input.Salesperson != nil) ||
		(!purchaser && input.Purchaser != nil) || (!handler && input.Handler != nil) ||
		(!warehouse && input.Warehouse != nil) || (!fundAccount && input.FundAccount != nil) ||
		(!source && strings.TrimSpace(input.SourceName) != "") ||
		strings.TrimSpace(input.SourceDocumentID) != "" || input.Platform != nil || input.Vehicle != nil ||
		len(input.SourceLines) != 0 || len(input.SignoffLines) != 0 {
		return domainError(ErrorValidation, "fields do not match entity", nil, nil)
	}
	if len(input.ProductLines) > 0 && !(customer || supplier) {
		return domainError(ErrorValidation, "productLines do not match entity", nil, nil)
	}
	if len(input.PriceLines) > 0 {
		return domainError(ErrorValidation, "priceLines do not match entity", nil, nil)
	}
	if len(input.ExpenseLines) > 0 && !employee {
		return domainError(ErrorValidation, "expenseLines do not match entity", nil, nil)
	}
	if len(input.InventoryCountLines) > 0 && !warehouse {
		return domainError(ErrorValidation, "inventoryCountLines do not match entity", nil, nil)
	}
	if strings.TrimSpace(input.Amount) != "" && (customer || supplier || employee) {
		return domainError(ErrorValidation, "amount does not match entity", nil, nil)
	}
	return nil
}

func validateInventoryCountLines(lines []InventoryCountLineInput) ([]fixedInventoryCountLine, error) {
	if len(lines) == 0 || len(lines) > 200 {
		return nil, domainError(ErrorValidation, "inventoryCountLines must contain 1 to 200 items", nil, nil)
	}
	result := make([]fixedInventoryCountLine, 0, len(lines))
	seen := make(map[string]struct{}, len(lines))
	for _, line := range lines {
		if err := validateReference(&line.Product, "product", true); err != nil {
			return nil, err
		}
		if _, exists := seen[line.Product.ObjectID]; exists {
			return nil, domainError(ErrorValidation, "duplicate inventory count product", nil, nil)
		}
		seen[line.Product.ObjectID] = struct{}{}
		quantity, err := quantityMicros(line.ActualQuantity, true)
		if err != nil {
			return nil, domainError(ErrorValidation, "invalid actualQuantity", nil, err)
		}
		remark, err := lineRemark(line.Remark)
		if err != nil {
			return nil, err
		}
		result = append(result, fixedInventoryCountLine{Product: line.Product, ActualQuantity: quantity, Remark: remark})
	}
	return result, nil
}

func validateProductLines(
	lines []ProductLineInput, requirePurchasePrice, allowFormula bool,
) ([]fixedProductLine, int64, error) {
	if len(lines) == 0 || len(lines) > 200 {
		return nil, 0, domainError(ErrorValidation, "productLines must contain 1 to 200 items", nil, nil)
	}
	result := make([]fixedProductLine, 0, len(lines))
	seen := make(map[string]struct{}, len(lines))
	var total int64
	for _, line := range lines {
		if err := validateReference(&line.Product, "product", true); err != nil {
			return nil, 0, err
		}
		key := line.Product.ObjectID + "/" + line.Product.VersionID
		if _, exists := seen[key]; exists {
			return nil, 0, domainError(ErrorValidation, "duplicate product line", nil, nil)
		}
		seen[key] = struct{}{}
		quantity, err := quantityMicros(line.OrderedQuantity, false)
		if err != nil {
			return nil, 0, err
		}
		price, err := parseFixed(line.UnitPrice, 2, true)
		if err != nil {
			return nil, 0, err
		}
		var purchasePrice *int64
		if requirePurchasePrice {
			parsed, purchaseErr := moneyCents(line.PurchaseUnitPrice)
			if purchaseErr != nil {
				return nil, 0, domainError(ErrorValidation, "purchaseUnitPrice is required for intermediary sale lines", nil, purchaseErr)
			}
			purchasePrice = &parsed
		} else if strings.TrimSpace(line.PurchaseUnitPrice) != "" {
			return nil, 0, domainError(ErrorValidation, "purchaseUnitPrice only applies to intermediary sale lines", nil, nil)
		}
		surcharge := int64(0)
		surchargeProvided := line.SettlementSurcharge != nil
		if surchargeProvided {
			surcharge, err = parseFixed(*line.SettlementSurcharge, 2, true)
			if err != nil {
				return nil, 0, domainError(ErrorValidation, "invalid settlement surcharge", nil, err)
			}
		}
		amount, err := lineAmountCents(quantity, price+surcharge)
		if err != nil || total > math.MaxInt64-amount {
			return nil, 0, domainError(ErrorValidation, "amount out of range", nil, err)
		}
		total += amount
		remark, err := lineRemark(line.Remark)
		if err != nil {
			return nil, 0, err
		}
		formula, err := validateFormula(line.Formula, allowFormula)
		if err != nil {
			return nil, 0, err
		}
		result = append(result, fixedProductLine{
			Product: line.Product, Quantity: quantity, BaseUnitPrice: price,
			SettlementSurcharge: surcharge, SurchargeProvided: surchargeProvided,
			UnitPrice:         price + surcharge,
			PurchaseUnitPrice: purchasePrice, LineAmount: amount, Remark: remark, Formula: formula,
		})
	}
	return result, total, nil
}

func validatePriceLines(lines []PriceLineInput) ([]fixedPriceLine, error) {
	if len(lines) == 0 || len(lines) > 200 {
		return nil, domainError(ErrorValidation, "priceLines must contain 1 to 200 items", nil, nil)
	}
	result := make([]fixedPriceLine, 0, len(lines))
	seen := make(map[string]struct{}, len(lines))
	for _, line := range lines {
		if err := validateReference(&line.Product, "product", true); err != nil {
			return nil, err
		}
		if _, ok := seen[line.Product.ObjectID]; ok {
			return nil, domainError(ErrorValidation, "duplicate price product", nil, nil)
		}
		seen[line.Product.ObjectID] = struct{}{}
		price, err := parseFixed(line.UnitPrice, 2, true)
		if err != nil {
			return nil, domainError(ErrorValidation, "invalid price", nil, err)
		}
		remark, err := lineRemark(line.Remark)
		if err != nil {
			return nil, err
		}
		result = append(result, fixedPriceLine{Product: line.Product, UnitPrice: price, Remark: remark})
	}
	return result, nil
}

func validateFormula(input *FormulaInput, allowed bool) (*fixedFormula, error) {
	if input == nil {
		return nil, nil
	}
	if !allowed {
		return nil, domainError(ErrorValidation, "formula only applies to sale order lines", nil, nil)
	}
	baseQuantity, err := quantityMicros(input.BaseOutputQuantity, false)
	if err != nil {
		return nil, domainError(ErrorValidation, "invalid formula base output quantity", nil, err)
	}
	if len(input.Components) == 0 || len(input.Components) > 200 {
		return nil, domainError(ErrorValidation, "formula must contain 1 to 200 components", nil, nil)
	}
	sourceType := strings.ToUpper(strings.TrimSpace(input.SourceType))
	if sourceType == "" {
		sourceType = "MANUAL"
	}
	if !slices.Contains([]string{"RAW_SELF", "PRODUCT_FIXED", "CUSTOMER_LATEST", "MANUAL"}, sourceType) {
		return nil, domainError(ErrorValidation, "invalid formula source", nil, nil)
	}
	sourceDocumentID := strings.TrimSpace(input.SourceDocumentID)
	sourceDocumentNo := strings.TrimSpace(input.SourceDocumentNo)
	if sourceType == "CUSTOMER_LATEST" {
		if !validID(sourceDocumentID) || sourceDocumentNo == "" {
			return nil, domainError(ErrorValidation, "invalid formula source document", nil, nil)
		}
	} else if sourceDocumentID != "" || sourceDocumentNo != "" {
		return nil, domainError(ErrorValidation, "formula source document is not allowed", nil, nil)
	}
	seen := make(map[string]bool, len(input.Components))
	components := make([]fixedFormulaComponent, 0, len(input.Components))
	for _, component := range input.Components {
		if err = validateReference(&component.Material, "formula material", true); err != nil {
			return nil, err
		}
		if seen[component.Material.ObjectID] {
			return nil, domainError(ErrorValidation, "duplicate formula material", nil, nil)
		}
		seen[component.Material.ObjectID] = true
		quantity, quantityErr := quantityMicros(component.Quantity, false)
		if quantityErr != nil {
			return nil, domainError(ErrorValidation, "invalid formula material quantity", nil, quantityErr)
		}
		components = append(components, fixedFormulaComponent{
			Material: component.Material, Quantity: quantity,
		})
	}
	return &fixedFormula{
		BaseOutputQuantity: baseQuantity, SourceType: sourceType,
		SourceDocumentID: sourceDocumentID, SourceDocumentNo: sourceDocumentNo,
		Components: components,
	}, nil
}

func validateExpenseLines(lines []ExpenseLineInput) ([]fixedExpenseLine, int64, error) {
	if len(lines) == 0 || len(lines) > 200 {
		return nil, 0, domainError(ErrorValidation, "expenseLines must contain 1 to 200 items", nil, nil)
	}
	result := make([]fixedExpenseLine, 0, len(lines))
	var total int64
	for _, line := range lines {
		category := strings.TrimSpace(line.Category)
		description := strings.TrimSpace(line.Description)
		if category == "" || utf8.RuneCountInString(category) > 100 ||
			description == "" || utf8.RuneCountInString(description) > 500 {
			return nil, 0, domainError(ErrorValidation, "invalid expense line", nil, nil)
		}
		amount, err := moneyCents(line.Amount)
		if err != nil || total > math.MaxInt64-amount {
			return nil, 0, domainError(ErrorValidation, "amount out of range", nil, err)
		}
		total += amount
		remark, err := lineRemark(line.Remark)
		if err != nil {
			return nil, 0, err
		}
		result = append(result, fixedExpenseLine{
			Category: category, Description: description, Amount: amount, Remark: remark,
		})
	}
	return result, total, nil
}

func lineRemark(value string) (*string, error) {
	remark := optionalText(value)
	if remark != nil && utf8.RuneCountInString(*remark) > 1000 {
		return nil, domainError(ErrorValidation, "line remark is too long", nil, nil)
	}
	return remark, nil
}

func validateDocumentRevision(documentID string, revision int64) error {
	if !validID(documentID) || revision < 1 {
		return domainError(ErrorValidation, "invalid document revision", nil, nil)
	}
	return nil
}

func validateReverse(input ReverseInput) (*string, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return nil, err
	}
	reason := optionalText(input.Reason)
	if reason == nil || utf8.RuneCountInString(*reason) > 1000 {
		return nil, domainError(ErrorValidation, "invalid reason", nil, nil)
	}
	return reason, nil
}

func validateQuery(input QueryInput) (validatedQuery, error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 100 || len(input.Sort) > 1 ||
		utf8.RuneCountInString(strings.TrimSpace(input.Filters.Keyword)) > 200 {
		return validatedQuery{}, domainError(ErrorValidation, "invalid query", nil, nil)
	}
	result := validatedQuery{
		Page: input.Page, PageSize: input.PageSize, Keyword: strings.TrimSpace(input.Filters.Keyword),
		PartyObjectID: strings.TrimSpace(input.Filters.PartyObjectID),
		SortField:     "updatedAt", SortOrder: "desc",
	}
	if result.PartyObjectID != "" && !validID(result.PartyObjectID) {
		return validatedQuery{}, domainError(ErrorValidation, "invalid partyObjectId", nil, nil)
	}
	allowedStatuses := map[string]bool{
		StatusDraft: true, StatusChecked: true, StatusApproved: true,
	}
	seen := map[string]bool{}
	for _, status := range input.Filters.Status {
		status = strings.ToUpper(strings.TrimSpace(status))
		if !allowedStatuses[status] || seen[status] {
			return validatedQuery{}, domainError(ErrorValidation, "invalid status filter", nil, nil)
		}
		seen[status] = true
		result.Statuses = append(result.Statuses, status)
	}
	var err error
	if strings.TrimSpace(input.Filters.DateFrom) != "" {
		parsed, parseErr := time.Parse(dateLayout, strings.TrimSpace(input.Filters.DateFrom))
		if parseErr != nil {
			return validatedQuery{}, domainError(ErrorValidation, "invalid dateFrom", nil, nil)
		}
		result.DateFrom = &parsed
	}
	if strings.TrimSpace(input.Filters.DateTo) != "" {
		parsed, parseErr := time.Parse(dateLayout, strings.TrimSpace(input.Filters.DateTo))
		if parseErr != nil {
			return validatedQuery{}, domainError(ErrorValidation, "invalid dateTo", nil, nil)
		}
		result.DateTo = &parsed
	}
	if result.DateFrom != nil && result.DateTo != nil && result.DateFrom.After(*result.DateTo) {
		return validatedQuery{}, domainError(ErrorValidation, "dateFrom must not exceed dateTo", nil, nil)
	}
	if len(input.Sort) == 1 {
		allowed := map[string]bool{"updatedAt": true, "documentNo": true, "businessDate": true, "status": true, "amount": true}
		result.SortField = input.Sort[0].Field
		result.SortOrder = strings.ToLower(input.Sort[0].Order)
		if !allowed[result.SortField] || (result.SortOrder != "asc" && result.SortOrder != "desc") {
			return validatedQuery{}, domainError(ErrorValidation, "invalid sort", nil, nil)
		}
	}
	return result, err
}

func validateHistory(input HistoryInput) error {
	if !validID(input.DocumentID) || input.Page < 1 || input.PageSize < 1 || input.PageSize > 100 {
		return domainError(ErrorValidation, "invalid history query", nil, nil)
	}
	return nil
}

func validateAttachmentInitiate(input AttachmentInitiateInput) (string, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return "", err
	}
	rawName := strings.TrimSpace(input.FileName)
	name := filepath.Base(rawName)
	if rawName != name || name == "." || name == ".." || name == "" ||
		utf8.RuneCountInString(name) > 255 || strings.ContainsAny(rawName, "/\\\x00") {
		return "", domainError(ErrorValidation, "invalid fileName", nil, nil)
	}
	if input.Size < 1 || input.Size > 10<<20 {
		return "", domainError(ErrorValidation, "invalid file size", nil, nil)
	}
	allowed := map[string]bool{"application/pdf": true, "image/jpeg": true, "image/png": true}
	if !allowed[input.ContentType] {
		return "", domainError(ErrorValidation, "invalid contentType", nil, nil)
	}
	hash := strings.ToLower(strings.TrimSpace(input.SHA256))
	decoded, err := hex.DecodeString(hash)
	if err != nil || len(decoded) != 32 {
		return "", domainError(ErrorValidation, "invalid sha256", nil, nil)
	}
	return name, nil
}

func optionalText(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}
