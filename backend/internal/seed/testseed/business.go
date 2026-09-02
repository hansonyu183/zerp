package testseed

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
)

const approvedStatus = string(approval.StatusApproved)

// legalIdentifierForSeed derives a valid, reproducible mainland identifier
// without relying on domain validation. Each seed key maps to a distinct serial
// within its archive fixture set.
func legalIdentifierForSeed(kind, key string) string {
	serials := map[string]int{
		"employee-effective": 1, "employee-rejected": 2,
		"other-unit-effective": 11, "other-unit-draft": 12, "external-carrier": 13,
		"supplier-effective": 21, "supplier-pending": 22,
		"customer-effective": 31, "customer-draft": 32,
	}
	serial, ok := serials[key]
	if !ok {
		panic("missing legal identifier serial for seed " + key)
	}
	if kind == "PERSON" {
		base := fmt.Sprintf("11010519900101%03d", serial)
		weights := [...]int{7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2}
		checks := "10X98765432"
		sum := 0
		for i, weight := range weights {
			sum += int(base[i]-'0') * weight
		}
		return base + string(checks[sum%11])
	}
	base := fmt.Sprintf("91350211M%08d", serial)
	chars := "0123456789ABCDEFGHJKLMNPQRTUWXY"
	weights := [...]int{1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28}
	sum := 0
	for i, weight := range weights {
		sum += strings.IndexByte(chars, base[i]) * weight
	}
	return base + string(chars[(31-sum%31)%31])
}

type bobSample struct {
	key, entity, status string
	data                func(*Seeder) bobdomain.CreateDetailInput
}

type seedBusinessMutation struct {
	ObjectID         string
	ApprovalRevision int64
	Enabled          bool
	Approval         approval.VersionMeta
}

type seedBusinessView struct {
	ObjectID         string
	Entity           string
	Code             string
	ApprovalRevision int64
	Enabled          bool
	Approval         approval.VersionMeta
	Data             bobdomain.DetailView
	UpdatedAt        time.Time
}

type seedBusinessVersion struct {
	Approval approval.VersionMeta
	Data     bobdomain.DetailView
}

func currentBusinessVersion(view seedBusinessView) *seedBusinessVersion {
	return &seedBusinessVersion{Approval: view.Approval, Data: view.Data}
}

func businessMutation(view seedBusinessView) (seedBusinessMutation, error) {
	version := currentBusinessVersion(view)
	if version == nil {
		return seedBusinessMutation{}, fmt.Errorf("BOB object %s has neither open nor approved version", view.ObjectID)
	}
	return seedBusinessMutation{
		ObjectID: view.ObjectID, ApprovalRevision: view.ApprovalRevision, Enabled: view.Enabled,
		Approval: version.Approval,
	}, nil
}

func unitSnapshot(view auxdomain.ObjectView) bobdomain.MeasurementUnitSnapshot {
	data := view.Data
	name, _ := data["name"].(string)
	symbol, _ := data["symbol"].(string)
	return bobdomain.MeasurementUnitSnapshot{ObjectID: view.ObjectID, Code: view.Code, Name: name, Symbol: symbol}
}

func productUnits(input, pricing auxdomain.ObjectView, pricingFactor string) []bobdomain.ProductUnitConversion {
	return []bobdomain.ProductUnitConversion{{Unit: unitSnapshot(input), Factor: "1"}, {Unit: unitSnapshot(pricing), Factor: pricingFactor}}
}

func quantitySnapshot(unit auxdomain.ObjectView, quantity string) bobdomain.QuantitySnapshot {
	return bobdomain.QuantitySnapshot{EnteredQuantity: quantity, EnteredUnit: unitSnapshot(unit), BaseQuantity: quantity}
}

