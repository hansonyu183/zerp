package bob

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

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
	moneyPattern         = regexp.MustCompile(`^(0|[0-9]{1,12})(?:\.([0-9]{1,2}))?$`)
)

func validateCreate(entity string, input CreateDetailInput) (DetailView, string, error) {
	supplierType := input.SupplierType
	if entity == EntitySupplier && supplierType == nil {
		value := SupplierTypeGeneral
		supplierType = &value
	}
	customerType := input.CustomerType
	if (entity == EntityCustomer || entity == EntityOtherParty) && customerType == nil {
		value := CustomerTypeEndUser
		customerType = &value
	}
	monthlyClosingDay := input.MonthlyClosingDay
	if entity == EntityCustomer && monthlyClosingDay == 0 {
		monthlyClosingDay = 31
	}
	data := DetailView{
		Name: input.Name, Unit: input.Unit, Currency: input.Currency,
		SupplierType: deref(supplierType), CustomerType: deref(customerType),
		PlateNumber: input.PlateNumber, VehicleType: input.VehicleType,
		PlatformObjectID: input.PlatformObjectID, TargetEntity: input.TargetEntity,
		ShortName: input.ShortName, CategoryID: input.CategoryID, TaxNumber: input.TaxNumber,
		ContactName: input.ContactName, ContactPhone: input.ContactPhone, Email: input.Email,
		Address: input.Address, Remark: input.Remark, DepartmentID: input.DepartmentID,
		PositionID: input.PositionID, Phone: input.Phone, HireDate: input.HireDate,
		Specification: input.Specification, Model: input.Model, Barcode: input.Barcode,
		Description: input.Description, ManagerEmployeeID: input.ManagerEmployeeID,
		VIN: input.VIN, EngineNumber: input.EngineNumber, LoadCapacityKG: input.LoadCapacityKG,
		AccountName: input.AccountName, BankName: input.BankName, BankBranch: input.BankBranch,
		AccountNumber: input.AccountNumber, ParentID: input.ParentID,
		SettlementMethodID: input.SettlementMethodID, MonthlyClosingDay: monthlyClosingDay,
		SalespersonEmployeeID: input.SalespersonEmployeeID,
		RuleType:              input.RuleType,
		MonthOffset:           input.MonthOffset, DayOfMonth: input.DayOfMonth, DayOffset: input.DayOffset,
		ContainerType: input.ContainerType, QuantityPerContainer: input.QuantityPerContainer,
		ProductKind: input.ProductKind, InventoryUnitID: input.InventoryUnitID,
		PricingUnitID:                   input.PricingUnitID,
		PricingQuantityPerInventoryUnit: input.PricingQuantityPerInventoryUnit,
		Returnable:                      input.Returnable, PackagingSpecs: input.PackagingSpecs,
		Formula: cloneProductFormula(input.Formula), TermCode: input.TermCode,
		DefaultSalesSurcharge: input.DefaultSalesSurcharge,
	}
	if entity == EntityProduct && data.ContainerType == "" {
		data.ContainerType = ContainerTypeNone
	}
	if entity == EntityProduct {
		if data.ProductKind == "" {
			data.ProductKind = ProductKindRawMaterial
		}
		if data.InventoryUnitID == "" {
			data.InventoryUnitID = legacyUnitID(data.Unit)
		}
		if data.PricingUnitID == "" {
			data.PricingUnitID = "01JAVX00000000000000000011"
		}
		if data.PricingQuantityPerInventoryUnit == "" {
			if slices.Contains([]string{"吨", "ton", "t"}, strings.ToLower(strings.TrimSpace(data.Unit))) {
				data.PricingQuantityPerInventoryUnit = "1000"
			} else {
				data.PricingQuantityPerInventoryUnit = "1"
			}
		}
	}
	if entity == EntityService && data.InventoryUnitID == "" {
		data.InventoryUnitID = legacyUnitID(data.Unit)
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
	result.PlatformObjectID = input.PlatformObjectID
	result.RuleType = input.RuleType
	result.MonthOffset = input.MonthOffset
	result.DayOfMonth = input.DayOfMonth
	result.DayOffset = input.DayOffset
	if input.ProductKind != nil {
		result.ProductKind = *input.ProductKind
	}
	if input.Returnable != nil {
		result.Returnable = *input.Returnable
	}
	if input.PackagingSpecs != nil {
		result.PackagingSpecs = slices.Clone(*input.PackagingSpecs)
	}
	if input.Formula != nil {
		result.Formula = cloneProductFormula(input.Formula)
	}
	if input.ProductKind != nil && *input.ProductKind != ProductKindStandardFinished && input.Formula == nil {
		result.Formula = nil
	}
	if input.ContainerType != nil {
		result.ContainerType = *input.ContainerType
	}
	if input.SupplierType != nil {
		result.SupplierType = *input.SupplierType
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
	mergeOptional(input.ParentID, &result.ParentID)
	mergeOptional(input.SettlementMethodID, &result.SettlementMethodID)
	if input.MonthlyClosingDay != nil {
		result.MonthlyClosingDay = *input.MonthlyClosingDay
	}
	if input.DefaultSalesSurcharge != nil {
		result.DefaultSalesSurcharge = *input.DefaultSalesSurcharge
	}
	mergeOptional(input.SalespersonEmployeeID, &result.SalespersonEmployeeID)
	mergeOptional(input.QuantityPerContainer, &result.QuantityPerContainer)
	mergeOptional(input.InventoryUnitID, &result.InventoryUnitID)
	mergeOptional(input.PricingUnitID, &result.PricingUnitID)
	mergeOptional(input.PricingQuantityPerInventoryUnit, &result.PricingQuantityPerInventoryUnit)
	return result
}

// validateDetail remains the focused validation entry point used by unit tests
// and callers that do not need save-time merge semantics.
func validateDetail(entity string, input DetailInput) (DetailView, error) {
	if err := validateDetailInputFields(entity, input); err != nil {
		return DetailView{}, err
	}
	current := DetailView{}
	if entity == EntitySupplier {
		current.SupplierType = SupplierTypeGeneral
	}
	if entity == EntityCustomer || entity == EntityOtherParty {
		current.CustomerType = CustomerTypeEndUser
		current.MonthlyClosingDay = 31
	}
	if entity == EntityProduct {
		current.ContainerType = ContainerTypeNone
		current.ProductKind = ProductKindRawMaterial
		current.PricingUnitID = "01JAVX00000000000000000011"
		current.PricingQuantityPerInventoryUnit = "1"
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
	case EntityOtherParty:
		allow("shortName", "taxNumber", "contactName", "contactPhone", "email", "address", "remark", "settlementMethodId", "salespersonEmployeeId")
	case EntitySupplier:
		allow("shortName", "taxNumber", "contactName", "contactPhone", "email", "address", "remark", "settlementMethodId", "salespersonEmployeeId")
	case EntityEmployee:
		allow("departmentId", "positionId", "phone", "email", "hireDate", "remark")
	case EntityProduct:
		allow("categoryId", "specification", "model", "barcode", "remark", "quantityPerContainer",
			"inventoryUnitId", "pricingUnitId", "pricingQuantityPerInventoryUnit",
			"productKind", "returnable", "packagingSpecs", "formula")
	case EntityService:
		allow("description", "remark", "inventoryUnitId")
	case EntityWarehouse:
		allow("address", "contactName", "contactPhone", "managerEmployeeId", "remark")
	case EntityVehicle:
		allow("vin", "engineNumber", "loadCapacityKg", "remark")
	case EntityFundAccount:
		allow("accountName", "bankName", "bankBranch", "accountNumber", "remark")
	case EntityCategory:
		allow("parentId", "description")
	case EntityDepartment:
		allow("categoryId", "parentId", "description")
	case EntityPosition:
		allow("categoryId", "description")
	case EntitySettlementMethod:
		allow("defaultSalesSurcharge")
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
		"monthlyClosingDay":               input.MonthlyClosingDay != nil,
		"defaultSalesSurcharge":           input.DefaultSalesSurcharge != nil,
		"salespersonEmployeeId":           input.SalespersonEmployeeID.Set,
		"quantityPerContainer":            input.QuantityPerContainer.Set,
		"inventoryUnitId":                 input.InventoryUnitID.Set,
		"pricingUnitId":                   input.PricingUnitID.Set,
		"pricingQuantityPerInventoryUnit": input.PricingQuantityPerInventoryUnit.Set,
		"productKind":                     input.ProductKind != nil,
		"returnable":                      input.Returnable != nil,
		"packagingSpecs":                  input.PackagingSpecs != nil,
		"formula":                         input.Formula != nil,
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
	if !runeLengthBetween(input.Name, 1, 200) {
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
		&input.VehicleType,
		&input.QuantityPerContainer, &input.PricingQuantityPerInventoryUnit,
		&input.DefaultSalesSurcharge,
	} {
		trim(value)
	}
	for _, value := range []*string{
		&input.Currency, &input.SupplierType, &input.CustomerType, &input.PlateNumber, &input.VehicleType,
		&input.TaxNumber, &input.Barcode, &input.VIN, &input.RuleType, &input.TermCode,
		&input.ContainerType, &input.ProductKind,
	} {
		*value = strings.ToUpper(strings.TrimSpace(*value))
	}
	for _, value := range []*string{
		&input.PlatformObjectID, &input.CategoryID, &input.DepartmentID, &input.PositionID,
		&input.ManagerEmployeeID, &input.ParentID, &input.SettlementMethodID, &input.SalespersonEmployeeID,
		&input.InventoryUnitID, &input.PricingUnitID,
	} {
		trim(value)
	}
	input.Email = strings.ToLower(input.Email)
	input.TargetEntity = strings.ToLower(strings.TrimSpace(input.TargetEntity))
	input.AccountNumber = normalizeAccountNumber(input.AccountNumber)
	if input.LoadCapacityKG != "" {
		input.LoadCapacityKG = normalizeLoadCapacity(input.LoadCapacityKG)
	}
	for index := range input.PackagingSpecs {
		spec := &input.PackagingSpecs[index]
		spec.PackagingProductObjectID = strings.TrimSpace(spec.PackagingProductObjectID)
		spec.PackagingProductVersionID = strings.TrimSpace(spec.PackagingProductVersionID)
		spec.ContentQuantity = strings.TrimSpace(spec.ContentQuantity)
	}
	if input.Formula != nil {
		input.Formula.BaseOutputQuantity = strings.TrimSpace(input.Formula.BaseOutputQuantity)
		for index := range input.Formula.Components {
			component := &input.Formula.Components[index]
			component.Material.ObjectID = strings.TrimSpace(component.Material.ObjectID)
			component.Material.VersionID = strings.TrimSpace(component.Material.VersionID)
			component.Quantity = strings.TrimSpace(component.Quantity)
		}
	}
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
	case EntityOtherParty:
		allow("customerType", "shortName", "taxNumber", "contactName", "contactPhone", "email", "address", "remark", "settlementMethodId", "salespersonEmployeeId")
		if !objectCodePattern.MatchString(input.CustomerType) {
			return domainError(ErrorValidation, "invalid customer type code", nil, nil)
		}
		if input.SalespersonEmployeeID == "" {
			return domainError(ErrorValidation, "salesperson employee is required", nil, nil)
		}
	case EntitySupplier:
		allow("supplierType", "shortName", "taxNumber", "contactName", "contactPhone", "email", "address", "remark", "settlementMethodId", "salespersonEmployeeId")
		if !validSupplierType(input.SupplierType) {
			return domainError(ErrorValidation, "invalid supplier type", nil, nil)
		}
		if input.SalespersonEmployeeID == "" {
			return domainError(ErrorValidation, "salesperson employee is required", nil, nil)
		}
	case EntityEmployee:
		allow("departmentId", "positionId", "phone", "email", "hireDate", "remark")
	case EntityProduct:
		allow("unit", "containerType", "quantityPerContainer", "categoryId", "specification", "model", "barcode", "remark",
			"productKind", "inventoryUnitId", "pricingUnitId", "pricingQuantityPerInventoryUnit", "returnable", "packagingSpecs", "formula")
		if !runeLengthBetween(input.Unit, 1, 32) {
			return domainError(ErrorValidation, "invalid unit", nil, nil)
		}
		if err := validateProductContainer(input); err != nil {
			return err
		}
		if err := validateProductModel(input); err != nil {
			return err
		}
	case EntityService:
		allow("unit", "inventoryUnitId", "description", "remark")
		if !runeLengthBetween(input.Unit, 1, 32) {
			return domainError(ErrorValidation, "invalid unit", nil, nil)
		}
		if !validID(input.InventoryUnitID) {
			return domainError(ErrorValidation, "invalid service unit reference", nil, nil)
		}
	case EntityWarehouse:
		allow("address", "contactName", "contactPhone", "managerEmployeeId", "remark")
	case EntityVehicle:
		allow("plateNumber", "vehicleType", "platformObjectId", "vin", "engineNumber", "loadCapacityKg", "remark")
		if !runeLengthBetween(input.PlateNumber, 1, 32) ||
			!runeLengthBetween(input.VehicleType, 1, 64) ||
			!validID(input.PlatformObjectID) {
			return domainError(ErrorValidation, "invalid vehicle fields", nil, nil)
		}
	case EntityFundAccount:
		allow("currency", "accountName", "bankName", "bankBranch", "accountNumber", "remark")
		if !currencyPattern.MatchString(input.Currency) {
			return domainError(ErrorValidation, "invalid currency", nil, nil)
		}
	case EntityCategory:
		allow("targetEntity", "parentId", "description")
		if !validCategoryTarget(input.TargetEntity) {
			return domainError(ErrorValidation, "invalid category target", nil, nil)
		}
	case EntityDepartment:
		allow("categoryId", "parentId", "description")
	case EntityPosition:
		allow("categoryId", "description")
	case EntitySettlementMethod:
		allow("termCode", "ruleType", "monthOffset", "dayOfMonth", "dayOffset", "description", "defaultSalesSurcharge")
		if !validSettlementTerm(input.TermCode) {
			return domainError(ErrorValidation, "invalid settlement term", nil, nil)
		}
		if err := validateSettlementRule(input); err != nil {
			return err
		}
		if _, err := moneyCents(input.DefaultSalesSurcharge); err != nil {
			return domainError(ErrorValidation, "invalid default sales surcharge", nil, nil)
		}
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
		input.InventoryUnitID, input.PricingUnitID,
	} {
		if id != "" && !validID(id) {
			return domainError(ErrorValidation, "invalid reference id", nil, nil)
		}
	}
	return nil
}

func detailFieldValues(input DetailView) map[string]string {
	return map[string]string{
		"unit": input.Unit, "currency": input.Currency, "supplierType": input.SupplierType,
		"customerType": input.CustomerType, "plateNumber": input.PlateNumber,
		"vehicleType": input.VehicleType, "platformObjectId": input.PlatformObjectID,
		"targetEntity": input.TargetEntity, "shortName": input.ShortName, "categoryId": input.CategoryID,
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
		"containerType": input.ContainerType, "quantityPerContainer": input.QuantityPerContainer,
		"productKind": input.ProductKind, "inventoryUnitId": input.InventoryUnitID,
		"pricingUnitId":                   input.PricingUnitID,
		"pricingQuantityPerInventoryUnit": input.PricingQuantityPerInventoryUnit,
		"returnable":                      boolField(input.Returnable), "packagingSpecs": sliceField(len(input.PackagingSpecs)),
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

func validateProductContainer(input DetailView) error {
	switch input.ContainerType {
	case ContainerTypeNone:
		if input.QuantityPerContainer != "" {
			return domainError(ErrorValidation, "quantity per container is not allowed for NONE", nil, nil)
		}
	case ContainerTypeSolvent, ContainerTypeResin:
		if _, err := fixedMicros(input.QuantityPerContainer); err != nil {
			return domainError(ErrorValidation, "invalid quantity per container", nil, err)
		}
	default:
		return domainError(ErrorValidation, "invalid container type", nil, nil)
	}
	return nil
}

func validateProductModel(input DetailView) error {
	if !slices.Contains([]string{
		ProductKindRawMaterial, ProductKindStandardFinished,
		ProductKindCustomFinished, ProductKindPackaging,
	}, input.ProductKind) {
		return domainError(ErrorValidation, "invalid product kind", nil, nil)
	}
	if !validID(input.InventoryUnitID) || !validID(input.PricingUnitID) {
		return domainError(ErrorValidation, "invalid product unit reference", nil, nil)
	}
	if _, err := fixedMicros(input.PricingQuantityPerInventoryUnit); err != nil {
		return domainError(ErrorValidation, "invalid pricing conversion", nil, err)
	}
	if input.ProductKind != ProductKindPackaging && input.Returnable {
		return domainError(ErrorValidation, "only packaging products can be returnable", nil, nil)
	}
	if input.ProductKind == ProductKindPackaging && len(input.PackagingSpecs) > 0 {
		return domainError(ErrorValidation, "packaging products cannot contain packaging specifications", nil, nil)
	}
	if input.ProductKind == ProductKindStandardFinished {
		if input.Formula == nil {
			return domainError(ErrorValidation, "standard finished product formula is required", nil, nil)
		}
		if _, err := fixedMicros(input.Formula.BaseOutputQuantity); err != nil {
			return domainError(ErrorValidation, "invalid formula base output quantity", nil, err)
		}
		if len(input.Formula.Components) == 0 || len(input.Formula.Components) > 200 {
			return domainError(ErrorValidation, "formula must contain 1 to 200 components", nil, nil)
		}
		seenMaterials := make(map[string]bool, len(input.Formula.Components))
		for _, component := range input.Formula.Components {
			if !validID(component.Material.ObjectID) || !validID(component.Material.VersionID) {
				return domainError(ErrorValidation, "invalid formula material reference", nil, nil)
			}
			if seenMaterials[component.Material.ObjectID] {
				return domainError(ErrorValidation, "duplicate formula material", nil, nil)
			}
			seenMaterials[component.Material.ObjectID] = true
			if _, err := fixedMicros(component.Quantity); err != nil {
				return domainError(ErrorValidation, "invalid formula material quantity", nil, err)
			}
		}
	} else if input.Formula != nil {
		return domainError(ErrorValidation, "formula only applies to standard finished products", nil, nil)
	}
	seen := make(map[string]bool, len(input.PackagingSpecs))
	defaults := 0
	for _, spec := range input.PackagingSpecs {
		if !validID(spec.PackagingProductObjectID) || !validID(spec.PackagingProductVersionID) {
			return domainError(ErrorValidation, "invalid packaging product reference", nil, nil)
		}
		if seen[spec.PackagingProductObjectID] {
			return domainError(ErrorValidation, "duplicate packaging product", nil, nil)
		}
		seen[spec.PackagingProductObjectID] = true
		if _, err := fixedMicros(spec.ContentQuantity); err != nil {
			return domainError(ErrorValidation, "invalid packaging content quantity", nil, err)
		}
		if spec.IsDefault {
			defaults++
		}
	}
	if defaults > 1 {
		return domainError(ErrorValidation, "only one packaging specification can be default", nil, nil)
	}
	return nil
}

func cloneProductFormula(input *ProductFormula) *ProductFormula {
	if input == nil {
		return nil
	}
	return &ProductFormula{
		BaseOutputQuantity: input.BaseOutputQuantity,
		Components:         slices.Clone(input.Components),
	}
}

func legacyUnitID(unit string) string {
	switch strings.ToLower(strings.TrimSpace(unit)) {
	case "kg":
		return "01JAVX00000000000000000011"
	case "件", "piece", "unit":
		return "01JAVX00000000000000000013"
	case "年":
		return "01JAVX00000000000000000015"
	case "次", "occurrence":
		return "01JAVX00000000000000000017"
	case "小时", "hour":
		return "01JAVX00000000000000000025"
	case "吨", "ton", "t":
		return "01JAVX00000000000000000027"
	default:
		return ""
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

func validSettlementTerm(value string) bool {
	return slices.Contains([]string{
		SettlementTermPrepaid,
		SettlementTermCashOnDelivery,
		SettlementTermArrival3,
		SettlementTermArrival5,
		SettlementTermArrival7,
		SettlementTermArrival15,
		SettlementTermArrival30,
		SettlementTermMonthlyCurrent,
		SettlementTermMonthly30,
		SettlementTermMonthly60,
		SettlementTermMonthly90,
	}, value)
}

func moneyCents(value string) (int64, error) {
	if !moneyPattern.MatchString(value) {
		return 0, domainError(ErrorValidation, "invalid amount", nil, nil)
	}
	parts := strings.SplitN(value, ".", 2)
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, domainError(ErrorValidation, "invalid amount", nil, err)
	}
	fraction := "00"
	if len(parts) == 2 {
		fraction = parts[1] + strings.Repeat("0", 2-len(parts[1]))
	}
	cents, err := strconv.ParseInt(fraction, 10, 64)
	if err != nil {
		return 0, domainError(ErrorValidation, "invalid amount", nil, err)
	}
	return whole*100 + cents, nil
}

func formatMoneyCents(value int64) string {
	return fmt.Sprintf("%d.%02d", value/100, value%100)
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

func validSupplierType(value string) bool {
	return slices.Contains([]string{SupplierTypeGeneral, SupplierTypeLogisticsPlatform}, value)
}

func validCustomerType(value string) bool {
	return slices.Contains([]string{CustomerTypeEndUser, CustomerTypeDealer}, value)
}

func validCategoryTarget(value string) bool {
	return value != EntityCategory && value != EntitySettlementMethod && slices.Contains(entities[:], value)
}

func validateQueryFilters(entity string, input QueryFilters) (QueryFilters, error) {
	input.Keyword = strings.TrimSpace(input.Keyword)
	input.CustomerType = strings.ToUpper(strings.TrimSpace(input.CustomerType))
	input.SupplierType = strings.ToUpper(strings.TrimSpace(input.SupplierType))
	input.Currency = strings.ToUpper(strings.TrimSpace(input.Currency))
	input.ProductKind = strings.ToUpper(strings.TrimSpace(input.ProductKind))
	input.TargetEntity = strings.ToLower(strings.TrimSpace(input.TargetEntity))
	input.CategoryID = strings.TrimSpace(input.CategoryID)
	input.DepartmentID = strings.TrimSpace(input.DepartmentID)
	input.PositionID = strings.TrimSpace(input.PositionID)
	input.SalespersonEmployeeID = strings.TrimSpace(input.SalespersonEmployeeID)
	input.ParentID = strings.TrimSpace(input.ParentID)
	if utf8.RuneCountInString(input.Keyword) > 128 || len(input.Status) > 5 ||
		(input.CustomerType != "" && !validCustomerType(input.CustomerType)) ||
		(input.SupplierType != "" && !validSupplierType(input.SupplierType)) ||
		(input.Currency != "" && !currencyPattern.MatchString(input.Currency)) ||
		(input.ProductKind != "" && !slices.Contains([]string{
			ProductKindRawMaterial, ProductKindStandardFinished,
			ProductKindCustomFinished, ProductKindPackaging,
		}, input.ProductKind)) ||
		(input.TargetEntity != "" && !validCategoryTarget(input.TargetEntity)) ||
		(input.ParentID != "" && input.RootOnly) {
		return QueryFilters{}, domainError(ErrorValidation, "invalid query filters", nil, nil)
	}
	for _, id := range []string{
		input.CategoryID, input.DepartmentID, input.PositionID,
		input.SalespersonEmployeeID, input.ParentID,
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
			"customerType": input.CustomerType != "" || input.provided["customerType"],
			"supplierType": input.SupplierType != "" || input.provided["supplierType"],
			"categoryId":   input.CategoryID != "" || input.provided["categoryId"],
			"departmentId": input.DepartmentID != "" || input.provided["departmentId"],
			"positionId":   input.PositionID != "" || input.provided["positionId"],
			"salespersonEmployeeId": input.SalespersonEmployeeID != "" ||
				input.provided["salespersonEmployeeId"],
			"currency":     input.Currency != "" || input.provided["currency"],
			"productKind":  input.ProductKind != "" || input.provided["productKind"],
			"targetEntity": input.TargetEntity != "" || input.provided["targetEntity"],
			"parentId":     input.ParentID != "" || input.provided["parentId"],
			"rootOnly":     input.RootOnly || input.provided["rootOnly"],
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
	case EntityCustomer, EntityOtherParty:
		unexpected = hasUnexpected("customerType", "salespersonEmployeeId")
	case EntitySupplier:
		unexpected = hasUnexpected("supplierType", "salespersonEmployeeId")
	case EntityEmployee:
		unexpected = hasUnexpected("departmentId", "positionId")
	case EntityProduct:
		unexpected = hasUnexpected("categoryId", "productKind")
	case EntityService, EntityWarehouse, EntityVehicle:
		unexpected = hasUnexpected()
	case EntityFundAccount:
		unexpected = hasUnexpected("currency")
	case EntityCategory:
		unexpected = hasUnexpected("targetEntity", "parentId", "rootOnly")
	case EntityDepartment:
		unexpected = hasUnexpected("categoryId", "parentId", "rootOnly")
	case EntityPosition:
		unexpected = hasUnexpected("categoryId")
	case EntitySettlementMethod:
		unexpected = hasUnexpected()
	default:
		unexpected = true
	}
	if unexpected {
		return QueryFilters{}, domainError(ErrorValidation, "query filters do not match entity", nil, nil)
	}
	return input, nil
}

func validWriteInput(entity, objectID, versionID string, revision int64, actorID, requestID string) bool {
	return validEntity(entity) && validID(objectID) && validID(versionID) && revision >= 1 && validActorAndRequest(actorID, requestID)
}

func validDeleteInput(entity string, input DeleteInput) bool {
	return validEntity(entity) &&
		validID(input.ObjectID) &&
		validID(input.VersionID) &&
		input.ObjectRevision >= 1 &&
		input.Revision >= 1
}

func validReverseInput(entity string, input ReverseInput, actorID, requestID string) bool {
	return validEntity(entity) &&
		validID(input.ObjectID) &&
		validID(input.VersionID) &&
		input.ObjectRevision >= 1 &&
		input.Revision >= 1 &&
		validActorAndRequest(actorID, requestID)
}

func validActorAndRequest(actorID, requestID string) bool {
	return validID(actorID) && requestID != "" && len(requestID) <= 128
}

func validHistoryInput(entity string, input HistoryInput) bool {
	_, validPage := pageOffset(input.Page, input.PageSize)
	return validEntity(entity) && validID(input.ObjectID) && validPage
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

func mustPageOffset(page, pageSize int) int32 {
	offset, _ := pageOffset(page, pageSize)
	return offset
}

func validEntity(entity string) bool { return slices.Contains(entities[:], entity) }

func validStatus(status string) bool {
	return slices.Contains([]string{StatusDraft, StatusPending, StatusEffective, StatusInvalid}, status)
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

func requiredComment(value *string) (*string, error) {
	comment, err := optionalComment(value)
	if err != nil {
		return nil, err
	}
	if comment == nil {
		return nil, domainError(ErrorValidation, "comment is required", nil, nil)
	}
	return comment, nil
}
