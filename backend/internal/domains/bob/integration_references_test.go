//go:build integration

package bob

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestCommonAttributesReferencesFiltersAndRedactionIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)

	category, categoryApproved := createApprovedIntegration(t, service, EntityCategory, CreateDetailInput{
		Code: "CC" + newID(), Name: "客户分类", TargetEntity: EntityCustomer,
		Description: "用于客户筛选",
	}, "common-customer-category")
	productCategory, _ := createApprovedIntegration(t, service, EntityCategory, CreateDetailInput{
		Code: "PC" + newID(), Name: "产品分类", TargetEntity: EntityProduct,
	}, "common-product-category")
	department, _ := createApprovedIntegration(t, service, EntityDepartment, CreateDetailInput{
		Code: "DP" + newID(), Name: "运营部",
	}, "common-department")
	position, _ := createApprovedIntegration(t, service, EntityPosition, CreateDetailInput{
		Code: "PS" + newID(), Name: "运营专员",
	}, "common-position")
	salesperson, _ := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Code: "SP" + newID(), Name: "客户业务员", DepartmentID: department.ObjectID,
		PositionID: position.ObjectID,
	}, "common-salesperson")
	settlementCode := "SM" + newID()
	settlementMethod, _ := createApprovedIntegration(t, service, EntitySettlementMethod, CreateDetailInput{
		Code: settlementCode, Name: "月结 30 天", RuleType: SettlementRuleRelativeDays,
		DayOffset: 30,
	}, "common-settlement-method")
	settlementPage, err := service.Query(t.Context(), EntitySettlementMethod, QueryInput{
		Page: 1, PageSize: 20, Filters: QueryFilters{Keyword: settlementCode},
	})
	if err != nil || settlementPage.Total != 1 {
		t.Fatalf("query settlement methods page=%+v err=%v", settlementPage, err)
	}

	if _, err := service.Create(t.Context(), EntityCustomer, CreateInput{Data: CreateDetailInput{
		Code: "WC" + newID(), Name: "错误分类客户", CategoryID: productCategory.ObjectID,
		SalespersonEmployeeID: salesperson.ObjectID,
	}}, integrationActorOne, "wrong-category-target"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("wrong category target error = %v", err)
	}
	if _, err := service.Create(t.Context(), EntityCustomer, CreateInput{Data: CreateDetailInput{
		Code: "WS" + newID(), Name: "错误结算方式客户", SettlementMethodID: position.ObjectID,
		SalespersonEmployeeID: salesperson.ObjectID,
	}}, integrationActorOne, "wrong-settlement-target"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("wrong settlement target error = %v", err)
	}
	if _, err := service.Create(t.Context(), EntityCustomer, CreateInput{Data: CreateDetailInput{
		Code: "WE" + newID(), Name: "错误业务员客户", SalespersonEmployeeID: settlementMethod.ObjectID,
	}}, integrationActorOne, "wrong-salesperson-target"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("wrong salesperson target error = %v", err)
	}
	draftSalesperson, err := service.Create(t.Context(), EntityEmployee, CreateInput{Data: CreateDetailInput{
		Code: "SD" + newID(), Name: "草稿业务员",
	}}, integrationActorOne, "draft-salesperson")
	if err != nil {
		t.Fatalf("create draft salesperson: %v", err)
	}
	if _, err = service.Create(t.Context(), EntityCustomer, CreateInput{Data: CreateDetailInput{
		Code: "WD" + newID(), Name: "无效业务员客户", SalespersonEmployeeID: draftSalesperson.ObjectID,
	}}, integrationActorOne, "inactive-salesperson-target"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("inactive salesperson target error = %v", err)
	}
	taxNumber := "TAX" + newID()
	customer, err := service.Create(t.Context(), EntityCustomer, CreateInput{Data: CreateDetailInput{
		Code: "CA" + newID(), Name: "属性客户", CustomerType: stringIntegrationPointer(CustomerTypeDealer),
		ShortName: "属性客户简称", CategoryID: category.ObjectID, TaxNumber: taxNumber,
		ContactName: "联系人", ContactPhone: "+86 13800000000",
		Email: "CONTACT@EXAMPLE.COM", Address: "上海市示例路", Remark: "新增属性",
		SettlementMethodID:    settlementMethod.ObjectID,
		SalespersonEmployeeID: salesperson.ObjectID,
	}}, integrationActorOne, "common-customer-create")
	if err != nil {
		t.Fatalf("create customer attributes: %v", err)
	}
	saved, err := service.Save(t.Context(), EntityCustomer, SaveInput{
		ObjectID: customer.ObjectID, VersionID: customer.VersionID, Revision: customer.Revision,
		Data: DetailInput{Name: "属性客户（更新）"},
	}, integrationActorOne, "common-customer-preserve")
	if err != nil {
		t.Fatalf("save customer preserving omitted attributes: %v", err)
	}
	view, err := service.Get(t.Context(), EntityCustomer, GetInput{ObjectID: customer.ObjectID})
	if err != nil || view.Data.ShortName != "属性客户简称" || view.Data.TaxNumber != taxNumber ||
		view.Data.Email != "contact@example.com" || view.Data.CategoryID != category.ObjectID ||
		view.Data.SettlementMethodID != settlementMethod.ObjectID ||
		view.Data.SalespersonEmployeeID != salesperson.ObjectID {
		t.Fatalf("preserved customer view=%+v err=%v", view, err)
	}
	page, err := service.Query(t.Context(), EntityCustomer, QueryInput{
		Page: 1, PageSize: 20,
		Filters: QueryFilters{
			CustomerType: CustomerTypeDealer, CategoryID: category.ObjectID,
			SalespersonEmployeeID: salesperson.ObjectID, Keyword: taxNumber,
		},
	})
	if err != nil || page.Total != 1 || len(page.Items) != 1 ||
		page.Items[0].CurrentVersion.Summary.SettlementMethodID != settlementMethod.ObjectID ||
		page.Items[0].CurrentVersion.Summary.SalespersonEmployeeID != salesperson.ObjectID {
		t.Fatalf("query common attributes page=%+v err=%v", page, err)
	}
	supplier, err := service.Create(t.Context(), EntitySupplier, CreateInput{Data: CreateDetailInput{
		Code: "SA" + newID(), Name: "属性供应商",
		SettlementMethodID:    settlementMethod.ObjectID,
		SalespersonEmployeeID: salesperson.ObjectID,
	}}, integrationActorOne, "common-supplier-create")
	if err != nil {
		t.Fatalf("create supplier salesperson: %v", err)
	}
	supplierView, err := service.Get(t.Context(), EntitySupplier, GetInput{ObjectID: supplier.ObjectID})
	if err != nil || supplierView.Data.SalespersonEmployeeID != salesperson.ObjectID {
		t.Fatalf("supplier salesperson view=%+v err=%v", supplierView.Data, err)
	}
	supplierPage, err := service.Query(t.Context(), EntitySupplier, QueryInput{
		Page: 1, PageSize: 20,
		Filters: QueryFilters{SalespersonEmployeeID: salesperson.ObjectID},
	})
	if err != nil || supplierPage.Total < 1 {
		t.Fatalf("query supplier salesperson page=%+v err=%v", supplierPage, err)
	}
	saved, err = service.Save(t.Context(), EntityCustomer, SaveInput{
		ObjectID: customer.ObjectID, VersionID: customer.VersionID, Revision: saved.Revision,
		Data: DetailInput{
			Name: "属性客户（更新）", ShortName: Optional(""), ContactPhone: Optional(""),
		},
	}, integrationActorOne, "common-customer-clear")
	if err != nil {
		t.Fatalf("clear optional attributes: %v", err)
	}
	view, _ = service.Get(t.Context(), EntityCustomer, GetInput{ObjectID: customer.ObjectID})
	if view.Data.ShortName != "" || view.Data.ContactPhone != "" || view.Data.TaxNumber != taxNumber {
		t.Fatalf("explicit clear view = %+v", view.Data)
	}
	clearable, err := service.Create(t.Context(), EntityCustomer, CreateInput{Data: CreateDetailInput{
		Code: "CL" + newID(), Name: "清空默认值客户",
		SettlementMethodID:    settlementMethod.ObjectID,
		SalespersonEmployeeID: salesperson.ObjectID,
	}}, integrationActorOne, "common-customer-clear-create")
	if err != nil {
		t.Fatalf("create clearable customer: %v", err)
	}
	if _, err = service.Save(t.Context(), EntityCustomer, SaveInput{
		ObjectID: clearable.ObjectID, VersionID: clearable.VersionID, Revision: clearable.Revision,
		Data: DetailInput{
			Name: "清空默认值客户", SettlementMethodID: Optional(""),
			SalespersonEmployeeID: Optional(""),
		},
	}, integrationActorOne, "common-customer-clear-references"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("clear required salesperson error = %v", err)
	}
	clearedView, err := service.Get(t.Context(), EntityCustomer, GetInput{ObjectID: clearable.ObjectID})
	if err != nil || clearedView.Data.SettlementMethodID != settlementMethod.ObjectID ||
		clearedView.Data.SalespersonEmployeeID != salesperson.ObjectID {
		t.Fatalf("rejected clear changed customer view=%+v err=%v", clearedView, err)
	}
	if _, err = service.Create(t.Context(), EntityCustomer, CreateInput{Data: CreateDetailInput{
		Code: "DU" + newID(), Name: "重复税号客户", TaxNumber: strings.ToLower(taxNumber),
		SalespersonEmployeeID: salesperson.ObjectID,
	}}, integrationActorOne, "duplicate-tax"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("duplicate tax error = %v", err)
	}
	submitted, _ := service.Submit(t.Context(), EntityCustomer, VersionRevisionInput{
		ObjectID: customer.ObjectID, VersionID: customer.VersionID, Revision: saved.Revision,
	}, integrationActorOne, "common-customer-submit")
	approved, err := service.Approve(t.Context(), EntityCustomer, ReviewInput{
		ObjectID: customer.ObjectID, VersionID: customer.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, "common-customer-approve")
	if err != nil {
		t.Fatalf("approve common customer: %v", err)
	}

	employee, _ := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Code: "EM" + newID(), Name: "关联员工", DepartmentID: department.ObjectID,
		PositionID: position.ObjectID, Phone: "13800000001", HireDate: "2025-01-02",
	}, "common-employee")
	warehouse, _ := createApprovedIntegration(t, service, EntityWarehouse, CreateDetailInput{
		Code: "WH" + newID(), Name: "关联仓库", ManagerEmployeeID: employee.ObjectID,
		Address: "上海市仓库路",
	}, "common-warehouse")
	if warehouse.ObjectID == "" {
		t.Fatal("warehouse reference was not created")
	}

	accountNumber := "6222" + newID()
	accountCode := "FA" + newID()
	account, _ := createApprovedIntegration(t, service, EntityFundAccount, CreateDetailInput{
		Code: accountCode, Name: "敏感账户", Currency: "CNY",
		AccountName: "示例公司", BankName: "示例银行", BankBranch: "上海支行",
		AccountNumber: accountNumber,
	}, "common-account")
	accountView, err := service.Get(t.Context(), EntityFundAccount, GetInput{ObjectID: account.ObjectID})
	if err != nil || accountView.Data.AccountNumber == "" {
		t.Fatalf("get account view=%+v err=%v", accountView, err)
	}
	accountPage, err := service.Query(t.Context(), EntityFundAccount, QueryInput{
		Page: 1, PageSize: 20, Filters: QueryFilters{Currency: "cny", Keyword: accountCode},
	})
	if err != nil || accountPage.Total != 1 || accountPage.Items[0].CurrentVersion.Summary.AccountNumber != "" {
		t.Fatalf("query account redaction page=%+v err=%v", accountPage, err)
	}
	accountVersions, err := service.Versions(t.Context(), EntityFundAccount, HistoryInput{
		ObjectID: account.ObjectID, Page: 1, PageSize: 20,
	})
	if err != nil || accountVersions.Items[0].Summary.AccountNumber == "" {
		t.Fatalf("account versions=%+v err=%v", accountVersions, err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin account resolve: %v", err)
	}
	accountReference, err := service.ResolveEffectiveReference(
		t.Context(), tx, EntityFundAccount, account.ObjectID, account.VersionID,
	)
	_ = tx.Rollback(t.Context())
	if err != nil || accountReference.Data.AccountNumber != "" {
		t.Fatalf("account reference=%+v err=%v", accountReference, err)
	}
	if _, err = service.Create(t.Context(), EntityFundAccount, CreateInput{Data: CreateDetailInput{
		Code: "FD" + newID(), Name: "重复账号", Currency: "CNY", AccountNumber: accountNumber,
	}}, integrationActorOne, "duplicate-account"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("duplicate account error = %v", err)
	}

	categoryEdit, err := service.Edit(t.Context(), EntityCategory, ObjectRevisionInput{
		ObjectID: category.ObjectID, ObjectRevision: categoryApproved.ObjectRevision,
	}, integrationActorOne, "category-target-edit")
	if err != nil {
		t.Fatalf("edit referenced category: %v", err)
	}
	tx, err = pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin customer resolve during category edit: %v", err)
	}
	_, err = service.ResolveEffectiveReference(t.Context(), tx, EntityCustomer, customer.ObjectID, customer.VersionID)
	_ = tx.Rollback(t.Context())
	if err != nil {
		t.Fatalf("category edit recursively blocked customer: %v", err)
	}
	if _, err = service.Save(t.Context(), EntityCategory, SaveInput{
		ObjectID: categoryEdit.ObjectID, VersionID: categoryEdit.VersionID, Revision: categoryEdit.Revision,
		Data: DetailInput{
			Name: "客户分类", TargetEntity: stringIntegrationPointer(EntityProduct),
		},
	}, integrationActorOne, "category-target-change"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("referenced category target change error = %v", err)
	}

	categorySaved, err := service.Save(t.Context(), EntityCategory, SaveInput{
		ObjectID: categoryEdit.ObjectID, VersionID: categoryEdit.VersionID, Revision: categoryEdit.Revision,
		Data: DetailInput{Name: "客户分类"},
	}, integrationActorOne, "category-restore-save")
	if err != nil {
		t.Fatalf("restore category draft: %v", err)
	}
	categorySubmitted, _ := service.Submit(t.Context(), EntityCategory, VersionRevisionInput{
		ObjectID: categoryEdit.ObjectID, VersionID: categoryEdit.VersionID, Revision: categorySaved.Revision,
	}, integrationActorOne, "category-restore-submit")
	categoryRestored, err := service.Approve(t.Context(), EntityCategory, ReviewInput{
		ObjectID: categoryEdit.ObjectID, VersionID: categoryEdit.VersionID, Revision: categorySubmitted.Revision,
	}, integrationActorTwo, "category-restore-approve")
	if err != nil {
		t.Fatalf("restore category effective version: %v", err)
	}

	customerEdit, err := service.Edit(t.Context(), EntityCustomer, ObjectRevisionInput{
		ObjectID: customer.ObjectID, ObjectRevision: approved.ObjectRevision,
	}, integrationActorOne, "historical-category-customer-edit")
	if err != nil {
		t.Fatalf("edit customer before clearing category: %v", err)
	}
	customerSaved, err := service.Save(t.Context(), EntityCustomer, SaveInput{
		ObjectID: customerEdit.ObjectID, VersionID: customerEdit.VersionID, Revision: customerEdit.Revision,
		Data: DetailInput{Name: "属性客户（更新）", CategoryID: Optional("")},
	}, integrationActorOne, "historical-category-customer-save")
	if err != nil {
		t.Fatalf("clear current customer category: %v", err)
	}
	customerSubmitted, _ := service.Submit(t.Context(), EntityCustomer, VersionRevisionInput{
		ObjectID: customerEdit.ObjectID, VersionID: customerEdit.VersionID, Revision: customerSaved.Revision,
	}, integrationActorOne, "historical-category-customer-submit")
	if _, err = service.Approve(t.Context(), EntityCustomer, ReviewInput{
		ObjectID: customerEdit.ObjectID, VersionID: customerEdit.VersionID, Revision: customerSubmitted.Revision,
	}, integrationActorTwo, "historical-category-customer-approve"); err != nil {
		t.Fatalf("approve customer without current category: %v", err)
	}

	categoryHistoryEdit, err := service.Edit(t.Context(), EntityCategory, ObjectRevisionInput{
		ObjectID: category.ObjectID, ObjectRevision: categoryRestored.ObjectRevision,
	}, integrationActorOne, "historical-category-target-edit")
	if err != nil {
		t.Fatalf("edit category with historical reference: %v", err)
	}
	if _, err = service.Save(t.Context(), EntityCategory, SaveInput{
		ObjectID: categoryHistoryEdit.ObjectID, VersionID: categoryHistoryEdit.VersionID,
		Revision: categoryHistoryEdit.Revision,
		Data: DetailInput{
			Name: "客户分类", TargetEntity: stringIntegrationPointer(EntityProduct),
		},
	}, integrationActorOne, "historical-category-target-save"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("historical category target change error = %v", err)
	}
	if approved.ObjectID == "" {
		t.Fatal("customer approval result is empty")
	}
}

