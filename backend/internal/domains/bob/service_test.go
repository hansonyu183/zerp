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

func TestObjectPrefixes(t *testing.T) {
	t.Parallel()
	expected := map[string]string{
		EntityCustomer: "CUS", EntitySupplier: "SUP", EntityOtherParty: "OTP", EntityEmployee: "EMP",
		EntityProduct: "PRD", EntityService: "SVC", EntityWarehouse: "WHS",
		EntityVehicle: "VEH", EntityFundAccount: "FAC",
		EntityCategory: "PCT", EntityDepartment: "DEP", EntityPosition: "POS",
		EntitySettlementMethod: "STM",
		EntityOperatingEntity:  "OPE",
	}
	for entity, prefix := range expected {
		if actual := objectPrefix(entity); actual != prefix {
			t.Fatalf("objectPrefix(%q) = %q, want %q", entity, actual, prefix)
		}
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
		{EntitySupplier, CreateDetailInput{
			Code: "sup-01", Name: "Supplier", DefaultPurchaserEmployeeID: salespersonEmployeeID,
		}},
		{EntityOtherParty, CreateDetailInput{
			Code: "otp-01", Name: "Other party", SalespersonEmployeeID: salespersonEmployeeID,
		}},
		{EntityEmployee, CreateDetailInput{Code: "emp_01", Name: "Employee"}},
		{EntityProduct, CreateDetailInput{Code: "prd01", Name: "Product", Unit: "件"}},
		{EntityService, CreateDetailInput{Code: "svc01", Name: "Service", Unit: "次"}},
		{EntityWarehouse, CreateDetailInput{Code: "wh01", Name: "主仓"}},
		{EntityVehicle, CreateDetailInput{
			Code: "veh01", Name: "配送车", PlateNumber: " 沪a12345 ",
			VehicleType: " 厢式货车 ", PlatformObjectID: platformObjectID,
		}},
		{EntityFundAccount, CreateDetailInput{Code: "cash01", Name: "Cash", Currency: "cny", OperatingEntityID: "01J00000000000000000000030"}},
		{EntityCategory, CreateDetailInput{Code: "cat01", Name: "产品分类", TargetEntity: EntityProduct}},
		{EntityDepartment, CreateDetailInput{Code: "dept01", Name: "运营部"}},
		{EntityPosition, CreateDetailInput{Code: "pos01", Name: "主管"}},
		{EntitySettlementMethod, CreateDetailInput{
			Code: "sm01", Name: "月结 30 天", TermCode: SettlementTermMonthly30,
			RuleType: SettlementRuleMonthEnd, MonthOffset: 1, DefaultSalesSurcharge: "0.10",
		}},
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
			if test.entity == EntitySupplier && data.SupplierType != SupplierTypeGeneral {
				t.Fatalf("supplier type = %v", data.SupplierType)
			}
			if (test.entity == EntityCustomer || test.entity == EntityOtherParty) && data.CustomerType != CustomerTypeEndUser {
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

func TestValidateSupplierTypeAndPurchaserVocabulary(t *testing.T) {
	logisticsPlatform := " logistics_platform "
	data, _, err := validateCreate(EntitySupplier, CreateDetailInput{
		Code: "platform01", Name: "物流平台", SupplierType: &logisticsPlatform,
		DefaultPurchaserEmployeeID: "01J00000000000000000000021",
	})
	if err != nil || data.SupplierType != SupplierTypeLogisticsPlatform {
		t.Fatalf("logistics supplier data=%+v err=%v", data, err)
	}
	if _, err = validateDetail(EntitySupplier, DetailInput{
		Name: "保存供应商", DefaultPurchaserEmployeeID: Optional("01J00000000000000000000021"),
	}); err != nil {
		t.Fatalf("omitted supplier type rejected: %v", err)
	}
	invalid := "OTHER"
	if _, err = validateDetail(EntitySupplier, DetailInput{Name: "错误类型", SupplierType: &invalid}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("invalid supplier type error = %v", err)
	}
}

func TestValidateSettlementMethodRules(t *testing.T) {
	valid := []CreateDetailInput{
		{Code: "SM-1", Name: "预付", TermCode: SettlementTermPrepaid, RuleType: SettlementRuleRelativeDays, DefaultSalesSurcharge: "0.00"},
		{Code: "SM-2", Name: "现结", TermCode: SettlementTermCashOnDelivery, RuleType: SettlementRuleRelativeDays, DefaultSalesSurcharge: "0"},
		{Code: "SM-3", Name: "货到30天", TermCode: SettlementTermArrival30, RuleType: SettlementRuleRelativeDays, DayOffset: 30, DefaultSalesSurcharge: "0.10"},
		{Code: "SM-4", Name: "当月结", TermCode: SettlementTermMonthlyCurrent, RuleType: SettlementRuleMonthEnd, DefaultSalesSurcharge: "0.05"},
		{Code: "SM-5", Name: "月结90天", TermCode: SettlementTermMonthly90, RuleType: SettlementRuleMonthEnd, MonthOffset: 3, DefaultSalesSurcharge: "0.30"},
	}
	for _, input := range valid {
		if _, _, err := validateCreate(EntitySettlementMethod, input); err != nil {
			t.Fatalf("valid settlement rule %+v rejected: %v", input, err)
		}
	}

	invalid := []CreateDetailInput{
		{Code: "SM-BAD-1", Name: "缺少术语代码", RuleType: SettlementRuleRelativeDays, DefaultSalesSurcharge: "0.00"},
		{Code: "SM-BAD-2", Name: "未知术语", TermCode: "CUSTOM", RuleType: SettlementRuleRelativeDays, DefaultSalesSurcharge: "0.00"},
		{Code: "SM-BAD-3", Name: "负加价", TermCode: SettlementTermPrepaid, RuleType: SettlementRuleRelativeDays, DefaultSalesSurcharge: "-0.01"},
		{Code: "SM-BAD-4", Name: "超小数位", TermCode: SettlementTermPrepaid, RuleType: SettlementRuleRelativeDays, DefaultSalesSurcharge: "0.001"},
		{Code: "SM-BAD-5", Name: "期限不匹配", TermCode: SettlementTermArrival30, RuleType: SettlementRuleRelativeDays, DayOffset: 15, DefaultSalesSurcharge: "0.00"},
	}
	for _, input := range invalid {
		if _, _, err := validateCreate(EntitySettlementMethod, input); !errorIsKind(err, ErrorValidation) {
			t.Fatalf("invalid settlement rule %+v error = %v", input, err)
		}
	}
}

func TestValidateProductContainerRules(t *testing.T) {
	solvent := ContainerTypeSolvent
	product, _, err := validateCreate(EntityProduct, CreateDetailInput{
		Code: "P-SOLVENT", Name: "桶装溶剂", Unit: "kg",
		ContainerType: solvent, QuantityPerContainer: "180.123456",
	})
	if err != nil {
		t.Fatalf("valid container product rejected: %v", err)
	}
	if product.ContainerType != ContainerTypeSolvent || product.QuantityPerContainer != "180.123456" {
		t.Fatalf("container product normalized incorrectly: %+v", product)
	}
	for name, input := range map[string]CreateDetailInput{
		"none with quantity": {
			Code: "P-NONE", Name: "散装", Unit: "kg",
			QuantityPerContainer: "1",
		},
		"container without quantity": {
			Code: "P-EMPTY", Name: "桶装", Unit: "kg", ContainerType: solvent,
		},
		"too many decimals": {
			Code: "P-SCALE", Name: "桶装", Unit: "kg",
			ContainerType: solvent, QuantityPerContainer: "1.0000001",
		},
		"zero quantity": {
			Code: "P-ZERO", Name: "桶装", Unit: "kg",
			ContainerType: solvent, QuantityPerContainer: "0",
		},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, validationErr := validateCreate(EntityProduct, input); !errorIsKind(validationErr, ErrorValidation) {
				t.Fatalf("error = %v, want validation", validationErr)
			}
		})
	}
}

func TestValidateStandardFinishedProductFormula(t *testing.T) {
	t.Parallel()
	valid := CreateDetailInput{
		Code:                            "P-FINISHED",
		Name:                            "固定配方成品",
		Unit:                            "kg",
		ProductKind:                     ProductKindStandardFinished,
		InventoryUnitID:                 "01JAVX00000000000000000011",
		PricingUnitID:                   "01JAVX00000000000000000011",
		PricingQuantityPerInventoryUnit: "1",
		Formula: &ProductFormula{
			BaseOutputQuantity: "100",
			Components: []ProductFormulaComponent{{
				Material: FormulaMaterialReference{
					ObjectID:  "01J00000000000000000000031",
					VersionID: "01J00000000000000000000032",
				},
				Quantity: "25.5",
			}},
		},
	}
	data, _, err := validateCreate(EntityProduct, valid)
	if err != nil {
		t.Fatalf("valid standard formula rejected: %v", err)
	}
	if data.Formula == nil || data.Formula.BaseOutputQuantity != "100" {
		t.Fatalf("formula not preserved: %+v", data.Formula)
	}

	missing := valid
	missing.Formula = nil
	if _, _, err = validateCreate(EntityProduct, missing); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("missing standard formula error = %v", err)
	}

	rawWithFormula := valid
	rawWithFormula.ProductKind = ProductKindRawMaterial
	if _, _, err = validateCreate(EntityProduct, rawWithFormula); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("raw material formula error = %v", err)
	}

	duplicate := valid
	duplicate.Formula = cloneProductFormula(valid.Formula)
	duplicate.Formula.Components = append(
		duplicate.Formula.Components,
		ProductFormulaComponent{
			Material: FormulaMaterialReference{
				ObjectID:  "01J00000000000000000000031",
				VersionID: "01J00000000000000000000033",
			},
			Quantity: "1",
		},
	)
	if _, _, err = validateCreate(EntityProduct, duplicate); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("duplicate formula material error = %v", err)
	}
}