func (s *Seeder) seedBusiness(ctx context.Context, counts *Counts) error {
	for key, termCode := range map[string]string{
		"settlement-month-end": "MONTHLY_CURRENT",
		"settlement-due-days":  "ARRIVAL_30",
	} {
		objectID, err := s.queries.FindEnabledSettlementMethodByTermCode(ctx, termCode)
		if err != nil {
			return fmt.Errorf("load fixed settlement method %s: %w", termCode, err)
		}
		actor, actorErr := seedActor(actorID, requestID(key, "get"))
		if actorErr != nil {
			return actorErr
		}
		view, err := s.auxiliary.Get(ctx, auxdomain.EntitySettlementMethod, auxdomain.GetInput{ObjectID: objectID}, actor)
		if err != nil {
			return fmt.Errorf("get fixed settlement method %s: %w", termCode, err)
		}
		s.auxRefs[key] = view
	}
	samples := []bobSample{
		{"operating-effective", bobdomain.EntityOperatingEntity, approvedStatus, func(*Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "上海测试科技有限公司", ShortName: "上海测试", TaxNumber: "91310000TESTOPE1",
				Address: "上海市浦东新区测试路1号", Phone: "021-61000000",
			}
		}},
		{"employee-effective", bobdomain.EntityEmployee, approvedStatus, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "张伟（测试）", DepartmentID: s.auxRefs["department-root"].ObjectID,
				PositionID: s.auxRefs["position-operator"].ObjectID, Phone: "13800000101",
				Email: "test.employee@example.com", HireDate: "2024-01-15", Remark: "测试有效员工",
			}
		}},
		{"employee-rejected", bobdomain.EntityEmployee, string(approval.StatusDraft), func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "李娜（测试草稿）", DepartmentID: s.auxRefs["department-sales"].ObjectID,
				PositionID: s.auxRefs["position-operator"].ObjectID, Phone: "13800000102",
				Remark: "测试草稿员工",
			}
		}},
		{"other-unit-effective", bobdomain.EntityOtherUnit, approvedStatus, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "远航居间服务有限公司（测试）", ShortName: "远航居间",
				ContactName: "刘顾问", ContactPhone: "13800000107",
				Email: "test.intermediary@example.com", Address: "上海市静安区测试商务路 88 号",
				SettlementMethodID:    s.auxRefs["settlement-due-days"].ObjectID,
				SalespersonEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                "测试有效居间往来单位",
			}
		}},
		{"other-unit-draft", bobdomain.EntityOtherUnit, string(approval.StatusDraft), func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "待确认居间单位（测试草稿）", ContactName: "陈顾问", ContactPhone: "13800000108",
				SettlementMethodID:    s.auxRefs["settlement-due-days"].ObjectID,
				SalespersonEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                "测试草稿其他单位",
			}
		}},
		{"customer-effective", bobdomain.EntityCustomer, approvedStatus, func(s *Seeder) bobdomain.CreateDetailInput {
			customerType := bobdomain.CustomerTypeEndUser
			return bobdomain.CreateDetailInput{
				Name: "星河制造有限公司（测试）", CustomerType: &customerType,
				ShortName:   "星河制造",
				ContactName: "王经理", ContactPhone: "13800000103",
				Email: "test.customer@example.com", Address: "上海市浦东新区测试路 101 号",
				SettlementMethodID:    s.auxRefs["settlement-month-end"].ObjectID,
				MonthlyClosingDay:     15,
				SalespersonEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                "测试有效客户",
			}
		}},
		{"customer-draft", bobdomain.EntityCustomer, string(approval.StatusDraft), func(s *Seeder) bobdomain.CreateDetailInput {
			customerType := bobdomain.CustomerTypeEndUser
			return bobdomain.CreateDetailInput{
				Name: "新客户（测试草稿）", CustomerType: &customerType,
				ContactName: "陈先生", ContactPhone: "13800000104",
				SettlementMethodID:    s.auxRefs["settlement-due-days"].ObjectID,
				SalespersonEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                "测试草稿客户",
			}
		}},
		{"external-carrier", bobdomain.EntityOtherUnit, approvedStatus, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name:      "自营物流服务单位（测试）",
				ShortName: "测试物流", ContactName: "调度中心", ContactPhone: "021-60000101",
				Address:                    "上海市嘉定区测试物流园",
				SettlementMethodID:         s.auxRefs["settlement-due-days"].ObjectID,
				DefaultPurchaserEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                     "测试物流服务单位",
			}
		}},
		{"supplier-effective", bobdomain.EntitySupplier, approvedStatus, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name:        "通用原料供应商（测试）",
				ShortName:   "测试原料",
				ContactName: "赵经理", ContactPhone: "13800000105",
				Address:                    "江苏省苏州市测试工业园",
				SettlementMethodID:         s.auxRefs["settlement-due-days"].ObjectID,
				DefaultPurchaserEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                     "测试有效供应商",
			}
		}},
		{"supplier-pending", bobdomain.EntitySupplier, string(approval.StatusPending), func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name:        "候选供应商（测试待审核）",
				ContactName: "周经理", ContactPhone: "13800000106",
				SettlementMethodID:         s.auxRefs["settlement-due-days"].ObjectID,
				DefaultPurchaserEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                     "测试待审核供应商",
			}
		}},
		{"warehouse-effective", bobdomain.EntityWarehouse, approvedStatus, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "华东主仓（测试）", Address: "上海市嘉定区测试仓储路 1 号",
				ContactName: "张伟", ContactPhone: "13800000101",
				ManagerEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:            "测试有效仓库",
			}
		}},
		{"warehouse-rejected", bobdomain.EntityWarehouse, string(approval.StatusDraft), func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "临时仓（测试草稿）", Address: "上海市青浦区测试临时仓",
				ManagerEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:            "测试草稿仓库",
			}
		}},
		{"packaging-effective", bobdomain.EntityProduct, approvedStatus, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "可回收包装桶（测试）", ProductTypeID: s.auxRefs["product-type-packaging"].ObjectID,
				DefaultInputUnitID: s.auxRefs["UNT-0002"].ObjectID, PricingUnitID: s.auxRefs["UNT-0002"].ObjectID,
				UnitConversions: []bobdomain.ProductUnitConversion{{Unit: unitSnapshot(s.auxRefs["UNT-0002"]), Factor: "1"}}, Returnable: true,
				CategoryID:    s.auxRefs["product-category-parts"].ObjectID,
				Specification: "20L", Model: "PK-20", Barcode: "TEST-PACK-001",
				Remark: "测试可回收包装物",
			}
		}},
		{"raw-effective", bobdomain.EntityProduct, approvedStatus, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "标准原料 A（测试）", ProductTypeID: s.auxRefs["product-type-raw"].ObjectID,
				DefaultInputUnitID: s.auxRefs["UNT-0002"].ObjectID, PricingUnitID: s.auxRefs["UNT-0001"].ObjectID,
				UnitConversions:      productUnits(s.auxRefs["UNT-0002"], s.auxRefs["UNT-0001"], "2.5"),
				DefaultPackagingSpec: "10",
				CategoryID:           s.auxRefs["product-category-parts"].ObjectID,
				Specification:        "M20", Model: "RM-A", Barcode: "TEST-RAW-001",
				Remark: "测试原材料",
			}
		}},
		{"finished-effective", bobdomain.EntityProduct, approvedStatus, func(s *Seeder) bobdomain.CreateDetailInput {
			raw := s.bobRefs["raw-effective"]
			return bobdomain.CreateDetailInput{
				Name: "标准自制品 A（测试）", ProductTypeID: s.auxRefs["product-type-finished"].ObjectID,
				DefaultInputUnitID: s.auxRefs["UNT-0002"].ObjectID, PricingUnitID: s.auxRefs["UNT-0001"].ObjectID,
				UnitConversions:      productUnits(s.auxRefs["UNT-0002"], s.auxRefs["UNT-0001"], "3"),
				DefaultPackagingSpec: "10",
				CategoryID:           s.auxRefs["product-category-parts"].ObjectID,
				Specification:        "FG-A", Model: "FG-100", Barcode: "TEST-FG-001",
				Formula: &bobdomain.ProductFormula{
					Output: quantitySnapshot(s.auxRefs["UNT-0002"], "1"),
					Components: []bobdomain.ProductFormulaComponent{{
						Material: bobdomain.FormulaMaterialReference{
							ObjectID: raw.ObjectID, ApprovalEntryID: raw.Approval.ApprovalEntryID,
						},
						Quantity: quantitySnapshot(s.auxRefs["UNT-0002"], "2"), ResolutionStatus: "CURRENT",
					}},
				},
				Remark: "测试标准自制品",
			}
		}},
		{"custom-effective", bobdomain.EntityProduct, approvedStatus, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "客户定制品 B（测试）", ProductTypeID: s.auxRefs["product-type-custom"].ObjectID,
				DefaultInputUnitID: s.auxRefs["UNT-0002"].ObjectID, PricingUnitID: s.auxRefs["UNT-0001"].ObjectID,
				UnitConversions:      productUnits(s.auxRefs["UNT-0002"], s.auxRefs["UNT-0001"], "4"),
				DefaultPackagingSpec: "10",
				CategoryID:           s.auxRefs["product-category-parts"].ObjectID,
				Specification:        "FG-B", Model: "FG-200", Barcode: "TEST-FG-002",
				Remark: "测试客户定制品",
			}
		}},
		{"product-draft", bobdomain.EntityProduct, string(approval.StatusDraft), func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "试制原料（测试草稿）", ProductTypeID: s.auxRefs["product-type-raw"].ObjectID,
				DefaultInputUnitID: s.auxRefs["UNT-0002"].ObjectID, PricingUnitID: s.auxRefs["UNT-0001"].ObjectID,
				UnitConversions:      productUnits(s.auxRefs["UNT-0002"], s.auxRefs["UNT-0001"], "1"),
				DefaultPackagingSpec: "10",
				CategoryID:           s.auxRefs["product-category-parts"].ObjectID,
				Specification:        "TEST", Model: "DRAFT", Barcode: "TEST-DRAFT-001",
				Remark: "测试草稿产品",
			}
		}},
		{"vehicle-effective", bobdomain.EntityVehicle, approvedStatus, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "自营配送一号车（测试）", PlateNumber: "沪A10101",
				VehicleType: "DIT-0003", CarrierAffiliation: &bobdomain.CarrierAffiliation{
					Type: "EXTERNAL", OtherUnitObjectID: s.bobRefs["external-carrier"].ObjectID,
				},
				VIN: "LSVAA4187N2100101", EngineNumber: "ENG-TEST-101",
				LoadCapacityKG: "18000", Remark: "测试有效车辆",
			}
		}},
		{"vehicle-draft", bobdomain.EntityVehicle, string(approval.StatusDraft), func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "自营配送二号车（测试草稿）", PlateNumber: "沪A10102",
				VehicleType: "DIT-0003", CarrierAffiliation: &bobdomain.CarrierAffiliation{
					Type: "EXTERNAL", OtherUnitObjectID: s.bobRefs["external-carrier"].ObjectID,
				},
				VIN: "LSVAA4187N2100102", EngineNumber: "ENG-TEST-102",
				LoadCapacityKG: "12000", Remark: "测试草稿车辆",
			}
		}},
		{"fund-effective", bobdomain.EntityFundAccount, approvedStatus, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "人民币基本账户（测试）", Currency: "CNY",
				OperatingEntityID: s.bobRefs["operating-effective"].ObjectID,
				AccountName:       "上海测试科技有限公司", BankName: "示例银行",
				BankBranch: "上海浦东支行", AccountNumber: "622200000000001001",
				Remark: "测试有效资金账户",
			}
		}},
		{"fund-draft", bobdomain.EntityFundAccount, string(approval.StatusDraft), func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "备用结算账户（测试草稿）", Currency: "CNY",
				OperatingEntityID: s.bobRefs["operating-effective"].ObjectID,
				AccountName:       "上海测试科技有限公司", BankName: "示例银行",
				BankBranch: "上海虹桥支行", AccountNumber: "622200000000001002",
				Remark: "测试草稿资金账户",
			}
		}},
	}
	for _, sample := range samples {
		var view seedBusinessView
		var result outcome
		var err error
		if sample.entity == bobdomain.EntityOtherUnit {
			view, result, err = s.ensureOtherUnit(ctx, sample)
		} else {
			view, result, err = s.ensureBusiness(ctx, sample)
		}
		if err != nil {
			return fmt.Errorf("%s: %w", sample.key, err)
		}
		s.bobRefs[sample.key] = view
		if sample.entity == bobdomain.EntityCustomer && sample.status == approvedStatus {
			subunit, subunitErr := s.defaultCustomerSubunitReference(ctx, view, sample.key)
			if subunitErr != nil {
				return fmt.Errorf("%s implicit subunit: %w", sample.key, subunitErr)
			}
			s.bobRefs[sample.key+"-customer"] = view
			s.bobRefs[sample.key] = subunit
		}
		counts.add(result)
	}
	return nil
}

