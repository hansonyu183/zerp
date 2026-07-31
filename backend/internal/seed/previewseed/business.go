package previewseed

import (
	"context"
	"errors"
	"fmt"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

type bobSample struct {
	key, entity, status string
	data                func(*Seeder) bobdomain.CreateDetailInput
}

func (s *Seeder) seedBusiness(ctx context.Context, counts *Counts) error {
	samples := []bobSample{
		{"employee-effective", bobdomain.EntityEmployee, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "张伟（预览）", DepartmentID: s.auxRefs["department-root"].ObjectID,
				PositionID: s.auxRefs["position-operator"].ObjectID, Phone: "13800000101",
				Email: "preview.employee@example.com", HireDate: "2024-01-15", Remark: "预览测试有效员工",
			}
		}},
		{"employee-rejected", bobdomain.EntityEmployee, bobdomain.StatusRejected, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "李娜（预览已驳回）", DepartmentID: s.auxRefs["department-sales"].ObjectID,
				PositionID: s.auxRefs["position-operator"].ObjectID, Phone: "13800000102",
				Remark: "预览测试已驳回员工",
			}
		}},
		{"customer-effective", bobdomain.EntityCustomer, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			customerType := bobdomain.CustomerTypeDealer
			return bobdomain.CreateDetailInput{
				Name: "星河制造有限公司（预览）", CustomerType: &customerType,
				ShortName: "星河制造", TaxNumber: "91310000PREVIEW0101",
				ContactName: "王经理", ContactPhone: "13800000103",
				Email: "preview.customer@example.com", Address: "上海市浦东新区预览路 101 号",
				SettlementMethodID:    s.auxRefs["settlement-month-end"].ObjectID,
				SalespersonEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                "预览测试有效客户",
			}
		}},
		{"customer-draft", bobdomain.EntityCustomer, bobdomain.StatusDraft, func(s *Seeder) bobdomain.CreateDetailInput {
			customerType := bobdomain.CustomerTypeEndUser
			return bobdomain.CreateDetailInput{
				Name: "新客户（预览草稿）", CustomerType: &customerType,
				ContactName: "陈先生", ContactPhone: "13800000104",
				SettlementMethodID:    s.auxRefs["settlement-due-days"].ObjectID,
				SalespersonEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                "预览测试草稿客户",
			}
		}},
		{"supplier-platform", bobdomain.EntitySupplier, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			supplierType := bobdomain.SupplierTypeLogisticsPlatform
			return bobdomain.CreateDetailInput{
				Name: "自营物流平台（预览）", SupplierType: &supplierType,
				ShortName: "预览物流", ContactName: "调度中心", ContactPhone: "021-60000101",
				Address:               "上海市嘉定区预览物流园",
				SettlementMethodID:    s.auxRefs["settlement-due-days"].ObjectID,
				SalespersonEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                "预览测试物流平台",
			}
		}},
		{"supplier-effective", bobdomain.EntitySupplier, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			supplierType := bobdomain.SupplierTypeGeneral
			return bobdomain.CreateDetailInput{
				Name: "通用原料供应商（预览）", SupplierType: &supplierType,
				ShortName: "预览原料", TaxNumber: "91310000PREVIEW0102",
				ContactName: "赵经理", ContactPhone: "13800000105",
				Address:               "江苏省苏州市预览工业园",
				SettlementMethodID:    s.auxRefs["settlement-due-days"].ObjectID,
				SalespersonEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                "预览测试有效供应商",
			}
		}},
		{"supplier-pending", bobdomain.EntitySupplier, bobdomain.StatusPending, func(s *Seeder) bobdomain.CreateDetailInput {
			supplierType := bobdomain.SupplierTypeGeneral
			return bobdomain.CreateDetailInput{
				Name: "候选供应商（预览待审核）", SupplierType: &supplierType,
				ContactName: "周经理", ContactPhone: "13800000106",
				SettlementMethodID:    s.auxRefs["settlement-due-days"].ObjectID,
				SalespersonEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:                "预览测试待审核供应商",
			}
		}},
		{"warehouse-effective", bobdomain.EntityWarehouse, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "华东主仓（预览）", Address: "上海市嘉定区预览仓储路 1 号",
				ContactName: "张伟", ContactPhone: "13800000101",
				ManagerEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:            "预览测试有效仓库",
			}
		}},
		{"warehouse-rejected", bobdomain.EntityWarehouse, bobdomain.StatusRejected, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "临时仓（预览已驳回）", Address: "上海市青浦区预览临时仓",
				ManagerEmployeeID: s.bobRefs["employee-effective"].ObjectID,
				Remark:            "预览测试已驳回仓库",
			}
		}},
		{"packaging-effective", bobdomain.EntityProduct, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "可回收包装桶（预览）", Unit: "件",
				ProductKind:                     bobdomain.ProductKindPackaging,
				InventoryUnitID:                 s.auxRefs["UNT-0002"].ObjectID,
				PricingUnitID:                   s.auxRefs["UNT-0002"].ObjectID,
				PricingQuantityPerInventoryUnit: "1", Returnable: true,
				CategoryID:    s.auxRefs["product-category-parts"].ObjectID,
				Specification: "20L", Model: "PK-20", Barcode: "PREVIEW-PACK-001",
				Remark: "预览测试可回收包装物",
			}
		}},
		{"raw-effective", bobdomain.EntityProduct, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "标准原料 A（预览）", Unit: "件",
				ProductKind:                     bobdomain.ProductKindRawMaterial,
				InventoryUnitID:                 s.auxRefs["UNT-0002"].ObjectID,
				PricingUnitID:                   s.auxRefs["UNT-0001"].ObjectID,
				PricingQuantityPerInventoryUnit: "2.5",
				CategoryID:                      s.auxRefs["product-category-parts"].ObjectID,
				Specification:                   "M20", Model: "RM-A", Barcode: "PREVIEW-RAW-001",
				Remark: "预览测试原材料",
			}
		}},
		{"finished-effective", bobdomain.EntityProduct, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			packaging := s.bobRefs["packaging-effective"]
			raw := s.bobRefs["raw-effective"]
			return bobdomain.CreateDetailInput{
				Name: "标准自制品 A（预览）", Unit: "件",
				ProductKind:                     bobdomain.ProductKindStandardFinished,
				InventoryUnitID:                 s.auxRefs["UNT-0002"].ObjectID,
				PricingUnitID:                   s.auxRefs["UNT-0001"].ObjectID,
				PricingQuantityPerInventoryUnit: "3.0",
				CategoryID:                      s.auxRefs["product-category-parts"].ObjectID,
				Specification:                   "FG-A", Model: "FG-100", Barcode: "PREVIEW-FG-001",
				PackagingSpecs: []bobdomain.PackagingSpecInput{{
					PackagingProductObjectID:  packaging.ObjectID,
					PackagingProductVersionID: packaging.Version.VersionID,
					ContentQuantity:           "10", IsDefault: true,
				}},
				Formula: &bobdomain.ProductFormula{
					BaseOutputQuantity: "1",
					Components: []bobdomain.ProductFormulaComponent{{
						Material: bobdomain.FormulaMaterialReference{
							ObjectID: raw.ObjectID, VersionID: raw.Version.VersionID,
						},
						Quantity: "2",
					}},
				},
				Remark: "预览测试标准自制品",
			}
		}},
		{"custom-effective", bobdomain.EntityProduct, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "客户定制品 B（预览）", Unit: "件",
				ProductKind:                     bobdomain.ProductKindCustomFinished,
				InventoryUnitID:                 s.auxRefs["UNT-0002"].ObjectID,
				PricingUnitID:                   s.auxRefs["UNT-0001"].ObjectID,
				PricingQuantityPerInventoryUnit: "4.0",
				CategoryID:                      s.auxRefs["product-category-parts"].ObjectID,
				Specification:                   "FG-B", Model: "FG-200", Barcode: "PREVIEW-FG-002",
				Remark: "预览测试客户定制品",
			}
		}},
		{"product-draft", bobdomain.EntityProduct, bobdomain.StatusDraft, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "试制原料（预览草稿）", Unit: "件",
				ProductKind:                     bobdomain.ProductKindRawMaterial,
				InventoryUnitID:                 s.auxRefs["UNT-0002"].ObjectID,
				PricingUnitID:                   s.auxRefs["UNT-0001"].ObjectID,
				PricingQuantityPerInventoryUnit: "1.0",
				CategoryID:                      s.auxRefs["product-category-parts"].ObjectID,
				Specification:                   "TEST", Model: "DRAFT", Barcode: "PREVIEW-DRAFT-001",
				Remark: "预览测试草稿产品",
			}
		}},
		{"service-effective", bobdomain.EntityService, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "设备巡检服务（预览）", Unit: "次",
				InventoryUnitID: s.auxRefs["UNT-0004"].ObjectID,
				Description:     "现场设备巡检与报告", Remark: "预览测试有效服务",
			}
		}},
		{"service-pending", bobdomain.EntityService, bobdomain.StatusPending, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "年度维保服务（预览待审核）", Unit: "年",
				InventoryUnitID: s.auxRefs["UNT-0003"].ObjectID,
				Description:     "年度维保方案", Remark: "预览测试待审核服务",
			}
		}},
		{"vehicle-effective", bobdomain.EntityVehicle, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "自营配送一号车（预览）", PlateNumber: "沪A10101",
				VehicleType: "DIT-0003", PlatformObjectID: s.bobRefs["supplier-platform"].ObjectID,
				VIN: "LSVAA4187N2100101", EngineNumber: "ENG-PREVIEW-101",
				LoadCapacityKG: "18000", Remark: "预览测试有效车辆",
			}
		}},
		{"vehicle-draft", bobdomain.EntityVehicle, bobdomain.StatusDraft, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "自营配送二号车（预览草稿）", PlateNumber: "沪A10102",
				VehicleType: "DIT-0003", PlatformObjectID: s.bobRefs["supplier-platform"].ObjectID,
				VIN: "LSVAA4187N2100102", EngineNumber: "ENG-PREVIEW-102",
				LoadCapacityKG: "12000", Remark: "预览测试草稿车辆",
			}
		}},
		{"fund-effective", bobdomain.EntityFundAccount, bobdomain.StatusEffective, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "人民币基本账户（预览）", Currency: "CNY",
				AccountName: "上海预览科技有限公司", BankName: "示例银行",
				BankBranch: "上海浦东支行", AccountNumber: "622200000000001001",
				Remark: "预览测试有效资金账户",
			}
		}},
		{"fund-draft", bobdomain.EntityFundAccount, bobdomain.StatusDraft, func(s *Seeder) bobdomain.CreateDetailInput {
			return bobdomain.CreateDetailInput{
				Name: "备用结算账户（预览草稿）", Currency: "CNY",
				AccountName: "上海预览科技有限公司", BankName: "示例银行",
				BankBranch: "上海虹桥支行", AccountNumber: "622200000000001002",
				Remark: "预览测试草稿资金账户",
			}
		}},
	}
	for _, sample := range samples {
		view, result, err := s.ensureBusiness(ctx, sample)
		if err != nil {
			return fmt.Errorf("%s: %w", sample.key, err)
		}
		s.bobRefs[sample.key] = view
		counts.add(result)
	}
	return nil
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
		result, createErr := s.business.Create(
			ctx,
			sample.entity,
			bobdomain.CreateInput{Data: sample.data(s)},
			actorID,
			requestID(sample.key, "create"),
		)
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
	if (current.Status == bobdomain.StatusDraft || current.Status == bobdomain.StatusRejected) &&
		sample.status != current.Status {
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
		comment := "预览测试数据：审核通过"
		_, err = s.business.Approve(ctx, sample.entity, bobdomain.ReviewInput{
			ObjectID: current.ObjectID, VersionID: current.VersionID,
			Revision: current.Revision, Comment: &comment,
		}, reviewerID, requestID(sample.key, "approve"))
	case current.Status == bobdomain.StatusPending && sample.status == bobdomain.StatusRejected:
		comment := "预览测试数据：审核驳回"
		_, err = s.business.Reject(ctx, sample.entity, bobdomain.ReviewInput{
			ObjectID: current.ObjectID, VersionID: current.VersionID,
			Revision: current.Revision, Comment: &comment,
		}, reviewerID, requestID(sample.key, "reject"))
	default:
		return fmt.Errorf("cannot advance status %s to %s", current.Status, sample.status)
	}
	return err
}
