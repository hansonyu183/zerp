package bob

import (
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"
)

func errorIsKind(err error, kind ErrorKind) bool {
	var target *DomainError
	return errors.As(err, &target) && target.Kind == kind
}

func TestSalesPartnerCapabilitiesAreClosedAndRequiredForSubmission(t *testing.T) {
	valid, err := normalizeSalesPartnerCapabilities([]string{
		SalesCapabilityChannelPartner,
		SalesCapabilityExternalPartTime,
		SalesCapabilityChannelPartner,
	})
	if err != nil {
		t.Fatalf("normalize valid capabilities: %v", err)
	}
	if diff := strings.Join(valid, ","); diff != "CHANNEL_PARTNER,EXTERNAL_PART_TIME" {
		t.Fatalf("capabilities = %q", diff)
	}
	if _, err = normalizeSalesPartnerCapabilities([]string{"DEALER"}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("legacy DEALER capability error = %v", err)
	}
	if err = validateEffectiveSalesPartnerCapabilities(nil); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("empty effective capabilities error = %v", err)
	}
}

func TestExactAuxiliarySnapshotsDoNotRequireCurrentSource(t *testing.T) {
	t.Parallel()
	service := &Service{}
	const objectID = "01JAVX00000000000000000011"

	employee, err := service.ResolveEmployeeAuxiliaryReferences(t.Context(), nil, EmployeeData{
		Department: &EmployeeReferenceSnapshot{ObjectID: objectID, Code: "DEP-0001", Name: "生产部"},
	}, true)
	if err != nil || employee.Department == nil || employee.Department.Name != "生产部" {
		t.Fatalf("exact employee snapshot = %+v, err = %v", employee, err)
	}

	other, err := service.ResolveOtherUnitDeclaration(t.Context(), nil, DetailView{
		SettlementMethodID: objectID, SettlementMethodCode: "SET-0001", SettlementMethodName: "预付",
		TermCode: SettlementTermPrepaid, RuleType: SettlementRuleRelativeDays,
	}, true)
	if err != nil || other.SettlementMethodName != "预付" {
		t.Fatalf("exact settlement snapshot = %+v, err = %v", other, err)
	}

	vehicle, err := service.ResolveVehicleType(t.Context(), nil, VehicleData{
		Name: "车辆", PlateNumber: "粤A12345", VehicleTypeObjectID: objectID, VehicleType: "DIT-0001", VehicleTypeName: "厢式货车",
	}, true)
	if err != nil || vehicle.VehicleTypeName != "厢式货车" {
		t.Fatalf("exact vehicle type snapshot = %+v, err = %v", vehicle, err)
	}
}

func TestOperatingEntityUsesLegalInvoiceFields(t *testing.T) {
	data, _, err := validateCreate(EntityOperatingEntity, CreateDetailInput{
		Name: "深圳示例科技有限公司", ShortName: "深圳示例", TaxNumber: "91440300TEST000001",
		Address: "深圳市南山区", Phone: "0755-12345678", Remark: "开票主体",
	})
	if err != nil {
		t.Fatalf("validate operating entity: %v", err)
	}
	if data.Name != "深圳示例科技有限公司" || data.TaxNumber != "91440300TEST000001" {
		t.Fatalf("unexpected operating entity: %#v", data)
	}
}