func (s *Seeder) ensureOtherUnit(ctx context.Context, sample bobSample) (seedBusinessView, outcome, error) {
	var objectID string
	err := s.pool.QueryRow(ctx, `
		SELECT subject_id FROM approval_events
		WHERE domain='dcl' AND entity='other-unit' AND request_id=$1 AND action='CREATED'
		ORDER BY created_at,id LIMIT 1
	`, requestID(sample.key, "create")).Scan(&objectID)
	created := false
	if errors.Is(err, pgx.ErrNoRows) {
		data := sample.data(s)
		createActor, actorErr := seedActor(actorID, requestID(sample.key, "create"))
		if actorErr != nil {
			return seedBusinessView{}, 0, actorErr
		}
		result, createErr := s.typedArchives.CreateOtherUnit(ctx, dcldomain.OtherUnitCreateInput{
			Data: dcldomain.OtherUnitData{
				Kind: "ORGANIZATION", LegalName: data.Name, DisplayName: data.ShortName,
				LegalIdentifier: legalIdentifierForSeed("ORGANIZATION", sample.key), Enabled: true,
				OperatingEntityIDs:       []string{s.bobRefs["operating-effective"].ObjectID},
				DefaultOperatingEntityID: s.bobRefs["operating-effective"].ObjectID,
				ContactName:              data.ContactName, ContactPhone: data.ContactPhone,
				Email: data.Email, Address: data.Address,
				SettlementMethodID: data.SettlementMethodID, Remark: data.Remark,
			},
		}, createActor)
		if createErr != nil {
			return seedBusinessView{}, 0, createErr
		}
		objectID, created = result.ObjectID, true
	} else if err != nil {
		return seedBusinessView{}, 0, err
	}
	getActor, actorErr := seedActor(actorID, requestID(sample.key, "get"))
	if actorErr != nil {
		return seedBusinessView{}, 0, actorErr
	}
	view, err := s.typedArchives.GetOtherUnit(ctx, dcldomain.TypedArchiveGetInput{ObjectID: objectID}, getActor)
	if err != nil {
		return seedBusinessView{}, 0, err
	}
	converted := dclOtherUnitObjectView(view)
	if string(view.Approval.Status) != sample.status {
		if err = s.advanceBusiness(ctx, sample, converted); err != nil {
			return seedBusinessView{}, 0, err
		}
		view, err = s.typedArchives.GetOtherUnit(ctx, dcldomain.TypedArchiveGetInput{ObjectID: objectID}, getActor)
		if err != nil {
			return seedBusinessView{}, 0, err
		}
		converted = dclOtherUnitObjectView(view)
		if !created {
			return converted, outcomeResumed, nil
		}
	}
	if created {
		return converted, outcomeCreated, nil
	}
	return converted, outcomeSkipped, nil
}