func TestCategoryAndDepartmentHierarchyCycleIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)

	categoryRoot, categoryRootApproved := createApprovedIntegration(t, service, EntityCategory, CreateDetailInput{
		Code: "CR" + newID(), Name: "分类根", TargetEntity: EntityProduct,
	}, "category-root")
	categoryChild, _ := createApprovedIntegration(t, service, EntityCategory, CreateDetailInput{
		Code: "CH" + newID(), Name: "分类子项", TargetEntity: EntityProduct, ParentID: categoryRoot.ObjectID,
	}, "category-child")
	categoryEdit, err := service.Edit(t.Context(), EntityCategory, ObjectRevisionInput{
		ObjectID: categoryRoot.ObjectID, ObjectRevision: categoryRootApproved.ObjectRevision,
	}, integrationActorOne, "category-cycle-edit")
	if err != nil {
		t.Fatalf("edit category root: %v", err)
	}
	if _, err = service.Save(t.Context(), EntityCategory, SaveInput{
		ObjectID: categoryEdit.ObjectID, VersionID: categoryEdit.VersionID, Revision: categoryEdit.Revision,
		Data: DetailInput{
			Name: "分类根", ParentID: Optional(categoryChild.ObjectID),
		},
	}, integrationActorOne, "category-cycle-save"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("category cycle error = %v", err)
	}

	departmentRoot, departmentRootApproved := createApprovedIntegration(t, service, EntityDepartment, CreateDetailInput{
		Code: "DR" + newID(), Name: "部门根",
	}, "department-root")
	departmentChild, _ := createApprovedIntegration(t, service, EntityDepartment, CreateDetailInput{
		Code: "DH" + newID(), Name: "部门子项", ParentID: departmentRoot.ObjectID,
	}, "department-child")
	departmentEdit, err := service.Edit(t.Context(), EntityDepartment, ObjectRevisionInput{
		ObjectID: departmentRoot.ObjectID, ObjectRevision: departmentRootApproved.ObjectRevision,
	}, integrationActorOne, "department-cycle-edit")
	if err != nil {
		t.Fatalf("edit department root: %v", err)
	}
	if _, err = service.Save(t.Context(), EntityDepartment, SaveInput{
		ObjectID: departmentEdit.ObjectID, VersionID: departmentEdit.VersionID, Revision: departmentEdit.Revision,
		Data: DetailInput{Name: "部门根", ParentID: Optional(departmentChild.ObjectID)},
	}, integrationActorOne, "department-cycle-save"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("department cycle error = %v", err)
	}
}

