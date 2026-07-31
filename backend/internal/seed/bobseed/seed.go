package bobseed

import (
	"context"
	"errors"
	"fmt"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	submitterID = "01J00000000000000000000000"
	reviewerID  = "01J00000000000000000000001"
)

type Result struct {
	Created int
	Resumed int
	Skipped int
}

type lifecycleService interface {
	Create(context.Context, string, bob.CreateInput, string, string) (bob.MutationResult, error)
	Get(context.Context, string, bob.GetInput) (bob.ObjectView, error)
	Save(context.Context, string, bob.SaveInput, string, string) (bob.MutationResult, error)
	Submit(context.Context, string, bob.VersionRevisionInput, string, string) (bob.MutationResult, error)
	Unsubmit(context.Context, string, bob.ReverseInput, string, string) (bob.MutationResult, error)
	Approve(context.Context, string, bob.ReviewInput, string, string) (bob.MutationResult, error)
	Unapprove(context.Context, string, bob.ReverseInput, string, string) (bob.MutationResult, error)
	Reject(context.Context, string, bob.ReviewInput, string, string) (bob.MutationResult, error)
}

type objectLookup interface {
	Find(context.Context, string, string) (string, bool, error)
}

type queryLookup struct {
	queries *dbsqlc.Queries
}

func (l queryLookup) Find(ctx context.Context, entity, code string) (string, bool, error) {
	id, err := l.queries.FindBobSeedObjectID(ctx, dbsqlc.FindBobSeedObjectIDParams{
		Entity:   entity,
		SeedCode: code,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return id, err == nil, err
}

type Seeder struct {
	service lifecycleService
	lookup  objectLookup
}

func New(pool *pgxpool.Pool) *Seeder {
	return &Seeder{
		service: bob.NewService(pool),
		lookup:  queryLookup{queries: dbsqlc.New(pool)},
	}
}

type sample struct {
	entity                  string
	data                    bob.CreateDetailInput
	status                  string
	platformCode            string
	categoryCode            string
	departmentCode          string
	positionCode            string
	parentCode              string
	managerEmployeeCode     string
	salespersonEmployeeCode string
	settlementMethodCode    string
	formulaMaterialCode     string
	formulaBaseQuantity     string
	formulaMaterialQuantity string
}

var samples = [...]sample{
	{entity: bob.EntityCategory, data: bob.CreateDetailInput{
		Code: "DEMO-CAT-001", Name: "工业零部件", TargetEntity: bob.EntityProduct, Description: "产品演示分类",
	}, status: bob.StatusEffective},
	{entity: bob.EntityCategory, data: bob.CreateDetailInput{
		Code: "DEMO-CAT-002", Name: "标准件", TargetEntity: bob.EntityProduct, Description: "工业零部件子分类",
	}, status: bob.StatusEffective, parentCode: "DEMO-CAT-001"},
	{entity: bob.EntityDepartment, data: bob.CreateDetailInput{
		Code: "DEMO-DEPT-001", Name: "运营部", Description: "演示有效部门",
	}, status: bob.StatusEffective},
	{entity: bob.EntityDepartment, data: bob.CreateDetailInput{
		Code: "DEMO-DEPT-002", Name: "华东运营组", Description: "演示草稿部门",
	}, status: bob.StatusDraft, parentCode: "DEMO-DEPT-001"},
	{entity: bob.EntityPosition, data: bob.CreateDetailInput{
		Code: "DEMO-POS-001", Name: "运营专员", Description: "演示有效岗位",
	}, status: bob.StatusEffective},
	{entity: bob.EntityPosition, data: bob.CreateDetailInput{
		Code: "DEMO-POS-002", Name: "仓储主管", Description: "演示待审核岗位",
	}, status: bob.StatusPending},
	{entity: bob.EntityEmployee, data: bob.CreateDetailInput{
		Code: "DEMO-EMP-001", Name: "张伟", Phone: "13800000004",
		Email: "zhangwei@example.com", HireDate: "2024-01-15", Remark: "演示在岗员工",
	}, status: bob.StatusEffective, departmentCode: "DEMO-DEPT-001", positionCode: "DEMO-POS-001"},
	{entity: bob.EntityEmployee, data: bob.CreateDetailInput{
		Code: "DEMO-EMP-002", Name: "李娜（草稿）", Phone: "13800000005",
	}, status: bob.StatusDraft, departmentCode: "DEMO-DEPT-001", positionCode: "DEMO-POS-001"},
	{entity: bob.EntitySettlementMethod, data: bob.CreateDetailInput{
		Code: "DEMO-SM-001", Name: "当月 15 日结算", RuleType: bob.SettlementRuleFixedDay,
		MonthOffset: 0, DayOfMonth: int32Pointer(15), DayOffset: 0, Description: "VOU 演示结算方式",
	}, status: bob.StatusEffective},
	{entity: bob.EntityCustomer, data: bob.CreateDetailInput{
		Code: "DEMO-CUST-001", Name: "星河零售有限公司", CustomerType: stringPointer(bob.CustomerTypeDealer),
		ShortName: "星河零售", TaxNumber: "91310000DEMO000001", ContactName: "王经理",
		ContactPhone: "+86 13800000001", Email: "sales@example.com",
		Address: "上海市浦东新区示例路1号", Remark: "演示经销商客户",
	}, status: bob.StatusEffective, salespersonEmployeeCode: "DEMO-EMP-001", settlementMethodCode: "DEMO-SM-001"},
	{entity: bob.EntityCustomer, data: bob.CreateDetailInput{
		Code: "DEMO-CUST-002", Name: "新客户（草稿）", CustomerType: stringPointer(bob.CustomerTypeEndUser),
		ContactName: "陈先生", ContactPhone: "13800000002",
	}, status: bob.StatusDraft, salespersonEmployeeCode: "DEMO-EMP-001"},
	{entity: bob.EntitySupplier, data: bob.CreateDetailInput{
		Code: "DEMO-SUP-001", Name: "自营物流平台", SupplierType: stringPointer(bob.SupplierTypeLogisticsPlatform),
		ShortName: "自营物流", ContactName: "调度中心", ContactPhone: "021-60000001",
		Address: "上海市闵行区物流路1号", Remark: "演示物流平台供应商",
	}, status: bob.StatusEffective, salespersonEmployeeCode: "DEMO-EMP-001"},
	{entity: bob.EntitySupplier, data: bob.CreateDetailInput{
		Code: "DEMO-SUP-003", Name: "通用零部件供应商", SupplierType: stringPointer(bob.SupplierTypeGeneral),
		ShortName: "通用供应商", ContactName: "采购对接人", ContactPhone: "13800000006",
		Address: "江苏省苏州市工业园区示例路3号", Remark: "VOU 演示普通供应商",
	}, status: bob.StatusEffective, salespersonEmployeeCode: "DEMO-EMP-001", settlementMethodCode: "DEMO-SM-001"},
	{entity: bob.EntitySupplier, data: bob.CreateDetailInput{
		Code: "DEMO-SUP-002", Name: "待审核供应商", TaxNumber: "91310000DEMO000002",
		ContactName: "赵经理", ContactPhone: "13800000003",
	}, status: bob.StatusPending, salespersonEmployeeCode: "DEMO-EMP-001"},
	{entity: bob.EntityProduct, data: bob.CreateDetailInput{
		Code: "DEMO-PROD-001", Name: "标准零件 A", Unit: "件",
		Specification: "M20", Model: "A-20", Barcode: "DEMO-BARCODE-001", Remark: "演示标准产品",
	}, status: bob.StatusEffective, categoryCode: "DEMO-CAT-002"},
	{entity: bob.EntityProduct, data: bob.CreateDetailInput{
		Code: "DEMO-PROD-002", Name: "试制零件 B", Unit: "件",
		Specification: "M30", Model: "B-30", Barcode: "DEMO-BARCODE-002",
	}, status: bob.StatusDraft, categoryCode: "DEMO-CAT-002"},
	{entity: bob.EntityProduct, data: bob.CreateDetailInput{
		Code: "DEMO-FG-001", Name: "标准自制品 A", Unit: "件",
		Specification: "FG-A", Model: "A-100", ProductKind: bob.ProductKindStandardFinished,
		Remark: "生产单固定测试成品",
	}, status: bob.StatusEffective, categoryCode: "DEMO-CAT-002",
		formulaMaterialCode: "DEMO-PROD-001", formulaBaseQuantity: "1.0", formulaMaterialQuantity: "2.0"},
	{entity: bob.EntityProduct, data: bob.CreateDetailInput{
		Code: "DEMO-FG-002", Name: "客户定制品 B", Unit: "件",
		Specification: "FG-B", Model: "B-200", ProductKind: bob.ProductKindCustomFinished,
		Remark: "生产配货固定测试成品",
	}, status: bob.StatusEffective, categoryCode: "DEMO-CAT-002"},
	{entity: bob.EntityService, data: bob.CreateDetailInput{
		Code: "DEMO-SVC-001", Name: "设备巡检服务", Unit: "次",
		Description: "现场设备巡检与报告", Remark: "演示服务",
	}, status: bob.StatusEffective},
	{entity: bob.EntityService, data: bob.CreateDetailInput{
		Code: "DEMO-SVC-002", Name: "年度维保服务", Unit: "年", Description: "年度维保方案",
	}, status: bob.StatusPending},
	{entity: bob.EntityWarehouse, data: bob.CreateDetailInput{
		Code: "DEMO-WH-001", Name: "华东主仓", Address: "上海市嘉定区仓储路1号",
		ContactName: "张伟", ContactPhone: "13800000004", Remark: "演示主仓",
	}, status: bob.StatusEffective, managerEmployeeCode: "DEMO-EMP-001"},
	{entity: bob.EntityWarehouse, data: bob.CreateDetailInput{
		Code: "DEMO-WH-002", Name: "临时仓（草稿）", Address: "上海市青浦区临时仓路2号",
	}, status: bob.StatusDraft},
	{entity: bob.EntityVehicle, data: bob.CreateDetailInput{
		Code: "DEMO-VEH-001", Name: "自营配送一号车", PlateNumber: "沪A10001", VehicleType: "DIT-0003",
		VIN: "LSVAA4187N2000001", EngineNumber: "ENG-DEMO-001", LoadCapacityKG: "18000.000",
		Remark: "演示有效车辆",
	}, status: bob.StatusEffective, platformCode: "DEMO-SUP-001"},
	{entity: bob.EntityVehicle, data: bob.CreateDetailInput{
		Code: "DEMO-VEH-002", Name: "自营配送二号车", PlateNumber: "沪A10002", VehicleType: "DIT-0003",
		VIN: "LSVAA4187N2000002", EngineNumber: "ENG-DEMO-002", LoadCapacityKG: "12000.000",
	}, status: bob.StatusDraft, platformCode: "DEMO-SUP-001"},
	{entity: bob.EntityFundAccount, data: bob.CreateDetailInput{
		Code: "DEMO-FA-001", Name: "人民币基本账户", Currency: "CNY",
		AccountName: "上海示例科技有限公司", BankName: "示例银行",
		BankBranch: "上海浦东支行", AccountNumber: "622200000000000001", Remark: "演示基本账户",
	}, status: bob.StatusEffective},
	{entity: bob.EntityFundAccount, data: bob.CreateDetailInput{
		Code: "DEMO-FA-002", Name: "备用结算账户", Currency: "CNY",
		AccountName: "上海示例科技有限公司", BankName: "示例银行",
		BankBranch: "上海虹桥支行", AccountNumber: "622200000000000002",
	}, status: bob.StatusDraft},
}

func (s *Seeder) Seed(ctx context.Context) (Result, error) {
	var result Result
	for _, item := range samples {
		outcome, err := s.seedOne(ctx, item)
		if err != nil {
			return result, fmt.Errorf("seed %s %s: %w", item.entity, item.data.Code, err)
		}
		switch outcome {
		case outcomeCreated:
			result.Created++
		case outcomeResumed:
			result.Resumed++
		case outcomeSkipped:
			result.Skipped++
		}
	}
	return result, nil
}

type seedOutcome int

const (
	outcomeCreated seedOutcome = iota + 1
	outcomeResumed
	outcomeSkipped
)

func (s *Seeder) seedOne(ctx context.Context, item sample) (seedOutcome, error) {
	resolve := func(entity, code, label string) (string, error) {
		if code == "" {
			return "", nil
		}
		objectID, found, err := s.lookup.Find(ctx, entity, code)
		if err != nil {
			return "", fmt.Errorf("find %s: %w", label, err)
		}
		if !found {
			return "", fmt.Errorf("%s %s is missing", label, code)
		}
		return objectID, nil
	}
	var err error
	if item.data.PlatformObjectID, err = resolve(bob.EntitySupplier, item.platformCode, "logistics platform"); err != nil {
		return 0, err
	}
	if item.data.CategoryID, err = resolve(bob.EntityCategory, item.categoryCode, "category"); err != nil {
		return 0, err
	}
	if item.data.DepartmentID, err = resolve(bob.EntityDepartment, item.departmentCode, "department"); err != nil {
		return 0, err
	}
	if item.data.PositionID, err = resolve(bob.EntityPosition, item.positionCode, "position"); err != nil {
		return 0, err
	}
	if item.data.ManagerEmployeeID, err = resolve(bob.EntityEmployee, item.managerEmployeeCode, "manager employee"); err != nil {
		return 0, err
	}
	if item.data.SalespersonEmployeeID, err = resolve(
		bob.EntityEmployee, item.salespersonEmployeeCode, "salesperson employee",
	); err != nil {
		return 0, err
	}
	if item.data.SettlementMethodID, err = resolve(
		bob.EntitySettlementMethod, item.settlementMethodCode, "settlement method",
	); err != nil {
		return 0, err
	}
	if item.parentCode != "" {
		if item.data.ParentID, err = resolve(item.entity, item.parentCode, "parent"); err != nil {
			return 0, err
		}
	}
	if item.formulaMaterialCode != "" {
		materialObjectID, resolveErr := resolve(
			bob.EntityProduct,
			item.formulaMaterialCode,
			"formula material",
		)
		if resolveErr != nil {
			return 0, resolveErr
		}
		material, getErr := s.service.Get(
			ctx,
			bob.EntityProduct,
			bob.GetInput{ObjectID: materialObjectID},
		)
		if getErr != nil {
			return 0, fmt.Errorf("get formula material: %w", getErr)
		}
		if material.Version.Status != bob.StatusEffective {
			return 0, fmt.Errorf("formula material %s is not effective", item.formulaMaterialCode)
		}
		item.data.Formula = &bob.ProductFormula{
			BaseOutputQuantity: item.formulaBaseQuantity,
			Components: []bob.ProductFormulaComponent{{
				Material: bob.FormulaMaterialReference{
					ObjectID:  material.ObjectID,
					VersionID: material.Version.VersionID,
				},
				Quantity: item.formulaMaterialQuantity,
			}},
		}
	}

	objectID, found, err := s.lookup.Find(ctx, item.entity, item.data.Code)
	if err != nil {
		return 0, fmt.Errorf("find existing object: %w", err)
	}

	var current bob.MutationResult
	outcome := outcomeCreated
	if found {
		view, getErr := s.service.Get(ctx, item.entity, bob.GetInput{ObjectID: objectID})
		if getErr != nil {
			return 0, fmt.Errorf("get existing object: %w", getErr)
		}
		if !matches(item, view) {
			if !matchesLegacyShape(item, view) && !isLegacyPlatformSample(item, view) {
				return 0, fmt.Errorf("reserved demo code is occupied by different data")
			}
			current, err = s.reconcileExisting(ctx, item, view)
			if err != nil {
				return 0, err
			}
			outcome = outcomeResumed
		} else {
			if view.Version.Status == item.status {
				return outcomeSkipped, nil
			}
			current = bob.MutationResult{
				ObjectID:       view.ObjectID,
				ObjectRevision: view.ObjectRevision,
				VersionID:      view.Version.VersionID,
				Status:         view.Version.Status,
				Revision:       view.Version.Revision,
			}
			outcome = outcomeResumed
		}
	} else {
		current, err = s.service.Create(
			ctx,
			item.entity,
			bob.CreateInput{Data: item.data},
			submitterID,
			requestID(item.data.Code, "create"),
		)
		if err != nil {
			return 0, fmt.Errorf("create object: %w (cause: %v)", err, errors.Unwrap(err))
		}
	}

	if current.Status == bob.StatusDraft && item.status != current.Status {
		current, err = s.service.Submit(ctx, item.entity, bob.VersionRevisionInput{
			ObjectID:  current.ObjectID,
			VersionID: current.VersionID,
			Revision:  current.Revision,
		}, submitterID, requestID(item.data.Code, "submit"))
		if err != nil {
			return 0, fmt.Errorf("submit object: %w", err)
		}
	}

	switch {
	case current.Status == item.status:
		return outcome, nil
	case current.Status == bob.StatusPending && item.status == bob.StatusEffective:
		comment := "演示数据：审核通过"
		_, err = s.service.Approve(ctx, item.entity, bob.ReviewInput{
			ObjectID:  current.ObjectID,
			VersionID: current.VersionID,
			Revision:  current.Revision,
			Comment:   &comment,
		}, reviewerID, requestID(item.data.Code, "approve"))
	default:
		return 0, fmt.Errorf("cannot advance status %s to %s", current.Status, item.status)
	}
	if err != nil {
		return 0, fmt.Errorf("review object: %w", err)
	}
	return outcome, nil
}

func matches(item sample, view bob.ObjectView) bool {
	expectedSupplierType := deref(item.data.SupplierType)
	if item.entity == bob.EntitySupplier && expectedSupplierType == "" {
		expectedSupplierType = bob.SupplierTypeGeneral
	}
	expectedCustomerType := deref(item.data.CustomerType)
	if item.entity == bob.EntityCustomer && expectedCustomerType == "" {
		expectedCustomerType = bob.CustomerTypeEndUser
	}
	return view.Entity == item.entity &&
		view.Data.Name == item.data.Name &&
		view.Data.Unit == item.data.Unit &&
		view.Data.Currency == item.data.Currency &&
		view.Data.SupplierType == expectedSupplierType &&
		view.Data.CustomerType == expectedCustomerType &&
		view.Data.PlateNumber == item.data.PlateNumber &&
		view.Data.VehicleType == item.data.VehicleType &&
		view.Data.PlatformObjectID == item.data.PlatformObjectID &&
		view.Data.TargetEntity == item.data.TargetEntity &&
		view.Data.ShortName == item.data.ShortName &&
		view.Data.CategoryID == item.data.CategoryID &&
		view.Data.TaxNumber == item.data.TaxNumber &&
		view.Data.ContactName == item.data.ContactName &&
		view.Data.ContactPhone == item.data.ContactPhone &&
		view.Data.Email == item.data.Email &&
		view.Data.Address == item.data.Address &&
		view.Data.Remark == item.data.Remark &&
		view.Data.DepartmentID == item.data.DepartmentID &&
		view.Data.PositionID == item.data.PositionID &&
		view.Data.Phone == item.data.Phone &&
		view.Data.HireDate == item.data.HireDate &&
		view.Data.Specification == item.data.Specification &&
		view.Data.Model == item.data.Model &&
		view.Data.Barcode == item.data.Barcode &&
		view.Data.Description == item.data.Description &&
		view.Data.ManagerEmployeeID == item.data.ManagerEmployeeID &&
		view.Data.VIN == item.data.VIN &&
		view.Data.EngineNumber == item.data.EngineNumber &&
		view.Data.LoadCapacityKG == item.data.LoadCapacityKG &&
		view.Data.AccountName == item.data.AccountName &&
		view.Data.BankName == item.data.BankName &&
		view.Data.BankBranch == item.data.BankBranch &&
		view.Data.AccountNumber == item.data.AccountNumber &&
		view.Data.ParentID == item.data.ParentID &&
		view.Data.SalespersonEmployeeID == item.data.SalespersonEmployeeID &&
		view.Data.SettlementMethodID == item.data.SettlementMethodID &&
		view.Data.RuleType == item.data.RuleType &&
		view.Data.MonthOffset == item.data.MonthOffset &&
		equalInt32Pointer(view.Data.DayOfMonth, item.data.DayOfMonth) &&
		view.Data.DayOffset == item.data.DayOffset &&
		view.Data.ProductKind == expectedProductKind(item) &&
		formulaMatches(view.Data.Formula, item.data.Formula)
}

func expectedProductKind(item sample) string {
	if item.entity == bob.EntityProduct && item.data.ProductKind == "" {
		return bob.ProductKindRawMaterial
	}
	return item.data.ProductKind
}

func formulaMatches(actual, expected *bob.ProductFormula) bool {
	if actual == nil || expected == nil {
		return actual == nil && expected == nil
	}
	if actual.BaseOutputQuantity != expected.BaseOutputQuantity ||
		len(actual.Components) != len(expected.Components) {
		return false
	}
	for index := range actual.Components {
		actualComponent := actual.Components[index]
		expectedComponent := expected.Components[index]
		if actualComponent.Material.ObjectID != expectedComponent.Material.ObjectID ||
			actualComponent.Material.VersionID != expectedComponent.Material.VersionID ||
			actualComponent.Quantity != expectedComponent.Quantity {
			return false
		}
	}
	return true
}

func matchesLegacyShape(item sample, view bob.ObjectView) bool {
	if item.entity == bob.EntityCategory || item.entity == bob.EntityDepartment || item.entity == bob.EntityPosition {
		return false
	}
	expectedSupplierType := deref(item.data.SupplierType)
	if item.entity == bob.EntitySupplier && expectedSupplierType == "" {
		expectedSupplierType = bob.SupplierTypeGeneral
	}
	return view.Entity == item.entity &&
		view.Data.Name == item.data.Name &&
		view.Data.Unit == item.data.Unit &&
		view.Data.Currency == item.data.Currency &&
		view.Data.SupplierType == expectedSupplierType &&
		view.Data.PlateNumber == item.data.PlateNumber &&
		view.Data.VehicleType == item.data.VehicleType &&
		view.Data.PlatformObjectID == item.data.PlatformObjectID
}

func requestID(code, action string) string {
	return "seed-bob-" + code + "-" + action
}

func isLegacyPlatformSample(item sample, view bob.ObjectView) bool {
	return item.entity == bob.EntitySupplier &&
		item.data.Code == "DEMO-SUP-001" &&
		view.Data.Name == "远山供应链有限公司" &&
		(view.Data.SupplierType == "" || view.Data.SupplierType == bob.SupplierTypeGeneral) &&
		view.Version.Status == bob.StatusEffective
}

func (s *Seeder) reconcileExisting(ctx context.Context, item sample, view bob.ObjectView) (bob.MutationResult, error) {
	current := bob.MutationResult{
		ObjectID: view.ObjectID, ObjectRevision: view.ObjectRevision,
		VersionID: view.Version.VersionID, Status: view.Version.Status, Revision: view.Version.Revision,
	}
	var err error
	switch current.Status {
	case bob.StatusEffective:
		current, err = s.service.Unapprove(ctx, item.entity, bob.ReverseInput{
			ObjectID: current.ObjectID, ObjectRevision: current.ObjectRevision,
			VersionID: current.VersionID, Revision: current.Revision, Reason: "演示数据：撤销批准后补齐属性",
		}, submitterID, requestID(item.data.Code, "upgrade-unapprove"))
		if err == nil {
			current, err = s.service.Unsubmit(ctx, item.entity, bob.ReverseInput{
				ObjectID: current.ObjectID, ObjectRevision: current.ObjectRevision,
				VersionID: current.VersionID, Revision: current.Revision, Reason: "演示数据：退回草稿补齐属性",
			}, submitterID, requestID(item.data.Code, "upgrade-unsubmit"))
		}
	case bob.StatusPending:
		comment := "演示数据：补齐新增属性"
		current, err = s.service.Reject(ctx, item.entity, bob.ReviewInput{
			ObjectID: current.ObjectID, VersionID: current.VersionID,
			Revision: current.Revision, Comment: &comment,
		}, reviewerID, requestID(item.data.Code, "upgrade-reject"))
	case bob.StatusDraft:
	default:
		return bob.MutationResult{}, fmt.Errorf("cannot reconcile status %s", current.Status)
	}
	if err != nil {
		return bob.MutationResult{}, fmt.Errorf("prepare demo data upgrade: %w", err)
	}
	saved, err := s.service.Save(ctx, item.entity, bob.SaveInput{
		ObjectID: current.ObjectID, VersionID: current.VersionID, Revision: current.Revision,
		Data: detailInput(item.entity, item.data),
	}, submitterID, requestID(item.data.Code, "upgrade-save"))
	if err != nil {
		return bob.MutationResult{}, fmt.Errorf("save upgraded demo data: %w", err)
	}
	return saved, nil
}

func detailInput(entity string, input bob.CreateDetailInput) bob.DetailInput {
	result := bob.DetailInput{
		Name: input.Name, Unit: input.Unit, Currency: input.Currency,
		SupplierType: input.SupplierType, PlateNumber: input.PlateNumber,
		CustomerType: input.CustomerType, VehicleType: input.VehicleType,
		PlatformObjectID: input.PlatformObjectID, TargetEntity: stringPointer(input.TargetEntity),
		RuleType: input.RuleType, MonthOffset: input.MonthOffset,
		DayOfMonth: input.DayOfMonth, DayOffset: input.DayOffset,
	}
	switch entity {
	case bob.EntityCustomer, bob.EntitySupplier:
		result.ShortName = bob.Optional(input.ShortName)
		result.CategoryID = bob.Optional(input.CategoryID)
		result.TaxNumber = bob.Optional(input.TaxNumber)
		result.ContactName = bob.Optional(input.ContactName)
		result.ContactPhone = bob.Optional(input.ContactPhone)
		result.Email = bob.Optional(input.Email)
		result.Address = bob.Optional(input.Address)
		result.Remark = bob.Optional(input.Remark)
		result.SettlementMethodID = bob.Optional(input.SettlementMethodID)
		result.SalespersonEmployeeID = bob.Optional(input.SalespersonEmployeeID)
	case bob.EntityEmployee:
		result.CategoryID = bob.Optional(input.CategoryID)
		result.DepartmentID = bob.Optional(input.DepartmentID)
		result.PositionID = bob.Optional(input.PositionID)
		result.Phone = bob.Optional(input.Phone)
		result.Email = bob.Optional(input.Email)
		result.HireDate = bob.Optional(input.HireDate)
		result.Remark = bob.Optional(input.Remark)
	case bob.EntityProduct:
		result.CategoryID = bob.Optional(input.CategoryID)
		result.Specification = bob.Optional(input.Specification)
		result.Model = bob.Optional(input.Model)
		result.Barcode = bob.Optional(input.Barcode)
		result.Remark = bob.Optional(input.Remark)
		if input.ProductKind != "" {
			result.ProductKind = stringPointer(input.ProductKind)
		}
		result.Formula = input.Formula
	case bob.EntityService:
		result.CategoryID = bob.Optional(input.CategoryID)
		result.Description = bob.Optional(input.Description)
		result.Remark = bob.Optional(input.Remark)
	case bob.EntityWarehouse:
		result.CategoryID = bob.Optional(input.CategoryID)
		result.Address = bob.Optional(input.Address)
		result.ContactName = bob.Optional(input.ContactName)
		result.ContactPhone = bob.Optional(input.ContactPhone)
		result.ManagerEmployeeID = bob.Optional(input.ManagerEmployeeID)
		result.Remark = bob.Optional(input.Remark)
	case bob.EntityVehicle:
		result.CategoryID = bob.Optional(input.CategoryID)
		result.VIN = bob.Optional(input.VIN)
		result.EngineNumber = bob.Optional(input.EngineNumber)
		result.LoadCapacityKG = bob.Optional(input.LoadCapacityKG)
		result.Remark = bob.Optional(input.Remark)
	case bob.EntityFundAccount:
		result.CategoryID = bob.Optional(input.CategoryID)
		result.AccountName = bob.Optional(input.AccountName)
		result.BankName = bob.Optional(input.BankName)
		result.BankBranch = bob.Optional(input.BankBranch)
		result.AccountNumber = bob.Optional(input.AccountNumber)
		result.Remark = bob.Optional(input.Remark)
	case bob.EntityCategory:
		result.ParentID = bob.Optional(input.ParentID)
		result.Description = bob.Optional(input.Description)
	case bob.EntityDepartment:
		result.CategoryID = bob.Optional(input.CategoryID)
		result.ParentID = bob.Optional(input.ParentID)
		result.Description = bob.Optional(input.Description)
	case bob.EntityPosition:
		result.CategoryID = bob.Optional(input.CategoryID)
		result.Description = bob.Optional(input.Description)
	case bob.EntitySettlementMethod:
		result.Description = bob.Optional(input.Description)
	}
	return result
}

func stringPointer(value string) *string {
	return &value
}

func int32Pointer(value int32) *int32 {
	return &value
}

func equalInt32Pointer(left, right *int32) bool {
	return (left == nil && right == nil) ||
		(left != nil && right != nil && *left == *right)
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
