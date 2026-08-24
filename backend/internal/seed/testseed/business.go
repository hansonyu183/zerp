package testseed

import (
	"context"
	"errors"
	"fmt"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

type bobSample struct {
	key, entity, status string
	data                func(*Seeder) bobdomain.CreateDetailInput
}

func unitSnapshot(view auxdomain.ObjectView) bobdomain.MeasurementUnitSnapshot {
	data := view.CurrentVersion.Data
	name, _ := data["name"].(string)
	symbol, _ := data["symbol"].(string)
	return bobdomain.MeasurementUnitSnapshot{ObjectID: view.ObjectID, VersionID: view.CurrentVersion.VersionID, Code: view.Code, Name: name, Symbol: symbol}
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
			FROM bob_objects object
			JOIN bob_settlement_method_versions method ON method.version_id=object.effective_version_id
			WHERE object.entity='settlement-method' AND object.enabled AND method.term_code=$1`,
			termCode).Scan(&objectID); err != nil {
			return fmt.Errorf("load fixed settlement method %s: %w", termCode, err)
		}
		view, err := s.business.Get(ctx, bobdomain.EntitySettlementMethod, bobdomain.GetInput{ObjectID: objectID})
		if err != nil {
			return fmt.Errorf("get fixed settlement method %s: %w", termCode, err)
		}
		s.bobRefs[key] = view
	}
	samples := []bobSample{
		{"operating-effective", bobdomain.EntityOperatingEntity, bobdomain.StatusEffective, func(*Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "上海测试科技有限公司", ShortName: "上海测试", TaxNumber: "91310000TESTOPE1",
				Address: "上海市浦东新区测试路1号", Phone: "021-61000000",
			}
		}},
		{"employee-effective", bobdomain.EntityEmployee, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "张伟（测试）", DepartmentID: s.auxRefs["department-root"].ObjectID,
				PositionID: s.auxRefs["position-operator"].ObjectID, Phone: "13800000101",
				Email: "test.employee@example.com", HireDate: "2024-01-15", Remark: "测试有效员工",
			}
		}},
		{"employee-rejected", bobdomain.EntityEmployee, bobdomain.StatusDraft, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "李娜（测试草稿）", DepartmentID: s.auxRefs["department-sales"].ObjectID,
				PositionID: s.auxRefs["position-operator"].ObjectID, Phone: "13800000102",
				Remark: "测试草稿员工",
			}
		}},
		{"other-unit-effective", bobdomain.EntityOtherUnit, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "远航居间服务有限公司（测试）", ShortName: "远航居间",
				TaxNumber: "91310000TEST0103", ContactName: "刘顾问", ContactPhone: "13800000107",
				Email: "test.intermediary@example.com", Address: "上海市静安区测试商务路 88 号",
				SettlementMethodID:    s.bobRefs["settlement-due-days"].ObjectID,
				SalespersonEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                "测试有效居间往来单位",
			}
		}},
		{"other-unit-draft", bobdomain.EntityOtherUnit, bobdomain.StatusDraft, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "待确认居间单位（测试草稿）", ContactName: "陈顾问", ContactPhone: "13800000108",
				SettlementMethodID:    s.bobRefs["settlement-due-days"].ObjectID,
				SalespersonEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                "测试草稿其他单位",
			}
		}},
		{"customer-effective", bobdomain.EntityCustomerAccount, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			customerType := bobdomain.CustomerTypeEndUser
			return bobdomain.CreateDetailInput{
				Name: "星河制造有限公司（测试）", CustomerType: &customerType,
				ShortName: "星河制造", TaxNumber: "91310000TEST0101",
				ContactName: "王经理", ContactPhone: "13800000103",
				Email: "test.customer@example.com", Address: "上海市浦东新区测试路 101 号",
				SettlementMethodID:    s.bobRefs["settlement-month-end"].ObjectID,
				MonthlyClosingDay:     15,
				SalespersonEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                "测试有效客户",
			}
		}},
		{"customer-draft", bobdomain.EntityCustomerAccount, bobdomain.StatusDraft, func(s *Seeder) bobdomain.CreateDetailInput {
			customerType := bobdomain.CustomerTypeEndUser
			return bobdomain.CreateDetailInput{
				Name: "新客户（测试草稿）", CustomerType: &customerType,
				ContactName: "陈先生", ContactPhone: "13800000104",
				SettlementMethodID:    s.bobRefs["settlement-due-days"].ObjectID,
				SalespersonEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                "测试草稿客户",
			}
		}},
		{"external-carrier", bobdomain.EntityOtherUnit, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name:      "自营物流服务单位（测试）",
				ShortName: "测试物流", ContactName: "调度中心", ContactPhone: "021-60000101",
				Address:                    "上海市嘉定区测试物流园",
				SettlementMethodID:         s.bobRefs["settlement-due-days"].ObjectID,
				DefaultPurchaserEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                     "测试物流服务单位",
			}
		}},
		{"supplier-effective", bobdomain.EntitySupplier, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name:      "通用原料供应商（测试）",
				ShortName: "测试原料", TaxNumber: "91310000TEST0102",
				ContactName: "赵经理", ContactPhone: "13800000105",
				Address:                    "江苏省苏州市测试工业园",
				SettlementMethodID:         s.bobRefs["settlement-due-days"].ObjectID,
				DefaultPurchaserEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                     "测试有效供应商",
			}
		}},
		{"supplier-pending", bobdomain.EntitySupplier, bobdomain.StatusPending, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name:        "候选供应商（测试待审核）",
				ContactName: "周经理", ContactPhone: "13800000106",
				SettlementMethodID:         s.bobRefs["settlement-due-days"].ObjectID,
				DefaultPurchaserEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                     "测试待审核供应商",
			}
		}},
		{"warehouse-effective", bobdomain.EntityWarehouse, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "华东主仓（测试）", Address: "上海市嘉定区测试仓储路 1 号",
				ContactName: "张伟", ContactPhone: "13800000101",
				ManagerEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:            "测试有效仓库",
			}
		}},
		{"warehouse-rejected", bobdomain.EntityWarehouse, bobdomain.StatusDraft, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "临时仓（测试草稿）", Address: "上海市青浦区测试临时仓",
				ManagerEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:            "测试草稿仓库",
			}
		}},
		{"packaging-effective", bobdomain.EntityProduct, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "可回收包装桶（测试）", ProductTypeID: s.auxRefs["product-type-packaging"].ObjectID,
				DefaultInputUnitID: s.auxRefs["UNT-0002"].ObjectID, PricingUnitID: s.auxRefs["UNT-0002"].ObjectID,
				UnitConversions: []bobdomain.ProductUnitConversion{{Unit: unitSnapshot(s.auxRefs["UNT-0002"]), Factor: "1"}}, Returnable: true,
				CategoryID:    s.auxRefs["product-category-parts"].ObjectID,
				Specification: "20L", Model: "PK-20", Barcode: "TEST-PACK-001",
				Remark: "测试可回收包装物",
			}
		}},
		{"raw-effective", bobdomain.EntityProduct, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
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
		{"finished-effective", bobdomain.EntityProduct, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
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
							ObjectID: raw.ObjectID, VersionID: raw.Version.VersionID,
						},
						Quantity: quantitySnapshot(s.auxRefs["UNT-0002"], "2"), ResolutionStatus: "CURRENT",
					}},
				},
				Remark: "测试标准自制品",
			}
		}},
		{"custom-effective", bobdomain.EntityProduct, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
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
		{"product-draft", bobdomain.EntityProduct, bobdomain.StatusDraft, func(s *Seeder) bobdomain.CreateDetailInput {
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
		{"vehicle-effective", bobdomain.EntityVehicle, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "自营配送一号车（测试）", PlateNumber: "沪A10101",
				VehicleType: "DIT-0003", CarrierAffiliation: &bobdomain.CarrierAffiliation{
					Type: "EXTERNAL", ServiceRelationshipObjectID: s.bobRefs["external-carrier"].ObjectID,
				},
				VIN: "LSVAA4187N2100101", EngineNumber: "ENG-TEST-101",
				LoadCapacityKG: "18000", Remark: "测试有效车辆",
			}
		}},
		{"vehicle-draft", bobdomain.EntityVehicle, bobdomain.StatusDraft, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "自营配送二号车（测试草稿）", PlateNumber: "沪A10102",
				VehicleType: "DIT-0003", CarrierAffiliation: &bobdomain.CarrierAffiliation{
					Type: "EXTERNAL", ServiceRelationshipObjectID: s.bobRefs["external-carrier"].ObjectID,
				},
				VIN: "LSVAA4187N2100102", EngineNumber: "ENG-TEST-102",
				LoadCapacityKG: "12000", Remark: "测试草稿车辆",
			}
		}},
		{"fund-effective", bobdomain.EntityFundAccount, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "人民币基本账户（测试）", Currency: "CNY",
				OperatingEntityID: s.bobRefs["operating-effective"].ObjectID,
				AccountName:       "上海测试科技有限公司", BankName: "示例银行",
				BankBranch: "上海浦东支行", AccountNumber: "622200000000001001",
				Remark: "测试有效资金账户",
			}
		}},
		{"fund-draft", bobdomain.EntityFundAccount, bobdomain.StatusDraft, func(s *Seeder) bobdomain.CreateDetailInput {
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
		SELECT object_id FROM bob_audit_events
		WHERE request_id=$1 AND event_type='CREATED'
		ORDER BY occurred_at,id LIMIT 1
	`, requestID(sample.key, "create")).Scan(&objectID)
	created := false
	if errors.Is(err, pgx.ErrNoRows) {
		data := sample.data(s)
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
		}, actorID, requestID(sample.key, "create"), true)
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
	if view.Status != sample.status {
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
	return bobdomain.ObjectView{
		ObjectID: view.ObjectID, Entity: bobdomain.EntityOtherUnit, Code: view.Code,
		ObjectRevision: view.ObjectRevision, Enabled: view.Enabled,
		CurrentVersionID: view.VersionID, EffectiveVersionID: view.EffectiveVersionID,
		Version: bobdomain.VersionMeta{
			VersionID: view.VersionID, Version: view.Version, Status: view.Status,
			Revision: view.Revision, SubmittedBy: view.SubmittedBy,
		},
		Data: bobdomain.DetailView{
			Name: view.PartyDisplayName, ContactName: view.Data.ContactName,
			ContactPhone: view.Data.ContactPhone, Email: view.Data.Email,
			Address: view.Data.Address, SettlementMethodID: view.Data.SettlementMethodID,
			OperatingEntityID: view.OperatingEntityID, Remark: view.Data.Remark,
		},
	}
}