func TestCommonAttributeSchemaAndPermissionsIntegration(t *testing.T) {
	pool := integrationPool(t)

	for _, table := range []string{
		"bob_category_versions",
		"bob_department_versions",
		"bob_position_versions",
	} {
		var relation *string
		if err := pool.QueryRow(t.Context(), "select to_regclass($1)::text", table).Scan(&relation); err != nil {
			t.Fatalf("read %s: %v", table, err)
		}
		if relation == nil || *relation != table {
			t.Fatalf("%s relation = %v", table, relation)
		}
	}

	expected := map[string]int{}
	actions := []string{
		"approve", "audit-history", "create", "delete", "edit", "get",
		"query", "reject", "save", "submit", "versions",
	}
	for entity, first := range map[string]int{
		EntityCategory: 89, EntityDepartment: 100, EntityPosition: 111,
	} {
		for offset, action := range actions {
			expected["/bob/"+entity+"/"+action] = first + offset
		}
	}
	rows, err := pool.Query(t.Context(), `
		SELECT id, path
		FROM app_permissions
		WHERE domain = 'bob' AND entity IN ('category', 'department', 'position')
	`)
	if err != nil {
		t.Fatalf("query common attribute permissions: %v", err)
	}
	defer rows.Close()
	seen := 0
	for rows.Next() {
		var id, path string
		if err = rows.Scan(&id, &path); err != nil {
			t.Fatalf("scan common attribute permission: %v", err)
		}
		sequence, ok := expected[path]
		expectedID := "01JBOB" + fmt.Sprintf("%020d", sequence)
		if !ok || id != expectedID {
			t.Fatalf("permission id=%s path=%s expected=%s", id, path, expectedID)
		}
		seen++
	}
	if err = rows.Err(); err != nil {
		t.Fatalf("iterate common attribute permissions: %v", err)
	}
	if seen != 33 {
		t.Fatalf("common attribute permission count = %d, want 33", seen)
	}

	var grants int
	if err = pool.QueryRow(t.Context(), `
		SELECT count(*)
		FROM app_role_permissions rp
		JOIN app_permissions p ON p.id = rp.permission_id
		WHERE p.domain = 'bob' AND p.entity IN ('category', 'department', 'position')
	`).Scan(&grants); err != nil {
		t.Fatalf("count common attribute role grants: %v", err)
	}
	if grants != 0 {
		t.Fatalf("new common attribute permissions were granted item-by-item: %d", grants)
	}
}

