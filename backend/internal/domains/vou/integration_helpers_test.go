//go:build integration

package vou

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	integrationActorOne = "01J00000000000000000000000"
	integrationActorTwo = "01J00000000000000000000001"
)

type integrationReferences struct {
	customer, supplier, employee, product, warehouse, fundAccount ReferenceInput
	settlement, platform, vehicle                                 ReferenceInput
}

func vouIntegrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	expectedName := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if databaseURL == "" || expectedName == "" || !strings.HasSuffix(expectedName, "_test") {
		t.Fatal("safe TEST_DATABASE_URL and TEST_POSTGRES_DB ending in _test are required")
	}
	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect integration database: %v", err)
	}
	t.Cleanup(pool.Close)
	var actual string
	if err = pool.QueryRow(t.Context(), "select current_database()").Scan(&actual); err != nil || actual != expectedName {
		t.Fatalf("integration database = %q, want %q, err=%v", actual, expectedName, err)
	}
	var table *string
	if err = pool.QueryRow(t.Context(), "select to_regclass('vou_documents')::text").Scan(&table); err != nil ||
		table == nil || *table != "vou_documents" {
		t.Fatalf("VOU migrations are not applied: table=%v err=%v", table, err)
	}
	return pool
}

func truncateVOU(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		TRUNCATE led_bill_entries, led_bills,
			wfl_runtime_audit_events, wfl_edge_executions, wfl_node_instances,
			wfl_definition_instances, vou_audit_events, vou_download_tokens, vou_document_attachments,
			vou_settlement_reservations,
			vou_files, wfl_audit_events, wfl_process_documents, wfl_process_instances,
			vou_asset_liquidation_lines,vou_asset_liquidation_details,
			vou_asset_sale_lines,vou_asset_sale_details,
			vou_asset_depreciation_lines,vou_asset_depreciation_details,
			vou_asset_acquisition_lines,vou_asset_acquisition_details,
			vou_bill_cash_lines,vou_bill_lines,vou_bill_details,
			vou_price_lines, vou_purchase_inquiry_details, vou_sale_pricing_details,
			vou_inventory_count_lines, vou_inventory_count_details,
			vou_sale_return_lines, vou_sale_return_details,
			vou_purchase_return_lines, vou_purchase_return_details,
			vou_sale_signoff_lines, vou_sale_signoff_details,
			vou_sale_delivery_details, vou_sale_outbound_lines, vou_sale_outbound_details,
			vou_purchase_inbound_lines, vou_purchase_inbound_details,
			vou_production_material_lines, vou_production_output_lines, vou_production_details,
			vou_expense_lines, vou_sale_order_formula_lines, vou_sale_order_formulas,
			vou_product_lines, vou_other_income_details,
			vou_employee_loan_writeoff_details, vou_expense_payment_details, vou_expense_reimbursement_details, vou_payment_details, vou_receipt_details,
			vou_purchase_order_details,
			vou_sale_order_details, vou_documents, vou_number_counters`)
	if err != nil {
		t.Fatalf("truncate VOU: %v", err)
	}
}

func createApprovedBOB(
	t *testing.T, service *bobdomain.Service, entity string, data bobdomain.CreateDetailInput,
) ReferenceInput {
	t.Helper()
	created, err := service.Create(t.Context(), entity, bobdomain.CreateInput{Data: data},
		integrationActorOne, "vou-ref-create")
	if err != nil {
		t.Fatalf("create %s reference: %v (cause: %v)", entity, err, errors.Unwrap(err))
	}
	submitted, err := service.Submit(t.Context(), entity, bobdomain.VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, integrationActorOne, "vou-ref-submit")
	if err != nil {
		t.Fatalf("submit %s reference: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, bobdomain.ReviewInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, "vou-ref-approve")
	if err != nil {
		t.Fatalf("approve %s reference: %v", entity, err)
	}
	return ReferenceInput{ObjectID: approved.ObjectID, VersionID: approved.VersionID}
}

func reverseApprovedBOBToDraft(
	t *testing.T,
	service *bobdomain.Service,
	entity string,
	view bobdomain.ObjectView,
	requestID string,
) bobdomain.MutationResult {
	t.Helper()
	unapproved, err := service.Unapprove(t.Context(), entity, bobdomain.ReverseInput{
		ObjectID: view.ObjectID, ObjectRevision: view.ObjectRevision,
		VersionID: view.Version.VersionID, Revision: view.Version.Revision, Reason: "integration update",
	}, integrationActorOne, requestID+"-unapprove")
	if err != nil {
		t.Fatalf("unapprove BOB reference: %v", err)
	}
	draft, err := service.Unsubmit(t.Context(), entity, bobdomain.ReverseInput{
		ObjectID: unapproved.ObjectID, ObjectRevision: unapproved.ObjectRevision,
		VersionID: unapproved.VersionID, Revision: unapproved.Revision, Reason: "integration update",
	}, integrationActorOne, requestID+"-unsubmit")
	if err != nil {
		t.Fatalf("unsubmit BOB reference: %v", err)
	}
	return draft
}

func fixedSettlementReference(t *testing.T, pool *pgxpool.Pool, termCode string) ReferenceInput {
	t.Helper()
	var result ReferenceInput
	if err := pool.QueryRow(t.Context(), `
		SELECT object.id,object.effective_version_id
		FROM bob_objects object
		JOIN bob_settlement_method_versions method ON method.version_id=object.effective_version_id
		WHERE object.entity='settlement-method' AND object.enabled AND method.term_code=$1
	`, termCode).Scan(&result.ObjectID, &result.VersionID); err != nil {
		t.Fatalf("find fixed settlement method %s: %v", termCode, err)
	}
	return result
}

func prepareReferences(t *testing.T, pool *pgxpool.Pool) integrationReferences {
	t.Helper()
	service := bobdomain.NewService(pool)
	suffix := newID()
	general := bobdomain.SupplierTypeGeneral
	logistics := bobdomain.SupplierTypeLogisticsPlatform
	settlement := fixedSettlementReference(t, pool, bobdomain.SettlementTermMonthly30)
	employee := createApprovedBOB(t, service, bobdomain.EntityEmployee, bobdomain.CreateDetailInput{
		Code: "VE" + suffix, Name: "VOU 员工",
	})
	platform := createApprovedBOB(t, service, bobdomain.EntitySupplier, bobdomain.CreateDetailInput{
		Code: "VLP" + suffix, Name: "VOU 物流平台", SupplierType: &logistics,
		SalespersonEmployeeID: employee.ObjectID,
	})
	return integrationReferences{
		customer: createApprovedBOB(t, service, bobdomain.EntityCustomer, bobdomain.CreateDetailInput{
			Code: "VC" + suffix, Name: "VOU 客户", ContactName: "客户联系人",
			ContactPhone: "13800000000", Address: "深圳市测试路 1 号",
			SettlementMethodID:    settlement.ObjectID,
			SalespersonEmployeeID: employee.ObjectID,
		}),
		supplier: createApprovedBOB(t, service, bobdomain.EntitySupplier, bobdomain.CreateDetailInput{
			Code: "VS" + suffix, Name: "VOU 供应商", SupplierType: &general,
			ContactName: "供应商联系人", ContactPhone: "13900000000",
			SettlementMethodID:    settlement.ObjectID,
			SalespersonEmployeeID: employee.ObjectID,
		}),
		employee: employee,
		product: createApprovedBOB(t, service, bobdomain.EntityProduct, bobdomain.CreateDetailInput{
			Code: "VP" + suffix, Name: "VOU 产品", Unit: "吨",
		}),
		warehouse: createApprovedBOB(t, service, bobdomain.EntityWarehouse, bobdomain.CreateDetailInput{
			Code: "VW" + suffix, Name: "VOU 仓库",
		}),
		fundAccount: createApprovedBOB(t, service, bobdomain.EntityFundAccount, bobdomain.CreateDetailInput{
			Code: "VF" + suffix, Name: "VOU 资金账户", Currency: "CNY",
		}),
		settlement: settlement, platform: platform,
		vehicle: createApprovedBOB(t, service, bobdomain.EntityVehicle, bobdomain.CreateDetailInput{
			Code: "VV" + suffix, Name: "VOU 车辆", PlateNumber: "粤V" + suffix[len(suffix)-6:],
			VehicleType: "厢式货车", PlatformObjectID: platform.ObjectID,
		}),
	}
}

func newIntegrationService(t *testing.T, pool *pgxpool.Pool) *Service {
	t.Helper()
	service, err := NewService(pool, bobdomain.NewService(pool), auxiliaryrefs.New(auxdomain.NewService(pool)), txevent.NewBus(), AttachmentOptions{Root: t.TempDir()},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("new VOU service: %v", err)
	}
	return service
}
