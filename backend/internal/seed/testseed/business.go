package testseed

import (
	"context"
	"errors"
	"fmt"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

const approvedStatus = string(approval.StatusApproved)

type bobSample struct {
	key, entity, status string
	data                func(*Seeder) bobdomain.CreateDetailInput
}

func currentBusinessVersion(view bobdomain.ObjectView) *bobdomain.VersionView {
	return &bobdomain.VersionView{Approval: view.Approval, Data: view.Data}
}

func businessMutation(view bobdomain.ObjectView) (bobdomain.MutationResult, error) {
	version := currentBusinessVersion(view)
	if version == nil {
		return bobdomain.MutationResult{}, fmt.Errorf("BOB object %s has neither open nor approved version", view.ObjectID)
	}
	return bobdomain.MutationResult{
		ObjectID: view.ObjectID, ObjectRevision: view.ObjectRevision, Enabled: view.Enabled,
		Approval: version.Approval,
	}, nil
}

func unitSnapshot(view auxdomain.ObjectView) bobdomain.MeasurementUnitSnapshot {
	if view.LatestApproved == nil {
		panic("test seed requires an approved AUX measurement unit")
	}
	data := view.LatestApproved.Data
	name, _ := data["name"].(string)
	symbol, _ := data["symbol"].(string)
	return bobdomain.MeasurementUnitSnapshot{ObjectID: view.ObjectID, ApprovalEntryID: view.LatestApproved.Approval.ApprovalEntryID, Code: view.Code, Name: name, Symbol: symbol}
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
		var objectID string
		if err := s.pool.QueryRow(ctx, `SELECT object.id
			FROM aux_objects object
			JOIN approval_entries entry ON entry.domain='aux' AND entry.entity='settlement-method'
			  AND entry.subject_id=object.id AND entry.status='APPROVED'
			JOIN aux_version_payloads payload ON payload.approval_entry_id=entry.id
			WHERE object.entity='settlement-method' AND object.enabled
			  AND payload.data->>'termCode'=$1
			  AND NOT EXISTS (SELECT 1 FROM approval_entries newer WHERE newer.domain='aux' AND newer.entity=entry.entity AND newer.subject_id=entry.subject_id AND newer.status='APPROVED' AND newer.version_no>entry.version_no)`,
			termCode).Scan(&objectID); err != nil {
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
				TaxNumber: "91310000TEST0103", ContactName: "刘顾问", ContactPhone: "13800000107",
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
		{"customer-effective", bobdomain.EntityCustomerAccount, approvedStatus, func(s *Seeder) bobdomain.CreateDetailInput {
			customerType := bobdomain.CustomerTypeEndUser
			return bobdomain.CreateDetailInput{
				Name: "星河制造有限公司（测试）", CustomerType: &customerType,
				ShortName: "星河制造", TaxNumber: "91310000TEST0101",
				ContactName: "王经理", ContactPhone: "13800000103",
				Email: "test.customer@example.com", Address: "上海市浦东新区测试路 101 号",
				SettlementMethodID:    s.auxRefs["settlement-month-end"].ObjectID,
				MonthlyClosingDay:     15,
				SalespersonEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                "测试有效客户",
			}
		}},
		{"customer-draft", bobdomain.EntityCustomerAccount, string(approval.StatusDraft), func(s *Seeder) bobdomain.CreateDetailInput {
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
				Name:      "通用原料供应商（测试）",
				ShortName: "测试原料", TaxNumber: "91310000TEST0102",
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
					Type: "EXTERNAL", ServiceRelationshipObjectID: s.bobRefs["external-carrier"].ObjectID,
				},
				VIN: "LSVAA4187N2100101", EngineNumber: "ENG-TEST-101",
				LoadCapacityKG: "18000", Remark: "测试有效车辆",
			}
		}},
		{"vehicle-draft", bobdomain.EntityVehicle, string(approval.StatusDraft), func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "自营配送二号车（测试草稿）", PlateNumber: "沪A10102",
				VehicleType: "DIT-0003", CarrierAffiliation: &bobdomain.CarrierAffiliation{
					Type: "EXTERNAL", ServiceRelationshipObjectID: s.bobRefs["external-carrier"].ObjectID,
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
		var view bobdomain.ObjectView
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
		counts.add(result)
	}
	return nil
}

func (s *Seeder) ensureOtherUnit(ctx context.Context, sample bobSample) (bobdomain.ObjectView, outcome, error) {
	var objectID string
	err := s.pool.QueryRow(ctx, `
		SELECT subject_id FROM approval_events
		WHERE domain='bob' AND request_id=$1 AND action='CREATED'
		ORDER BY created_at,id LIMIT 1
	`, requestID(sample.key, "create")).Scan(&objectID)
	created := false
	if errors.Is(err, pgx.ErrNoRows) {
		data := sample.data(s)
		createActor, actorErr := seedActor(actorID, requestID(sample.key, "create"))
		if actorErr != nil {
			return bobdomain.ObjectView{}, 0, actorErr
		}
		result, createErr := s.business.OtherUnitCreate(ctx, bobdomain.OtherUnitCreateInput{
			NewParty: &bobdomain.PartyCreateData{
				Kind: bobdomain.PartyKindOrganization, LegalName: data.Name,
				DisplayName: data.ShortName, TaxNumber: data.TaxNumber,
			},
			Data: bobdomain.OtherUnitData{
				OperatingEntityID: s.bobRefs["operating-effective"].ObjectID,
				ContactName:       data.ContactName, ContactPhone: data.ContactPhone,
				Email: data.Email, Address: data.Address,
				SettlementMethodID: data.SettlementMethodID, Remark: data.Remark,
			},
		}, createActor, true)
		if createErr != nil {
			return bobdomain.ObjectView{}, 0, createErr
		}
		objectID, created = result.ObjectID, true
	} else if err != nil {
		return bobdomain.ObjectView{}, 0, err
	}
	view, err := s.business.OtherUnitGet(ctx, bobdomain.GetInput{ObjectID: objectID})
	if err != nil {
		return bobdomain.ObjectView{}, 0, err
	}
	converted := otherUnitObjectView(view)
	if string(view.Approval.Status) != sample.status {
		if err = s.advanceBusiness(ctx, sample, converted); err != nil {
			return bobdomain.ObjectView{}, 0, err
		}
		view, err = s.business.OtherUnitGet(ctx, bobdomain.GetInput{ObjectID: objectID})
		if err != nil {
			return bobdomain.ObjectView{}, 0, err
		}
		converted = otherUnitObjectView(view)
		if !created {
			return converted, outcomeResumed, nil
		}
	}
	if created {
		return converted, outcomeCreated, nil
	}
	return converted, outcomeSkipped, nil
}

func otherUnitObjectView(view bobdomain.OtherUnitView) bobdomain.ObjectView {
	result := bobdomain.ObjectView{
		ObjectID: view.ObjectID, Entity: bobdomain.EntityOtherUnit, Code: view.Code,
		ObjectRevision: view.ObjectRevision, Enabled: view.Enabled,
	}
	result.Approval, result.Data = view.Approval, bobdomain.DetailView{
		Name: view.PartyDisplayName, ContactName: view.Data.ContactName,
		ContactPhone: view.Data.ContactPhone, Email: view.Data.Email,
		Address: view.Data.Address, SettlementMethodID: view.Data.SettlementMethodID,
		OperatingEntityID: view.OperatingEntityID, Remark: view.Data.Remark,
	}
	return result
}

func (s *Seeder) ensureBusiness(
	ctx context.Context,
	sample bobSample,
) (bobdomain.ObjectView, outcome, error) {
	approvalDomain := "bob"
	if sample.entity == bobdomain.EntityOperatingEntity || sample.entity == bobdomain.EntityWarehouse || sample.entity == bobdomain.EntityVehicle {
		approvalDomain = "dcl"
	}
	var objectID string
	err := s.pool.QueryRow(ctx, `
		SELECT subject_id
		FROM approval_events
		WHERE domain=$3 AND entity=$2 AND request_id=$1 AND action='CREATED'
		ORDER BY created_at,id
		LIMIT 1
	`, requestID(sample.key, "create"), sample.entity, approvalDomain).Scan(&objectID)
	created := false
	if errors.Is(err, pgx.ErrNoRows) {
		data := sample.data(s)
		createActor, actorErr := seedActor(actorID, requestID(sample.key, "create"))
		if actorErr != nil {
			return bobdomain.ObjectView{}, 0, actorErr
		}
		var result bobdomain.MutationResult
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
		case bobdomain.EntityEmployee:
			createdEmployment, relationshipErr := s.business.EmploymentCreate(ctx, bobdomain.EmploymentCreateInput{
				NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindPerson,
					LegalName: data.Name, Phone: data.Phone, Email: data.Email},
				Data: bobdomain.CreateDetailInput{OperatingEntityID: s.bobRefs["operating-effective"].ObjectID,
					DepartmentID: data.DepartmentID, PositionID: data.PositionID, HireDate: data.HireDate,
					Remark: data.Remark},
			}, createActor, true)
			result, createErr = createdEmployment.MutationResult, relationshipErr
		case bobdomain.EntitySupplier:
			createdSupplier, relationshipErr := s.business.SupplierCreate(ctx, bobdomain.SupplierCreateInput{
				NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization,
					LegalName: data.Name, DisplayName: data.ShortName, TaxNumber: data.TaxNumber,
					Phone: data.ContactPhone, Email: data.Email, Address: data.Address},
				Data: bobdomain.SupplierData{OperatingEntityID: s.bobRefs["operating-effective"].ObjectID,
					Name: data.Name, ShortName: data.ShortName,
					TaxNumber: data.TaxNumber, ContactName: data.ContactName, ContactPhone: data.ContactPhone,
					Email: data.Email, Address: data.Address, Remark: data.Remark,
					SettlementMethodID:         data.SettlementMethodID,
					DefaultPurchaserEmployeeID: data.DefaultPurchaserEmployeeID},
			}, createActor, true)
			result, createErr = createdSupplier.MutationResult, relationshipErr
		case bobdomain.EntityCustomerAccount:
			customerType := bobdomain.CustomerTypeEndUser
			if data.CustomerType != nil {
				customerType = *data.CustomerType
			}
			createdCustomer, relationshipErr := s.business.CustomerCreate(ctx, bobdomain.CustomerCreateInput{
				NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization,
					LegalName: data.Name, DisplayName: data.ShortName, TaxNumber: data.TaxNumber,
					Phone: data.ContactPhone, Email: data.Email, Address: data.Address},
				Data: bobdomain.CustomerAccountData{Name: data.Name, ShortName: data.ShortName,
					CustomerTypeCode: customerType, ContactName: data.ContactName,
					ContactPhone: data.ContactPhone, Email: data.Email, Address: data.Address,
					OperatingEntityID:          s.bobRefs["operating-effective"].ObjectID,
					SettlementMethodID:         data.SettlementMethodID,
					PaymentMethodID:            s.auxRefs["payment-bank-transfer"].ObjectID,
					DefaultTransportMethodCode: "DELIVERY", DefaultTransportMethodName: "送货",
					PricingPolicy: bobdomain.PricingPolicy{DefaultPremiumUnitPrice: "0.00",
						DefaultDiscountUnitPrice: "0.00", CostItems: []bobdomain.PricingCostItem{},
						ThirdPartyIntermediaryFixedUnitCost:    "0.00",
						ThirdPartyIntermediaryVariableUnitCost: "0.00"},
					CreditLimits: []bobdomain.CustomerCreditLimit{},
					PrimarySalesAttribution: bobdomain.CustomerSalesAttributionInput{
						Type:            bobdomain.SalesAttributionInternalEmployee,
						SubjectObjectID: data.SalespersonEmployeeID}, InternalReminder: data.Remark},
			}, createActor, true)
			if relationshipErr == nil {
				account := createdCustomer.DefaultAccount
				if account.OpenVersion == nil {
					return bobdomain.ObjectView{}, 0, errors.New("created customer account has no open approval version")
				}
				result = bobdomain.MutationResult{
					ObjectID: account.ObjectID, ObjectRevision: account.ObjectRevision,
					Enabled: account.Enabled, Approval: account.OpenVersion.Approval,
				}
			}
			createErr = relationshipErr
		default:
			result, createErr = s.business.Create(ctx, sample.entity,
				bobdomain.CreateInput{Data: data}, createActor)
		}
		if createErr != nil {
			return bobdomain.ObjectView{}, 0, createErr
		}
		objectID = result.ObjectID
		created = true
	} else if err != nil {
		return bobdomain.ObjectView{}, 0, err
	}
	view, err := s.getBusiness(ctx, sample.entity, objectID, sample.key)
	if err != nil {
		return bobdomain.ObjectView{}, 0, err
	}
	if version := currentBusinessVersion(view); version == nil || string(version.Approval.Status) != sample.status {
		var external int
		if err = s.pool.QueryRow(ctx, `
			SELECT count(*)
			FROM approval_events
			WHERE domain=$3 AND subject_id=$1 AND request_id NOT LIKE $2
		`, objectID, seedPrefix+"%", approvalDomain).Scan(&external); err != nil {
			return bobdomain.ObjectView{}, 0, err
		}
		if external == 0 {
			if err = s.advanceBusiness(ctx, sample, view); err != nil {
				return bobdomain.ObjectView{}, 0, err
			}
			view, err = s.getBusiness(ctx, sample.entity, objectID, sample.key)
			if err != nil {
				return bobdomain.ObjectView{}, 0, err
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

func dclBusinessMutation(result dcldomain.OperatingEntityMutation) bobdomain.MutationResult {
	return bobdomain.MutationResult{ObjectID: result.ObjectID, ObjectRevision: result.ObjectRevision,
		Enabled: result.Enabled, Approval: result.Approval}
}

func dclBusinessView(view dcldomain.OperatingEntityView) bobdomain.ObjectView {
	return bobdomain.ObjectView{ObjectID: view.ObjectID, Entity: bobdomain.EntityOperatingEntity,
		Code: view.Code, ObjectRevision: view.ObjectRevision, Enabled: view.Enabled,
		Approval: view.Approval, Data: bobdomain.DetailView{Name: view.Data.Name,
			ShortName: view.Data.ShortName, TaxNumber: view.Data.TaxNumber, Address: view.Data.Address,
			Phone: view.Data.Phone, Remark: view.Data.Remark}, UpdatedAt: view.UpdatedAt}
}

func dclWarehouseBusinessMutation(result dcldomain.WarehouseMutation) bobdomain.MutationResult {
	return bobdomain.MutationResult{ObjectID: result.ObjectID, ObjectRevision: result.ObjectRevision,
		Enabled: result.Enabled, Approval: result.Approval}
}

func dclWarehouseBusinessView(view dcldomain.WarehouseView) bobdomain.ObjectView {
	return bobdomain.ObjectView{ObjectID: view.ObjectID, Entity: bobdomain.EntityWarehouse,
		Code: view.Code, ObjectRevision: view.ObjectRevision, Enabled: view.Enabled,
		Approval: view.Approval, Data: bobdomain.DetailView{Name: view.Data.Name,
			Address: view.Data.Address, ContactName: view.Data.ContactName, ContactPhone: view.Data.ContactPhone,
			ManagerEmployeeID: view.Data.ManagerEmployeeID,
			Remark:            view.Data.Remark}, UpdatedAt: view.UpdatedAt}
}
func dclVehicleBusinessMutation(result dcldomain.VehicleMutation) bobdomain.MutationResult {
	return bobdomain.MutationResult{ObjectID: result.ObjectID, ObjectRevision: result.ObjectRevision, Enabled: result.Enabled, Approval: result.Approval}
}
func dclVehicleBusinessView(view dcldomain.VehicleView) bobdomain.ObjectView {
	return bobdomain.ObjectView{ObjectID: view.ObjectID, Entity: bobdomain.EntityVehicle, Code: view.Code, ObjectRevision: view.ObjectRevision, Enabled: view.Enabled, Approval: view.Approval, Data: bobdomain.DetailView{Name: view.Data.Name, PlateNumber: view.Data.PlateNumber, VehicleType: view.Data.VehicleType, CarrierAffiliation: view.Data.CarrierAffiliation, BulkLiquidCapable: view.Data.BulkLiquidCapable, VIN: view.Data.VIN, EngineNumber: view.Data.EngineNumber, LoadCapacityKG: view.Data.LoadCapacityKG, Remark: view.Data.Remark}, UpdatedAt: view.UpdatedAt}
}

func (s *Seeder) getBusiness(ctx context.Context, entity, objectID, key string) (bobdomain.ObjectView, error) {
	if entity != bobdomain.EntityOperatingEntity && entity != bobdomain.EntityWarehouse && entity != bobdomain.EntityVehicle {
		return s.business.Get(ctx, entity, bobdomain.GetInput{ObjectID: objectID})
	}
	actor, err := seedActor(actorID, requestID(key, "get"))
	if err != nil {
		return bobdomain.ObjectView{}, err
	}
	if entity == bobdomain.EntityWarehouse {
		view, getErr := s.warehouses.Get(ctx, dcldomain.WarehouseGetInput{ObjectID: objectID}, actor)
		return dclWarehouseBusinessView(view), getErr
	}
	if entity == bobdomain.EntityVehicle {
		view, getErr := s.vehicles.Get(ctx, dcldomain.VehicleGetInput{ObjectID: objectID}, actor)
		return dclVehicleBusinessView(view), getErr
	}
	view, getErr := s.operatingEntities.Get(ctx, dcldomain.OperatingEntityGetInput{ObjectID: objectID}, actor)
	return dclBusinessView(view), getErr
}

func (s *Seeder) advanceBusiness(
	ctx context.Context,
	sample bobSample,
	view bobdomain.ObjectView,
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
		if sample.entity == bobdomain.EntityVehicle {
			var submitted dcldomain.VehicleMutation
			submitted, err = s.vehicles.Submit(ctx, dcldomain.VehicleVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
			current = dclVehicleBusinessMutation(submitted)
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
			current, err = s.business.Submit(ctx, sample.entity, bobdomain.VersionRevisionInput{
				ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision,
			}, actor)
		}
		if err != nil {
			return err
		}
	}
	switch {
	case string(current.Approval.Status) == sample.status:
		return nil
	case current.Approval.Status == approval.StatusPending && sample.status == approvedStatus:
		comment := "测试数据：审核通过"
		actor, actorErr := seedActor(reviewerID, requestID(sample.key, "approve"))
		if actorErr != nil {
			return actorErr
		}
		if sample.entity == bobdomain.EntityVehicle {
			_, err = s.vehicles.Approve(ctx, dcldomain.VehicleVersionInput{ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID, ApprovalRevision: current.Approval.Revision}, actor)
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
			_, err = s.business.Approve(ctx, sample.entity, bobdomain.ReviewInput{
				ObjectID: current.ObjectID, ApprovalEntryID: current.Approval.ApprovalEntryID,
				ApprovalRevision: current.Approval.Revision, Reason: &comment,
			}, actor)
		}
	default:
		return fmt.Errorf("cannot advance status %s to %s", current.Approval.Status, sample.status)
	}
	return err
}