func TestValidateCreateIgnoresInternalFixtureCodeAndNormalizesEntityFields(t *testing.T) {
	const platformObjectID = "01J00000000000000000000020"
	const salespersonEmployeeID = "01J00000000000000000000021"
	tests := []struct {
		entity string
		input  CreateDetailInput
	}{
		{EntityCustomer, CreateDetailInput{
			Code: " cus.01 ", Name: " Customer ", SalespersonEmployeeID: salespersonEmployeeID,
		}},
		{EntityEmployee, CreateDetailInput{Code: "emp_01", Name: "Employee"}},
		{EntityProduct, CreateDetailInput{Code: "prd01", Name: "Product", DefaultPackagingSpec: "1"}},
		{EntityWarehouse, CreateDetailInput{Code: "wh01", Name: "主仓"}},
		{EntityVehicle, CreateDetailInput{
			Code: "veh01", Name: "配送车", PlateNumber: " 沪a12345 ",
			VehicleType: " 厢式货车 ", CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: platformObjectID},
		}},
		{EntityFundAccount, CreateDetailInput{Code: "cash01", Name: "Cash", Currency: "cny", OperatingEntityID: "01J00000000000000000000030"}},
	}
	for _, test := range tests {
		t.Run(test.entity, func(t *testing.T) {
			data, code, err := validateCreate(test.entity, test.input)
			if err != nil {
				t.Fatalf("validateCreate: %v", err)
			}
			if code != "" {
				t.Fatalf("fixture code leaked into validation result: %q", code)
			}
			if data.Name == "" {
				t.Fatal("name was not normalized")
			}
			if test.entity == EntityFundAccount && data.Currency != "CNY" {
				t.Fatalf("currency = %q", data.Currency)
			}
			if test.entity == EntityCustomer && data.CustomerType != CustomerTypeEndUser {
				t.Fatalf("customer type = %v", data.CustomerType)
			}
			if test.entity == EntityCustomer && data.MonthlyClosingDay != 31 {
				t.Fatalf("monthly closing day = %d", data.MonthlyClosingDay)
			}
			if test.entity == EntityVehicle &&
				(data.PlateNumber != "沪A12345" || data.VehicleType != "厢式货车") {
				t.Fatalf("vehicle data = %+v", data)
			}
		})
	}
}

func TestValidateProductDraftAllowsIncompleteConfiguration(t *testing.T) {
	t.Parallel()
	data, _, err := validateCreate(EntityProduct, CreateDetailInput{Name: "待完善产品"})
	if err != nil {
		t.Fatalf("incomplete product draft rejected: %v", err)
	}
	if data.Name != "待完善产品" || data.ProductTypeID != "" || len(data.UnitConversions) != 0 {
		t.Fatalf("unexpected draft normalization: %+v", data)
	}

	invalid := CreateDetailInput{Name: "错误换算", UnitConversions: []ProductUnitConversion{{
		Unit: MeasurementUnitSnapshot{ObjectID: "bad"}, Factor: "0",
	}}}
	if _, _, err = validateCreate(EntityProduct, invalid); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("malformed populated conversion error = %v", err)
	}
}

func TestValidateCompleteProductConfiguration(t *testing.T) {
	t.Parallel()
	unit := MeasurementUnitSnapshot{ObjectID: "01JAVX00000000000000000011", Code: "UNT-0001", Name: "千克", Symbol: "kg"}
	valid := DetailView{
		Name: "固定配方成品", ProductTypeID: "01JPTY00000000000000000003",
		ProductTypeCode: "PTY-0002",
		ProductTypeName: "标准成品", BehaviorProfile: ProductBehaviorStandardFinished,
		DefaultInputUnitID: unit.ObjectID, PricingUnitID: unit.ObjectID,
		UnitConversions:      []ProductUnitConversion{{Unit: unit, Factor: "1"}},
		DefaultPackagingSpec: "10",
		Formula: &ProductFormula{
			Output: QuantitySnapshot{EnteredQuantity: "100", EnteredUnit: unit, BaseQuantity: "100"},
			Components: []ProductFormulaComponent{{
				Material: FormulaMaterialReference{
					ObjectID:        "01J00000000000000000000031",
					ApprovalEntryID: "01J00000000000000000000032",
					BehaviorProfile: ProductBehaviorRawMaterial,
				},
				Quantity:         QuantitySnapshot{EnteredQuantity: "25.5", EnteredUnit: unit, BaseQuantity: "25.5"},
				ResolutionStatus: "CURRENT",
			}},
		},
	}
	if err := validateProductComplete(valid); err != nil {
		t.Fatalf("valid standard formula rejected: %v", err)
	}
	missing := valid
	missing.Formula = nil
	if err := validateProductComplete(missing); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("missing standard formula error = %v", err)
	}

	missingPackaging := valid
	missingPackaging.DefaultPackagingSpec = ""
	if err := validateProductComplete(missingPackaging); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("missing packaging specification error = %v", err)
	}

	invalidOutputUnit := valid
	invalidOutputUnit.Formula = cloneProductFormula(valid.Formula)
	invalidOutputUnit.Formula.Output.EnteredUnit.ObjectID = "01JAVX00000000000000000013"
	if err := validateProductComplete(invalidOutputUnit); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("formula output unit outside product conversions error = %v", err)
	}

	duplicate := valid
	duplicate.Formula = cloneProductFormula(valid.Formula)
	duplicate.Formula.Components = append(
		duplicate.Formula.Components,
		ProductFormulaComponent{
			Material: FormulaMaterialReference{
				ObjectID:        "01J00000000000000000000031",
				ApprovalEntryID: "01J00000000000000000000033",
			},
			Quantity:         QuantitySnapshot{EnteredQuantity: "1", EnteredUnit: unit, BaseQuantity: "1"},
			ResolutionStatus: "CURRENT",
		},
	)
	if err := validateProductComplete(duplicate); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("duplicate formula material error = %v", err)
	}
}