func dclOtherUnitObjectView(view dcldomain.OtherUnitView) seedBusinessView {
	result := seedBusinessView{
		ObjectID: view.ObjectID, Entity: bobdomain.EntityOtherUnit, Code: view.Code,
		ApprovalRevision: view.Approval.Revision, Enabled: view.Data.Enabled,
	}
	result.Approval, result.Data = view.Approval, bobdomain.DetailView{
		Name: view.Data.DisplayName, ContactName: view.Data.ContactName,
		ContactPhone: view.Data.ContactPhone, Email: view.Data.Email,
		Address: view.Data.Address, SettlementMethodID: view.Data.SettlementMethodID,
		OperatingEntityID: view.Data.DefaultOperatingEntityID, Remark: view.Data.Remark,
	}
	return result
}

func (s *Seeder) supplierDeclarations() *dcldomain.SupplierService {
	return dcldomain.NewSupplierService(
		s.pool, s.business, seedAuthorizer{}, txevent.NewBus(),
	)
}

func (s *Seeder) customerDeclarations() *dcldomain.CustomerService {
	return dcldomain.NewCustomerService(s.pool, s.business, seedAuthorizer{}, txevent.NewBus())
}

func (s *Seeder) ensureBusiness(
	ctx context.Context,
	sample bobSample,
) (seedBusinessView, outcome, error) {
	var objectID string
	err := s.pool.QueryRow(ctx, `
		SELECT subject_id
		FROM approval_events
		WHERE domain='dcl' AND entity=$2 AND request_id=$1 AND action='CREATED'
		ORDER BY created_at,id
		LIMIT 1
	`, requestID(sample.key, "create"), sample.entity).Scan(&objectID)
	created := false
	if errors.Is(err, pgx.ErrNoRows) {
		data := sample.data(s)
		createActor, actorErr := seedActor(actorID, requestID(sample.key, "create"))
		if actorErr != nil {
			return seedBusinessView{}, 0, actorErr
		}
		var result seedBusinessMutation
		var createErr error
		switch sample.entity {
		case bobdomain.EntityOperatingEntity:
			createdOperatingEntity, declarationErr := s.operatingEntities.Create(ctx, dcldomain.OperatingEntityCreateInput{
				Data: dcldomain.OperatingEntityData{Name: data.Name, ShortName: data.ShortName,
					TaxNumber: data.TaxNumber, Address: data.Address, Phone: data.Phone, Remark: data.Remark},
			}, createActor)
			result, createErr = dclBusinessMutation(createdOperatingEntity), declarationErr
		case bobdomain.EntityWarehouse:
			createdWarehouse, declarationErr := s.warehouses.Create(ctx, dcldomain.WarehouseCreateInput{
				Data: dcldomain.WarehouseData{Name: data.Name, Address: data.Address,
					ContactName: data.ContactName, ContactPhone: data.ContactPhone,
					ManagerEmployeeID: data.ManagerEmployeeID, Remark: data.Remark},
			}, createActor)
			result, createErr = dclWarehouseBusinessMutation(createdWarehouse), declarationErr
		case bobdomain.EntityVehicle:
			createdVehicle, declarationErr := s.vehicles.Create(ctx, dcldomain.VehicleCreateInput{Data: dcldomain.VehicleData{Name: data.Name, PlateNumber: data.PlateNumber, VehicleType: data.VehicleType, CarrierAffiliation: data.CarrierAffiliation, BulkLiquidCapable: data.BulkLiquidCapable, VIN: data.VIN, EngineNumber: data.EngineNumber, LoadCapacityKG: data.LoadCapacityKG, Remark: data.Remark}}, createActor)
			result, createErr = dclVehicleBusinessMutation(createdVehicle), declarationErr
		case bobdomain.EntityFundAccount:
			createdFundAccount, declarationErr := s.fundAccounts.Create(ctx, dcldomain.FundAccountCreateInput{Data: dcldomain.FundAccountData{
				Name: data.Name, Currency: data.Currency, OperatingEntityID: data.OperatingEntityID,
				AccountName: data.AccountName, BankName: data.BankName, BankBranch: data.BankBranch,
				AccountNumber: data.AccountNumber, Remark: data.Remark,
			}}, createActor)
			result, createErr = dclFundAccountBusinessMutation(createdFundAccount), declarationErr
		case bobdomain.EntityProduct:
			createdProduct, declarationErr := s.products.Create(ctx, dcldomain.ProductCreateInput{Data: dcldomain.ProductInputFromData(dcldomain.ProductData{
				Name: data.Name, CategoryID: data.CategoryID, Specification: data.Specification,
				Model: data.Model, Barcode: data.Barcode, Remark: data.Remark,
				ProductTypeID: data.ProductTypeID, DefaultInputUnitID: data.DefaultInputUnitID,
				PricingUnitID: data.PricingUnitID, UnitConversions: data.UnitConversions,
				Returnable: data.Returnable, DefaultPackagingSpec: data.DefaultPackagingSpec, Formula: data.Formula,
			})}, createActor)
			result, createErr = dclProductBusinessMutation(createdProduct), declarationErr
		case bobdomain.EntityEmployee:
			createdEmployee, declarationErr := s.employees.Create(ctx, dcldomain.EmployeeCreateInput{
				Data: dcldomain.EmployeeInput{Kind: "PERSON", LegalName: data.Name, LegalIdentifier: legalIdentifierForSeed("PERSON", sample.key), Enabled: true, CurrentOperatingEntityID: s.bobRefs["operating-effective"].ObjectID, DepartmentID: data.DepartmentID, PositionID: data.PositionID,
					Phone: data.Phone, Email: data.Email, HireDate: data.HireDate, Remark: data.Remark},
			}, createActor)
			result, createErr = dclEmployeeBusinessMutation(createdEmployee), declarationErr
		case bobdomain.EntitySupplier:
			createdSupplier, declarationErr := s.supplierDeclarations().Create(ctx, dcldomain.SupplierCreateInput{
				Data: dcldomain.SupplierInput{Kind: "ORGANIZATION", LegalName: data.Name, DisplayName: data.ShortName,
					LegalIdentifier: legalIdentifierForSeed("ORGANIZATION", sample.key), Enabled: true,
					OperatingEntityIDs: []string{s.bobRefs["operating-effective"].ObjectID}, DefaultOperatingEntityID: s.bobRefs["operating-effective"].ObjectID,
					ShortName:   data.ShortName,
					ContactName: data.ContactName, ContactPhone: data.ContactPhone,
					Email: data.Email, Address: data.Address, Remark: data.Remark,
					SettlementMethodID:         data.SettlementMethodID,
					DefaultPurchaserEmployeeID: data.DefaultPurchaserEmployeeID},
			}, createActor)
			result, createErr = dclSupplierBusinessMutation(createdSupplier), declarationErr
		case bobdomain.EntityCustomer:
			createdCustomer, archiveErr := s.customerDeclarations().Create(ctx, dcldomain.CustomerCreateInput{Data: dcldomain.CustomerCreateDataInput{
				Root: dcldomain.CustomerRootDataInput{Kind: "MAINLAND_ENTERPRISE", LegalName: data.Name, DisplayName: data.ShortName, LegalIdentifier: legalIdentifierForSeed("ORGANIZATION", sample.key),
					Phone: data.ContactPhone, Email: data.Email, Address: data.Address,
					DefaultOperatingEntityID: s.bobRefs["operating-effective"].ObjectID, Enabled: true,
					RemittanceProfiles: []dcldomain.CustomerRemittanceProfile{}},
				Subunits: []dcldomain.CustomerSubunitDataInput{{Enabled: true, Name: data.Name, ShortName: data.ShortName,
					CustomerTypeID: bobdomain.CustomerTypeEndUserID, ContactName: data.ContactName,
					ContactPhone: data.ContactPhone, Email: data.Email, Address: data.Address,
					SettlementMethodID:         data.SettlementMethodID,
					PaymentMethodID:            s.auxRefs["payment-bank-transfer"].ObjectID,
					DefaultTransportMethodCode: "DELIVERY", DefaultTransportMethodName: "送货",
					PricingPolicy: dcldomain.CustomerPricingPolicy{DefaultPremiumUnitPrice: "0.00",
						DefaultDiscountUnitPrice: "0.00", CostItems: []dcldomain.CustomerPricingCostItem{},
						ThirdPartyIntermediaryFixedUnitCost:    "0.00",
						ThirdPartyIntermediaryVariableUnitCost: "0.00"},
					CreditLimits: []dcldomain.CustomerCreditLimit{},
					PrimarySalesAttribution: dcldomain.CustomerSalesAttributionInput{
						Type:            dcldomain.CustomerSalesAttributionInternalEmployee,
						SubjectObjectID: data.SalespersonEmployeeID}, InternalReminder: data.Remark}},
			}}, createActor)
			result = dclCustomerBusinessMutation(createdCustomer)
			createErr = archiveErr
		default:
			createErr = fmt.Errorf("unsupported DCL seed entity %q", sample.entity)
		}
		if createErr != nil {
			return seedBusinessView{}, 0, createErr
		}
		objectID = result.ObjectID
		created = true
	} else if err != nil {
		return seedBusinessView{}, 0, err
	}
	view, err := s.getBusiness(ctx, sample.entity, objectID, sample.key)
	if err != nil {
		return seedBusinessView{}, 0, err
	}
	if version := currentBusinessVersion(view); version == nil || string(version.Approval.Status) != sample.status {
		var external int
		if err = s.pool.QueryRow(ctx, `
			SELECT count(*)
			FROM approval_events
			WHERE domain='dcl' AND subject_id=$1 AND request_id NOT LIKE $2
		`, objectID, seedPrefix+"%").Scan(&external); err != nil {
			return seedBusinessView{}, 0, err
		}
		if external == 0 {
			if err = s.advanceBusiness(ctx, sample, view); err != nil {
				return seedBusinessView{}, 0, err
			}
			view, err = s.getBusiness(ctx, sample.entity, objectID, sample.key)
			if err != nil {
				return seedBusinessView{}, 0, err
			}
			if !created {
				return view, outcomeResumed, nil
			}
		}
	}
	if created {
		return view, outcomeCreated, nil
	}
	return view, outcomeSkipped, nil
}

