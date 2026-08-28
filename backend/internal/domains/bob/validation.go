package bob

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/oklog/ulid/v2"
)

var (
	objectCodePattern    = regexp.MustCompile(`^[A-Z]{3}-[0-9]{4}$`)
	currencyPattern      = regexp.MustCompile(`^[A-Z]{3}$`)
	phonePattern         = regexp.MustCompile(`^[+0-9() -]+$`)
	taxNumberPattern     = regexp.MustCompile(`^[A-Z0-9-]+$`)
	barcodePattern       = regexp.MustCompile(`^[A-Z0-9._-]+$`)
	vinPattern           = regexp.MustCompile(`^[A-HJ-NPR-Z0-9]{17}$`)
	accountNumberPattern = regexp.MustCompile(`^[A-Z0-9]{1,64}$`)
	loadCapacityPattern  = regexp.MustCompile(`^([0-9]{1,9})(?:\.([0-9]{1,3}))?$`)
)

func validateCreate(entity string, input CreateDetailInput) (DetailView, string, error) {
	customerType := input.CustomerType
	if entity == EntityCustomer && customerType == nil {
		value := CustomerTypeEndUser
		customerType = &value
	}
	monthlyClosingDay := input.MonthlyClosingDay
	if entity == EntityCustomer && monthlyClosingDay == 0 {
		monthlyClosingDay = 31
	}
	data := DetailView{
		Name: input.Name, Unit: input.Unit, InventoryUnitID: input.InventoryUnitID, Currency: input.Currency,
		CustomerType: deref(customerType),
		PlateNumber:  input.PlateNumber, VehicleType: input.VehicleType,
		CarrierAffiliation: input.CarrierAffiliation, BulkLiquidCapable: input.BulkLiquidCapable, TargetEntity: input.TargetEntity,
		ShortName: input.ShortName, CategoryID: input.CategoryID, TaxNumber: input.TaxNumber,
		ContactName: input.ContactName, ContactPhone: input.ContactPhone, Email: input.Email,
		Address: input.Address, Remark: input.Remark, DepartmentID: input.DepartmentID,
		PositionID: input.PositionID, Phone: input.Phone, HireDate: input.HireDate,
		Specification: input.Specification, Model: input.Model, Barcode: input.Barcode,
		Description: input.Description, ManagerEmployeeID: input.ManagerEmployeeID,
		VIN: input.VIN, EngineNumber: input.EngineNumber, LoadCapacityKG: input.LoadCapacityKG,
		AccountName: input.AccountName, BankName: input.BankName, BankBranch: input.BankBranch,
		AccountNumber: input.AccountNumber, OperatingEntityID: input.OperatingEntityID, ParentID: input.ParentID,
		SettlementMethodID: input.SettlementMethodID, MonthlyClosingDay: monthlyClosingDay,
		SalespersonEmployeeID:      input.SalespersonEmployeeID,
		DefaultPurchaserEmployeeID: input.DefaultPurchaserEmployeeID,
		RuleType:                   input.RuleType,
		MonthOffset:                input.MonthOffset, DayOfMonth: input.DayOfMonth, DayOffset: input.DayOffset,
		ProductTypeID: input.ProductTypeID, DefaultInputUnitID: input.DefaultInputUnitID,
		PricingUnitID: input.PricingUnitID, UnitConversions: slices.Clone(input.UnitConversions),
		Returnable: input.Returnable, DefaultPackagingSpec: input.DefaultPackagingSpec,
		Formula: cloneProductFormula(input.Formula), TermCode: input.TermCode,
		DefaultSalesSurcharge: input.DefaultSalesSurcharge,
	}
	data, err := validateDetailData(entity, data)
	return data, "", err
}