func TestValidateProductDataDefaultsFormulaResolutionStatus(t *testing.T) {
	t.Parallel()
	unitID := "01JAVX00000000000000000011"
	validated, err := ValidateProductData(DetailView{
		Name:               "固定配方成品",
		ProductTypeID:      "01JPTY00000000000000000003",
		DefaultInputUnitID: unitID,
		PricingUnitID:      unitID,
		UnitConversions: []ProductUnitConversion{{
			Unit: MeasurementUnitSnapshot{ObjectID: unitID}, Factor: "1",
		}},
		DefaultPackagingSpec: "10",
		Formula: &ProductFormula{
			Output: QuantitySnapshot{EnteredQuantity: "1", EnteredUnit: MeasurementUnitSnapshot{ObjectID: unitID}, BaseQuantity: "1"},
			Components: []ProductFormulaComponent{{
				Material: FormulaMaterialReference{ObjectID: "01J00000000000000000000031", ApprovalEntryID: "01J00000000000000000000032"},
				Quantity: QuantitySnapshot{EnteredQuantity: "1", EnteredUnit: MeasurementUnitSnapshot{ObjectID: unitID}, BaseQuantity: "1"},
			}},
		},
	})
	if err != nil {
		t.Fatalf("ValidateProductData() error = %v", err)
	}
	if got := validated.Formula.Components[0].ResolutionStatus; got != "CURRENT" {
		t.Fatalf("resolution status = %q, want CURRENT", got)
	}
}

func TestValidateDetailRejectsCrossEntityFields(t *testing.T) {
	tests := []struct {
		name   string
		entity string
		data   DetailInput
	}{
		{"customer unit", EntityCustomer, DetailInput{Name: "Customer", Unit: "piece"}},
		{"product unit", EntityProduct, DetailInput{Name: "Product", Unit: "piece"}},
		{"product currency", EntityProduct, DetailInput{Name: "Product", Currency: "CNY"}},
		{"warehouse unit", EntityWarehouse, DetailInput{Name: "Warehouse", Unit: "piece"}},
		{"warehouse currency", EntityWarehouse, DetailInput{Name: "Warehouse", Currency: "CNY"}},
		{"supplier vehicle field", EntitySupplier, DetailInput{Name: "Supplier", PlateNumber: "沪A12345"}},
		{"vehicle missing plate", EntityVehicle, DetailInput{
			Name: "Vehicle", VehicleType: "Truck", CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: "01J00000000000000000000020"},
		}},
		{"vehicle malformed platform", EntityVehicle, DetailInput{
			Name: "Vehicle", PlateNumber: "沪A12345", VehicleType: "Truck", CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: "bad"},
		}},
		{"vehicle currency", EntityVehicle, DetailInput{
			Name: "Vehicle", PlateNumber: "沪A12345", VehicleType: "Truck",
			CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: "01J00000000000000000000020"}, Currency: "CNY",
		}},
		{"fund account missing currency", EntityFundAccount, DetailInput{Name: "Cash"}},
		{"fund account malformed currency", EntityFundAccount, DetailInput{Name: "Cash", Currency: "CN"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := validateDetail(test.entity, test.data); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestVehicleCarrierAffiliationIsClosedAndExclusive(t *testing.T) {
	validID := "01J00000000000000000000020"
	base := DetailInput{Name: "车辆", PlateNumber: "沪A12345", VehicleType: "货车"}
	for _, test := range []struct {
		name        string
		affiliation *CarrierAffiliation
		wantError   bool
	}{
		{"internal", &CarrierAffiliation{Type: "INTERNAL", OperatingEntityID: validID}, false},
		{"external", &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: validID}, false},
		{"missing", nil, true},
		{"mixed", &CarrierAffiliation{Type: "INTERNAL", OperatingEntityID: validID, ServiceRelationshipObjectID: validID}, true},
		{"unknown", &CarrierAffiliation{Type: "UNKNOWN", OperatingEntityID: validID}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			input := base
			input.CarrierAffiliation = test.affiliation
			_, err := validateDetail(EntityVehicle, input)
			if test.wantError != errorIsKind(err, ErrorValidation) {
				t.Fatalf("validate vehicle affiliation error = %v", err)
			}
		})
	}
}