func dclBusinessMutation(result dcldomain.OperatingEntityMutation) seedBusinessMutation {
	return seedBusinessMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision,
		Enabled: result.Enabled, Approval: result.Approval}
}

func dclBusinessView(view dcldomain.OperatingEntityView) seedBusinessView {
	return seedBusinessView{ObjectID: view.ObjectID, Entity: bobdomain.EntityOperatingEntity,
		Code: view.Code, ApprovalRevision: view.Approval.Revision, Enabled: view.Enabled,
		Approval: view.Approval, Data: bobdomain.DetailView{Name: view.Data.Name,
			ShortName: view.Data.ShortName, TaxNumber: view.Data.TaxNumber, Address: view.Data.Address,
			Phone: view.Data.Phone, Remark: view.Data.Remark}, UpdatedAt: view.UpdatedAt}
}

func dclWarehouseBusinessMutation(result dcldomain.WarehouseMutation) seedBusinessMutation {
	return seedBusinessMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision,
		Enabled: result.Enabled, Approval: result.Approval}
}

func dclWarehouseBusinessView(view dcldomain.WarehouseView) seedBusinessView {
	return seedBusinessView{ObjectID: view.ObjectID, Entity: bobdomain.EntityWarehouse,
		Code: view.Code, ApprovalRevision: view.Approval.Revision, Enabled: view.Enabled,
		Approval: view.Approval, Data: bobdomain.DetailView{Name: view.Data.Name,
			Address: view.Data.Address, ContactName: view.Data.ContactName, ContactPhone: view.Data.ContactPhone,
			ManagerEmployeeID: view.Data.ManagerEmployeeID,
			Remark:            view.Data.Remark}, UpdatedAt: view.UpdatedAt}
}
func dclVehicleBusinessMutation(result dcldomain.VehicleMutation) seedBusinessMutation {
	return seedBusinessMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}
}
func dclVehicleBusinessView(view dcldomain.VehicleView) seedBusinessView {
	return seedBusinessView{ObjectID: view.ObjectID, Entity: bobdomain.EntityVehicle, Code: view.Code, ApprovalRevision: view.Approval.Revision, Enabled: view.Enabled, Approval: view.Approval, Data: bobdomain.DetailView{Name: view.Data.Name, PlateNumber: view.Data.PlateNumber, VehicleType: view.Data.VehicleType, CarrierAffiliation: view.Data.CarrierAffiliation, BulkLiquidCapable: view.Data.BulkLiquidCapable, VIN: view.Data.VIN, EngineNumber: view.Data.EngineNumber, LoadCapacityKG: view.Data.LoadCapacityKG, Remark: view.Data.Remark}, UpdatedAt: view.UpdatedAt}
}

