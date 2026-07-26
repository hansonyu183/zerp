//go:build integration

package bob

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	integrationActorOne = "01J00000000000000000000000"
	integrationActorTwo = "01J00000000000000000000001"
)

func integrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required")
	}
	testDatabaseName := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if testDatabaseName == "" {
		t.Fatal("TEST_POSTGRES_DB is required")
	}
	if !strings.HasSuffix(testDatabaseName, "_test") {
		t.Fatalf("TEST_POSTGRES_DB %q must end with _test", testDatabaseName)
	}
	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect integration database: %v", err)
	}
	t.Cleanup(pool.Close)

	var currentDatabase string
	if err = pool.QueryRow(t.Context(), "select current_database()").Scan(&currentDatabase); err != nil {
		t.Fatalf("read integration database name: %v", err)
	}
	if currentDatabase != testDatabaseName {
		t.Fatalf("connected database %q does not match TEST_POSTGRES_DB %q", currentDatabase, testDatabaseName)
	}

	var table *string
	if err = pool.QueryRow(t.Context(), "select to_regclass('bob_objects')::text").Scan(&table); err != nil || table == nil {
		t.Fatalf("BOB migrations are not applied: table=%v err=%v", table, err)
	}
	return pool
}

func deleteIntegrationData(entity, platformObjectID, salespersonEmployeeID string) CreateDetailInput {
	data := CreateDetailInput{
		Code: "DEL" + newID(),
		Name: "Deletable " + entity,
	}
	switch entity {
	case EntityCustomer, EntitySupplier:
		data.SalespersonEmployeeID = salespersonEmployeeID
	case EntityProduct, EntityService:
		data.Unit = "unit"
	case EntityFundAccount:
		data.Currency = "CNY"
	case EntityVehicle:
		data.PlateNumber = "沪D" + newID()
		data.VehicleType = "Truck"
		data.PlatformObjectID = platformObjectID
	case EntityCategory:
		data.TargetEntity = EntityProduct
	case EntitySettlementMethod:
		data.RuleType = SettlementRuleRelativeDays
		data.DayOffset = 30
	}
	return data
}

func assertBobAggregateCounts(
	t *testing.T,
	pool *pgxpool.Pool,
	objectID, versionID string,
	wantObjects, wantVersions, wantDetails, wantAudits int,
) {
	t.Helper()
	var objects, versions, details, audits int
	err := pool.QueryRow(t.Context(), `
		SELECT
			(SELECT count(*) FROM bob_objects WHERE id = $1),
			(SELECT count(*) FROM bob_versions WHERE id = $2 AND object_id = $1),
			(SELECT count(*) FROM bob_customer_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_supplier_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_employee_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_product_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_service_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_warehouse_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_vehicle_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_fund_account_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_category_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_department_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_position_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_settlement_method_versions WHERE version_id = $2),
			(SELECT count(*) FROM bob_audit_events WHERE object_id = $1 AND version_id = $2)
	`, objectID, versionID).Scan(&objects, &versions, &details, &audits)
	if err != nil {
		t.Fatalf("count BOB aggregate: %v", err)
	}
	if objects != wantObjects || versions != wantVersions || details != wantDetails || audits != wantAudits {
		t.Fatalf(
			"aggregate counts object=%d version=%d detail=%d audit=%d, want %d/%d/%d/%d",
			objects, versions, details, audits,
			wantObjects, wantVersions, wantDetails, wantAudits,
		)
	}
}

func assertBobAggregatePresent(t *testing.T, pool *pgxpool.Pool, objectID, versionID string) {
	t.Helper()
	var objects, versions, details, audits int
	err := pool.QueryRow(t.Context(), `
		SELECT
			(SELECT count(*) FROM bob_objects WHERE id = $1),
			(SELECT count(*) FROM bob_versions WHERE id = $2 AND object_id = $1),
			(SELECT count(*) FROM bob_customer_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_supplier_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_employee_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_product_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_service_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_warehouse_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_vehicle_versions WHERE version_id = $2) +
			(SELECT count(*) FROM bob_fund_account_versions WHERE version_id = $2),
			(SELECT count(*) FROM bob_audit_events WHERE object_id = $1 AND version_id = $2)
	`, objectID, versionID).Scan(&objects, &versions, &details, &audits)
	if err != nil {
		t.Fatalf("count preserved BOB aggregate: %v", err)
	}
	if objects != 1 || versions != 1 || details != 1 || audits < 1 {
		t.Fatalf("preserved aggregate counts object=%d version=%d detail=%d audit=%d", objects, versions, details, audits)
	}
}

func insertSaleOrderReferenceIntegration(t *testing.T, pool *pgxpool.Pool, target MutationResult) string {
	t.Helper()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin VOU reference insert: %v", err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	documentID := newID()
	if _, err = tx.Exec(t.Context(), `
		INSERT INTO vou_documents (
			id, entity, document_no, business_date, currency, total_amount_cents, created_by, updated_by
		) VALUES ($1, 'sale-order', $2, current_date, 'CNY', 100, $3, $3)
	`, documentID, "D"+newID(), integrationActorOne); err != nil {
		t.Fatalf("insert VOU reference document: %v", err)
	}
	if _, err = tx.Exec(t.Context(), `
		INSERT INTO vou_sale_order_details (
			document_id, customer_object_id, customer_version_id, customer_code, customer_name
		) VALUES ($1, $2, $3, 'DRAFT-REFERENCE', 'Draft Reference')
	`, documentID, target.ObjectID, target.VersionID); err != nil {
		t.Fatalf("insert VOU reference detail: %v", err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit VOU reference insert: %v", err)
	}
	return documentID
}

func deleteVOUTestDocument(t *testing.T, pool *pgxpool.Pool, documentID string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Errorf("begin VOU test cleanup: %v", err)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err = tx.Exec(ctx, `DELETE FROM vou_sale_order_details WHERE document_id = $1`, documentID); err != nil {
		t.Errorf("delete VOU reference detail: %v", err)
		return
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_documents WHERE id = $1`, documentID); err != nil {
		t.Errorf("delete VOU reference document: %v", err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		t.Errorf("commit VOU test cleanup: %v", err)
	}
}

func createApprovedIntegration(
	t *testing.T,
	service *Service,
	entity string,
	data CreateDetailInput,
	requestPrefix string,
) (MutationResult, MutationResult) {
	t.Helper()
	if (entity == EntityCustomer || entity == EntitySupplier) && data.SalespersonEmployeeID == "" {
		_, employee := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
			Code: "AUTOEMP" + newID(), Name: "Integration Salesperson",
		}, requestPrefix+"-salesperson")
		data.SalespersonEmployeeID = employee.ObjectID
	}
	created, err := service.Create(
		t.Context(), entity, CreateInput{Data: data}, integrationActorOne, requestPrefix+"-create",
	)
	if err != nil {
		t.Fatalf("create approved %s: %v", entity, err)
	}
	submitted, err := service.Submit(t.Context(), entity, VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, integrationActorOne, requestPrefix+"-submit")
	if err != nil {
		t.Fatalf("submit approved %s: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, ReviewInput{
		ObjectID: submitted.ObjectID, VersionID: submitted.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, requestPrefix+"-approve")
	if err != nil {
		t.Fatalf("approve %s: %v", entity, err)
	}
	return created, approved
}

func stringIntegrationPointer(value string) *string {
	return &value
}