func TestCurrentIdentifierUniquenessAndHistoryReleaseIntegration(t *testing.T) {
	service := NewService(integrationPool(t))

	product, productApproved := createApprovedIntegration(t, service, EntityProduct, CreateDetailInput{
		Code: "PU" + newID(), Name: "唯一条码产品", Unit: "件", Barcode: " barcode-" + newID(),
	}, "identifier-product")
	productView, err := service.Get(t.Context(), EntityProduct, GetInput{ObjectID: product.ObjectID})
	if err != nil {
		t.Fatalf("get identifier product: %v", err)
	}
	originalBarcode := productView.Data.Barcode
	if originalBarcode != strings.ToUpper(strings.TrimSpace(originalBarcode)) {
		t.Fatalf("barcode was not normalized: %q", originalBarcode)
	}
	if _, err = service.Create(t.Context(), EntityProduct, CreateInput{Data: CreateDetailInput{
		Code: "PD" + newID(), Name: "重复条码产品", Unit: "件", Barcode: strings.ToLower(originalBarcode),
	}}, integrationActorOne, "duplicate-barcode"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("duplicate barcode error = %v", err)
	}
	productEdit, err := service.Edit(t.Context(), EntityProduct, ObjectRevisionInput{
		ObjectID: product.ObjectID, ObjectRevision: productApproved.ObjectRevision,
	}, integrationActorOne, "release-barcode-edit")
	if err != nil {
		t.Fatalf("edit identifier product: %v", err)
	}
	productSaved, err := service.Save(t.Context(), EntityProduct, SaveInput{
		ObjectID: product.ObjectID, VersionID: productEdit.VersionID, Revision: productEdit.Revision,
		Data: DetailInput{
			Name: "唯一条码产品", Unit: "件", Barcode: Optional("BARCODE-" + newID()),
		},
	}, integrationActorOne, "release-barcode-save")
	if err != nil {
		t.Fatalf("save replacement barcode: %v", err)
	}
	productSubmitted, _ := service.Submit(t.Context(), EntityProduct, VersionRevisionInput{
		ObjectID: product.ObjectID, VersionID: productEdit.VersionID, Revision: productSaved.Revision,
	}, integrationActorOne, "release-barcode-submit")
	if _, err = service.Approve(t.Context(), EntityProduct, ReviewInput{
		ObjectID: product.ObjectID, VersionID: productEdit.VersionID, Revision: productSubmitted.Revision,
	}, integrationActorTwo, "release-barcode-approve"); err != nil {
		t.Fatalf("approve replacement barcode: %v", err)
	}
	if _, err = service.Create(t.Context(), EntityProduct, CreateInput{Data: CreateDetailInput{
		Code: "PR" + newID(), Name: "复用历史条码产品", Unit: "件", Barcode: originalBarcode,
	}}, integrationActorOne, "reuse-historical-barcode"); err != nil {
		t.Fatalf("historical barcode was not released: %v", err)
	}

	platform, _ := createApprovedIntegration(t, service, EntitySupplier, CreateDetailInput{
		Code: "VP" + newID(), Name: "VIN 测试平台",
		SupplierType: stringIntegrationPointer(SupplierTypeLogisticsPlatform),
	}, "identifier-platform")
	vinSuffix := strings.ReplaceAll(newID()[20:], "Q", "A")
	vin := "LSVAA4187N2" + vinSuffix
	vehicle, err := service.Create(t.Context(), EntityVehicle, CreateInput{Data: CreateDetailInput{
		Code: "VU" + newID(), Name: "唯一 VIN 车辆", PlateNumber: "沪B" + newID()[20:],
		VehicleType: "货车", PlatformObjectID: platform.ObjectID, VIN: strings.ToLower(vin),
	}}, integrationActorOne, "identifier-vehicle")
	if err != nil {
		t.Fatalf("create unique VIN vehicle: %v cause=%v vin=%q", err, errors.Unwrap(err), vin)
	}
	vehicleView, _ := service.Get(t.Context(), EntityVehicle, GetInput{ObjectID: vehicle.ObjectID})
	if vehicleView.Data.VIN != vin {
		t.Fatalf("VIN normalization = %q, want %q", vehicleView.Data.VIN, vin)
	}
	if _, err = service.Create(t.Context(), EntityVehicle, CreateInput{Data: CreateDetailInput{
		Code: "VD" + newID(), Name: "重复 VIN 车辆", PlateNumber: "沪C" + newID()[20:],
		VehicleType: "货车", PlatformObjectID: platform.ObjectID, VIN: vin,
	}}, integrationActorOne, "duplicate-vin"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("duplicate VIN error = %v", err)
	}
}