func dclFundAccountBusinessMutation(result dcldomain.FundAccountMutation) seedBusinessMutation {
	return seedBusinessMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}
}

func dclFundAccountBusinessView(view dcldomain.FundAccountView) seedBusinessView {
	return seedBusinessView{ObjectID: view.ObjectID, Entity: bobdomain.EntityFundAccount,
		Code: view.Code, ApprovalRevision: view.Approval.Revision, Enabled: view.Enabled,
		Approval: view.Approval, Data: bobdomain.DetailView{Name: view.Data.Name, Currency: view.Data.Currency,
			OperatingEntityID: view.Data.OperatingEntityID, AccountName: view.Data.AccountName,
			BankName: view.Data.BankName, BankBranch: view.Data.BankBranch, AccountNumber: view.Data.AccountNumber,
			Remark: view.Data.Remark}, UpdatedAt: view.UpdatedAt}
}

func dclProductBusinessMutation(result dcldomain.ProductMutation) seedBusinessMutation {
	return seedBusinessMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}
}

func dclEmployeeBusinessMutation(result dcldomain.EmployeeMutation) seedBusinessMutation {
	return seedBusinessMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision,
		Enabled: result.Enabled, Approval: result.Approval}
}

func dclEmployeeBusinessView(view dcldomain.EmployeeView) seedBusinessView {
	return seedBusinessView{ObjectID: view.ObjectID, Entity: bobdomain.EntityEmployee,
		Code: view.Code, ApprovalRevision: view.Approval.Revision, Enabled: view.Data.Enabled,
		Approval: view.Approval, Data: bobdomain.DetailView{Name: view.Data.DisplayName,
			OperatingEntityID: view.Data.CurrentOperatingEntityID, DepartmentID: view.Data.DepartmentID,
			PositionID: view.Data.PositionID, Phone: view.Data.Phone, Email: view.Data.Email,
			HireDate: view.Data.HireDate, Remark: view.Data.Remark}, UpdatedAt: view.UpdatedAt}
}

func dclSupplierBusinessMutation(result dcldomain.SupplierMutation) seedBusinessMutation {
	return seedBusinessMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision,
		Enabled: result.Enabled, Approval: result.Approval}
}

func dclSupplierBusinessView(view dcldomain.SupplierView) seedBusinessView {
	return seedBusinessView{ObjectID: view.ObjectID, Entity: bobdomain.EntitySupplier,
		Code: view.Code, ApprovalRevision: view.Approval.Revision, Enabled: view.Data.Enabled,
		Approval: view.Approval, Data: bobdomain.DetailView{Name: view.Data.DisplayName,
			ShortName: view.Data.ShortName, LegalIdentifier: view.Data.LegalIdentifier,
			ContactName: view.Data.ContactName, ContactPhone: view.Data.ContactPhone,
			Email: view.Data.Email, Address: view.Data.Address, Remark: view.Data.Remark,
			SettlementMethodID:         view.Data.SettlementMethodID,
			DefaultPurchaserEmployeeID: view.Data.DefaultPurchaserEmployeeID,
			OperatingEntityID:          view.Data.DefaultOperatingEntityID}, UpdatedAt: view.UpdatedAt}
}

func dclCustomerBusinessMutation(result dcldomain.CustomerMutation) seedBusinessMutation {
	return seedBusinessMutation{ObjectID: result.ObjectID, ApprovalRevision: result.Approval.Revision, Enabled: result.Enabled, Approval: result.Approval}
}

