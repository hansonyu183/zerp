//go:build integration

package wfl

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

const (
	workflowIntegrationActor    = "01J00000000000000000000000"
	workflowIntegrationReviewer = "01J00000000000000000000001"
)

type workflowReferences struct {
	customer, supplier, employee, warehouse, platform, vehicle, fundAccount voudomain.ReferenceInput
	products                                                                []voudomain.ReferenceInput
}

func workflowIntegrationPool(t *testing.T) *pgxpool.Pool {
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
	return pool
}

func truncateWorkflowIntegration(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		TRUNCATE led_bill_entries, led_bills,
			wfl_runtime_audit_events, wfl_edge_executions, wfl_node_instances,
			wfl_definition_instances, vou_settlement_reservations, vou_audit_events, vou_download_tokens, vou_document_attachments,
			vou_files, wfl_audit_events, wfl_process_documents, wfl_process_instances,
			vou_asset_liquidation_lines,vou_asset_liquidation_details,
			vou_asset_sale_lines,vou_asset_sale_details,
			vou_asset_depreciation_lines,vou_asset_depreciation_details,
			vou_asset_acquisition_lines,vou_asset_acquisition_details,
			vou_intermediary_calculation_bill_allocations,
			vou_bill_cash_lines,vou_bill_lines,vou_bill_details,
			vou_intermediary_calculation_lines,vou_intermediary_calculation_summaries,vou_intermediary_calculation_details,
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
			vou_purchase_order_details, vou_sale_order_details, vou_documents, vou_number_counters`)
	if err != nil {
		t.Fatalf("truncate workflow integration data: %v", err)
	}
}

func fixedWorkflowSettlementReference(
	t *testing.T, pool *pgxpool.Pool, termCode string,
) voudomain.ReferenceInput {
	t.Helper()
	var result voudomain.ReferenceInput
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

func createWorkflowReference(
	t *testing.T,
	service *bobdomain.Service,
	entity string,
	data bobdomain.CreateDetailInput,
) voudomain.ReferenceInput {
	t.Helper()
	created, err := service.Create(t.Context(), entity, bobdomain.CreateInput{Data: data},
		workflowIntegrationActor, "wfl-ref-create")
	if err != nil {
		t.Fatalf("create %s reference: %v", entity, err)
	}
	submitted, err := service.Submit(t.Context(), entity, bobdomain.VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, workflowIntegrationActor, "wfl-ref-submit")
	if err != nil {
		t.Fatalf("submit %s reference: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, bobdomain.ReviewInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision,
	}, workflowIntegrationReviewer, "wfl-ref-approve")
	if err != nil {
		t.Fatalf("approve %s reference: %v", entity, err)
	}
	return voudomain.ReferenceInput{ObjectID: approved.ObjectID, VersionID: approved.VersionID}
}

func prepareWorkflowReferences(
	t *testing.T, pool *pgxpool.Pool, service *bobdomain.Service,
) workflowReferences {
	t.Helper()
	suffix := ulid.Make().String()
	general, logistics := bobdomain.SupplierTypeGeneral, bobdomain.SupplierTypeLogisticsPlatform
	settlement := fixedWorkflowSettlementReference(t, pool, bobdomain.SettlementTermArrival3)
	employee := createWorkflowReference(t, service, bobdomain.EntityEmployee, bobdomain.CreateDetailInput{
		Code: "WEM" + suffix, Name: "流程员工",
	})
	platform := createWorkflowReference(t, service, bobdomain.EntitySupplier, bobdomain.CreateDetailInput{
		Code: "WLP" + suffix, Name: "流程物流", SupplierType: &logistics,
		SalespersonEmployeeID: employee.ObjectID,
	})
	refs := workflowReferences{
		customer: createWorkflowReference(t, service, bobdomain.EntityCustomer, bobdomain.CreateDetailInput{
			Code: "WCU" + suffix, Name: "流程客户", ContactName: "客户联系人",
			ContactPhone: "13800000000", Address: "深圳",
			SettlementMethodID: settlement.ObjectID, SalespersonEmployeeID: employee.ObjectID,
		}),
		supplier: createWorkflowReference(t, service, bobdomain.EntitySupplier, bobdomain.CreateDetailInput{
			Code: "WSU" + suffix, Name: "流程供应商", SupplierType: &general,
			ContactName: "供应商联系人", ContactPhone: "13900000000",
			SettlementMethodID: settlement.ObjectID, SalespersonEmployeeID: employee.ObjectID,
		}),
		employee: employee,
		warehouse: createWorkflowReference(t, service, bobdomain.EntityWarehouse, bobdomain.CreateDetailInput{
			Code: "WWH" + suffix, Name: "流程仓库",
		}),
		platform: platform,
		vehicle: createWorkflowReference(t, service, bobdomain.EntityVehicle, bobdomain.CreateDetailInput{
			Code: "WVE" + suffix, Name: "流程车辆", PlateNumber: "粤B" + suffix[len(suffix)-6:],
			VehicleType: "厢式货车", PlatformObjectID: platform.ObjectID,
		}),
		fundAccount: createWorkflowReference(t, service, bobdomain.EntityFundAccount, bobdomain.CreateDetailInput{
			Code: "WFA" + suffix, Name: "流程资金账户", Currency: "CNY",
		}),
	}
	for index, unit := range []string{"吨", "吨", "件"} {
		refs.products = append(refs.products, createWorkflowReference(
			t, service, bobdomain.EntityProduct, bobdomain.CreateDetailInput{
				Code: "WPR" + string(rune('A'+index)) + suffix,
				Name: "流程产品" + string(rune('A'+index)), Unit: unit,
			},
		))
	}
	return refs
}

func newWorkflowIntegrationServices(
	t *testing.T,
	pool *pgxpool.Pool,
) (*Service, *voudomain.Service, workflowReferences) {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	business := bobdomain.NewService(pool)
	refs := prepareWorkflowReferences(t, pool, business)
	events := txevent.NewBus()
	vouchers, err := voudomain.NewService(pool, business, auxiliaryrefs.New(auxdomain.NewService(pool)), events,
		voudomain.AttachmentOptions{Root: t.TempDir()}, logger)
	if err != nil {
		t.Fatalf("new voucher service: %v", err)
	}
	workflows, err := NewService(pool, events, vouchers, logger)
	if err != nil {
		t.Fatalf("new workflow service: %v", err)
	}
	return workflows, vouchers, refs
}

func advanceWorkflowDocument(
	t *testing.T,
	service *voudomain.Service,
	entity string,
	created voudomain.MutationResult,
) voudomain.MutationResult {
	t.Helper()
	checked, err := service.Check(t.Context(), entity, voudomain.DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Revision,
	}, workflowIntegrationActor, "wfl-check")
	if err != nil {
		t.Fatalf("check %s: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, voudomain.DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: checked.Revision,
	}, workflowIntegrationActor, "wfl-approve")
	if err != nil {
		t.Fatalf("approve %s: %v", entity, err)
	}
	return approved
}

func createWorkflowDocument(
	t *testing.T,
	service *voudomain.Service,
	entity string,
	data voudomain.DraftInput,
	approve bool,
) (voudomain.MutationResult, voudomain.DocumentView) {
	t.Helper()
	var created voudomain.MutationResult
	var err error
	switch entity {
	case voudomain.EntityPurchaseInbound:
		created, err = service.CreatePurchaseInbound(t.Context(), voudomain.CreateInput{Data: data},
			workflowIntegrationActor, "wfl-create")
	case voudomain.EntityPurchaseReturn:
		created, err = service.CreatePurchaseReturn(t.Context(), voudomain.CreateInput{Data: data},
			workflowIntegrationActor, "wfl-create")
	default:
		created, err = service.Create(t.Context(), entity, voudomain.CreateInput{Data: data},
			workflowIntegrationActor, "wfl-create")
	}
	if err != nil {
		t.Fatalf("create %s: %v", entity, err)
	}
	result := created
	if approve {
		result = advanceWorkflowDocument(t, service, entity, created)
	}
	view, err := service.Get(t.Context(), entity, voudomain.GetInput{DocumentID: result.DocumentID})
	if err != nil {
		t.Fatalf("get %s: %v", entity, err)
	}
	return result, view
}