func TestValidateDetailRejectsCrossEntityFields(t *testing.T) {
	tests := []struct {
		name   string
		entity string
		data   DetailInput
	}{
		{"customer unit", EntityCustomer, DetailInput{Name: "Customer", Unit: "piece"}},
		{"product missing unit", EntityProduct, DetailInput{Name: "Product"}},
		{"product currency", EntityProduct, DetailInput{Name: "Product", Unit: "piece", Currency: "CNY"}},
		{"warehouse unit", EntityWarehouse, DetailInput{Name: "Warehouse", Unit: "piece"}},
		{"warehouse currency", EntityWarehouse, DetailInput{Name: "Warehouse", Currency: "CNY"}},
		{"customer supplier type", EntityCustomer, DetailInput{Name: "Customer", SupplierType: stringTestPointer(SupplierTypeGeneral)}},
		{"supplier vehicle field", EntitySupplier, DetailInput{Name: "Supplier", PlateNumber: "沪A12345"}},
		{"vehicle missing plate", EntityVehicle, DetailInput{
			Name: "Vehicle", VehicleType: "Truck", PlatformObjectID: "01J00000000000000000000020",
		}},
		{"vehicle malformed platform", EntityVehicle, DetailInput{
			Name: "Vehicle", PlateNumber: "沪A12345", VehicleType: "Truck", PlatformObjectID: "bad",
		}},
		{"vehicle currency", EntityVehicle, DetailInput{
			Name: "Vehicle", PlateNumber: "沪A12345", VehicleType: "Truck",
			PlatformObjectID: "01J00000000000000000000020", Currency: "CNY",
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
		Name:            "产品",
		Unit:            strings.Repeat("箱", 32),
		InventoryUnitID: Optional("01JAVX00000000000000000013"),
	}); err != nil {
		t.Fatalf("32-character unit rejected: %v", err)
	}
	if _, err := validateDetail(EntityProduct, DetailInput{
		Name:            "产品",
		Unit:            strings.Repeat("箱", 33),
		InventoryUnitID: Optional("01JAVX00000000000000000013"),
	}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("33-character unit error = %v", err)
	}
	if _, err := validateDetail(EntityVehicle, DetailInput{
		Name: "车辆", PlateNumber: strings.Repeat("车", 32), VehicleType: strings.Repeat("型", 64),
		PlatformObjectID: "01J00000000000000000000020",
	}); err != nil {
		t.Fatalf("vehicle Unicode boundary rejected: %v", err)
	}
	if _, err := validateDetail(EntityVehicle, DetailInput{
		Name: "车辆", PlateNumber: strings.Repeat("车", 33), VehicleType: "货车",
		PlatformObjectID: "01J00000000000000000000020",
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
		customer.Email != "sales@example.com" || customer.RebateUnitPrice != "0" {
		t.Fatalf("normalized customer = %+v", customer)
	}

	vehicle, _, err := validateCreate(EntityVehicle, CreateDetailInput{
		Code: "vehicle-1", Name: "车辆", PlateNumber: " 沪a12345 ", VehicleType: " 厢式货车 ",
		PlatformObjectID: "01J00000000000000000000020",
		VIN:              " lsvaa4187n2000001 ",
		LoadCapacityKG:   "018000.5",
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
		{"invalid rebate unit price", EntityCustomer, CreateDetailInput{
			Code: "CUSTOMER-7", Name: "客户", RebateUnitPrice: "-0.01",
			SalespersonEmployeeID: "01J00000000000000000000021",
		}},
		{"invalid date", EntityEmployee, CreateDetailInput{
			Code: "EMPLOYEE-2", Name: "员工", HireDate: "2025-02-30",
		}},
		{"invalid vin", EntityVehicle, CreateDetailInput{
			Code: "VEHICLE-2", Name: "车辆", PlateNumber: "沪A12346", VehicleType: "货车",
			PlatformObjectID: "01J00000000000000000000020", VIN: "LSVAA4187N200000I",
		}},
		{"invalid load capacity", EntityVehicle, CreateDetailInput{
			Code: "VEHICLE-3", Name: "车辆", PlateNumber: "沪A12347", VehicleType: "货车",
			PlatformObjectID: "01J00000000000000000000020", LoadCapacityKG: "0",
		}},
		{"long short name", EntityCustomer, CreateDetailInput{
			Code: "CUSTOMER-3", Name: "客户", ShortName: strings.Repeat("简", 101),
		}},
		{"long remark", EntityService, CreateDetailInput{
			Code: "SERVICE-2", Name: "服务", Unit: "次", Remark: strings.Repeat("注", 1001),
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
		Name: "客户", CustomerType: CustomerTypeDealer, ShortName: "简称",
		TaxNumber: "TAX001", CategoryID: "01J00000000000000000000020",
		SettlementMethodID:       "01J00000000000000000000021",
		SalespersonEmployeeID:    "01J00000000000000000000022",
		RebateUnitPrice:          "0.35",
		IntermediaryOtherPartyID: "01J00000000000000000000023",
	}
	var omitted DetailInput
	if err := json.Unmarshal([]byte(`{"name":"更新客户"}`), &omitted); err != nil {
		t.Fatalf("decode omitted input: %v", err)
	}
	merged := mergeDetailInput(current, omitted)
	if merged.ShortName != "简称" || merged.TaxNumber != "TAX001" || merged.CategoryID == "" ||
		merged.SettlementMethodID == "" || merged.SalespersonEmployeeID == "" ||
		merged.RebateUnitPrice != "0.35" || merged.IntermediaryOtherPartyID == "" {
		t.Fatalf("omitted fields were not preserved: %+v", merged)
	}

	var cleared DetailInput
	if err := json.Unmarshal([]byte(
		`{"name":"更新客户","shortName":null,"taxNumber":"","settlementMethodId":null,"salespersonEmployeeId":"","rebateUnitPrice":"0.20","intermediaryOtherPartyId":null}`,
	), &cleared); err != nil {
		t.Fatalf("decode clear input: %v", err)
	}
	merged = mergeDetailInput(current, cleared)
	if merged.ShortName != "" || merged.TaxNumber != "" || merged.CategoryID == "" ||
		merged.SettlementMethodID != "" || merged.SalespersonEmployeeID != "" ||
		merged.RebateUnitPrice != "0.20" || merged.IntermediaryOtherPartyID != "" {
		t.Fatalf("explicit clear failed: %+v", merged)
	}
	if _, err := validateDetailData(EntityCustomer, merged); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("required salesperson clear error = %v", err)
	}
}

func TestCategoryAndQueryFilterValidation(t *testing.T) {
	if _, _, err := validateCreate(EntityCategory, CreateDetailInput{
		Code: "cat-1", Name: "产品分类", TargetEntity: EntityProduct,
	}); err != nil {
		t.Fatalf("category rejected: %v", err)
	}
	if _, _, err := validateCreate(EntityCategory, CreateDetailInput{
		Code: "cat-2", Name: "错误分类", TargetEntity: EntityCategory,
	}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("category self target error = %v", err)
	}
	if _, err := validateQueryFilters(EntityEmployee, QueryFilters{
		DepartmentID: "01J00000000000000000000020",
		PositionID:   "01J00000000000000000000021",
	}); err != nil {
		t.Fatalf("employee filters rejected: %v", err)
	}
	if _, err := validateQueryFilters(EntitySupplier, QueryFilters{
		DefaultPurchaserEmployeeID: "01J00000000000000000000022",
	}); err != nil {
		t.Fatalf("supplier default purchaser filter rejected: %v", err)
	}
	if _, err := validateQueryFilters(EntityProduct, QueryFilters{CustomerType: CustomerTypeDealer}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("cross-entity filter error = %v", err)
	}
	if _, err := validateQueryFilters(EntitySettlementMethod, QueryFilters{}); err != nil {
		t.Fatalf("settlement method query rejected: %v", err)
	}
	if _, err := validateQueryFilters(EntityCategory, QueryFilters{
		ParentID: "01J00000000000000000000020", RootOnly: true,
	}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("parent/root conflict error = %v", err)
	}

	var explicitEmpty QueryFilters
	if err := json.Unmarshal([]byte(`{"rootOnly":false}`), &explicitEmpty); err != nil {
		t.Fatalf("decode explicit empty filter: %v", err)
	}
	if _, err := validateQueryFilters(EntityCustomer, explicitEmpty); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("explicit cross-entity filter error = %v", err)
	}
	if err := json.Unmarshal([]byte(`{"unknown":true}`), &explicitEmpty); err == nil {
		t.Fatal("unknown nested filter was accepted")
	}

	var crossEntityClear DetailInput
	if err := json.Unmarshal([]byte(`{"name":"客户","vin":null}`), &crossEntityClear); err != nil {
		t.Fatalf("decode cross-entity clear: %v", err)
	}
	if _, err := validateDetail(EntityCustomer, crossEntityClear); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("cross-entity null field error = %v", err)
	}
}

func stringTestPointer(value string) *string {
	return &value
}