func TestWarehouseSchemaAndPermissionsIntegration(t *testing.T) {
	pool := integrationPool(t)

	var warehouseTable *string
	if err := pool.QueryRow(t.Context(), "select to_regclass('bob_warehouse_versions')::text").Scan(&warehouseTable); err != nil {
		t.Fatalf("read warehouse table: %v", err)
	}
	if warehouseTable == nil || *warehouseTable != "bob_warehouse_versions" {
		t.Fatalf("warehouse table = %v", warehouseTable)
	}

	expectedSequence := map[string]int{
		"approve":       61,
		"audit-history": 62,
		"create":        63,
		"delete":        86,
		"edit":          64,
		"get":           65,
		"query":         66,
		"reject":        67,
		"save":          68,
		"submit":        69,
		"versions":      70,
	}
	rows, err := pool.Query(t.Context(), `
		SELECT id, path, action, status
		FROM app_permissions
		WHERE domain = 'bob' AND entity = 'warehouse'
	`)
	if err != nil {
		t.Fatalf("query warehouse permissions: %v", err)
	}
	defer rows.Close()
	seen := make(map[string]bool, len(expectedSequence))
	for rows.Next() {
		var id, path, action, status string
		if err = rows.Scan(&id, &path, &action, &status); err != nil {
			t.Fatalf("scan warehouse permission: %v", err)
		}
		sequence, exists := expectedSequence[action]
		if !exists {
			t.Fatalf("unexpected warehouse action %q", action)
		}
		if id != fmt.Sprintf("01JBOB%020d", sequence) {
			t.Fatalf("permission %s id = %q", action, id)
		}
		if path != "/bob/warehouse/"+action || status != "ENABLED" {
			t.Fatalf("permission %s path=%q status=%q", action, path, status)
		}
		seen[action] = true
	}
	if err = rows.Err(); err != nil {
		t.Fatalf("iterate warehouse permissions: %v", err)
	}
	if len(seen) != len(expectedSequence) {
		t.Fatalf("warehouse permission actions = %v", seen)
	}

	var superadminCount int
	if err = pool.QueryRow(t.Context(), "SELECT count(*) FROM app_roles WHERE code = 'superadmin'").Scan(&superadminCount); err != nil {
		t.Fatalf("count superadmin roles: %v", err)
	}
	if superadminCount > 0 {
		var storedGrantCount int
		if err = pool.QueryRow(t.Context(), `
			SELECT count(*)
			FROM app_role_permissions rp
			JOIN app_roles r ON r.id = rp.role_id
			JOIN app_permissions p ON p.id = rp.permission_id
			WHERE r.code = 'superadmin' AND p.domain = 'bob' AND p.entity = 'warehouse'
			  AND p.action <> 'delete'
		`).Scan(&storedGrantCount); err != nil {
			t.Fatalf("count stored superadmin warehouse grants: %v", err)
		}
		if storedGrantCount != 0 {
			t.Fatalf("stored superadmin warehouse grants = %d, want 0", storedGrantCount)
		}
	}
}