func TestQueryValidationBoundaries(t *testing.T) {
	service := &Service{}
	if _, err := service.Query(t.Context(), EntityCustomer, QueryInput{Page: 1, PageSize: 101}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("page size error = %v", err)
	}
	if _, err := service.Query(t.Context(), EntityCustomer, QueryInput{
		Page: 1, PageSize: 20, Sort: []SortItem{{Field: "createdBy", Order: "asc"}},
	}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("sort error = %v", err)
	}
	if _, err := service.Query(t.Context(), EntityCustomer, QueryInput{Page: math.MaxInt, PageSize: 100}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("offset overflow error = %v", err)
	}
}

func TestWarehouseAndEmployeeRejectInexactSortValues(t *testing.T) {
	service := &Service{}
	for _, entity := range []string{EntityWarehouse, EntityEmployee} {
		for _, sort := range []SortItem{
			{Field: "date", Order: "asc"},
			{Field: "At", Order: "desc"},
			{Field: "", Order: "asc"},
			{Field: "updatedAt", Order: "ascending"},
			{Field: "updatedAt", Order: "ASC"},
		} {
			name := entity + "/" + sort.Field + "/" + sort.Order
			t.Run(name, func(t *testing.T) {
				_, err := service.Query(t.Context(), entity, QueryInput{
					Page: 1, PageSize: 20, Sort: []SortItem{sort},
				})
				if !errorIsKind(err, ErrorValidation) {
					t.Fatalf("sort %+v error = %v", sort, err)
				}
			})
		}
	}
}

func TestValidateDetailCountsUnicodeCharacters(t *testing.T) {
	if _, err := validateDetail(EntityCustomer, DetailInput{
		Name:                  strings.Repeat("客", 200),
		SalespersonEmployeeID: Optional("01J00000000000000000000021"),
	}); err != nil {
		t.Fatalf("200-character name rejected: %v", err)
	}
	if _, err := validateDetail(EntityCustomer, DetailInput{Name: strings.Repeat("客", 201)}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("201-character name error = %v", err)
	}
	if _, err := validateDetail(EntityProduct, DetailInput{
		Name:          "产品",
		Specification: Optional(strings.Repeat("箱", 200)),
	}); err != nil {
		t.Fatalf("200-character specification rejected: %v", err)
	}
	if _, err := validateDetail(EntityProduct, DetailInput{
		Name:          "产品",
		Specification: Optional(strings.Repeat("箱", 201)),
	}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("201-character specification error = %v", err)
	}
	if _, err := validateDetail(EntityVehicle, DetailInput{
		Name: "车辆", PlateNumber: strings.Repeat("车", 32), VehicleType: strings.Repeat("型", 64),
		CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: "01J00000000000000000000020"},
	}); err != nil {
		t.Fatalf("vehicle Unicode boundary rejected: %v", err)
	}
	if _, err := validateDetail(EntityVehicle, DetailInput{
		Name: "车辆", PlateNumber: strings.Repeat("车", 33), VehicleType: "货车",
		CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: "01J00000000000000000000020"},
	}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("33-character plate error = %v", err)
	}
}

func TestCommentCountsUnicodeCharacters(t *testing.T) {
	accepted := strings.Repeat("改", 1000)
	if comment, err := optionalComment(&accepted); err != nil || comment == nil {
		t.Fatalf("1000-character comment rejected: comment=%v err=%v", comment, err)
	}
	rejected := strings.Repeat("改", 1001)
	if _, err := optionalComment(&rejected); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("1001-character comment error = %v", err)
	}
}