func mergeDetailInput(current DetailView, input DetailInput) DetailView {
	result := current
	result.Name = input.Name
	result.Unit = input.Unit
	result.Currency = input.Currency
	result.PlateNumber = input.PlateNumber
	result.VehicleType = input.VehicleType
	result.CarrierAffiliation = input.CarrierAffiliation
	result.BulkLiquidCapable = input.BulkLiquidCapable
	result.RuleType = input.RuleType
	result.MonthOffset = input.MonthOffset
	result.DayOfMonth = input.DayOfMonth
	result.DayOffset = input.DayOffset
	if input.Returnable != nil {
		result.Returnable = *input.Returnable
	}
	if input.Formula != nil {
		result.Formula = cloneProductFormula(input.Formula)
	}
	if input.CustomerType != nil {
		result.CustomerType = *input.CustomerType
	}
	if input.TargetEntity != nil {
		result.TargetEntity = *input.TargetEntity
	}
	mergeOptional := func(optional OptionalString, target *string) {
		if optional.Set {
			*target = optional.Value
		}
	}
	mergeOptional(input.DefaultPackagingSpec, &result.DefaultPackagingSpec)
	mergeOptional(input.InventoryUnitID, &result.InventoryUnitID)
	mergeOptional(input.ShortName, &result.ShortName)
	mergeOptional(input.CategoryID, &result.CategoryID)
	mergeOptional(input.TaxNumber, &result.TaxNumber)
	mergeOptional(input.ContactName, &result.ContactName)
	mergeOptional(input.ContactPhone, &result.ContactPhone)
	mergeOptional(input.Email, &result.Email)
	mergeOptional(input.Address, &result.Address)
	mergeOptional(input.Remark, &result.Remark)
	mergeOptional(input.DepartmentID, &result.DepartmentID)
	mergeOptional(input.PositionID, &result.PositionID)
	mergeOptional(input.Phone, &result.Phone)
	mergeOptional(input.HireDate, &result.HireDate)
	mergeOptional(input.Specification, &result.Specification)
	mergeOptional(input.Model, &result.Model)
	mergeOptional(input.Barcode, &result.Barcode)
	mergeOptional(input.Description, &result.Description)
	mergeOptional(input.ManagerEmployeeID, &result.ManagerEmployeeID)
	mergeOptional(input.VIN, &result.VIN)
	mergeOptional(input.EngineNumber, &result.EngineNumber)
	mergeOptional(input.LoadCapacityKG, &result.LoadCapacityKG)
	mergeOptional(input.AccountName, &result.AccountName)
	mergeOptional(input.BankName, &result.BankName)
	mergeOptional(input.BankBranch, &result.BankBranch)
	mergeOptional(input.AccountNumber, &result.AccountNumber)
	mergeOptional(input.OperatingEntityID, &result.OperatingEntityID)
	mergeOptional(input.ParentID, &result.ParentID)
	mergeOptional(input.SettlementMethodID, &result.SettlementMethodID)
	if input.MonthlyClosingDay != nil {
		result.MonthlyClosingDay = *input.MonthlyClosingDay
	}
	if input.DefaultSalesSurcharge != nil {
		result.DefaultSalesSurcharge = *input.DefaultSalesSurcharge
	}
	mergeOptional(input.SalespersonEmployeeID, &result.SalespersonEmployeeID)
	mergeOptional(input.DefaultPurchaserEmployeeID, &result.DefaultPurchaserEmployeeID)
	mergeOptional(input.ProductTypeID, &result.ProductTypeID)
	mergeOptional(input.DefaultInputUnitID, &result.DefaultInputUnitID)
	mergeOptional(input.PricingUnitID, &result.PricingUnitID)
	if input.UnitConversions != nil {
		result.UnitConversions = slices.Clone(*input.UnitConversions)
	}
	return result
}

// validateDetail remains the focused validation entry point used by unit tests
// and callers that do not need save-time merge semantics.
func validateDetail(entity string, input DetailInput) (DetailView, error) {
	if err := validateDetailInputFields(entity, input); err != nil {
		return DetailView{}, err
	}
	current := DetailView{}
	if entity == EntityCustomer {
		current.CustomerType = CustomerTypeEndUser
		current.MonthlyClosingDay = 31
	}
	return validateDetailData(entity, mergeDetailInput(current, input))
}

