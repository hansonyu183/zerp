//go:build integration

package bob

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

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
		seen++
	}
	if err = rows.Err(); err != nil {
		t.Fatalf("iterate common attribute permissions: %v", err)
	}
	if seen != 0 {
		t.Fatalf("migrated BOB permission count = %d, want 0", seen)
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

func TestProductQueryIncludesVersionedUnitConversionsIntegration(t *testing.T) {
	service := NewService(integrationPool(t))
	productName := "单位换算查询产品 " + newID()
	createApprovedIntegration(t, service, EntityProduct, CreateDetailInput{
		Name: productName,
	}, "product-query-units")

	page, err := service.Query(t.Context(), EntityProduct, QueryInput{
		Page: 1, PageSize: 20,
		Filters: QueryFilters{Keyword: productName, Status: []string{StatusEffective}},
		Sort:    []SortItem{{Field: "name", Order: "asc"}},
	})
	if err != nil {
		t.Fatalf("query product: %v", err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("product query items = %d, want 1", len(page.Items))
	}
	data := page.Items[0].CurrentVersion.Summary
	if data.DefaultInputUnitID != integrationKGUnitID || data.PricingUnitID != integrationKGUnitID {
		t.Fatalf("product default units = %q/%q", data.DefaultInputUnitID, data.PricingUnitID)
	}
	if len(data.UnitConversions) != 1 || data.UnitConversions[0].Unit.ObjectID != integrationKGUnitID || data.UnitConversions[0].Factor != "1" {
		t.Fatalf("product unit conversions = %#v", data.UnitConversions)
	}
}

func TestCurrentIdentifierUniquenessAndHistoryReleaseIntegration(t *testing.T) {
	service := NewService(integrationPool(t))

	product, productApproved := createApprovedIntegration(t, service, EntityProduct, CreateDetailInput{
		Code: "PU" + newID(), Name: "唯一条码产品", Barcode: " barcode-" + newID(),
	}, "identifier-product")
	previousAuxiliaryResolver := service.auxiliaryResolver
	service.SetAuxiliaryResolver(integrationAuxiliaryResolver{})
	t.Cleanup(func() { service.SetAuxiliaryResolver(previousAuxiliaryResolver) })
	productView, err := service.Get(t.Context(), EntityProduct, GetInput{ObjectID: product.ObjectID})
	if err != nil {
		t.Fatalf("get identifier product: %v", err)
	}
	originalBarcode := productView.Data.Barcode
	if originalBarcode != strings.ToUpper(strings.TrimSpace(originalBarcode)) {
		t.Fatalf("barcode was not normalized: %q", originalBarcode)
	}
	if _, err = service.Create(t.Context(), EntityProduct, CreateInput{Data: CreateDetailInput{
		Code: "PD" + newID(), Name: "重复条码产品", Barcode: strings.ToLower(originalBarcode), DefaultPackagingSpec: "1",
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
			Name: "唯一条码产品", Barcode: Optional("BARCODE-" + newID()),
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
		Code: "PR" + newID(), Name: "复用历史条码产品", Barcode: originalBarcode, DefaultPackagingSpec: "1",
	}}, integrationActorOne, "reuse-historical-barcode"); err != nil {
		t.Fatalf("historical barcode was not released: %v", err)
	}
	service.SetAuxiliaryResolver(previousAuxiliaryResolver)

	platform, _ := createApprovedIntegration(t, service, EntityOtherUnit, CreateDetailInput{
		Name: "VIN 测试承运单位",
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
		"disable":       156,
		"enable":        155,
		"get":           65,
		"query":         66,
		"reject":        67,
		"save":          68,
		"submit":        69,
		"unapprove":     154,
		"unsubmit":      153,
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
		if sequence > 0 && id != fmt.Sprintf("01JBOB%020d", sequence) {
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
		"disable":       160,
		"enable":        159,
		"get":           75,
		"query":         76,
		"reject":        77,
		"save":          78,
		"submit":        79,
		"unapprove":     158,
		"unsubmit":      157,
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
		if sequence > 0 && id != fmt.Sprintf("01JBOB%020d", sequence) {
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
}