func TestCommonAttributesNormalizeAndValidate(t *testing.T) {
	customer, _, err := validateCreate(EntityCustomer, CreateDetailInput{
		Code: " customer-1 ", Name: " 客户 ",
		TaxNumber: " ab-123 ", Email: " SALES@EXAMPLE.COM ",
		SalespersonEmployeeID: "01J00000000000000000000021",
	})
	if err != nil {
		t.Fatalf("validate customer: %v", err)
	}
	if customer.CustomerType != CustomerTypeEndUser || customer.TaxNumber != "AB-123" ||
		customer.Email != "sales@example.com" {
		t.Fatalf("normalized customer = %+v", customer)
	}

	vehicle, _, err := validateCreate(EntityVehicle, CreateDetailInput{
		Code: "vehicle-1", Name: "车辆", PlateNumber: " 沪a12345 ", VehicleType: " 厢式货车 ",
		CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: "01J00000000000000000000020"},
		VIN:                " lsvaa4187n2000001 ",
		LoadCapacityKG:     "018000.5",
	})
	if err != nil {
		t.Fatalf("validate vehicle: %v", err)
	}
	if vehicle.VIN != "LSVAA4187N2000001" || vehicle.LoadCapacityKG != "18000.500" {
		t.Fatalf("normalized vehicle = %+v", vehicle)
	}

	account, _, err := validateCreate(EntityFundAccount, CreateDetailInput{
		Code: "account-1", Name: "基本户", Currency: "cny", AccountNumber: " 6222-0000 0001 ",
		OperatingEntityID: "01J00000000000000000000030",
	})
	if err != nil {
		t.Fatalf("validate account: %v", err)
	}
	if account.AccountNumber != "622200000001" {
		t.Fatalf("account number = %q", account.AccountNumber)
	}

	invalidCases := []struct {
		name   string
		entity string
		data   CreateDetailInput
	}{
		{"invalid customer type", EntityCustomer, CreateDetailInput{
			Code: "CUSTOMER-2", Name: "客户", CustomerType: stringTestPointer("OTHER"),
		}},
		{"invalid monthly closing day", EntityCustomer, CreateDetailInput{
			Code: "CUSTOMER-6", Name: "客户", MonthlyClosingDay: 32,
			SalespersonEmployeeID: "01J00000000000000000000021",
		}},
		{"invalid date", EntityEmployee, CreateDetailInput{
			Code: "EMPLOYEE-2", Name: "员工", HireDate: "2025-02-30",
		}},
		{"invalid vin", EntityVehicle, CreateDetailInput{
			Code: "VEHICLE-2", Name: "车辆", PlateNumber: "沪A12346", VehicleType: "货车",
			CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: "01J00000000000000000000020"}, VIN: "LSVAA4187N200000I",
		}},
		{"invalid load capacity", EntityVehicle, CreateDetailInput{
			Code: "VEHICLE-3", Name: "车辆", PlateNumber: "沪A12347", VehicleType: "货车",
			CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: "01J00000000000000000000020"}, LoadCapacityKG: "0",
		}},
		{"long short name", EntityCustomer, CreateDetailInput{
			Code: "CUSTOMER-3", Name: "客户", ShortName: strings.Repeat("简", 101),
		}},
		{"invalid customer salesperson id", EntityCustomer, CreateDetailInput{
			Code: "CUSTOMER-4", Name: "客户", SalespersonEmployeeID: "not-an-object-id",
		}},
		{"missing customer salesperson", EntityCustomer, CreateDetailInput{
			Code: "CUSTOMER-5", Name: "客户",
		}},
		{"legacy supplier salesperson", EntitySupplier, CreateDetailInput{
			Code: "SUPPLIER-5", Name: "供应商", SalespersonEmployeeID: "01J00000000000000000000021",
		}},
	}
	for _, test := range invalidCases {
		t.Run(test.name, func(t *testing.T) {
			if _, _, err := validateCreate(test.entity, test.data); !errorIsKind(err, ErrorValidation) {
				t.Fatalf("validation error = %v", err)
			}
		})
	}
}