func TestVehicleSchemaAndPermissionsIntegration(t *testing.T) {
	pool := integrationPool(t)

	var vehicleTable *string
	if err := pool.QueryRow(t.Context(), "select to_regclass('bob_vehicle_versions')::text").Scan(&vehicleTable); err != nil {
		t.Fatalf("read vehicle table: %v", err)
	}
	if vehicleTable == nil || *vehicleTable != "bob_vehicle_versions" {
		t.Fatalf("vehicle table = %v", vehicleTable)
	}

	expectedSequence := map[string]int{
		"approve":       71,
		"audit-history": 72,
		"create":        73,
		"delete":        87,
		"edit":          74,
		"get":           75,
		"query":         76,
		"reject":        77,
		"save":          78,
		"submit":        79,
		"versions":      80,
	}
	rows, err := pool.Query(t.Context(), `
		SELECT id, path, action, status
		FROM app_permissions
		WHERE domain = 'bob' AND entity = 'vehicle'
	`)
	if err != nil {
		t.Fatalf("query vehicle permissions: %v", err)
	}
	defer rows.Close()
	seen := make(map[string]bool, len(expectedSequence))
	for rows.Next() {
		var id, path, action, status string
		if err = rows.Scan(&id, &path, &action, &status); err != nil {
			t.Fatalf("scan vehicle permission: %v", err)
		}
		sequence, exists := expectedSequence[action]
		if !exists {
			t.Fatalf("unexpected vehicle action %q", action)
		}
		if id != fmt.Sprintf("01JBOB%020d", sequence) {
			t.Fatalf("permission %s id = %q", action, id)
		}
		if path != "/bob/vehicle/"+action || status != "ENABLED" {
			t.Fatalf("permission %s path=%q status=%q", action, path, status)
		}
		seen[action] = true
	}
	if err = rows.Err(); err != nil {
		t.Fatalf("iterate vehicle permissions: %v", err)
	}
	if len(seen) != len(expectedSequence) {
		t.Fatalf("vehicle permission actions = %v", seen)
	}

	var superadminCount int
	if err = pool.QueryRow(t.Context(), "SELECT count(*) FROM app_roles WHERE code = 'superadmin'").Scan(&superadminCount); err != nil {
		t.Fatalf("count superadmin roles: %v", err)
	}
	if superadminCount > 0 {
		var storedGrantCount int
		if err = pool.QueryRow(t.Context(), `
			SELECT count(*)
			FROM app_role_permissions rp
			JOIN app_roles r ON r.id = rp.role_id
			JOIN app_permissions p ON p.id = rp.permission_id
			WHERE r.code = 'superadmin' AND p.domain = 'bob' AND p.entity = 'vehicle'
			  AND p.action <> 'delete'
		`).Scan(&storedGrantCount); err != nil {
			t.Fatalf("count stored superadmin vehicle grants: %v", err)
		}
		if storedGrantCount != 0 {
			t.Fatalf("stored superadmin vehicle grants = %d, want 0", storedGrantCount)
		}
	}
}