func dclCustomerBusinessView(view dcldomain.CustomerView) seedBusinessView {
	return seedBusinessView{ObjectID: view.ObjectID, Entity: bobdomain.EntityCustomer,
		Code: view.Code, ApprovalRevision: view.Approval.Revision, Enabled: view.Data.Enabled,
		Approval: view.Approval, Data: bobdomain.DetailView{Name: view.Data.LegalName,
			ShortName: view.Data.DisplayName, LegalIdentifier: view.Data.LegalIdentifier,
			ContactPhone: view.Data.Phone, Email: view.Data.Email, Address: view.Data.Address,
			OperatingEntityID: view.Data.DefaultOperatingEntityID}, UpdatedAt: view.UpdatedAt}
}

// defaultCustomerSubunitReference exposes the Customer aggregate's approved
// implicit subunit to voucher seeds. The subunit is an embedded reference; its
// approval entry remains the enclosing Customer entry.
func (s *Seeder) defaultCustomerSubunitReference(ctx context.Context, customer seedBusinessView, key string) (seedBusinessView, error) {
	actor, err := seedActor(actorID, requestID(key, "default-account"))
	if err != nil {
		return seedBusinessView{}, err
	}
	view, err := s.customerDeclarations().Get(ctx, dcldomain.CustomerGetInput{ObjectID: customer.ObjectID}, actor)
	if err != nil {
		return seedBusinessView{}, err
	}
	for _, subunit := range view.Data.Subunits {
		if view.Data.ImplicitSubunitID != nil && *view.Data.ImplicitSubunitID == subunit.SubunitID {
			return seedBusinessView{ObjectID: subunit.SubunitID, Entity: bobdomain.EntityCustomerSubunit,
				Code: subunit.Code, ApprovalRevision: view.Approval.Revision, Enabled: subunit.Enabled,
				Approval: view.Approval, Data: bobdomain.DetailView{Name: subunit.Name, ShortName: subunit.ShortName,
					ContactName: subunit.ContactName, ContactPhone: subunit.ContactPhone, Email: subunit.Email,
					Address: subunit.Address, SettlementMethodID: subunit.SettlementMethodID,
					SalespersonEmployeeID: subunit.PrimarySalesAttribution.SubjectObjectID,
					Remark:                subunit.InternalReminder}}, nil
		}
	}
	return seedBusinessView{}, errors.New("customer has no implicit subunit")
}

func dclProductBusinessView(view dcldomain.ProductView) seedBusinessView {
	return seedBusinessView{ObjectID: view.ObjectID, Entity: bobdomain.EntityProduct,
		Code: view.Code, ApprovalRevision: view.Approval.Revision, Enabled: view.Enabled,
		Approval: view.Approval, Data: bobdomain.DetailView{
			Name: view.Data.Name, CategoryID: view.Data.CategoryID, Specification: view.Data.Specification,
			Model: view.Data.Model, Barcode: view.Data.Barcode, Remark: view.Data.Remark,
			ProductTypeID: view.Data.ProductTypeID, DefaultInputUnitID: view.Data.DefaultInputUnitID,
			PricingUnitID: view.Data.PricingUnitID, UnitConversions: view.Data.UnitConversions,
			Returnable: view.Data.Returnable, DefaultPackagingSpec: view.Data.DefaultPackagingSpec, Formula: view.Data.Formula,
		}, UpdatedAt: view.UpdatedAt}
}

func (s *Seeder) getBusiness(ctx context.Context, entity, objectID, key string) (seedBusinessView, error) {
	if entity == bobdomain.EntityCustomer {
		actor, err := seedActor(actorID, requestID(key, "get"))
		if err != nil {
			return seedBusinessView{}, err
		}
		view, getErr := s.customerDeclarations().Get(ctx, dcldomain.CustomerGetInput{ObjectID: objectID}, actor)
		return dclCustomerBusinessView(view), getErr
	}
	if entity == bobdomain.EntitySupplier {
		actor, err := seedActor(actorID, requestID(key, "get"))
		if err != nil {
			return seedBusinessView{}, err
		}
		view, getErr := s.supplierDeclarations().Get(ctx, dcldomain.SupplierGetInput{ObjectID: objectID}, actor)
		return dclSupplierBusinessView(view), getErr
	}
	if entity == bobdomain.EntityOtherUnit {
		actor, err := seedActor(actorID, requestID(key, "get"))
		if err != nil {
			return seedBusinessView{}, err
		}
		view, getErr := s.typedArchives.GetOtherUnit(ctx, dcldomain.TypedArchiveGetInput{ObjectID: objectID}, actor)
		return dclOtherUnitObjectView(view), getErr
	}
	if entity != bobdomain.EntityOperatingEntity && entity != bobdomain.EntityWarehouse && entity != bobdomain.EntityVehicle && entity != bobdomain.EntityFundAccount && entity != bobdomain.EntityProduct && entity != bobdomain.EntityEmployee {
		return seedBusinessView{}, fmt.Errorf("unsupported DCL seed entity %q", entity)
	}
	actor, err := seedActor(actorID, requestID(key, "get"))
	if err != nil {
		return seedBusinessView{}, err
	}
	if entity == bobdomain.EntityWarehouse {
		view, getErr := s.warehouses.Get(ctx, dcldomain.WarehouseGetInput{ObjectID: objectID}, actor)
		return dclWarehouseBusinessView(view), getErr
	}
	if entity == bobdomain.EntityVehicle {
		view, getErr := s.vehicles.Get(ctx, dcldomain.VehicleGetInput{ObjectID: objectID}, actor)
		return dclVehicleBusinessView(view), getErr
	}
	if entity == bobdomain.EntityFundAccount {
		view, getErr := s.fundAccounts.Get(ctx, dcldomain.FundAccountGetInput{ObjectID: objectID}, actor)
		return dclFundAccountBusinessView(view), getErr
	}
	if entity == bobdomain.EntityProduct {
		view, getErr := s.products.Get(ctx, dcldomain.ProductGetInput{ObjectID: objectID}, actor)
		return dclProductBusinessView(view), getErr
	}
	if entity == bobdomain.EntityEmployee {
		view, getErr := s.employees.Get(ctx, dcldomain.EmployeeGetInput{ObjectID: objectID}, actor)
		return dclEmployeeBusinessView(view), getErr
	}
	view, getErr := s.operatingEntities.Get(ctx, dcldomain.OperatingEntityGetInput{ObjectID: objectID}, actor)
	return dclBusinessView(view), getErr
}