func (s *Seeder) ensureBusiness(
	ctx context.Context,
	sample bobSample,
) (bobdomain.ObjectView, outcome, error) {
	var objectID string
	err := s.pool.QueryRow(ctx, `
		SELECT object_id
		FROM bob_audit_events
		WHERE request_id=$1 AND event_type='CREATED'
		ORDER BY occurred_at,id
		LIMIT 1
	`, requestID(sample.key, "create")).Scan(&objectID)
	created := false
	if errors.Is(err, pgx.ErrNoRows) {
		data := sample.data(s)
		var result bobdomain.MutationResult
		var createErr error
		switch sample.entity {
		case bobdomain.EntityEmployee:
			createdEmployment, relationshipErr := s.business.EmploymentCreate(ctx, bobdomain.EmploymentCreateInput{
				NewParty: &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindPerson,
					LegalName: data.Name, Phone: data.Phone, Email: data.Email},
				Data: bobdomain.CreateDetailInput{OperatingEntityID: s.bobRefs["operating-effective"].ObjectID,
					DepartmentID: data.DepartmentID, PositionID: data.PositionID, HireDate: data.HireDate,
					Remark: data.Remark},
			}, actorID, requestID(sample.key, "create"), true)
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
			}, actorID, requestID(sample.key, "create"), true)
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
			}, actorID, requestID(sample.key, "create"), true)
			if relationshipErr == nil {
				account := createdCustomer.DefaultAccount
				version := account.Candidate.Version
				result = bobdomain.MutationResult{ObjectID: account.ObjectID,
					ObjectRevision: account.ObjectRevision, Enabled: account.Enabled,
					VersionID: version.VersionID, Version: version.Version,
					Status: version.Status, Revision: version.Revision}
			}
			createErr = relationshipErr
		default:
			result, createErr = s.business.Create(ctx, sample.entity,
				bobdomain.CreateInput{Data: data}, actorID, requestID(sample.key, "create"))
		}
		if createErr != nil {
			return bobdomain.ObjectView{}, 0, createErr
		}
		objectID = result.ObjectID
		created = true
	} else if err != nil {
		return bobdomain.ObjectView{}, 0, err
	}
	view, err := s.business.Get(ctx, sample.entity, bobdomain.GetInput{ObjectID: objectID})
	if err != nil {
		return bobdomain.ObjectView{}, 0, err
	}
	if view.Version.Status != sample.status {
		var external int
		if err = s.pool.QueryRow(ctx, `
			SELECT count(*)
			FROM bob_audit_events
			WHERE object_id=$1 AND request_id NOT LIKE $2
		`, objectID, seedPrefix+"%").Scan(&external); err != nil {
			return bobdomain.ObjectView{}, 0, err
		}
		if external == 0 {
			if err = s.advanceBusiness(ctx, sample, view); err != nil {
				return bobdomain.ObjectView{}, 0, err
			}
			view, err = s.business.Get(ctx, sample.entity, bobdomain.GetInput{ObjectID: objectID})
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

func (s *Seeder) advanceBusiness(
	ctx context.Context,
	sample bobSample,
	view bobdomain.ObjectView,
) error {
	current := bobdomain.MutationResult{
		ObjectID: view.ObjectID, ObjectRevision: view.ObjectRevision,
		VersionID: view.Version.VersionID, Status: view.Version.Status, Revision: view.Version.Revision,
	}
	var err error
	if current.Status == bobdomain.StatusDraft && sample.status != current.Status {
		current, err = s.business.Submit(ctx, sample.entity, bobdomain.VersionRevisionInput{
			ObjectID: current.ObjectID, VersionID: current.VersionID, Revision: current.Revision,
		}, actorID, requestID(sample.key, "submit"))
		if err != nil {
			return err
		}
	}
	switch {
	case current.Status == sample.status:
		return nil
	case current.Status == bobdomain.StatusPending && sample.status == bobdomain.StatusEffective:
		comment := "测试数据：审核通过"
		_, err = s.business.Approve(ctx, sample.entity, bobdomain.ReviewInput{
			ObjectID: current.ObjectID, VersionID: current.VersionID,
			Revision: current.Revision, Comment: &comment,
		}, reviewerID, requestID(sample.key, "approve"))
	default:
		return fmt.Errorf("cannot advance status %s to %s", current.Status, sample.status)
	}
	return err
}