func validateDetailInputFields(entity string, input DetailInput) error {
	allowed := map[string]bool{}
	allow := func(fields ...string) {
		for _, field := range fields {
			allowed[field] = true
		}
	}
	switch entity {
	case EntityCustomer:
		allow("shortName", "taxNumber", "contactName", "contactPhone", "email", "address", "remark", "settlementMethodId", "monthlyClosingDay", "salespersonEmployeeId")
	case EntityOtherUnit:
		allow("contactName", "contactPhone", "email", "address", "remark", "settlementMethodId")
	case EntityEmployee:
		allow("departmentId", "positionId", "phone", "email", "hireDate", "remark")
	case EntityProduct:
		allow("categoryId", "specification", "model", "barcode", "remark", "productTypeId",
			"defaultInputUnitId", "pricingUnitId", "unitConversions", "returnable", "defaultPackagingSpec", "formula")
	case EntityWarehouse:
		allow("address", "contactName", "contactPhone", "managerEmployeeId", "remark")
	case EntityVehicle:
		allow("vin", "engineNumber", "loadCapacityKg", "remark")
	case EntityFundAccount:
		allow("accountName", "bankName", "bankBranch", "accountNumber", "operatingEntityId", "remark")
	case EntityOperatingEntity:
		allow("shortName", "taxNumber", "address", "phone", "remark")
	default:
		return domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	provided := map[string]bool{
		"shortName": input.ShortName.Set, "categoryId": input.CategoryID.Set,
		"taxNumber": input.TaxNumber.Set, "contactName": input.ContactName.Set,
		"contactPhone": input.ContactPhone.Set, "email": input.Email.Set,
		"address": input.Address.Set, "remark": input.Remark.Set,
		"departmentId": input.DepartmentID.Set, "positionId": input.PositionID.Set,
		"phone": input.Phone.Set, "hireDate": input.HireDate.Set,
		"specification": input.Specification.Set, "model": input.Model.Set,
		"barcode": input.Barcode.Set, "description": input.Description.Set,
		"managerEmployeeId": input.ManagerEmployeeID.Set, "vin": input.VIN.Set,
		"engineNumber": input.EngineNumber.Set, "loadCapacityKg": input.LoadCapacityKG.Set,
		"accountName": input.AccountName.Set, "bankName": input.BankName.Set,
		"bankBranch": input.BankBranch.Set, "accountNumber": input.AccountNumber.Set,
		"parentId": input.ParentID.Set, "settlementMethodId": input.SettlementMethodID.Set,
		"monthlyClosingDay":          input.MonthlyClosingDay != nil,
		"defaultSalesSurcharge":      input.DefaultSalesSurcharge != nil,
		"salespersonEmployeeId":      input.SalespersonEmployeeID.Set,
		"defaultPurchaserEmployeeId": input.DefaultPurchaserEmployeeID.Set,
		"productTypeId":              input.ProductTypeID.Set,
		"defaultInputUnitId":         input.DefaultInputUnitID.Set,
		"pricingUnitId":              input.PricingUnitID.Set,
		"unitConversions":            input.UnitConversions != nil,
		"returnable":                 input.Returnable != nil,
		"defaultPackagingSpec":       input.DefaultPackagingSpec.Set,
		"formula":                    input.Formula != nil,
	}
	for field, present := range provided {
		if present && !allowed[field] {
			return domainError(ErrorValidation, fmt.Sprintf("unexpected field %s", field), nil, nil)
		}
	}
	return nil
}

func validateDetailData(entity string, input DetailView) (DetailView, error) {
	if !validEntity(entity) {
		return DetailView{}, domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	normalizeDetail(&input)
	if entity != EntityOtherUnit && !runeLengthBetween(input.Name, 1, 200) {
		return DetailView{}, domainError(ErrorValidation, "invalid name", nil, nil)
	}
	if err := validateLengthsAndFormats(input); err != nil {
		return DetailView{}, err
	}
	if err := validateEntityFields(entity, input); err != nil {
		return DetailView{}, err
	}
	return input, nil
}

func normalizeDetail(input *DetailView) {
	trim := func(value *string) { *value = strings.TrimSpace(*value) }
	for _, value := range []*string{
		&input.Name, &input.Unit, &input.ShortName, &input.ContactName, &input.ContactPhone,
		&input.Email, &input.Address, &input.Remark, &input.Phone, &input.HireDate,
		&input.Specification, &input.Model, &input.Description, &input.EngineNumber,
		&input.LoadCapacityKG, &input.AccountName, &input.BankName, &input.BankBranch,
		&input.VehicleType, &input.ProductTypeID, &input.DefaultInputUnitID, &input.PricingUnitID,
		&input.DefaultPackagingSpec, &input.DefaultSalesSurcharge,
	} {
		trim(value)
	}
	for index := range input.UnitConversions {
		input.UnitConversions[index].Unit.ObjectID = strings.TrimSpace(input.UnitConversions[index].Unit.ObjectID)
		input.UnitConversions[index].Factor = strings.TrimSpace(input.UnitConversions[index].Factor)
	}
	for _, value := range []*string{
		&input.Currency, &input.CustomerType, &input.PlateNumber, &input.VehicleType,
		&input.TaxNumber, &input.Barcode, &input.VIN, &input.RuleType, &input.TermCode,
	} {
		*value = strings.ToUpper(strings.TrimSpace(*value))
	}
	for _, value := range []*string{
		&input.CategoryID, &input.DepartmentID, &input.PositionID,
		&input.ManagerEmployeeID, &input.ParentID, &input.SettlementMethodID, &input.SalespersonEmployeeID,
		&input.DefaultPurchaserEmployeeID,
		&input.InventoryUnitID, &input.ProductTypeID, &input.DefaultInputUnitID, &input.PricingUnitID,
	} {
		trim(value)
	}
	input.Email = strings.ToLower(input.Email)
	input.TargetEntity = strings.ToLower(strings.TrimSpace(input.TargetEntity))
	input.AccountNumber = normalizeAccountNumber(input.AccountNumber)
	if input.LoadCapacityKG != "" {
		input.LoadCapacityKG = normalizeLoadCapacity(input.LoadCapacityKG)
	}
	if input.Formula != nil {
		normalizeQuantitySnapshot(&input.Formula.Output)
		for index := range input.Formula.Components {
			component := &input.Formula.Components[index]
			component.Material.ObjectID = strings.TrimSpace(component.Material.ObjectID)
			component.Material.ApprovalEntryID = strings.TrimSpace(component.Material.ApprovalEntryID)
			component.ResolutionStatus = strings.ToUpper(strings.TrimSpace(component.ResolutionStatus))
			if component.ResolutionStatus == "" {
				component.ResolutionStatus = "CURRENT"
			}
			normalizeQuantitySnapshot(&component.Quantity)
		}
	}
	if input.CarrierAffiliation != nil {
		input.CarrierAffiliation.Type = strings.ToUpper(strings.TrimSpace(input.CarrierAffiliation.Type))
		input.CarrierAffiliation.OperatingEntityID = strings.TrimSpace(input.CarrierAffiliation.OperatingEntityID)
		input.CarrierAffiliation.ServiceRelationshipObjectID = strings.TrimSpace(input.CarrierAffiliation.ServiceRelationshipObjectID)
	}
}

func validCarrierAffiliation(value *CarrierAffiliation) bool {
	if value == nil {
		return false
	}
	switch value.Type {
	case "INTERNAL":
		return validID(value.OperatingEntityID) && value.ServiceRelationshipObjectID == ""
	case "EXTERNAL":
		return validID(value.ServiceRelationshipObjectID) && value.OperatingEntityID == ""
	default:
		return false
	}
}

func carrierAffiliationField(value *CarrierAffiliation) string {
	if value == nil {
		return ""
	}
	return value.Type + value.OperatingEntityID + value.ServiceRelationshipObjectID
}

func normalizeQuantitySnapshot(quantity *QuantitySnapshot) {
	quantity.EnteredQuantity = strings.TrimSpace(quantity.EnteredQuantity)
	quantity.EnteredUnit.ObjectID = strings.TrimSpace(quantity.EnteredUnit.ObjectID)
	quantity.BaseQuantity = strings.TrimSpace(quantity.BaseQuantity)
}

func validateLengthsAndFormats(input DetailView) error {
	checks := []struct {
		value string
		max   int
	}{
		{input.Unit, 32}, {input.ShortName, 100}, {input.ContactName, 100},
		{input.ContactPhone, 32}, {input.Email, 254}, {input.Address, 500},
		{input.Remark, 1000}, {input.Phone, 32}, {input.Specification, 200},
		{input.Model, 200}, {input.Description, 1000}, {input.EngineNumber, 64},
		{input.AccountName, 200}, {input.BankName, 200}, {input.BankBranch, 200},
		{input.VehicleType, 64},
	}
	for _, check := range checks {
		if check.value != "" && !runeLengthBetween(check.value, 1, check.max) {
			return domainError(ErrorValidation, "field is too long", nil, nil)
		}
	}
	if input.ContactPhone != "" && !phonePattern.MatchString(input.ContactPhone) {
		return domainError(ErrorValidation, "invalid contact phone", nil, nil)
	}
	if input.Phone != "" && !phonePattern.MatchString(input.Phone) {
		return domainError(ErrorValidation, "invalid phone", nil, nil)
	}
	if input.Email != "" && (!strings.Contains(input.Email, "@") || strings.HasPrefix(input.Email, "@") ||
		strings.HasSuffix(input.Email, "@") || strings.Count(input.Email, "@") != 1) {
		return domainError(ErrorValidation, "invalid email", nil, nil)
	}
	if input.TaxNumber != "" && (len(input.TaxNumber) > 50 || !taxNumberPattern.MatchString(input.TaxNumber)) {
		return domainError(ErrorValidation, "invalid tax number", nil, nil)
	}
	if input.Barcode != "" && (len(input.Barcode) > 64 || !barcodePattern.MatchString(input.Barcode)) {
		return domainError(ErrorValidation, "invalid barcode", nil, nil)
	}
	if input.VIN != "" && !vinPattern.MatchString(input.VIN) {
		return domainError(ErrorValidation, "invalid vin", nil, nil)
	}
	if input.AccountNumber != "" && !accountNumberPattern.MatchString(input.AccountNumber) {
		return domainError(ErrorValidation, "invalid account number", nil, nil)
	}
	if input.HireDate != "" {
		parsed, err := time.Parse("2006-01-02", input.HireDate)
		if err != nil || parsed.Format("2006-01-02") != input.HireDate {
			return domainError(ErrorValidation, "invalid hire date", nil, nil)
		}
	}
	if input.LoadCapacityKG != "" &&
		(!loadCapacityPattern.MatchString(input.LoadCapacityKG) || input.LoadCapacityKG == "0.000") {
		return domainError(ErrorValidation, "invalid load capacity", nil, nil)
	}
	return nil
}

func validateEntityFields(entity string, input DetailView) error {
	allowed := map[string]bool{"name": true}
	allow := func(fields ...string) {
		for _, field := range fields {
			allowed[field] = true
		}
	}
	switch entity {
	case EntityCustomer:
		allow("customerType", "shortName", "taxNumber", "contactName", "contactPhone", "email", "address", "remark", "settlementMethodId", "monthlyClosingDay", "salespersonEmployeeId")
		if !objectCodePattern.MatchString(input.CustomerType) {
			return domainError(ErrorValidation, "invalid customer type code", nil, nil)
		}
		if input.MonthlyClosingDay < 1 || input.MonthlyClosingDay > 31 {
			return domainError(ErrorValidation, "monthly closing day must be 1-31", nil, nil)
		}
		if input.SalespersonEmployeeID == "" {
			return domainError(ErrorValidation, "salesperson employee is required", nil, nil)
		}
	case EntityOtherUnit:
		allow("contactName", "contactPhone", "email", "address", "remark", "settlementMethodId",
			"termCode", "ruleType", "monthOffset", "dayOfMonth", "dayOffset")
		if input.SettlementMethodID != "" {
			if err := validateSettlementRule(input); err != nil {
				return domainError(ErrorValidation, "invalid service settlement snapshot", nil, err)
			}
		}
	case EntityEmployee:
		allow("departmentId", "positionId", "phone", "email", "hireDate", "remark")
	case EntityProduct:
		allow("productTypeId", "defaultInputUnitId", "pricingUnitId", "unitConversions", "categoryId", "specification", "model", "barcode", "remark",
			"returnable", "defaultPackagingSpec", "formula")
		if err := validateProductDraft(input); err != nil {
			return err
		}
	case EntityWarehouse:
		allow("address", "contactName", "contactPhone", "managerEmployeeId", "remark")
	case EntityVehicle:
		allow("plateNumber", "vehicleType", "carrierAffiliation", "bulkLiquidCapable", "vin", "engineNumber", "loadCapacityKg", "remark")
		if !runeLengthBetween(input.PlateNumber, 1, 32) ||
			!runeLengthBetween(input.VehicleType, 1, 64) ||
			!validCarrierAffiliation(input.CarrierAffiliation) {
			return domainError(ErrorValidation, "invalid vehicle fields", nil, nil)
		}
	case EntityFundAccount:
		allow("currency", "accountName", "bankName", "bankBranch", "accountNumber", "operatingEntityId", "remark")
		if !currencyPattern.MatchString(input.Currency) || !validID(input.OperatingEntityID) {
			return domainError(ErrorValidation, "invalid currency", nil, nil)
		}
	case EntityOperatingEntity:
		allow("shortName", "taxNumber", "address", "phone", "remark")
	default:
		return domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	values := detailFieldValues(input)
	for field, value := range values {
		if value != "" && !allowed[field] {
			return domainError(ErrorValidation, fmt.Sprintf("unexpected field %s", field), nil, nil)
		}
	}
	for _, id := range []string{
		input.CategoryID, input.DepartmentID, input.PositionID, input.ManagerEmployeeID,
		input.ParentID, input.SettlementMethodID, input.SalespersonEmployeeID,
		input.InventoryUnitID, input.ProductTypeID, input.DefaultInputUnitID, input.PricingUnitID,
	} {
		if id != "" && !validID(id) {
			return domainError(ErrorValidation, "invalid reference id", nil, nil)
		}
	}
	return nil
}

func detailFieldValues(input DetailView) map[string]string {
	return map[string]string{
		"unit": input.Unit, "currency": input.Currency,
		"customerType": input.CustomerType, "plateNumber": input.PlateNumber,
		"vehicleType": input.VehicleType, "carrierAffiliation": carrierAffiliationField(input.CarrierAffiliation),
		"bulkLiquidCapable": boolField(input.BulkLiquidCapable),
		"targetEntity":      input.TargetEntity, "shortName": input.ShortName, "categoryId": input.CategoryID,
		"taxNumber": input.TaxNumber, "contactName": input.ContactName, "contactPhone": input.ContactPhone,
		"email": input.Email, "address": input.Address, "remark": input.Remark,
		"departmentId": input.DepartmentID, "positionId": input.PositionID, "phone": input.Phone,
		"hireDate": input.HireDate, "specification": input.Specification, "model": input.Model,
		"barcode": input.Barcode, "description": input.Description,
		"managerEmployeeId": input.ManagerEmployeeID, "vin": input.VIN,
		"engineNumber": input.EngineNumber, "loadCapacityKg": input.LoadCapacityKG,
		"accountName": input.AccountName, "bankName": input.BankName, "bankBranch": input.BankBranch,
		"accountNumber": input.AccountNumber, "parentId": input.ParentID,
		"settlementMethodId":    input.SettlementMethodID,
		"monthlyClosingDay":     numericField(input.MonthlyClosingDay),
		"salespersonEmployeeId": input.SalespersonEmployeeID,
		"ruleType":              input.RuleType,
		"termCode":              input.TermCode,
		"defaultSalesSurcharge": input.DefaultSalesSurcharge,
		"monthOffset":           numericField(input.MonthOffset), "dayOfMonth": optionalNumericField(input.DayOfMonth),
		"dayOffset":     numericField(input.DayOffset),
		"productTypeId": input.ProductTypeID, "inventoryUnitId": input.InventoryUnitID,
		"defaultInputUnitId": input.DefaultInputUnitID, "pricingUnitId": input.PricingUnitID,
		"unitConversions": sliceField(len(input.UnitConversions)),
		"returnable":      boolField(input.Returnable), "defaultPackagingSpec": input.DefaultPackagingSpec,
		"formula": formulaField(input.Formula),
	}
}

func formulaField(value *ProductFormula) string {
	if value == nil {
		return ""
	}
	return "present"
}

func boolField(value bool) string {
	if value {
		return "true"
	}
	return ""
}

func sliceField(length int) string {
	if length > 0 {
		return "present"
	}
	return ""
}

func validateProductDraft(input DetailView) error {
	if input.ProductTypeID != "" && !validID(input.ProductTypeID) {
		return domainError(ErrorValidation, "invalid product type reference", nil, nil)
	}
	seenUnits := make(map[string]bool, len(input.UnitConversions))
	for index, conversion := range input.UnitConversions {
		if !validID(conversion.Unit.ObjectID) {
			return domainError(ErrorValidation, fmt.Sprintf("unitConversions[%d].unit is invalid", index), nil, nil)
		}
		if seenUnits[conversion.Unit.ObjectID] {
			return domainError(ErrorValidation, fmt.Sprintf("unitConversions[%d].unit is duplicated", index), nil, nil)
		}
		seenUnits[conversion.Unit.ObjectID] = true
		if _, err := fixedMicros(conversion.Factor); err != nil {
			return domainError(ErrorValidation, fmt.Sprintf("unitConversions[%d].factor is invalid", index), nil, err)
		}
	}
	if input.DefaultInputUnitID != "" && !validID(input.DefaultInputUnitID) {
		return domainError(ErrorValidation, "invalid default input unit reference", nil, nil)
	}
	if input.PricingUnitID != "" && !validID(input.PricingUnitID) {
		return domainError(ErrorValidation, "invalid pricing unit reference", nil, nil)
	}
	if input.DefaultPackagingSpec != "" {
		if _, err := fixedMicros(input.DefaultPackagingSpec); err != nil {
			return domainError(ErrorValidation, "invalid default packaging specification", nil, err)
		}
	}
	if input.Formula != nil {
		if err := validateQuantitySnapshot(input.Formula.Output, "formula.output"); err != nil {
			return err
		}
		if !seenUnits[input.Formula.Output.EnteredUnit.ObjectID] {
			return domainError(ErrorValidation, "formula output unit is not configured for product", nil, nil)
		}
		if len(input.Formula.Components) > 200 {
			return domainError(ErrorValidation, "formula must contain at most 200 components", nil, nil)
		}
		seenMaterials := make(map[string]bool, len(input.Formula.Components))
		for index, component := range input.Formula.Components {
			if !validID(component.Material.ObjectID) || (component.Material.ApprovalEntryID != "" && !validID(component.Material.ApprovalEntryID)) {
				return domainError(ErrorValidation, fmt.Sprintf("formula.components[%d].material is invalid", index), nil, nil)
			}
			if component.ResolutionStatus != "CURRENT" && component.ResolutionStatus != "UNRESOLVED" {
				return domainError(ErrorValidation, fmt.Sprintf("formula.components[%d].resolutionStatus is invalid", index), nil, nil)
			}
			if seenMaterials[component.Material.ObjectID] {
				return domainError(ErrorValidation, fmt.Sprintf("formula.components[%d].material is duplicated", index), nil, nil)
			}
			seenMaterials[component.Material.ObjectID] = true
			if err := validateQuantitySnapshot(component.Quantity, fmt.Sprintf("formula.components[%d].quantity", index)); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateProductComplete(input DetailView) error {
	if err := validateProductDraft(input); err != nil {
		return err
	}
	if !validID(input.ProductTypeID) || !validID(input.ProductTypeApprovalEntryID) || input.ProductTypeCode == "" || input.ProductTypeName == "" || !validProductBehavior(input.BehaviorProfile) {
		return domainError(ErrorValidation, "product type is required", nil, nil)
	}
	if len(input.UnitConversions) == 0 || input.DefaultInputUnitID == "" || input.PricingUnitID == "" {
		return domainError(ErrorValidation, "complete unit configuration is required", nil, nil)
	}
	byUnit := make(map[string]ProductUnitConversion, len(input.UnitConversions))
	for _, conversion := range input.UnitConversions {
		if conversion.Unit.ApprovalEntryID == "" || conversion.Unit.Code == "" || conversion.Unit.Name == "" || conversion.Unit.Symbol == "" {
			return domainError(ErrorValidation, "unit conversion snapshot is incomplete", nil, nil)
		}
		byUnit[conversion.Unit.ObjectID] = conversion
	}
	if _, ok := byUnit[input.DefaultInputUnitID]; !ok {
		return domainError(ErrorValidation, "default input unit must have a conversion", nil, nil)
	}
	pricing, ok := byUnit[input.PricingUnitID]
	if !ok {
		return domainError(ErrorValidation, "pricing unit must have a conversion", nil, nil)
	}
	if input.BehaviorProfile == ProductBehaviorPackaging {
		if input.DefaultPackagingSpec != "" || input.PricingUnitID != input.DefaultInputUnitID || input.Formula != nil {
			return domainError(ErrorValidation, "packaging product configuration is invalid", nil, nil)
		}
	} else {
		if pricing.Unit.Code != kilogramMeasurementUnitCode {
			return domainError(ErrorValidation, "goods pricing unit must be KG", nil, nil)
		}
		if input.Returnable {
			return domainError(ErrorValidation, "only packaging products can be returnable", nil, nil)
		}
		if input.DefaultPackagingSpec == "" {
			return domainError(ErrorValidation, "default packaging specification is required", nil, nil)
		}
	}
	if input.BehaviorProfile == ProductBehaviorStandardFinished {
		if input.Formula == nil || len(input.Formula.Components) == 0 {
			return domainError(ErrorValidation, "standard finished product formula is required", nil, nil)
		}
		for index, component := range input.Formula.Components {
			if component.ResolutionStatus != "CURRENT" || component.RequiresConfirmation || component.Material.ApprovalEntryID == "" || component.Material.BehaviorProfile != ProductBehaviorRawMaterial {
				return domainError(ErrorValidation, fmt.Sprintf("formula.components[%d] is unresolved", index), nil, nil)
			}
		}
	} else if input.Formula != nil {
		return domainError(ErrorValidation, "formula only applies to standard finished products", nil, nil)
	}
	return nil
}

func validateQuantitySnapshot(quantity QuantitySnapshot, path string) error {
	if _, err := fixedMicros(strings.TrimSpace(quantity.EnteredQuantity)); err != nil {
		return domainError(ErrorValidation, path+".enteredQuantity is invalid", nil, err)
	}
	if !validID(quantity.EnteredUnit.ObjectID) {
		return domainError(ErrorValidation, path+".enteredUnit is invalid", nil, nil)
	}
	if _, err := fixedMicros(strings.TrimSpace(quantity.BaseQuantity)); err != nil {
		return domainError(ErrorValidation, path+".baseQuantity is invalid", nil, err)
	}
	return nil
}

func validProductBehavior(value string) bool {
	return slices.Contains([]string{ProductBehaviorRawMaterial, ProductBehaviorStandardFinished, ProductBehaviorCustomFinished, ProductBehaviorPackaging}, value)
}

func cloneProductFormula(input *ProductFormula) *ProductFormula {
	if input == nil {
		return nil
	}
	return &ProductFormula{
		Output:     input.Output,
		Components: slices.Clone(input.Components),
	}
}

func validateSettlementRule(input DetailView) error {
	type rule struct {
		ruleType               string
		monthOffset, dayOffset int32
	}
	expected := map[string]rule{
		SettlementTermPrepaid:        {SettlementRuleRelativeDays, 0, 0},
		SettlementTermCashOnDelivery: {SettlementRuleRelativeDays, 0, 0},
		SettlementTermArrival3:       {SettlementRuleRelativeDays, 0, 3},
		SettlementTermArrival5:       {SettlementRuleRelativeDays, 0, 5},
		SettlementTermArrival7:       {SettlementRuleRelativeDays, 0, 7},
		SettlementTermArrival15:      {SettlementRuleRelativeDays, 0, 15},
		SettlementTermArrival30:      {SettlementRuleRelativeDays, 0, 30},
		SettlementTermMonthlyCurrent: {SettlementRuleMonthEnd, 0, 0},
		SettlementTermMonthly30:      {SettlementRuleMonthEnd, 1, 0},
		SettlementTermMonthly60:      {SettlementRuleMonthEnd, 2, 0},
		SettlementTermMonthly90:      {SettlementRuleMonthEnd, 3, 0},
	}
	want, ok := expected[input.TermCode]
	if !ok || input.RuleType != want.ruleType || input.MonthOffset != want.monthOffset ||
		input.DayOffset != want.dayOffset || input.DayOfMonth != nil {
		return domainError(ErrorValidation, "settlement rule does not match fixed term", nil, nil)
	}
	return nil
}

func numericField(value int32) string {
	if value == 0 {
		return ""
	}
	return fmt.Sprint(value)
}

func optionalNumericField(value *int32) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(*value)
}

func normalizeAccountNumber(value string) string {
	return strings.ToUpper(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || r == '-' {
			return -1
		}
		return r
	}, strings.TrimSpace(value)))
}

func normalizeLoadCapacity(value string) string {
	value = strings.TrimSpace(value)
	match := loadCapacityPattern.FindStringSubmatch(value)
	if match == nil {
		return value
	}
	integer := strings.TrimLeft(match[1], "0")
	if integer == "" {
		integer = "0"
	}
	fraction := match[2]
	for len(fraction) < 3 {
		fraction += "0"
	}
	return integer + "." + fraction
}

func validCustomerType(value string) bool {
	return value == CustomerTypeEndUser
}

func validCategoryTarget(value string) bool {
	return slices.Contains(entities[:], value)
}

func validateQueryFilters(entity string, input QueryFilters) (QueryFilters, error) {
	input.Keyword = strings.TrimSpace(input.Keyword)
	input.PartyKind = strings.ToUpper(strings.TrimSpace(input.PartyKind))
	input.CustomerType = strings.ToUpper(strings.TrimSpace(input.CustomerType))
	input.Currency = strings.ToUpper(strings.TrimSpace(input.Currency))
	input.ProductTypeID = strings.TrimSpace(input.ProductTypeID)
	input.TargetEntity = strings.ToLower(strings.TrimSpace(input.TargetEntity))
	input.CategoryID = strings.TrimSpace(input.CategoryID)
	input.DepartmentID = strings.TrimSpace(input.DepartmentID)
	input.PositionID = strings.TrimSpace(input.PositionID)
	input.SalespersonEmployeeID = strings.TrimSpace(input.SalespersonEmployeeID)
	input.DefaultPurchaserEmployeeID = strings.TrimSpace(input.DefaultPurchaserEmployeeID)
	input.OperatingEntityID = strings.TrimSpace(input.OperatingEntityID)
	input.ParentID = strings.TrimSpace(input.ParentID)
	if utf8.RuneCountInString(input.Keyword) > 128 || len(input.Status) > 5 ||
		(input.PartyKind != "" && input.PartyKind != PartyKindPerson && input.PartyKind != PartyKindOrganization) ||
		(input.CustomerType != "" && !validCustomerType(input.CustomerType)) ||
		(input.Currency != "" && !currencyPattern.MatchString(input.Currency)) ||
		(input.ProductTypeID != "" && !validID(input.ProductTypeID)) ||
		(input.TargetEntity != "" && !validCategoryTarget(input.TargetEntity)) ||
		(input.ParentID != "" && input.RootOnly) {
		return QueryFilters{}, domainError(ErrorValidation, "invalid query filters", nil, nil)
	}
	for _, id := range []string{
		input.CategoryID, input.DepartmentID, input.PositionID,
		input.SalespersonEmployeeID, input.DefaultPurchaserEmployeeID, input.OperatingEntityID, input.ParentID,
		input.ProductTypeID,
	} {
		if id != "" && !validID(id) {
			return QueryFilters{}, domainError(ErrorValidation, "invalid query reference filter", nil, nil)
		}
	}
	hasUnexpected := func(allowed ...string) bool {
		accepted := make(map[string]bool, len(allowed))
		for _, field := range allowed {
			accepted[field] = true
		}
		values := map[string]bool{
			"kind":              input.PartyKind != "" || input.provided["kind"],
			"merged":            input.Merged != nil || input.provided["merged"],
			"operatingEntityId": input.OperatingEntityID != "" || input.provided["operatingEntityId"],
			"customerType":      input.CustomerType != "" || input.provided["customerType"],
			"categoryId":        input.CategoryID != "" || input.provided["categoryId"],
			"departmentId":      input.DepartmentID != "" || input.provided["departmentId"],
			"positionId":        input.PositionID != "" || input.provided["positionId"],
			"salespersonEmployeeId": input.SalespersonEmployeeID != "" ||
				input.provided["salespersonEmployeeId"],
			"defaultPurchaserEmployeeId": input.DefaultPurchaserEmployeeID != "" ||
				input.provided["defaultPurchaserEmployeeId"],
			"currency":      input.Currency != "" || input.provided["currency"],
			"productTypeId": input.ProductTypeID != "" || input.provided["productTypeId"],
			"targetEntity":  input.TargetEntity != "" || input.provided["targetEntity"],
			"parentId":      input.ParentID != "" || input.provided["parentId"],
			"rootOnly":      input.RootOnly || input.provided["rootOnly"],
		}
		for field, present := range values {
			if present && !accepted[field] {
				return true
			}
		}
		return false
	}
	var unexpected bool
	switch entity {
	case EntityCustomer:
		unexpected = hasUnexpected("customerType", "salespersonEmployeeId")
	case EntityOtherUnit:
		unexpected = hasUnexpected("operatingEntityId")
	case "party":
		unexpected = hasUnexpected("kind", "merged")
	case EntityEmployee:
		unexpected = hasUnexpected("departmentId", "positionId")
	case EntityProduct:
		unexpected = hasUnexpected("categoryId", "productTypeId")
	case EntityOperatingEntity, EntityWarehouse, EntityVehicle:
		unexpected = hasUnexpected()
	case EntityFundAccount:
		unexpected = hasUnexpected("currency")
	default:
		unexpected = true
	}
	if unexpected {
		return QueryFilters{}, domainError(ErrorValidation, "query filters do not match entity", nil, nil)
	}
	return input, nil
}

func validActorAndRequest(actorID, requestID string) bool {
	return validID(actorID) && requestID != "" && len(requestID) <= 128
}

func pageOffset(page, pageSize int) (int32, bool) {
	if page < 1 || pageSize < 1 || pageSize > 100 {
		return 0, false
	}
	pageIndex := int64(page - 1)
	if pageIndex > int64(1<<31-1)/int64(pageSize) {
		return 0, false
	}
	offset := pageIndex * int64(pageSize)
	return int32(offset), true
}

func validEntity(entity string) bool { return slices.Contains(entities[:], entity) }

func validStatus(status string) bool {
	return slices.Contains([]string{string(approval.StatusDraft), string(approval.StatusPending), string(approval.StatusApproved)}, status)
}

func validID(id string) bool {
	parsed, err := ulid.ParseStrict(id)
	return err == nil && parsed.String() == id
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func optionalComment(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*value)
	if utf8.RuneCountInString(trimmed) > 1000 {
		return nil, domainError(ErrorValidation, "comment is too long", nil, nil)
	}
	if trimmed == "" {
		return nil, nil
	}
	return &trimmed, nil
}

func runeLengthBetween(value string, minimum, maximum int) bool {
	length := utf8.RuneCountInString(value)
	return length >= minimum && length <= maximum
}