func TestCommonAttributeSaveOmissionAndExplicitClear(t *testing.T) {
	current := DetailView{
		Name: "客户", CustomerType: CustomerTypeEndUser, ShortName: "简称",
		TaxNumber: "TAX001", CategoryID: "01J00000000000000000000020",
		SettlementMethodID:    "01J00000000000000000000021",
		SalespersonEmployeeID: "01J00000000000000000000022",
	}
	var omitted DetailInput
	if err := json.Unmarshal([]byte(`{"name":"更新客户"}`), &omitted); err != nil {
		t.Fatalf("decode omitted input: %v", err)
	}
	merged := mergeDetailInput(current, omitted)
	if merged.ShortName != "简称" || merged.TaxNumber != "TAX001" || merged.CategoryID == "" ||
		merged.SettlementMethodID == "" || merged.SalespersonEmployeeID == "" {
		t.Fatalf("omitted fields were not preserved: %+v", merged)
	}

	var cleared DetailInput
	if err := json.Unmarshal([]byte(
		`{"name":"更新客户","shortName":null,"taxNumber":"","settlementMethodId":null,"salespersonEmployeeId":""}`,
	), &cleared); err != nil {
		t.Fatalf("decode clear input: %v", err)
	}
	merged = mergeDetailInput(current, cleared)
	if merged.ShortName != "" || merged.TaxNumber != "" || merged.CategoryID == "" ||
		merged.SettlementMethodID != "" || merged.SalespersonEmployeeID != "" {
		t.Fatalf("explicit clear failed: %+v", merged)
	}
	if _, err := validateDetailData(EntityCustomer, merged); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("required salesperson clear error = %v", err)
	}
}

func TestQueryFilterValidation(t *testing.T) {
	if _, err := validateQueryFilters(EntityOperatingEntity, QueryFilters{}); err != nil {
		t.Fatalf("operating entity query rejected: %v", err)
	}
	if _, err := validateQueryFilters(EntityProduct, QueryFilters{
		CategoryID:    "01J00000000000000000000020",
		ProductTypeID: "01J00000000000000000000021",
	}); err != nil {
		t.Fatalf("product filters rejected: %v", err)
	}
	if _, err := validateQueryFilters(EntitySupplier, QueryFilters{CategoryID: "01J00000000000000000000020"}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("cross-entity filter error = %v", err)
	}

	var filters QueryFilters
	if err := json.Unmarshal([]byte(`{"capability":"CHANNEL_PARTNER"}`), &filters); err == nil {
		t.Fatal("unsupported capability filter was accepted")
	}
	if err := json.Unmarshal([]byte(`{"unknown":true}`), &filters); err == nil {
		t.Fatal("unknown nested filter was accepted")
	}

	service := &Service{}
	if _, err := service.Query(t.Context(), EntitySupplier, QueryInput{
		Page: 1, PageSize: 20,
		Filters: QueryFilters{CategoryID: "01J00000000000000000000020"},
	}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("Supplier cross-entity filter error = %v", err)
	}

	var crossEntityClear DetailInput
	if err := json.Unmarshal([]byte(`{"name":"客户","vin":null}`), &crossEntityClear); err != nil {
		t.Fatalf("decode cross-entity clear: %v", err)
	}
	if _, err := validateDetail(EntityCustomer, crossEntityClear); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("cross-entity null field error = %v", err)
	}
}

func TestFundAccountValidationUsesCharacterLengthAndNormalizesAccountNumber(t *testing.T) {
	valid, err := ValidateFundAccountData(FundAccountData{
		Name:              strings.Repeat("账", 200),
		Currency:          "cny",
		AccountNumber:     " ab-12 34 ",
		OperatingEntityID: "01J00000000000000000000030",
	})
	if err != nil {
		t.Fatalf("valid multibyte fund account rejected: %v", err)
	}
	if valid.Currency != "CNY" || valid.AccountNumber != "AB1234" {
		t.Fatalf("normalized fund account = %+v", valid)
	}

	_, err = ValidateFundAccountData(FundAccountData{
		Name:              strings.Repeat("账", 201),
		Currency:          "CNY",
		OperatingEntityID: "01J00000000000000000000030",
	})
	if !errorIsKind(err, ErrorValidation) {
		t.Fatalf("oversized multibyte fund account error = %v", err)
	}
}

func stringTestPointer(value string) *string {
	return &value
}