func (s *Seeder) advanceBusiness(
	ctx context.Context,
	sample bobSample,
	view seedBusinessView,
) error {
	current, mutationErr := businessMutation(view)
	if mutationErr != nil {
		return mutationErr
	}
	var err error
	if current.Approval.Status == approval.StatusDraft && sample.status != string(current.Approval.Status) {
		actor, actorErr := seedActor(actorID, requestID(sample.key, "submit"))
		if actorErr != nil {
			return actorErr
		}
		if sample.entity == bobdomain.EntityOtherUnit {
			var submitted dcldomain.TypedArchiveMutation
			submitted, err = s.typedArchives.SubmitOtherUnit(ctx, dcldomain.TypedArchiveVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
			current = seedBusinessMutation{ObjectID: submitted.ObjectID, ApprovalRevision: submitted.Approval.Revision, Enabled: submitted.Enabled, Approval: submitted.Approval}
		} else if sample.entity == bobdomain.EntityCustomer {
			var submitted dcldomain.CustomerMutation
			submitted, err = s.customerDeclarations().Submit(ctx, dcldomain.CustomerVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
			current = dclCustomerBusinessMutation(submitted)
		} else if sample.entity == bobdomain.EntitySupplier {
			declarations := s.supplierDeclarations()
			var submitted dcldomain.SupplierMutation
			submitted, err = declarations.Submit(ctx, dcldomain.SupplierVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
			current = dclSupplierBusinessMutation(submitted)
		} else if sample.entity == bobdomain.EntityEmployee {
			var submitted dcldomain.EmployeeMutation
			submitted, err = s.employees.Submit(ctx, dcldomain.EmployeeVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
			current = dclEmployeeBusinessMutation(submitted)
		} else if sample.entity == bobdomain.EntityVehicle {
			var submitted dcldomain.VehicleMutation
			submitted, err = s.vehicles.Submit(ctx, dcldomain.VehicleVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
			current = dclVehicleBusinessMutation(submitted)
		} else if sample.entity == bobdomain.EntityFundAccount {
			var submitted dcldomain.FundAccountMutation
			submitted, err = s.fundAccounts.Submit(ctx, dcldomain.FundAccountVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
			current = dclFundAccountBusinessMutation(submitted)
		} else if sample.entity == bobdomain.EntityProduct {
			var submitted dcldomain.ProductMutation
			submitted, err = s.products.Submit(ctx, dcldomain.ProductVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
			current = dclProductBusinessMutation(submitted)
		} else if sample.entity == bobdomain.EntityWarehouse {
			var submitted dcldomain.WarehouseMutation
			submitted, err = s.warehouses.Submit(ctx, dcldomain.WarehouseVersionInput{
				ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID,
				ApprovalRevision: current.Approval.Revision,
			}, actor)
			current = dclWarehouseBusinessMutation(submitted)
		} else if sample.entity == bobdomain.EntityOperatingEntity {
			var submitted dcldomain.OperatingEntityMutation
			submitted, err = s.operatingEntities.Submit(ctx, dcldomain.OperatingEntityVersionInput{
				ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID,
				ApprovalRevision: current.Approval.Revision,
			}, actor)
			current = dclBusinessMutation(submitted)
		} else {
			err = fmt.Errorf("unsupported DCL seed entity %q", sample.entity)
		}
		if err != nil {
			return err
		}
	}
	switch {
	case string(current.Approval.Status) == sample.status:
		return nil
	case current.Approval.Status == approval.StatusPending && sample.status == approvedStatus:
		actor, actorErr := seedActor(reviewerID, requestID(sample.key, "approve"))
		if actorErr != nil {
			return actorErr
		}
		if sample.entity == bobdomain.EntityOtherUnit {
			_, err = s.typedArchives.ApproveOtherUnit(ctx, dcldomain.TypedArchiveVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
		} else if sample.entity == bobdomain.EntityCustomer {
			_, err = s.customerDeclarations().Approve(ctx, dcldomain.CustomerVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
		} else if sample.entity == bobdomain.EntitySupplier {
			_, err = s.supplierDeclarations().Approve(ctx, dcldomain.SupplierVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
		} else if sample.entity == bobdomain.EntityEmployee {
			_, err = s.employees.Approve(ctx, dcldomain.EmployeeVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
		} else if sample.entity == bobdomain.EntityVehicle {
			_, err = s.vehicles.Approve(ctx, dcldomain.VehicleVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
		} else if sample.entity == bobdomain.EntityFundAccount {
			_, err = s.fundAccounts.Approve(ctx, dcldomain.FundAccountVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
		} else if sample.entity == bobdomain.EntityProduct {
			_, err = s.products.Approve(ctx, dcldomain.ProductVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
		} else if sample.entity == bobdomain.EntityWarehouse {
			_, err = s.warehouses.Approve(ctx, dcldomain.WarehouseVersionInput{
				ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID,
				ApprovalRevision: current.Approval.Revision,
			}, actor)
		} else if sample.entity == bobdomain.EntityOperatingEntity {
			_, err = s.operatingEntities.Approve(ctx, dcldomain.OperatingEntityVersionInput{
				ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID,
				ApprovalRevision: current.Approval.Revision,
			}, actor)
		} else {
			err = fmt.Errorf("unsupported DCL seed entity %q", sample.entity)
		}
	default:
		return fmt.Errorf("cannot advance status %s to %s", current.Approval.Status, sample.status)
	}
	return err
}
