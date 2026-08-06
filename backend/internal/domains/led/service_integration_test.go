//go:build integration

package led

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	integrationActorOne = "01J00000000000000000000000"
	integrationActorTwo = "01J00000000000000000000001"
)

type integrationRefs struct {
	customer, supplier, employee, product, warehouse, fundAccount voudomain.ReferenceInput
	platform, vehicle                                             voudomain.ReferenceInput
}

type integratedVoucherService struct {
	*voudomain.Service
}

func (s *integratedVoucherService) AssertFinalized(
	ctx context.Context,
	entity string,
	input voudomain.DocumentRevisionInput,
	_, _ string,
) (voudomain.MutationResult, error) {
	view, err := s.Get(ctx, entity, voudomain.GetInput{DocumentID: input.DocumentID})
	if err != nil {
		return voudomain.MutationResult{}, err
	}
	if view.Revision != input.Revision || view.Status != voudomain.StatusFinalized {
		return voudomain.MutationResult{}, &voudomain.DomainError{
			Kind: voudomain.ErrorConflict, Message: "document has not completed automatically",
		}
	}
	return voudomain.MutationResult{
		DocumentID: view.DocumentID, DocumentNo: view.DocumentNo,
		Status: view.Status, Revision: view.Revision,
	}, nil
}

func ledIntegrationPool(t *testing.T) *pgxpool.Pool {
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

func truncateLedgerAndVOU(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		TRUNCATE led_bill_entries,led_bills,
			led_asset_entries,led_assets,led_asset_number_assignments,led_asset_number_counters,
			led_inventory_cost_allocations,led_closing_container,led_closing_other_payable,led_closing_party,
			led_closing_fund,led_closing_inventory,led_closings,
			led_audit_events, led_container_entries, led_party_entries, led_fund_entries, led_inventory_entries,
			led_opening_container, led_draft_container,
			led_opening_party, led_opening_fund, led_opening_inventory,
			led_draft_party, led_draft_fund, led_draft_inventory, led_control, led_generations,
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
			vou_purchase_order_details,
			vou_sale_order_details, vou_documents, vou_number_counters`)
	if err != nil {
		t.Fatalf("truncate LED/VOU: %v", err)
	}
	if _, err = pool.Exec(context.Background(), `INSERT INTO led_control (singleton) VALUES (true)`); err != nil {
		t.Fatalf("reset LED control: %v", err)
	}
}

func fixedSettlementReference(
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

func createApprovedReference(
	t *testing.T, service *bobdomain.Service, entity string, data bobdomain.CreateDetailInput,
) voudomain.ReferenceInput {
	t.Helper()
	created, err := service.Create(t.Context(), entity, bobdomain.CreateInput{Data: data},
		integrationActorOne, "led-ref-create")
	if err != nil {
		t.Fatalf("create %s: %v", entity, err)
	}
	submitted, err := service.Submit(t.Context(), entity, bobdomain.VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, integrationActorOne, "led-ref-submit")
	if err != nil {
		t.Fatalf("submit %s: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, bobdomain.ReviewInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, "led-ref-approve")
	if err != nil {
		t.Fatalf("approve %s: %v", entity, err)
	}
	return voudomain.ReferenceInput{ObjectID: approved.ObjectID, VersionID: approved.VersionID}
}

func prepareLEDReferences(t *testing.T, pool *pgxpool.Pool) integrationRefs {
	t.Helper()
	service := bobdomain.NewService(pool)
	suffix := newID()
	settlement := fixedSettlementReference(t, pool, bobdomain.SettlementTermArrival3)
	employee := createApprovedReference(t, service, bobdomain.EntityEmployee, bobdomain.CreateDetailInput{
		Code: "LE" + suffix, Name: "LED 员工",
	})
	general := bobdomain.SupplierTypeGeneral
	logistics := bobdomain.SupplierTypeLogisticsPlatform
	platform := createApprovedReference(t, service, bobdomain.EntitySupplier, bobdomain.CreateDetailInput{
		Code: "LLP" + suffix, Name: "LED 物流", SupplierType: &logistics,
		SalespersonEmployeeID: employee.ObjectID,
	})
	return integrationRefs{
		customer: createApprovedReference(t, service, bobdomain.EntityCustomer, bobdomain.CreateDetailInput{
			Code: "LC" + suffix, Name: "LED 客户", SettlementMethodID: settlement.ObjectID,
			SalespersonEmployeeID: employee.ObjectID,
		}),
		supplier: createApprovedReference(t, service, bobdomain.EntitySupplier, bobdomain.CreateDetailInput{
			Code: "LS" + suffix, Name: "LED 供应商", SupplierType: &general,
			SettlementMethodID: settlement.ObjectID, SalespersonEmployeeID: employee.ObjectID,
		}),
		employee: employee,
		product: createApprovedReference(t, service, bobdomain.EntityProduct, bobdomain.CreateDetailInput{
			Code: "LP" + suffix, Name: "LED 产品", Unit: "件",
		}),
		warehouse: createApprovedReference(t, service, bobdomain.EntityWarehouse, bobdomain.CreateDetailInput{
			Code: "LW" + suffix, Name: "LED 仓库",
		}),
		fundAccount: createApprovedReference(t, service, bobdomain.EntityFundAccount, bobdomain.CreateDetailInput{
			Code: "LF" + suffix, Name: "LED 账户", Currency: "CNY",
		}),
		platform: platform,
		vehicle: createApprovedReference(t, service, bobdomain.EntityVehicle, bobdomain.CreateDetailInput{
			Code: "LV" + suffix, Name: "LED 车辆", PlateNumber: "粤L" + suffix[len(suffix)-6:],
			VehicleType: "厢式货车", PlatformObjectID: platform.ObjectID,
		}),
	}
}

func newIntegratedServices(t *testing.T, pool *pgxpool.Pool) (*Service, *integratedVoucherService) {
	t.Helper()
	bobService := bobdomain.NewService(pool)
	bus := txevent.NewBus()
	vouchers, err := voudomain.NewService(
		pool, bobService, auxiliaryrefs.New(auxdomain.NewService(pool)), bus, voudomain.AttachmentOptions{Root: t.TempDir()},
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	if err != nil {
		t.Fatalf("new VOU service: %v", err)
	}
	ledger, err := NewService(pool, bobService, vouchers)
	if err != nil {
		t.Fatalf("new LED service: %v", err)
	}
	if err = ledger.RegisterSubscriptions(bus); err != nil {
		t.Fatalf("register LED subscriptions: %v", err)
	}
	if err = vouchers.RegisterCompletionSubscriptions(bus); err != nil {
		t.Fatalf("register VOU completion subscriptions: %v", err)
	}
	return ledger, &integratedVoucherService{Service: vouchers}
}

func activateEmptyLedger(t *testing.T, ledger *Service) MutationResult {
	t.Helper()
	saved, err := ledger.SaveOpening(t.Context(), OpeningSaveInput{
		Revision: 1, CutoverDate: "2026-01-01",
		Inventory: []InventoryOpeningInput{}, Fund: []FundOpeningInput{}, Party: []PartyOpeningInput{},
	}, integrationActorOne, "opening-save")
	if err != nil {
		t.Fatalf("save opening: %v", err)
	}
	activated, err := ledger.Activate(t.Context(), RevisionInput{Revision: saved.Revision},
		integrationActorOne, "opening-activate")
	if err != nil {
		t.Fatalf("activate ledger: %v", err)
	}
	return activated
}

func createAuxReference(t *testing.T, pool *pgxpool.Pool, entity string, data map[string]any) voudomain.ReferenceInput {
	t.Helper()
	created, err := auxdomain.NewService(pool).Create(t.Context(), entity, auxdomain.CreateInput{
		Data: auxdomain.CreateData{Data: data},
	}, integrationActorOne, "led-aux-create")
	if err != nil {
		t.Fatalf("create %s: %v", entity, err)
	}
	return voudomain.ReferenceInput{ObjectID: created.ObjectID, VersionID: created.VersionID}
}

func advanceToApproved(
	t *testing.T, service *integratedVoucherService, entity string, draft voudomain.DraftInput,
) (voudomain.MutationResult, voudomain.DocumentView) {
	t.Helper()
	checked, _ := advanceToChecked(t, service, entity, draft)
	approved, err := service.Approve(t.Context(), entity, voudomain.DocumentRevisionInput{
		DocumentID: checked.DocumentID, Revision: checked.Revision,
	}, integrationActorOne, "led-vou-approve")
	if err != nil {
		t.Fatalf("approve %s: %v", entity, err)
	}
	view, err := service.Get(t.Context(), entity, voudomain.GetInput{DocumentID: checked.DocumentID})
	if err != nil {
		t.Fatalf("get %s: %v", entity, err)
	}
	return approved, view
}

func advanceToChecked(
	t *testing.T, service *integratedVoucherService, entity string, draft voudomain.DraftInput,
) (voudomain.MutationResult, voudomain.DocumentView) {
	t.Helper()
	created, err := service.Create(t.Context(), entity, voudomain.CreateInput{Data: draft},
		integrationActorOne, "led-vou-create")
	if err != nil {
		t.Fatalf("create %s: %v", entity, err)
	}
	reviewed, err := service.Check(t.Context(), entity, voudomain.DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Revision,
	}, integrationActorOne, "led-vou-review")
	if err != nil {
		t.Fatalf("review %s: %v", entity, err)
	}
	view, err := service.Get(t.Context(), entity, voudomain.GetInput{DocumentID: created.DocumentID})
	if err != nil {
		t.Fatalf("get %s: %v", entity, err)
	}
	return reviewed, view
}

func approveZeroIntermediaryCalculation(
	t *testing.T, service *integratedVoucherService, businessDate string,
) voudomain.DocumentView {
	t.Helper()
	source, err := service.IntermediarySource(t.Context(), voudomain.IntermediarySourceInput{
		BusinessDate: businessDate,
	})
	if err != nil {
		t.Fatalf("load intermediary source for %s: %v", businessDate, err)
	}
	script, err := service.GetIntermediaryScript(t.Context())
	if err != nil {
		t.Fatalf("load intermediary script for %s: %v", businessDate, err)
	}
	lines := make([]voudomain.IntermediaryResultLine, 0, len(source.Source.Lines))
	for _, item := range source.Source.Lines {
		lines = append(lines, voudomain.IntermediaryResultLine{
			SourceSignoffLineID: item.SourceSignoffLineID,
			PremiumUnitPrice:    "0.00", BarrelQuantity: item.BarrelQuantity,
			BaseCommission: "0.00", PremiumCommission: "0.00", LowPriceCommission: "0.00",
			MarketMaintenanceSubsidy: "0.00", MarketDevelopmentSubsidy: "0.00",
			BillCost: "0.00", BillLineIDs: []string{}, EmployeeAmount: "0.00",
			IntermediaryAmount: "0.00", RebateAmount: "0.00",
		})
	}
	_, view := advanceToApproved(t, service, voudomain.EntityIntermediaryCalculation, voudomain.DraftInput{
		BusinessDate: businessDate, Currency: "CNY",
		IntermediaryCalculation: &voudomain.IntermediaryCalculationInput{
			Source: source.Source, SourceHash: source.SourceHash, Script: script,
			Result: voudomain.IntermediaryCalculationResult{Lines: lines, Summaries: []voudomain.IntermediarySummary{}},
		},
	})
	if view.Status != voudomain.StatusFinalized {
		t.Fatalf("approved intermediary calculation status = %s", view.Status)
	}
	return view
}

func approveZeroIntermediaryCalculations(
	t *testing.T, service *integratedVoucherService, firstMonth, lastMonth string,
) {
	t.Helper()
	first, err := time.Parse("2006-01-02", firstMonth)
	if err != nil {
		t.Fatalf("parse first intermediary month: %v", err)
	}
	last, err := time.Parse("2006-01-02", lastMonth)
	if err != nil {
		t.Fatalf("parse last intermediary month: %v", err)
	}
	for month := time.Date(first.Year(), first.Month(), 1, 0, 0, 0, 0, time.UTC); !month.After(last); month = month.AddDate(0, 1, 0) {
		approveZeroIntermediaryCalculation(t, service, month.AddDate(0, 1, -1).Format("2006-01-02"))
	}
}

func advancePurchaseInboundToApproved(
	t *testing.T,
	service *integratedVoucherService,
	refs integrationRefs,
	quantity, unitPrice string,
	shouldApprove ...bool,
) (voudomain.MutationResult, voudomain.DocumentView) {
	t.Helper()
	order, err := service.CreateManagedPurchaseOrder(t.Context(), voudomain.CreateInput{Data: voudomain.DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Supplier: &refs.supplier,
		Purchaser: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []voudomain.ProductLineInput{{
			Product: refs.product, OrderedQuantity: quantity, UnitPrice: unitPrice,
		}},
	}}, integrationActorOne, "led-purchase-create")
	if err != nil {
		t.Fatalf("create purchase order: %v", err)
	}
	checked, err := service.Check(t.Context(), voudomain.EntityPurchaseOrder,
		voudomain.DocumentRevisionInput{DocumentID: order.DocumentID, Revision: order.Revision},
		integrationActorOne, "led-purchase-check")
	if err != nil {
		t.Fatalf("check purchase order: %v", err)
	}
	if _, err = service.Approve(t.Context(), voudomain.EntityPurchaseOrder,
		voudomain.DocumentRevisionInput{DocumentID: order.DocumentID, Revision: checked.Revision},
		integrationActorOne, "led-purchase-approve"); err != nil {
		t.Fatalf("approve purchase order: %v", err)
	}
	orderView, err := service.Get(t.Context(), voudomain.EntityPurchaseOrder,
		voudomain.GetInput{DocumentID: order.DocumentID})
	if err != nil {
		t.Fatal(err)
	}
	inbound, err := service.CreatePurchaseInbound(t.Context(), voudomain.CreateInput{Data: voudomain.DraftInput{
		BusinessDate: "2026-07-24", SourceDocumentID: order.DocumentID, Warehouse: &refs.warehouse,
		SourceLines: []voudomain.SourceQuantityLineInput{{
			SourceLineID: orderView.Data.ProductLines[0].LineID, Quantity: quantity,
			Remark: "采购入库行",
		}},
	}}, integrationActorOne, "led-inbound-create")
	if err != nil {
		t.Fatalf("create purchase inbound: %v", err)
	}
	inboundChecked, err := service.Check(t.Context(), voudomain.EntityPurchaseInbound,
		voudomain.DocumentRevisionInput{DocumentID: inbound.DocumentID, Revision: inbound.Revision},
		integrationActorOne, "led-inbound-check")
	if err != nil {
		t.Fatal(err)
	}
	if len(shouldApprove) != 0 && !shouldApprove[0] {
		view, getErr := service.Get(t.Context(), voudomain.EntityPurchaseInbound,
			voudomain.GetInput{DocumentID: inbound.DocumentID})
		if getErr != nil {
			t.Fatal(getErr)
		}
		return inboundChecked, view
	}
	approved, err := service.Approve(t.Context(), voudomain.EntityPurchaseInbound,
		voudomain.DocumentRevisionInput{DocumentID: inbound.DocumentID, Revision: inboundChecked.Revision},
		integrationActorOne, "led-inbound-approve")
	if err != nil {
		t.Fatal(err)
	}
	view, err := service.Get(t.Context(), voudomain.EntityPurchaseInbound,
		voudomain.GetInput{DocumentID: inbound.DocumentID})
	if err != nil {
		t.Fatal(err)
	}
	return approved, view
}

func approveSaleOrder(
	t *testing.T,
	service *integratedVoucherService,
	refs integrationRefs,
	quantity string,
) (voudomain.MutationResult, voudomain.DocumentView) {
	t.Helper()
	approved, view := advanceToApproved(t, service, voudomain.EntitySaleOrder, voudomain.DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
		Salesperson: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []voudomain.ProductLineInput{{
			Product: refs.product, OrderedQuantity: quantity, UnitPrice: "12.00",
		}},
	})
	return approved, view
}

func advanceSaleOutboundToApproved(
	t *testing.T,
	service *integratedVoucherService,
	refs integrationRefs,
	order voudomain.MutationResult,
	orderView voudomain.DocumentView,
	quantity string,
	shouldApprove ...bool,
) (voudomain.MutationResult, voudomain.DocumentView) {
	t.Helper()
	created, err := service.Create(t.Context(), voudomain.EntitySaleOutbound, voudomain.CreateInput{Data: voudomain.DraftInput{
		BusinessDate: "2026-07-24", SourceDocumentID: order.DocumentID,
		Warehouse: &refs.warehouse,
		SourceLines: []voudomain.SourceQuantityLineInput{{
			SourceLineID: orderView.Data.ProductLines[0].LineID, Quantity: quantity,
			Remark: "销售出库行",
		}},
	}}, integrationActorOne, "led-sale-outbound-create")
	if err != nil {
		t.Fatal(err)
	}
	checked, err := service.Check(t.Context(), voudomain.EntitySaleOutbound,
		voudomain.DocumentRevisionInput{DocumentID: created.DocumentID, Revision: created.Revision},
		integrationActorOne, "led-sale-outbound-check")
	if err != nil {
		t.Fatal(err)
	}
	if len(shouldApprove) != 0 && !shouldApprove[0] {
		view, getErr := service.Get(t.Context(), voudomain.EntitySaleOutbound,
			voudomain.GetInput{DocumentID: created.DocumentID})
		if getErr != nil {
			t.Fatal(getErr)
		}
		return checked, view
	}
	approved, err := service.Approve(t.Context(), voudomain.EntitySaleOutbound,
		voudomain.DocumentRevisionInput{DocumentID: created.DocumentID, Revision: checked.Revision},
		integrationActorOne, "led-sale-outbound-approve")
	if err != nil {
		t.Fatal(err)
	}
	view, err := service.Get(t.Context(), voudomain.EntitySaleOutbound,
		voudomain.GetInput{DocumentID: created.DocumentID})
	if err != nil {
		t.Fatal(err)
	}
	return approved, view
}

func TestFixedAssetLifecycleIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	category := createAuxReference(t, pool, auxdomain.EntityAssetCategory, map[string]any{
		"name": "机器设备", "defaultUsefulLifeMonths": 12, "defaultResidualRate": "10.00", "description": "集成测试",
	})
	department := createAuxReference(t, pool, auxdomain.EntityDepartment, map[string]any{"name": "生产部", "description": "集成测试"})
	ledger, vouchers := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)

	acquisition, _ := advanceToApproved(t, vouchers, voudomain.EntityAssetAcquisition, voudomain.DraftInput{
		BusinessDate: "2026-02-15", Currency: "CNY", Supplier: &refs.supplier,
		AssetAcquisitionLines: []voudomain.AssetAcquisitionLineInput{{
			AssetName: "测试设备", Category: category, Department: department, Custodian: &refs.employee,
			OriginalValue: "1200.00", UsefulLifeMonths: 12, ResidualRate: "10.00", Location: "一号车间",
		}, {
			AssetName: "待清算设备", Category: category, Department: department,
			OriginalValue: "600.00", UsefulLifeMonths: 12, ResidualRate: "10.00", Location: "二号车间",
		}},
	})
	if _, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityAssetAcquisition, voudomain.DocumentRevisionInput{
		DocumentID: acquisition.DocumentID, Revision: acquisition.Revision,
	}, integrationActorOne, "asset-acquisition-finalize"); err != nil {
		t.Fatalf("finalize acquisition: %v", err)
	}
	assets, err := ledger.QueryAssets(t.Context(), AssetQueryInput{Page: 1, PageSize: 20, Filters: AssetQueryFilters{Status: []string{"ACTIVE"}}})
	if err != nil || len(assets.Items) != 2 {
		t.Fatalf("asset card after acquisition = %+v, err=%v", assets, err)
	}
	var assetID, liquidationAssetID string
	for _, item := range assets.Items {
		if item.AssetName == "测试设备" {
			assetID = item.AssetID
		}
		if item.AssetName == "待清算设备" {
			liquidationAssetID = item.AssetID
		}
	}
	if assetID == "" || liquidationAssetID == "" {
		t.Fatalf("missing acquired asset cards: %+v", assets.Items)
	}

	for _, period := range []struct{ month, date string }{{"2026-03", "2026-03-31"}, {"2026-04", "2026-04-30"}} {
		month := period.month
		preview, previewErr := vouchers.AssetDepreciationPreview(t.Context(), voudomain.AssetDepreciationPreviewInput{DepreciationMonth: month})
		if previewErr != nil || len(preview.Items) != 2 {
			t.Fatalf("preview %s = %+v, err=%v", month, preview, previewErr)
		}
		lines := make([]voudomain.AssetDepreciationLineInput, 0, len(preview.Items))
		for _, item := range preview.Items {
			lines = append(lines, voudomain.AssetDepreciationLineInput{AssetID: item.AssetID})
		}
		approved, _ := advanceToApproved(t, vouchers, voudomain.EntityAssetDepreciation, voudomain.DraftInput{
			BusinessDate: period.date, Currency: "CNY", DepreciationMonth: month,
			AssetDepreciationLines: lines,
		})
		if _, err = vouchers.AssertFinalized(t.Context(), voudomain.EntityAssetDepreciation, voudomain.DocumentRevisionInput{
			DocumentID: approved.DocumentID, Revision: approved.Revision,
		}, integrationActorOne, "asset-depreciation-finalize"); err != nil {
			t.Fatalf("finalize depreciation %s: %v", month, err)
		}
	}

	sale, _ := advanceToApproved(t, vouchers, voudomain.EntityAssetSale, voudomain.DraftInput{
		BusinessDate: "2026-04-20", Currency: "CNY", CounterpartyType: "customer", Counterparty: &refs.customer,
		AssetSaleLines: []voudomain.AssetSaleLineInput{{AssetID: assetID, SaleAmount: "900.00"}},
	})
	if _, err = vouchers.AssertFinalized(t.Context(), voudomain.EntityAssetSale, voudomain.DocumentRevisionInput{
		DocumentID: sale.DocumentID, Revision: sale.Revision,
	}, integrationActorOne, "asset-sale-finalize"); err != nil {
		t.Fatalf("finalize asset sale: %v", err)
	}
	detail, err := ledger.GetAsset(t.Context(), AssetGetInput{AssetID: assetID})
	if err != nil || detail.Asset.Status != "SOLD" || len(detail.History) != 4 {
		t.Fatalf("asset after sale = %+v, err=%v", detail, err)
	}
	var receivable int64
	if err = pool.QueryRow(t.Context(), `SELECT amount_delta_cents FROM led_party_entries WHERE source_document_id=$1`, sale.DocumentID).Scan(&receivable); err != nil || receivable != 90000 {
		t.Fatalf("sale receivable = %d, err=%v", receivable, err)
	}
	liquidation, _ := advanceToApproved(t, vouchers, voudomain.EntityAssetLiquidation, voudomain.DraftInput{
		BusinessDate: "2026-04-20", Currency: "CNY",
		AssetLiquidationLines: []voudomain.AssetLiquidationLineInput{{AssetID: liquidationAssetID, Reason: "设备损坏", SalvageIncome: "20.00", DisposalExpense: "5.00"}},
	})
	if _, err = vouchers.AssertFinalized(t.Context(), voudomain.EntityAssetLiquidation, voudomain.DocumentRevisionInput{DocumentID: liquidation.DocumentID, Revision: liquidation.Revision}, integrationActorOne, "asset-liquidation-finalize"); err != nil {
		t.Fatalf("finalize asset liquidation: %v", err)
	}
	liquidated, err := ledger.GetAsset(t.Context(), AssetGetInput{AssetID: liquidationAssetID})
	if err != nil || liquidated.Asset.Status != "RETIRED" || len(liquidated.History) != 4 {
		t.Fatalf("liquidated asset = %+v, err=%v", liquidated, err)
	}
	var liquidationPartyEntries int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM led_party_entries WHERE source_document_id=$1`, liquidation.DocumentID).Scan(&liquidationPartyEntries); err != nil || liquidationPartyEntries != 0 {
		t.Fatalf("liquidation party entries = %d, err=%v", liquidationPartyEntries, err)
	}
	assetNo := detail.Asset.AssetNo
	if _, err = pool.Exec(t.Context(), `UPDATE led_control SET rebuild_required=true WHERE singleton=true`); err != nil {
		t.Fatal(err)
	}
	if err = ledger.EnsureReady(t.Context()); err != nil {
		t.Fatalf("rebuild ledger with fixed assets: %v", err)
	}
	rebuilt, err := ledger.GetAsset(t.Context(), AssetGetInput{AssetID: assetID})
	if err != nil || rebuilt.Asset.Status != "SOLD" || rebuilt.Asset.AssetNo != assetNo || len(rebuilt.History) != 4 {
		t.Fatalf("rebuilt asset = %+v, err=%v", rebuilt, err)
	}
	rebuiltLiquidation, err := ledger.GetAsset(t.Context(), AssetGetInput{AssetID: liquidationAssetID})
	if err != nil || rebuiltLiquidation.Asset.Status != "RETIRED" || len(rebuiltLiquidation.History) != 4 {
		t.Fatalf("rebuilt liquidation asset = %+v, err=%v", rebuiltLiquidation, err)
	}
}

func TestLEDInventoryPostingStrictBalanceAndDeletionIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, vouchers := newIntegratedServices(t, pool)

	inactiveChecked, _ := advancePurchaseInboundToApproved(t, vouchers, refs, "1", "1.00", false)
	_, err := vouchers.Approve(t.Context(), voudomain.EntityPurchaseInbound, voudomain.DocumentRevisionInput{
		DocumentID: inactiveChecked.DocumentID, Revision: inactiveChecked.Revision,
	}, integrationActorOne, "inactive-approve")
	if err == nil {
		t.Fatal("inactive ledger allowed VOU approval")
	}

	activateEmptyLedger(t, ledger)
	purchaseApproved, _ := advancePurchaseInboundToApproved(t, vouchers, refs, "5", "10.00")
	purchaseExecuted, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityPurchaseInbound, voudomain.DocumentRevisionInput{
		DocumentID: purchaseApproved.DocumentID, Revision: purchaseApproved.Revision,
	}, integrationActorOne, "purchase-execute")
	if err != nil {
		t.Fatalf("execute purchase: %v", err)
	}
	var purchaseSource, purchaseDate, purchaseActor string
	if err = pool.QueryRow(t.Context(), `SELECT source_entity,effective_date::text,actor_id
		FROM led_inventory_entries WHERE source_document_id=$1`, purchaseExecuted.DocumentID).
		Scan(&purchaseSource, &purchaseDate, &purchaseActor); err != nil {
		t.Fatalf("read purchase inventory entry: %v", err)
	}
	if purchaseActor != systemidentity.UserID {
		t.Fatalf("automatic ledger actor = %s", purchaseActor)
	}
	purchaseEntries, err := ledger.QueryInventory(t.Context(), QueryInput{
		Page: 1, PageSize: 20,
		Filters: QueryFilters{
			DateFrom: purchaseDate, DateTo: purchaseDate,
			SourceEntity: purchaseSource,
		},
	})
	if err != nil || len(purchaseEntries.Items) != 1 {
		t.Fatalf("purchase inventory entries = %+v, err=%v", purchaseEntries, err)
	}
	purchaseEntry := purchaseEntries.Items[0]
	if purchaseEntry.UnitPrice != "10.00" || purchaseEntry.Amount != "50.00" ||
		purchaseEntry.Currency != "CNY" || purchaseEntry.Remark != "采购入库行" {
		t.Fatalf("purchase inventory pricing = %+v", purchaseEntry)
	}
	saleOrder, saleOrderView := approveSaleOrder(t, vouchers, refs, "6")
	saleChecked, _ := advanceSaleOutboundToApproved(
		t, vouchers, refs, saleOrder, saleOrderView, "6", false,
	)
	_, err = vouchers.Approve(t.Context(), voudomain.EntitySaleOutbound, voudomain.DocumentRevisionInput{
		DocumentID: saleChecked.DocumentID, Revision: saleChecked.Revision,
	}, integrationActorOne, "negative-sale-outbound")
	if err == nil {
		t.Fatal("negative inventory sale was accepted")
	}
	saleOrder, saleOrderView = approveSaleOrder(t, vouchers, refs, "4")
	saleApproved, _ := advanceSaleOutboundToApproved(
		t, vouchers, refs, saleOrder, saleOrderView, "4",
	)
	saleExecuted, err := vouchers.AssertFinalized(t.Context(), voudomain.EntitySaleOutbound, voudomain.DocumentRevisionInput{
		DocumentID: saleApproved.DocumentID, Revision: saleApproved.Revision,
	}, integrationActorOne, "sale-outbound-finalize")
	if err != nil {
		t.Fatalf("execute sale: %v", err)
	}
	balances, err := ledger.InventoryBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-07-24"},
	})
	if err != nil || len(balances.Items) != 1 || balances.Items[0].Quantity != "1.0" {
		t.Fatalf("inventory balances = %+v, err=%v", balances, err)
	}
	_, err = vouchers.Unapprove(t.Context(), voudomain.EntityPurchaseInbound, voudomain.ReverseInput{
		DocumentID: purchaseExecuted.DocumentID, Revision: purchaseExecuted.Revision, Reason: "撤销采购",
	}, integrationActorOne, "purchase-unexecute-rejected")
	if err == nil {
		t.Fatal("purchase reversal that makes inventory negative was accepted")
	}
	var purchaseEntryCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM led_inventory_entries
		WHERE source_document_id=$1`, purchaseExecuted.DocumentID).Scan(&purchaseEntryCount); err != nil {
		t.Fatal(err)
	}
	if purchaseEntryCount != 1 {
		t.Fatalf("rejected unfinalize changed purchase entries: %d", purchaseEntryCount)
	}
	saleReversed, err := vouchers.Unapprove(t.Context(), voudomain.EntitySaleOutbound, voudomain.ReverseInput{
		DocumentID: saleExecuted.DocumentID, Revision: saleExecuted.Revision, Reason: "撤销销售",
	}, integrationActorOne, "sale-unexecute")
	if err != nil || saleReversed.Status != voudomain.StatusChecked {
		t.Fatalf("unapprove sale = %+v, err=%v", saleReversed, err)
	}
	var saleEntryCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM led_inventory_entries
		WHERE source_document_id=$1`, saleExecuted.DocumentID).Scan(&saleEntryCount); err != nil {
		t.Fatal(err)
	}
	if saleEntryCount != 0 {
		t.Fatalf("unfinalized sale entries = %d, want 0", saleEntryCount)
	}
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityPurchaseInbound, voudomain.ReverseInput{
		DocumentID: purchaseExecuted.DocumentID, Revision: purchaseExecuted.Revision, Reason: "撤销采购",
	}, integrationActorOne, "purchase-unexecute"); err != nil {
		t.Fatalf("unexecute purchase after sale reversal: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM led_inventory_entries
		WHERE source_document_id=$1`, purchaseExecuted.DocumentID).Scan(&purchaseEntryCount); err != nil {
		t.Fatal(err)
	}
	if purchaseEntryCount != 0 {
		t.Fatalf("unfinalized purchase entries = %d, want 0", purchaseEntryCount)
	}
}

func TestInventoryCountPostingAndReversalIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, vouchers := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)

	purchase, _ := advancePurchaseInboundToApproved(t, vouchers, refs, "5", "10.00")
	if _, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityPurchaseInbound,
		voudomain.DocumentRevisionInput{DocumentID: purchase.DocumentID, Revision: purchase.Revision},
		integrationActorOne, "inventory-count-purchase"); err != nil {
		t.Fatalf("finalize purchase: %v", err)
	}

	approved, _ := advanceToApproved(t, vouchers, voudomain.EntityInventoryCount, voudomain.DraftInput{
		BusinessDate: "2026-07-25", Currency: "CNY", Warehouse: &refs.warehouse,
		InventoryCountLines: []voudomain.InventoryCountLineInput{{
			Product: refs.product, ActualQuantity: "7", Remark: "首次盘点",
		}},
	})
	finalized, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityInventoryCount,
		voudomain.DocumentRevisionInput{DocumentID: approved.DocumentID, Revision: approved.Revision},
		integrationActorOne, "inventory-count-finalize")
	if err != nil {
		t.Fatalf("finalize inventory count: %v", err)
	}
	view, err := vouchers.Get(t.Context(), voudomain.EntityInventoryCount,
		voudomain.GetInput{DocumentID: finalized.DocumentID})
	if err != nil || len(view.Data.InventoryCountLines) != 1 {
		t.Fatalf("get inventory count: %+v err=%v", view, err)
	}
	line := view.Data.InventoryCountLines[0]
	if line.BookQuantity == nil || *line.BookQuantity != "5.0" ||
		line.DifferenceQuantity == nil || *line.DifferenceQuantity != "2.0" {
		t.Fatalf("inventory count result = %+v", line)
	}
	balances, err := ledger.InventoryBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20,
		Filters: BalanceFilters{AsOfDate: "2026-07-25", ObjectID: refs.warehouse.ObjectID},
	})
	if err != nil || len(balances.Items) != 1 || balances.Items[0].Quantity != "7.0" {
		t.Fatalf("inventory count balance = %+v err=%v", balances, err)
	}
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityInventoryCount,
		voudomain.ReverseInput{DocumentID: finalized.DocumentID, Revision: finalized.Revision, Reason: "复盘"},
		integrationActorOne, "inventory-count-unfinalize"); err != nil {
		t.Fatalf("unfinalize inventory count: %v", err)
	}
	balances, err = ledger.InventoryBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20,
		Filters: BalanceFilters{AsOfDate: "2026-07-25", ObjectID: refs.warehouse.ObjectID},
	})
	if err != nil || len(balances.Items) != 1 || balances.Items[0].Quantity != "5.0" {
		t.Fatalf("reversed inventory count balance = %+v err=%v", balances, err)
	}
}

func TestLEDSelfProductionPostsMaterialOutAndFinishedGoodsInIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, vouchers := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)

	rawInbound, _ := advancePurchaseInboundToApproved(t, vouchers, refs, "100", "1.00")
	if _, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityPurchaseInbound, voudomain.DocumentRevisionInput{
		DocumentID: rawInbound.DocumentID, Revision: rawInbound.Revision,
	}, integrationActorOne, "production-raw-inbound"); err != nil {
		t.Fatalf("finalize raw material inbound: %v", err)
	}

	finished := createApprovedReference(
		t,
		bobdomain.NewService(pool),
		bobdomain.EntityProduct,
		bobdomain.CreateDetailInput{
			Code:        "LFG" + newID(),
			Name:        "LED 自制成品",
			Unit:        "件",
			ProductKind: bobdomain.ProductKindStandardFinished,
			Formula: &bobdomain.ProductFormula{
				BaseOutputQuantity: "1",
				Components: []bobdomain.ProductFormulaComponent{{
					Material: bobdomain.FormulaMaterialReference{
						ObjectID: refs.product.ObjectID, VersionID: refs.product.VersionID,
					},
					Quantity: "2",
				}},
			},
		},
	)
	approved, _ := advanceToApproved(t, vouchers, voudomain.EntitySelfProduction, voudomain.DraftInput{
		BusinessDate:      "2026-07-24",
		MaterialWarehouse: &refs.warehouse,
		FinishedWarehouse: &refs.warehouse,
		ProductionLines: []voudomain.ProductionOutputInput{{
			Product: &finished, OutputQuantity: "10", LossRate: "5",
			Remark: "成品入库",
			Materials: []voudomain.ProductionMaterialInput{{
				FormulaLineNo: 1, ActualMaterial: refs.product,
				ActualQuantity: "21", AdjustmentReason: "",
			}},
		}},
	})
	finalized, err := vouchers.AssertFinalized(
		t.Context(),
		voudomain.EntitySelfProduction,
		voudomain.DocumentRevisionInput{
			DocumentID: approved.DocumentID,
			Revision:   approved.Revision,
		},
		integrationActorOne,
		"production-finalize",
	)
	if err != nil {
		t.Fatalf("finalize self production: %v", err)
	}

	rows, err := pool.Query(t.Context(), `SELECT product_object_id,quantity_delta_micros
		FROM led_inventory_entries WHERE source_document_id=$1 ORDER BY quantity_delta_micros`,
		finalized.DocumentID)
	if err != nil {
		t.Fatalf("query production postings: %v", err)
	}
	defer rows.Close()
	type posting struct {
		productID string
		quantity  int64
	}
	var postings []posting
	for rows.Next() {
		var item posting
		if err = rows.Scan(&item.productID, &item.quantity); err != nil {
			t.Fatalf("scan production posting: %v", err)
		}
		postings = append(postings, item)
	}
	if err = rows.Err(); err != nil {
		t.Fatalf("iterate production postings: %v", err)
	}
	if len(postings) != 2 ||
		postings[0].productID != refs.product.ObjectID ||
		postings[0].quantity != -21_000_000 ||
		postings[1].productID != finished.ObjectID ||
		postings[1].quantity != 10_000_000 {
		t.Fatalf("production postings = %+v", postings)
	}

	reversed, err := vouchers.Unapprove(
		t.Context(),
		voudomain.EntitySelfProduction,
		voudomain.ReverseInput{
			DocumentID: finalized.DocumentID,
			Revision:   finalized.Revision,
			Reason:     "撤销生产",
		},
		integrationActorOne,
		"production-unfinalize",
	)
	if err != nil || reversed.Status != voudomain.StatusChecked {
		t.Fatalf("unapprove production = %+v, err=%v", reversed, err)
	}
	var remaining int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM led_inventory_entries
		WHERE source_document_id=$1`, finalized.DocumentID).Scan(&remaining); err != nil {
		t.Fatalf("count reversed production postings: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("reversed production postings = %d, want 0", remaining)
	}
}

func TestLEDPurchaseReturnPostsStockOutAndReducesPayableIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, vouchers := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)

	inboundApproved, _ := advancePurchaseInboundToApproved(t, vouchers, refs, "5", "10.00")
	if _, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityPurchaseInbound, voudomain.DocumentRevisionInput{
		DocumentID: inboundApproved.DocumentID, Revision: inboundApproved.Revision,
	}, integrationActorOne, "purchase-return-source-finalize"); err != nil {
		t.Fatalf("finalize purchase return source: %v", err)
	}
	inbound, err := vouchers.Get(t.Context(), voudomain.EntityPurchaseInbound,
		voudomain.GetInput{DocumentID: inboundApproved.DocumentID})
	if err != nil {
		t.Fatal(err)
	}
	returnApproved, _ := advanceToApproved(t, vouchers, voudomain.EntityPurchaseReturn,
		voudomain.DraftInput{
			BusinessDate: "2026-07-24", Warehouse: &refs.warehouse,
			ReturnReason: "质量退货",
			ReturnLines: []voudomain.ReturnLineInput{{
				SourceLineID: inbound.Data.ProductLines[0].LineID, Quantity: "2",
			}},
		})
	if _, err = vouchers.AssertFinalized(t.Context(), voudomain.EntityPurchaseReturn, voudomain.DocumentRevisionInput{
		DocumentID: returnApproved.DocumentID, Revision: returnApproved.Revision,
	}, integrationActorOne, "purchase-return-finalize"); err != nil {
		t.Fatalf("finalize purchase return: %v (cause: %v)", err, errors.Unwrap(err))
	}
	inventory, err := ledger.InventoryBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-07-24"},
	})
	if err != nil || len(inventory.Items) != 1 || inventory.Items[0].Quantity != "3.0" {
		t.Fatalf("purchase return inventory = %+v, err=%v", inventory, err)
	}
	party, err := ledger.PartyBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-07-24"},
	})
	if err != nil || len(party.Items) != 1 || party.Items[0].Amount != "30.00" ||
		party.Items[0].BalanceType != "PAYABLE" {
		t.Fatalf("purchase return payable = %+v, err=%v", party, err)
	}
}

func TestLEDSaleChainSignoffPostsRejectedStockAndSignedReceivableIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, vouchers := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)

	purchaseApproved, _ := advancePurchaseInboundToApproved(t, vouchers, refs, "10", "10.00")
	if _, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityPurchaseInbound, voudomain.DocumentRevisionInput{
		DocumentID: purchaseApproved.DocumentID, Revision: purchaseApproved.Revision,
	}, integrationActorOne, "sale-chain-purchase-finalize"); err != nil {
		t.Fatalf("finalize purchase: %v", err)
	}

	order, orderView := approveSaleOrder(t, vouchers, refs, "6")
	outboundApproved, _ := advanceSaleOutboundToApproved(t, vouchers, refs, order, orderView, "6")
	outbound, err := vouchers.AssertFinalized(t.Context(), voudomain.EntitySaleOutbound, voudomain.DocumentRevisionInput{
		DocumentID: outboundApproved.DocumentID, Revision: outboundApproved.Revision,
	}, integrationActorOne, "sale-chain-outbound-finalize")
	if err != nil {
		t.Fatalf("finalize sale outbound: %v", err)
	}

	deliveryApproved, deliveryView := advanceToApproved(t, vouchers, voudomain.EntitySaleDelivery, voudomain.DraftInput{
		BusinessDate: "2026-07-25", SourceDocumentID: outbound.DocumentID,
		Platform: &refs.platform, Vehicle: &refs.vehicle,
	})
	delivery, err := vouchers.AssertFinalized(t.Context(), voudomain.EntitySaleDelivery, voudomain.DocumentRevisionInput{
		DocumentID: deliveryApproved.DocumentID, Revision: deliveryApproved.Revision,
	}, integrationActorOne, "sale-chain-delivery-finalize")
	if err != nil {
		t.Fatalf("finalize sale delivery: %v", err)
	}

	signoffApproved, signoffView := advanceToApproved(t, vouchers, voudomain.EntitySaleSignoff, voudomain.DraftInput{
		BusinessDate: "2026-07-26", SourceDocumentID: delivery.DocumentID,
		SignoffLines: []voudomain.SaleSignoffLineInput{{
			SourceLineID:   deliveryView.Data.ProductLines[0].LineID,
			SignedQuantity: "4", RejectedQuantity: "1",
		}},
	})
	signoff, err := vouchers.AssertFinalized(t.Context(), voudomain.EntitySaleSignoff, voudomain.DocumentRevisionInput{
		DocumentID: signoffApproved.DocumentID, Revision: signoffApproved.Revision,
	}, integrationActorOne, "sale-chain-signoff-finalize")
	if err != nil {
		t.Fatalf("finalize sale signoff: %v", err)
	}

	var signoffInventoryMicros, signoffReceivableCents int64
	if err = pool.QueryRow(t.Context(), `SELECT COALESCE(sum(quantity_delta_micros),0)
		FROM led_inventory_entries WHERE source_document_id=$1`, signoff.DocumentID).Scan(
		&signoffInventoryMicros,
	); err != nil {
		t.Fatalf("sum signoff inventory entries: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT COALESCE(sum(amount_delta_cents),0)
		FROM led_party_entries WHERE source_document_id=$1`, signoff.DocumentID).Scan(
		&signoffReceivableCents,
	); err != nil {
		t.Fatalf("sum signoff party entries: %v", err)
	}
	if signoffInventoryMicros != 0 {
		t.Fatalf("signoff inventory delta = %d, want rejection inventory deferred to return", signoffInventoryMicros)
	}
	if signoffReceivableCents != 4_800 {
		t.Fatalf("signoff receivable delta = %d, want signed amount 4800", signoffReceivableCents)
	}

	var returnID string
	var returnRevision int64
	if err = pool.QueryRow(t.Context(), `SELECT d.id,d.revision
		FROM vou_documents d JOIN vou_sale_return_details r ON r.document_id=d.id
		WHERE r.source_signoff_id=$1 AND r.return_kind='REFUSAL'`, signoff.DocumentID).
		Scan(&returnID, &returnRevision); err != nil {
		t.Fatalf("load automatic refusal return: %v", err)
	}
	checked, err := vouchers.Check(t.Context(), voudomain.EntitySaleReturn,
		voudomain.DocumentRevisionInput{DocumentID: returnID, Revision: returnRevision},
		integrationActorOne, "refusal-return-check")
	if err != nil {
		t.Fatalf("check refusal return: %v", err)
	}
	approved, err := vouchers.Approve(t.Context(), voudomain.EntitySaleReturn,
		voudomain.DocumentRevisionInput{DocumentID: returnID, Revision: checked.Revision},
		integrationActorOne, "refusal-return-approve")
	if err != nil {
		t.Fatalf("approve refusal return: %v", err)
	}
	if _, err = vouchers.AssertFinalized(t.Context(), voudomain.EntitySaleReturn, voudomain.DocumentRevisionInput{
		DocumentID: returnID, Revision: approved.Revision,
	}, integrationActorOne, "refusal-return-finalize"); err != nil {
		t.Fatalf("finalize refusal return: %v", err)
	}
	var returnInventoryMicros, returnPartyCents int64
	if err = pool.QueryRow(t.Context(), `SELECT COALESCE(sum(quantity_delta_micros),0)
		FROM led_inventory_entries WHERE source_document_id=$1`, returnID).Scan(&returnInventoryMicros); err != nil {
		t.Fatalf("sum return inventory: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT COALESCE(sum(amount_delta_cents),0)
		FROM led_party_entries WHERE source_document_id=$1`, returnID).Scan(&returnPartyCents); err != nil {
		t.Fatalf("sum return party: %v", err)
	}
	if returnInventoryMicros != 1_000_000 || returnPartyCents != 0 {
		t.Fatalf("refusal return posting inventory=%d party=%d", returnInventoryMicros, returnPartyCents)
	}

	afterSaleApproved, _ := advanceToApproved(t, vouchers, voudomain.EntitySaleReturn, voudomain.DraftInput{
		BusinessDate: "2026-07-26", Warehouse: &refs.warehouse, ReturnReason: "客户售后退货",
		ReturnLines: []voudomain.ReturnLineInput{{
			SourceLineID: signoffView.Data.SignoffLines[0].LineID,
			Quantity:     "2",
		}},
	})
	afterSale, err := vouchers.AssertFinalized(t.Context(), voudomain.EntitySaleReturn, voudomain.DocumentRevisionInput{
		DocumentID: afterSaleApproved.DocumentID, Revision: afterSaleApproved.Revision,
	}, integrationActorOne, "after-sale-return-finalize")
	if err != nil {
		t.Fatalf("finalize after-sale return: %v", err)
	}
	var afterSaleInventoryMicros, afterSalePartyCents int64
	if err = pool.QueryRow(t.Context(), `SELECT COALESCE(sum(quantity_delta_micros),0)
		FROM led_inventory_entries WHERE source_document_id=$1`, afterSale.DocumentID).
		Scan(&afterSaleInventoryMicros); err != nil {
		t.Fatalf("sum after-sale return inventory: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT COALESCE(sum(amount_delta_cents),0)
		FROM led_party_entries WHERE source_document_id=$1`, afterSale.DocumentID).
		Scan(&afterSalePartyCents); err != nil {
		t.Fatalf("sum after-sale return party: %v", err)
	}
	if afterSaleInventoryMicros != 2_000_000 || afterSalePartyCents != -2_400 {
		t.Fatalf("after-sale return posting inventory=%d party=%d", afterSaleInventoryMicros, afterSalePartyCents)
	}

	balances, err := ledger.InventoryBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-07-26"},
	})
	if err != nil || len(balances.Items) != 1 || balances.Items[0].Quantity != "7.0" {
		t.Fatalf("inventory balances = %+v, err=%v; want outbound 6 plus finalized returns 3", balances, err)
	}
}

func TestLEDFundPartyAndReopenIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, vouchers := newIntegratedServices(t, pool)
	activated := activateEmptyLedger(t, ledger)

	receiptApproved, _ := advanceToApproved(t, vouchers, voudomain.EntityCustomerReceipt, voudomain.DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "customer",
		Counterparty: &refs.customer, FundAccount: &refs.fundAccount, Handler: &refs.employee, Amount: "100.00",
	})
	receiptExecuted, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityCustomerReceipt, voudomain.DocumentRevisionInput{
		DocumentID: receiptApproved.DocumentID, Revision: receiptApproved.Revision,
	}, integrationActorOne, "receipt-execute")
	if err != nil {
		t.Fatalf("execute receipt: %v", err)
	}
	paymentApproved, _ := advanceToApproved(t, vouchers, voudomain.EntitySupplierPayment, voudomain.DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "supplier",
		Counterparty: &refs.supplier, FundAccount: &refs.fundAccount, Handler: &refs.employee, Amount: "30.00",
	})
	if _, err := vouchers.AssertFinalized(t.Context(), voudomain.EntitySupplierPayment, voudomain.DocumentRevisionInput{
		DocumentID: paymentApproved.DocumentID, Revision: paymentApproved.Revision,
	}, integrationActorOne, "payment-execute"); err != nil {
		t.Fatalf("execute payment: %v", err)
	}
	expenseApproved, _ := advanceToApproved(t, vouchers, voudomain.EntityExpenseReimbursement, voudomain.DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Employee: &refs.employee,
		FundAccount:  &refs.fundAccount,
		ExpenseLines: []voudomain.ExpenseLineInput{{Category: "交通", Description: "测试", Amount: "20.00"}},
	})
	if _, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.DocumentRevisionInput{
		DocumentID: expenseApproved.DocumentID, Revision: expenseApproved.Revision,
	}, integrationActorOne, "expense-execute"); err != nil {
		t.Fatalf("execute expense: %v", err)
	}
	incomeApproved, _ := advanceToApproved(t, vouchers, voudomain.EntityOtherIncome, voudomain.DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", SourceName: "测试收入",
		FundAccount: &refs.fundAccount, Handler: &refs.employee, Amount: "5.00",
	})
	if _, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{
		DocumentID: incomeApproved.DocumentID, Revision: incomeApproved.Revision,
	}, integrationActorOne, "income-execute"); err != nil {
		t.Fatalf("execute other income: %v", err)
	}
	fund, err := ledger.FundBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-07-24"},
	})
	if err != nil || len(fund.Items) != 1 || fund.Items[0].Amount != "75.00" {
		t.Fatalf("fund balances = %+v, err=%v", fund, err)
	}
	party, err := ledger.PartyBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-07-24"},
	})
	if err != nil || len(party.Items) != 2 {
		t.Fatalf("party balances = %+v, err=%v", party, err)
	}
	got := map[string]string{}
	for _, item := range party.Items {
		got[item.CounterpartyType] = item.BalanceType + "/" + item.Amount
	}
	if got["customer"] != "PAYABLE/100.00" || got["supplier"] != "RECEIVABLE/30.00" {
		t.Fatalf("party balances = %v", got)
	}
	receiptCheckedAgain, err := vouchers.Unapprove(
		t.Context(),
		voudomain.EntityCustomerReceipt,
		voudomain.ReverseInput{
			DocumentID: receiptExecuted.DocumentID,
			Revision:   receiptExecuted.Revision,
			Reason:     "重开收款测试",
		},
		integrationActorOne,
		"receipt-delete-postings",
	)
	if err != nil {
		t.Fatalf("unfinalize receipt: %v", err)
	}
	var receiptFundEntries, receiptPartyEntries int
	if err = pool.QueryRow(t.Context(), `SELECT
		(SELECT count(*) FROM led_fund_entries WHERE source_document_id=$1),
		(SELECT count(*) FROM led_party_entries WHERE source_document_id=$1)`,
		receiptExecuted.DocumentID).Scan(&receiptFundEntries, &receiptPartyEntries); err != nil {
		t.Fatal(err)
	}
	if receiptFundEntries != 0 || receiptPartyEntries != 0 {
		t.Fatalf("unfinalized receipt entries = fund:%d party:%d", receiptFundEntries, receiptPartyEntries)
	}
	receiptExecuted, err = vouchers.Approve(
		t.Context(),
		voudomain.EntityCustomerReceipt,
		voudomain.DocumentRevisionInput{
			DocumentID: receiptCheckedAgain.DocumentID,
			Revision:   receiptCheckedAgain.Revision,
		},
		integrationActorOne,
		"receipt-reapprove",
	)
	if err != nil {
		t.Fatalf("reapprove receipt: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT
		(SELECT count(*) FROM led_fund_entries WHERE source_document_id=$1),
		(SELECT count(*) FROM led_party_entries WHERE source_document_id=$1)`,
		receiptExecuted.DocumentID).Scan(&receiptFundEntries, &receiptPartyEntries); err != nil {
		t.Fatal(err)
	}
	if receiptFundEntries != 1 || receiptPartyEntries != 1 {
		t.Fatalf("refinalized receipt entries = fund:%d party:%d", receiptFundEntries, receiptPartyEntries)
	}
	reopened, err := ledger.Reopen(t.Context(), ReopenInput{
		Revision: activated.Revision, Reason: "调整启用日",
	}, integrationActorOne, "ledger-reopen")
	if err != nil || reopened.Status != StatusReopening {
		t.Fatalf("reopen ledger = %+v, err=%v", reopened, err)
	}
	if _, err = ledger.FundBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-07-24"},
	}); err == nil {
		t.Fatal("ledger query succeeded during maintenance")
	}
	cancelled, err := ledger.CancelReopen(t.Context(), RevisionInput{Revision: reopened.Revision},
		integrationActorOne, "ledger-cancel-reopen")
	if err != nil || cancelled.GenerationID != activated.GenerationID {
		t.Fatalf("cancel reopen = %+v, err=%v", cancelled, err)
	}

	reopened, err = ledger.Reopen(t.Context(), ReopenInput{
		Revision: cancelled.Revision, Reason: "推迟启用日并重建",
	}, integrationActorOne, "ledger-reopen-again")
	if err != nil {
		t.Fatalf("reopen ledger again: %v", err)
	}
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityCustomerReceipt, voudomain.ReverseInput{
		DocumentID: receiptExecuted.DocumentID, Revision: receiptExecuted.Revision, Reason: "维护模式验证",
	}, integrationActorOne, "receipt-unexecute-maintenance"); err == nil {
		t.Fatal("maintenance mode allowed VOU unexecute")
	}
	saved, err := ledger.SaveOpening(t.Context(), OpeningSaveInput{
		Revision: reopened.Revision, CutoverDate: "2026-07-25",
		Inventory: []InventoryOpeningInput{}, Fund: []FundOpeningInput{}, Party: []PartyOpeningInput{},
	}, integrationActorOne, "ledger-save-reopen")
	if err != nil {
		t.Fatalf("save reopened ledger: %v", err)
	}
	rebuilt, err := ledger.Activate(t.Context(), RevisionInput{Revision: saved.Revision},
		integrationActorOne, "ledger-reactivate")
	if err != nil {
		t.Fatalf("reactivate ledger: %v", err)
	}
	if rebuilt.GenerationID == activated.GenerationID {
		t.Fatal("reactivation reused the previous generation")
	}
	fund, err = ledger.FundBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-07-25"},
	})
	if err != nil || len(fund.Items) != 0 {
		t.Fatalf("rebuilt fund balances = %+v, err=%v; want cutover-excluded empty balance", fund, err)
	}
	var oldStatus, newStatus string
	if err = pool.QueryRow(t.Context(), `
		SELECT old_generation.status, new_generation.status
		FROM led_generations old_generation, led_generations new_generation
		WHERE old_generation.id = $1 AND new_generation.id = $2
	`, activated.GenerationID, rebuilt.GenerationID).Scan(&oldStatus, &newStatus); err != nil {
		t.Fatalf("read generation statuses: %v", err)
	}
	if oldStatus != "ARCHIVED" || newStatus != "ACTIVE" {
		t.Fatalf("generation statuses = %s/%s", oldStatus, newStatus)
	}
}

func TestEmployeeLoanRepaymentAndWriteoffIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, vouchers := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)

	loan, _ := advanceToApproved(t, vouchers, voudomain.EntityEmployeeLoan, voudomain.DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Counterparty: &refs.employee,
		FundAccount: &refs.fundAccount, Handler: &refs.employee, Amount: "100.00",
	})
	loanFinalized, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityEmployeeLoan, voudomain.DocumentRevisionInput{
		DocumentID: loan.DocumentID, Revision: loan.Revision,
	}, integrationActorOne, "employee-loan-finalize")
	if err != nil {
		t.Fatalf("finalize employee loan: %v", err)
	}

	repayment, _ := advanceToApproved(t, vouchers, voudomain.EntityEmployeeRepayment, voudomain.DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Counterparty: &refs.employee,
		FundAccount: &refs.fundAccount, Handler: &refs.employee, Amount: "30.00",
	})
	if _, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityEmployeeRepayment, voudomain.DocumentRevisionInput{
		DocumentID: repayment.DocumentID, Revision: repayment.Revision,
	}, integrationActorOne, "employee-repayment-finalize"); err != nil {
		t.Fatalf("finalize employee repayment: %v", err)
	}

	writeoff, _ := advanceToApproved(t, vouchers, voudomain.EntityEmployeeLoanWriteoff, voudomain.DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Employee: &refs.employee,
		ExpenseLines: []voudomain.ExpenseLineInput{
			{Category: "差旅", Description: "员工借款核销", Amount: "40.00"},
			{Category: "交通", Description: "员工借款核销", Amount: "10.00"},
		},
	})
	writeoffFinalized, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityEmployeeLoanWriteoff, voudomain.DocumentRevisionInput{
		DocumentID: writeoff.DocumentID, Revision: writeoff.Revision,
	}, integrationActorOne, "employee-writeoff-finalize")
	if err != nil {
		t.Fatalf("finalize employee loan writeoff: %v", err)
	}

	fund, err := ledger.FundBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-07-24"},
	})
	if err != nil || len(fund.Items) != 1 || fund.Items[0].BalanceType != "OVERDRAFT" || fund.Items[0].Amount != "70.00" {
		t.Fatalf("employee fund balance = %+v, err=%v", fund, err)
	}
	party, err := ledger.PartyBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-07-24"},
	}, EntityEmployee)
	if err != nil || len(party.Items) != 1 || party.Items[0].BalanceType != "RECEIVABLE" || party.Items[0].Amount != "20.00" {
		t.Fatalf("employee party balance = %+v, err=%v", party, err)
	}

	excess, _ := advanceToChecked(t, vouchers, voudomain.EntityEmployeeLoanWriteoff, voudomain.DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Employee: &refs.employee,
		ExpenseLines: []voudomain.ExpenseLineInput{{Category: "差旅", Description: "超额核销", Amount: "20.01"}},
	})
	if _, err = vouchers.Approve(t.Context(), voudomain.EntityEmployeeLoanWriteoff, voudomain.DocumentRevisionInput{
		DocumentID: excess.DocumentID, Revision: excess.Revision,
	}, integrationActorOne, "employee-writeoff-excess"); err == nil {
		t.Fatal("employee loan writeoff exceeded the as-of-date balance")
	}
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityEmployeeLoan, voudomain.ReverseInput{
		DocumentID: loanFinalized.DocumentID, Revision: loanFinalized.Revision, Reason: "借款撤回测试",
	}, integrationActorOne, "employee-loan-unfinalize-with-writeoff"); err == nil {
		t.Fatal("employee loan reversal invalidated a later writeoff")
	}
	party, err = ledger.PartyBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-07-24"},
	}, EntityEmployee)
	if err != nil || len(party.Items) != 1 || party.Items[0].Amount != "20.00" {
		t.Fatalf("employee balance after rejected loan reversal = %+v, err=%v", party, err)
	}

	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityEmployeeLoanWriteoff, voudomain.ReverseInput{
		DocumentID: writeoffFinalized.DocumentID, Revision: writeoffFinalized.Revision, Reason: "核销撤回测试",
	}, integrationActorOne, "employee-writeoff-unfinalize"); err != nil {
		t.Fatalf("unfinalize employee loan writeoff: %v", err)
	}
	party, err = ledger.PartyBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-07-24"},
	}, EntityEmployee)
	if err != nil || len(party.Items) != 1 || party.Items[0].Amount != "70.00" {
		t.Fatalf("employee balance after writeoff reversal = %+v, err=%v", party, err)
	}
}

func TestBillReceiptPostingAndReversalIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, vouchers := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)

	primary := voudomain.BillLineInput{
		PositionType: "ASSET", Direction: "IN", Purpose: "PRIMARY",
		BillType: "BANK_ACCEPTANCE", BillNo: "BRE-001", Medium: "ELECTRONIC",
		Currency: "CNY", FaceAmount: "1000000.00", IssueDate: "2026-08-01",
		MaturityDate: "2026-09-01", Drawer: "出票人", Acceptor: "承兑行",
		Payee: "本公司", AnnualRateBps: 600,
	}
	receiptDraft := voudomain.DraftInput{
		BusinessDate: "2026-08-01", Currency: "CNY", Counterparty: &refs.customer,
		Handler: &refs.employee, InternalCostRateBps: 365, BillLines: []voudomain.BillLineInput{primary},
		BillCashLines: []voudomain.BillCashLineInput{{
			FundAccount: refs.fundAccount, Direction: "OUT", AmountType: "OTHER", Amount: "100.00",
		}},
	}
	created, err := vouchers.Create(t.Context(), voudomain.EntityBillReceipt, voudomain.CreateInput{
		Data: receiptDraft,
	}, integrationActorOne, "bill-receipt-create")
	if err != nil {
		t.Fatalf("create bill receipt: %v", err)
	}
	saved, err := vouchers.Save(t.Context(), voudomain.EntityBillReceipt, voudomain.SaveInput{
		DocumentID: created.DocumentID, Revision: created.Revision, Data: receiptDraft,
	}, integrationActorOne, "bill-receipt-save")
	if err != nil {
		t.Fatalf("save bill receipt: %v", err)
	}
	if _, err = vouchers.Save(t.Context(), voudomain.EntityBillReceipt, voudomain.SaveInput{
		DocumentID: created.DocumentID, Revision: created.Revision, Data: receiptDraft,
	}, integrationActorOne, "bill-receipt-stale-save"); err == nil {
		t.Fatal("stale bill receipt save succeeded")
	}
	checked, err := vouchers.Check(t.Context(), voudomain.EntityBillReceipt, voudomain.DocumentRevisionInput{
		DocumentID: saved.DocumentID, Revision: saved.Revision,
	}, integrationActorOne, "bill-receipt-check")
	if err != nil {
		t.Fatalf("check bill receipt: %v", err)
	}
	receipt, err := vouchers.Approve(t.Context(), voudomain.EntityBillReceipt, voudomain.DocumentRevisionInput{
		DocumentID: checked.DocumentID, Revision: checked.Revision,
	}, integrationActorOne, "bill-receipt-approve")
	if err != nil {
		t.Fatalf("approve bill receipt: %v", err)
	}
	receiptView, err := vouchers.Get(t.Context(), voudomain.EntityBillReceipt, voudomain.GetInput{
		DocumentID: receipt.DocumentID,
	})
	if err != nil {
		t.Fatalf("get bill receipt: %v", err)
	}
	finalized, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityBillReceipt, voudomain.DocumentRevisionInput{
		DocumentID: receipt.DocumentID, Revision: receipt.Revision,
	}, integrationActorOne, "bill-receipt-finalize")
	if err != nil {
		t.Fatalf("finalize bill receipt: %v", err)
	}
	bills, err := ledger.QueryBills(t.Context(), BillQueryInput{
		Page: 1, PageSize: 20, Filters: BillQueryFilters{Availability: "AVAILABLE", CustomerObjectID: refs.customer.ObjectID},
		Sort: []SortInput{{Field: "maturityDate", Order: "asc"}},
	})
	if err != nil || bills.Total != 1 || len(bills.Items) != 1 || bills.Items[0].CustomerCostAmount != "3100.00" {
		t.Fatalf("bill ledger after finalize = %+v, err=%v", bills, err)
	}
	duplicate, _ := advanceToChecked(t, vouchers, voudomain.EntityBillReceipt, voudomain.DraftInput{
		BusinessDate: "2026-08-01", Currency: "CNY", Counterparty: &refs.customer,
		Handler: &refs.employee, BillLines: []voudomain.BillLineInput{primary},
	})
	if _, err = vouchers.Approve(t.Context(), voudomain.EntityBillReceipt, voudomain.DocumentRevisionInput{
		DocumentID: duplicate.DocumentID, Revision: duplicate.Revision,
	}, integrationActorOne, "bill-receipt-duplicate-approve"); err == nil || err.Error() != "duplicate bill" {
		t.Fatalf("duplicate bill approval error = %v, want duplicate bill", err)
	}
	party, err := ledger.PartyBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-08-01", ObjectID: refs.customer.ObjectID},
	}, EntityCustomer)
	if err != nil || len(party.Items) != 1 || party.Items[0].BalanceType != "PAYABLE" || party.Items[0].Amount != "999900.00" {
		t.Fatalf("customer balance after bill receipt = %+v, err=%v", party, err)
	}
	fund, err := ledger.FundBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-08-01", ObjectID: refs.fundAccount.ObjectID},
	})
	if err != nil || len(fund.Items) != 1 || fund.Items[0].BalanceType != "OVERDRAFT" || fund.Items[0].Amount != "100.00" {
		t.Fatalf("fund balance after bill receipt = %+v, err=%v", fund, err)
	}

	changeBillID := receiptView.Data.BillLines[0].BillID
	secondPrimary := primary
	secondPrimary.BillNo = "BRE-002"
	secondPrimary.FaceAmount = "1100000.00"
	second, _ := advanceToApproved(t, vouchers, voudomain.EntityBillReceipt, voudomain.DraftInput{
		BusinessDate: "2026-08-02", Currency: "CNY", Counterparty: &refs.customer,
		Handler: &refs.employee, InternalCostRateBps: 365,
		BillLines: []voudomain.BillLineInput{
			secondPrimary,
			{BillID: changeBillID, Purpose: "CHANGE"},
		},
	})
	secondFinalized, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityBillReceipt, voudomain.DocumentRevisionInput{
		DocumentID: second.DocumentID, Revision: second.Revision,
	}, integrationActorOne, "bill-receipt-change-finalize")
	if err != nil {
		t.Fatalf("finalize bill receipt with bill change: %v", err)
	}
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityBillReceipt, voudomain.ReverseInput{
		DocumentID: finalized.DocumentID, Revision: finalized.Revision, Reason: "应被下游占用阻止",
	}, integrationActorOne, "bill-receipt-source-reverse-blocked"); err == nil {
		t.Fatal("source bill receipt reversal succeeded with downstream bill entry")
	}
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityBillReceipt, voudomain.ReverseInput{
		DocumentID: secondFinalized.DocumentID, Revision: secondFinalized.Revision, Reason: "撤回找零单",
	}, integrationActorOne, "bill-receipt-change-reverse"); err != nil {
		t.Fatalf("unfinalize downstream bill receipt: %v", err)
	}
	reversedSource, err := vouchers.Unapprove(t.Context(), voudomain.EntityBillReceipt, voudomain.ReverseInput{
		DocumentID: finalized.DocumentID, Revision: finalized.Revision, Reason: "撤回来源收票单",
	}, integrationActorOne, "bill-receipt-source-reverse")
	if err != nil {
		t.Fatalf("unfinalize source bill receipt: %v", err)
	}
	party, err = ledger.PartyBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-08-02", ObjectID: refs.customer.ObjectID},
	}, EntityCustomer)
	if err != nil || len(party.Items) != 0 {
		t.Fatalf("customer balance after bill reversals = %+v, err=%v", party, err)
	}
	fund, err = ledger.FundBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-08-02", ObjectID: refs.fundAccount.ObjectID},
	})
	if err != nil || len(fund.Items) != 0 {
		t.Fatalf("fund balance after bill reversals = %+v, err=%v", fund, err)
	}
	draftAgain, err := vouchers.Uncheck(t.Context(), voudomain.EntityBillReceipt, voudomain.ReverseInput{
		DocumentID: reversedSource.DocumentID, Revision: reversedSource.Revision, Reason: "退回草稿态",
	}, integrationActorOne, "bill-receipt-uncheck-after-history")
	if err != nil {
		t.Fatalf("uncheck historical bill receipt: %v", err)
	}
	resaved, err := vouchers.Save(t.Context(), voudomain.EntityBillReceipt, voudomain.SaveInput{
		DocumentID: draftAgain.DocumentID, Revision: draftAgain.Revision, Data: receiptDraft,
	}, integrationActorOne, "bill-receipt-resave-after-reversal")
	if err != nil {
		t.Fatalf("resave reversed bill receipt: %v", err)
	}
	rechecked, err := vouchers.Check(t.Context(), voudomain.EntityBillReceipt, voudomain.DocumentRevisionInput{
		DocumentID: resaved.DocumentID, Revision: resaved.Revision,
	}, integrationActorOne, "bill-receipt-recheck-after-reversal")
	if err != nil {
		t.Fatalf("recheck reversed bill receipt: %v", err)
	}
	reapproved, err := vouchers.Approve(t.Context(), voudomain.EntityBillReceipt, voudomain.DocumentRevisionInput{
		DocumentID: rechecked.DocumentID, Revision: rechecked.Revision,
	}, integrationActorOne, "bill-receipt-reapprove-after-reversal")
	if err != nil {
		t.Fatalf("reapprove reversed bill receipt: %v", err)
	}
	refinalized, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityBillReceipt, voudomain.DocumentRevisionInput{
		DocumentID: reapproved.DocumentID, Revision: reapproved.Revision,
	}, integrationActorOne, "bill-receipt-refinalize-after-reversal")
	if err != nil {
		t.Fatalf("refinalize reversed bill receipt: %v", err)
	}
	checkedAgain, err := vouchers.Unapprove(t.Context(), voudomain.EntityBillReceipt, voudomain.ReverseInput{
		DocumentID: refinalized.DocumentID, Revision: refinalized.Revision, Reason: "再次撤回",
	}, integrationActorOne, "bill-receipt-reverse-after-refinalize")
	if err != nil {
		t.Fatalf("unfinalize refinalized bill receipt: %v", err)
	}
	draftAgain, err = vouchers.Uncheck(t.Context(), voudomain.EntityBillReceipt, voudomain.ReverseInput{
		DocumentID: checkedAgain.DocumentID, Revision: checkedAgain.Revision, Reason: "再次退回草稿态",
	}, integrationActorOne, "bill-receipt-uncheck-after-refinalize")
	if err != nil {
		t.Fatalf("uncheck refinalized bill receipt: %v", err)
	}
	if _, err = vouchers.Delete(t.Context(), voudomain.EntityBillReceipt, voudomain.DeleteInput{
		DocumentID: draftAgain.DocumentID, Revision: draftAgain.Revision, Reason: "删除已撤回票据",
	}, integrationActorOne, "bill-receipt-delete-after-reversal"); err != nil {
		t.Fatalf("delete reversed bill receipt: %v", err)
	}
	freshDraft, err := vouchers.Create(t.Context(), voudomain.EntityBillReceipt, voudomain.CreateInput{
		Data: voudomain.DraftInput{
			BusinessDate: "2026-08-03", Currency: "CNY", Counterparty: &refs.customer,
			Handler: &refs.employee, BillLines: []voudomain.BillLineInput{{
				PositionType: "ASSET", Direction: "IN", Purpose: "PRIMARY",
				BillType: "CHECK", BillNo: "BRE-DRAFT-DELETE", Medium: "PAPER",
				Currency: "CNY", FaceAmount: "1.00", IssueDate: "2026-08-03",
				MaturityDate: "2026-08-03", Drawer: "出票人", Acceptor: "承兑人",
				Payee: "本公司",
			}},
		},
	}, integrationActorOne, "bill-receipt-fresh-draft-create")
	if err != nil {
		t.Fatalf("create fresh bill draft: %v", err)
	}
	if _, err = vouchers.Delete(t.Context(), voudomain.EntityBillReceipt, voudomain.DeleteInput{
		DocumentID: freshDraft.DocumentID, Revision: freshDraft.Revision, Reason: "删除未入账草稿",
	}, integrationActorOne, "bill-receipt-fresh-draft-delete"); err != nil {
		t.Fatalf("delete fresh bill draft: %v", err)
	}
}

func TestBillReceiptConcurrentChangeAllowsOneWinnerIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, vouchers := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)

	base := voudomain.BillLineInput{
		PositionType: "ASSET", Direction: "IN", Purpose: "PRIMARY",
		BillType: "BANK_ACCEPTANCE", BillNo: "BRE-CONC-SOURCE", Medium: "ELECTRONIC",
		Currency: "CNY", FaceAmount: "100.00", IssueDate: "2026-08-01",
		MaturityDate: "2026-09-01", Drawer: "出票人", Acceptor: "承兑行",
		Payee: "本公司", AnnualRateBps: 0,
	}
	source, sourceView := advanceToApproved(t, vouchers, voudomain.EntityBillReceipt, voudomain.DraftInput{
		BusinessDate: "2026-08-01", Currency: "CNY", Counterparty: &refs.customer,
		Handler: &refs.employee, BillLines: []voudomain.BillLineInput{base},
	})
	if _, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityBillReceipt, voudomain.DocumentRevisionInput{
		DocumentID: source.DocumentID, Revision: source.Revision,
	}, integrationActorOne, "bill-concurrent-source-finalize"); err != nil {
		t.Fatalf("finalize source bill: %v", err)
	}
	sourceBillID := sourceView.Data.BillLines[0].BillID

	contenders := make([]voudomain.MutationResult, 0, 2)
	for _, billNo := range []string{"BRE-CONC-A", "BRE-CONC-B"} {
		primary := base
		primary.BillNo = billNo
		primary.FaceAmount = "101.00"
		checked, _ := advanceToChecked(t, vouchers, voudomain.EntityBillReceipt, voudomain.DraftInput{
			BusinessDate: "2026-08-02", Currency: "CNY", Counterparty: &refs.customer,
			Handler: &refs.employee, BillLines: []voudomain.BillLineInput{
				primary, {BillID: sourceBillID, Purpose: "CHANGE"},
			},
		})
		contenders = append(contenders, checked)
	}
	type finalizeResult struct {
		mutation voudomain.MutationResult
		err      error
	}
	results := make(chan finalizeResult, len(contenders))
	for _, contender := range contenders {
		go func(item voudomain.MutationResult) {
			mutation, finalizeErr := vouchers.Approve(context.Background(), voudomain.EntityBillReceipt, voudomain.DocumentRevisionInput{
				DocumentID: item.DocumentID, Revision: item.Revision,
			}, integrationActorOne, "bill-concurrent-change-approve-"+item.DocumentID)
			results <- finalizeResult{mutation: mutation, err: finalizeErr}
		}(contender)
	}
	var winner voudomain.MutationResult
	successes := 0
	for range contenders {
		result := <-results
		if result.err == nil {
			successes++
			winner = result.mutation
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent bill change successes = %d, want 1", successes)
	}
	if _, err := vouchers.Unapprove(t.Context(), voudomain.EntityBillReceipt, voudomain.ReverseInput{
		DocumentID: winner.DocumentID, Revision: winner.Revision, Reason: "释放并发占用票据",
	}, integrationActorOne, "bill-concurrent-winner-unfinalize"); err != nil {
		t.Fatalf("unfinalize concurrent winner: %v", err)
	}
	bills, err := ledger.QueryBills(t.Context(), BillQueryInput{
		Page: 1, PageSize: 20, Filters: BillQueryFilters{Availability: "AVAILABLE"},
	})
	if err != nil {
		t.Fatalf("query bills after concurrent reversal: %v", err)
	}
	foundSource := false
	for _, bill := range bills.Items {
		foundSource = foundSource || bill.BillID == sourceBillID
	}
	if !foundSource {
		t.Fatal("source bill did not become available after winner reversal")
	}
}

func TestBillPaymentUsesAvailableBillAndReversalRestoresAvailabilityIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, vouchers := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)

	source, sourceView := advanceToApproved(t, vouchers, voudomain.EntityBillReceipt, voudomain.DraftInput{
		BusinessDate: "2026-08-01", Currency: "CNY", Counterparty: &refs.customer, Handler: &refs.employee,
		BillLines: []voudomain.BillLineInput{{
			PositionType: "ASSET", Direction: "IN", Purpose: "PRIMARY", BillType: "BANK_ACCEPTANCE",
			BillNo: "BILL-PAY-SOURCE", Medium: "ELECTRONIC", Currency: "CNY", FaceAmount: "100.00",
			IssueDate: "2026-08-01", MaturityDate: "2026-09-01", Drawer: "出票人", Acceptor: "承兑行", Payee: "本公司",
		}},
	})
	if _, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityBillReceipt, voudomain.DocumentRevisionInput{
		DocumentID: source.DocumentID, Revision: source.Revision,
	}, integrationActorOne, "bill-payment-source-finalize"); err != nil {
		t.Fatalf("finalize source receipt: %v", err)
	}
	billID := sourceView.Data.BillLines[0].BillID
	createPayment := func() voudomain.MutationResult {
		checked, _ := advanceToChecked(t, vouchers, voudomain.EntityBillPayment, voudomain.DraftInput{
			BusinessDate: "2026-08-02", Currency: "CNY", Supplier: &refs.supplier,
			BillLines: []voudomain.BillLineInput{{BillID: billID, Purpose: "PRIMARY"}},
		})
		return checked
	}
	contenders := []voudomain.MutationResult{createPayment(), createPayment()}
	type result struct {
		mutation voudomain.MutationResult
		err      error
	}
	results := make(chan result, len(contenders))
	for _, contender := range contenders {
		go func(item voudomain.MutationResult) {
			mutation, err := vouchers.Approve(context.Background(), voudomain.EntityBillPayment, voudomain.DocumentRevisionInput{
				DocumentID: item.DocumentID, Revision: item.Revision,
			}, integrationActorOne, "bill-payment-concurrent-approve-"+item.DocumentID)
			results <- result{mutation: mutation, err: err}
		}(contender)
	}
	var winner voudomain.MutationResult
	successes := 0
	for range contenders {
		outcome := <-results
		if outcome.err == nil {
			successes++
			winner = outcome.mutation
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent bill payment successes = %d, want 1", successes)
	}
	supplier, err := ledger.PartyBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-08-02", ObjectID: refs.supplier.ObjectID},
	}, EntitySupplier)
	if err != nil || len(supplier.Items) != 1 || supplier.Items[0].BalanceType != "RECEIVABLE" || supplier.Items[0].Amount != "100.00" {
		t.Fatalf("supplier balance after bill payment = %+v, err=%v", supplier, err)
	}
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityBillPayment, voudomain.ReverseInput{
		DocumentID: winner.DocumentID, Revision: winner.Revision, Reason: "撤回付票",
	}, integrationActorOne, "bill-payment-unfinalize"); err != nil {
		t.Fatalf("unfinalize bill payment: %v", err)
	}
	bills, err := ledger.QueryBills(t.Context(), BillQueryInput{
		Page: 1, PageSize: 20, Filters: BillQueryFilters{Availability: "AVAILABLE"},
	})
	if err != nil {
		t.Fatalf("query bills after payment reversal: %v", err)
	}
	available := false
	for _, bill := range bills.Items {
		available = available || bill.BillID == billID
	}
	if !available {
		t.Fatal("bill did not become available after bill payment reversal")
	}
}

func TestBillIssuePostsLiabilitySupplierInterestAndActualCashIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	other := createApprovedReference(t, bobdomain.NewService(pool), bobdomain.EntityOtherParty, bobdomain.CreateDetailInput{
		Code: "LO" + newID(), Name: "LED 计息方", SalespersonEmployeeID: refs.employee.ObjectID,
	})
	ledger, vouchers := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)
	issue, _ := advanceToApproved(t, vouchers, voudomain.EntityBillIssue, voudomain.DraftInput{
		BusinessDate: "2026-08-01", Currency: "CNY", Supplier: &refs.supplier,
		InterestMode: "THIRD_PARTY_PAYABLE", InterestParty: &other,
		BillLines: []voudomain.BillLineInput{{
			PositionType: "LIABILITY", Direction: "IN", Purpose: "PRIMARY", BillType: "BANK_ACCEPTANCE",
			BillNo: "BILL-ISSUE-001", Medium: "ELECTRONIC", Currency: "CNY", FaceAmount: "100.00",
			IssueDate: "2026-08-01", MaturityDate: "2027-08-01", Drawer: "本公司", Acceptor: "承兑行", Payee: "供应商", AnnualRateBps: 365,
		}},
		BillCashLines: []voudomain.BillCashLineInput{{
			FundAccount: refs.fundAccount, Direction: "IN", AmountType: "MARGIN", Amount: "5.00",
		}},
	})
	finalized, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityBillIssue, voudomain.DocumentRevisionInput{
		DocumentID: issue.DocumentID, Revision: issue.Revision,
	}, integrationActorOne, "bill-issue-finalize")
	if err != nil {
		t.Fatalf("finalize bill issue: %v", err)
	}
	supplier, err := ledger.PartyBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-08-01", ObjectID: refs.supplier.ObjectID},
	}, EntitySupplier)
	if err != nil || len(supplier.Items) != 1 || supplier.Items[0].BalanceType != "RECEIVABLE" || supplier.Items[0].Amount != "100.00" {
		t.Fatalf("supplier balance after bill issue = %+v, err=%v", supplier, err)
	}
	interest, err := ledger.PartyBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-08-01", ObjectID: other.ObjectID},
	}, bobdomain.EntityOtherParty)
	if err != nil || len(interest.Items) != 1 || interest.Items[0].BalanceType != "PAYABLE" || interest.Items[0].Amount != "3.65" {
		t.Fatalf("interest party balance after bill issue = %+v, err=%v", interest, err)
	}
	fund, err := ledger.FundBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-08-01", ObjectID: refs.fundAccount.ObjectID},
	})
	if err != nil || len(fund.Items) != 1 || fund.Items[0].BalanceType != "POSITIVE" || fund.Items[0].Amount != "5.00" {
		t.Fatalf("fund balance after bill issue = %+v, err=%v", fund, err)
	}
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityBillIssue, voudomain.ReverseInput{
		DocumentID: finalized.DocumentID, Revision: finalized.Revision, Reason: "撤回开票",
	}, integrationActorOne, "bill-issue-unfinalize"); err != nil {
		t.Fatalf("unfinalize bill issue: %v", err)
	}
}

func TestBillDiscountPostsActualCashAndThirdPartyInterestIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	other := createApprovedReference(t, bobdomain.NewService(pool), bobdomain.EntityOtherParty, bobdomain.CreateDetailInput{
		Code: "LD" + newID(), Name: "贴现方", SalespersonEmployeeID: refs.employee.ObjectID,
	})
	ledger, vouchers := newIntegratedServices(t, pool)
	activated := activateEmptyLedger(t, ledger)
	source, sourceView := advanceToApproved(t, vouchers, voudomain.EntityBillReceipt, voudomain.DraftInput{
		BusinessDate: "2026-08-01", Currency: "CNY", Counterparty: &refs.customer, Handler: &refs.employee,
		BillLines: []voudomain.BillLineInput{{PositionType: "ASSET", Direction: "IN", Purpose: "PRIMARY", BillType: "BANK_ACCEPTANCE", BillNo: "BILL-DISCOUNT-SOURCE", Medium: "ELECTRONIC", Currency: "CNY", FaceAmount: "100.00", IssueDate: "2026-08-01", MaturityDate: "2027-08-01", Drawer: "出票人", Acceptor: "承兑行", Payee: "本公司"}},
	})
	sourceFinalized, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityBillReceipt, voudomain.DocumentRevisionInput{DocumentID: source.DocumentID, Revision: source.Revision}, integrationActorOne, "bill-discount-source-finalize")
	if err != nil {
		t.Fatalf("finalize discount source: %v", err)
	}
	listed, err := vouchers.Query(t.Context(), voudomain.EntityBillReceipt, voudomain.QueryInput{
		Page: 1, PageSize: 20, Filters: voudomain.QueryFilters{PartyObjectID: refs.customer.ObjectID},
		Sort: []voudomain.SortInput{{Field: "documentNo", Order: "desc"}},
	})
	if err != nil || len(listed.Items) != 1 || sourceView.Data.Counterparty == nil || listed.Items[0].PartyName != sourceView.Data.Counterparty.Name {
		t.Fatalf("query bill receipt by party = %+v, err=%v", listed, err)
	}
	if _, err = vouchers.Create(t.Context(), voudomain.EntityBillDiscount, voudomain.CreateInput{Data: voudomain.DraftInput{
		BusinessDate: "2026-08-02", Currency: "USD", CounterpartyType: "other-party", Counterparty: &other, InterestMode: "BANK_DEDUCTED",
		BillLines: []voudomain.BillLineInput{{BillID: sourceView.Data.BillLines[0].BillID, Purpose: "PRIMARY", AnnualRateBps: 365}},
	}}, integrationActorOne, "bill-discount-currency-mismatch"); err == nil || !strings.Contains(err.Error(), "source bill currency must match document currency") {
		t.Fatalf("create bill discount with mismatched currency error = %v", err)
	}
	discount, _ := advanceToApproved(t, vouchers, voudomain.EntityBillDiscount, voudomain.DraftInput{
		BusinessDate: "2026-08-02", Currency: "CNY", CounterpartyType: "other-party", Counterparty: &other,
		InterestMode: "THIRD_PARTY_PAYABLE", InterestParty: &other,
		BillLines:     []voudomain.BillLineInput{{BillID: sourceView.Data.BillLines[0].BillID, Purpose: "PRIMARY", AnnualRateBps: 365}},
		BillCashLines: []voudomain.BillCashLineInput{{FundAccount: refs.fundAccount, Direction: "IN", AmountType: "PRINCIPAL", Amount: "96.35"}},
	})
	discountView, err := vouchers.Get(t.Context(), voudomain.EntityBillDiscount, voudomain.GetInput{DocumentID: discount.DocumentID})
	if err != nil || discountView.Data.Counterparty == nil || discountView.Data.Counterparty.Entity != bobdomain.EntityOtherParty {
		t.Fatalf("discount counterparty snapshot = %+v, err=%v", discountView.Data.Counterparty, err)
	}
	finalized, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityBillDiscount, voudomain.DocumentRevisionInput{DocumentID: discount.DocumentID, Revision: discount.Revision}, integrationActorOne, "bill-discount-finalize")
	if err != nil {
		t.Fatalf("finalize bill discount: %v", err)
	}
	fund, err := ledger.FundBalance(t.Context(), BalanceInput{Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-08-02", ObjectID: refs.fundAccount.ObjectID}})
	if err != nil || len(fund.Items) != 1 || fund.Items[0].Amount != "96.35" {
		t.Fatalf("discount fund balance = %+v, err=%v", fund, err)
	}
	interest, err := ledger.PartyBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-08-02", ObjectID: other.ObjectID},
	}, bobdomain.EntityOtherParty)
	if err != nil || len(interest.Items) != 1 || interest.Items[0].BalanceType != "PAYABLE" || interest.Items[0].Amount != "3.64" {
		t.Fatalf("discount interest balance = %+v, err=%v", interest, err)
	}
	reopened, err := ledger.Reopen(t.Context(), ReopenInput{Revision: activated.Revision, Reason: "重放票据贴现"}, integrationActorOne, "bill-discount-reopen")
	if err != nil {
		t.Fatalf("reopen ledger with bill discount: %v", err)
	}
	saved, err := ledger.SaveOpening(t.Context(), OpeningSaveInput{Revision: reopened.Revision, CutoverDate: "2026-01-01", Inventory: []InventoryOpeningInput{}, Fund: []FundOpeningInput{}, Party: []PartyOpeningInput{}}, integrationActorOne, "bill-discount-reopen-save")
	if err != nil {
		t.Fatalf("save reopened ledger with bill discount: %v", err)
	}
	if _, err = ledger.Activate(t.Context(), RevisionInput{Revision: saved.Revision}, integrationActorOne, "bill-discount-reactivate"); err != nil {
		t.Fatalf("reactivate ledger with bill discount: %v", err)
	}
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityBillDiscount, voudomain.ReverseInput{DocumentID: finalized.DocumentID, Revision: finalized.Revision, Reason: "撤回贴现"}, integrationActorOne, "bill-discount-unfinalize"); err != nil {
		t.Fatalf("unfinalize bill discount: %v", err)
	}
	billOnly, _ := advanceToApproved(t, vouchers, voudomain.EntityBillDiscount, voudomain.DraftInput{
		BusinessDate: "2026-08-03", Currency: "CNY", CounterpartyType: "other-party", Counterparty: &other, InterestMode: "BANK_DEDUCTED",
		BillLines: []voudomain.BillLineInput{{BillID: sourceView.Data.BillLines[0].BillID, Purpose: "PRIMARY", AnnualRateBps: 365}},
	})
	billOnlyFinalized, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityBillDiscount, voudomain.DocumentRevisionInput{DocumentID: billOnly.DocumentID, Revision: billOnly.Revision}, integrationActorOne, "bill-only-discount-finalize")
	if err != nil {
		t.Fatalf("finalize bill-only discount: %v", err)
	}
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityBillDiscount, voudomain.ReverseInput{DocumentID: billOnlyFinalized.DocumentID, Revision: billOnlyFinalized.Revision, Reason: "撤回纯票据贴现"}, integrationActorOne, "bill-only-discount-unfinalize"); err != nil {
		t.Fatalf("unfinalize bill-only discount: %v", err)
	}
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityBillReceipt, voudomain.ReverseInput{DocumentID: sourceFinalized.DocumentID, Revision: sourceFinalized.Revision, Reason: "撤回跨账期来源票据"}, integrationActorOne, "bill-source-unfinalize-after-reactivation"); err != nil {
		t.Fatalf("unfinalize archived bill source: %v", err)
	}
	var archivedBillMasters int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM led_bills WHERE source_document_id = $1`, source.DocumentID).Scan(&archivedBillMasters); err != nil {
		t.Fatalf("count archived bill masters: %v", err)
	}
	if archivedBillMasters != 1 {
		t.Fatalf("archived bill masters = %d, want 1", archivedBillMasters)
	}
}

func TestBillMaturityReceiptAndPaymentIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, vouchers := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)

	receiptSource, receiptView := advanceToApproved(t, vouchers, voudomain.EntityBillReceipt, voudomain.DraftInput{
		BusinessDate: "2026-08-01", Currency: "CNY", Counterparty: &refs.customer, Handler: &refs.employee,
		BillLines: []voudomain.BillLineInput{{PositionType: "ASSET", Direction: "IN", Purpose: "PRIMARY", BillType: "BANK_ACCEPTANCE", BillNo: "BILL-MATURITY-RECEIPT", Medium: "ELECTRONIC", Currency: "CNY", FaceAmount: "100.00", IssueDate: "2026-08-01", MaturityDate: "2026-08-01", Drawer: "出票人", Acceptor: "承兑行", Payee: "本公司"}},
	})
	if _, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityBillReceipt, voudomain.DocumentRevisionInput{DocumentID: receiptSource.DocumentID, Revision: receiptSource.Revision}, integrationActorOne, "bill-maturity-receipt-source-finalize"); err != nil {
		t.Fatalf("finalize maturity receipt source: %v", err)
	}
	paymentSource, paymentView := advanceToApproved(t, vouchers, voudomain.EntityBillIssue, voudomain.DraftInput{
		BusinessDate: "2026-08-01", Currency: "CNY", Supplier: &refs.supplier, InterestMode: "BANK_DEDUCTED",
		BillLines: []voudomain.BillLineInput{{PositionType: "LIABILITY", Direction: "IN", Purpose: "PRIMARY", BillType: "BANK_ACCEPTANCE", BillNo: "BILL-MATURITY-PAYMENT", Medium: "ELECTRONIC", Currency: "CNY", FaceAmount: "90.00", IssueDate: "2026-08-01", MaturityDate: "2026-08-01", Drawer: "本公司", Acceptor: "承兑行", Payee: "供应商"}},
	})
	if _, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityBillIssue, voudomain.DocumentRevisionInput{DocumentID: paymentSource.DocumentID, Revision: paymentSource.Revision}, integrationActorOne, "bill-maturity-payment-source-finalize"); err != nil {
		t.Fatalf("finalize maturity payment source: %v", err)
	}

	invalid := voudomain.DraftInput{
		BusinessDate: "2026-08-02", Currency: "CNY", MaturityType: "PAYMENT",
		BillLines:     []voudomain.BillLineInput{{BillID: paymentView.Data.BillLines[0].BillID, Purpose: "PRIMARY"}},
		BillCashLines: []voudomain.BillCashLineInput{{FundAccount: refs.fundAccount, Direction: "IN", AmountType: "PRINCIPAL", Amount: "90.00"}},
	}
	if _, err := vouchers.Create(t.Context(), voudomain.EntityBillMaturity, voudomain.CreateInput{Data: invalid}, integrationActorOne, "bill-maturity-invalid-payment-direction"); err == nil {
		t.Fatal("accepted payment maturity cash IN")
	}

	receiptMaturity, _ := advanceToApproved(t, vouchers, voudomain.EntityBillMaturity, voudomain.DraftInput{
		BusinessDate: "2026-08-02", Currency: "CNY", MaturityType: "RECEIPT",
		BillLines:     []voudomain.BillLineInput{{BillID: receiptView.Data.BillLines[0].BillID, Purpose: "PRIMARY"}},
		BillCashLines: []voudomain.BillCashLineInput{{FundAccount: refs.fundAccount, Direction: "IN", AmountType: "PRINCIPAL", Amount: "100.00"}},
	})
	receiptFinalized, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityBillMaturity, voudomain.DocumentRevisionInput{DocumentID: receiptMaturity.DocumentID, Revision: receiptMaturity.Revision}, integrationActorOne, "bill-maturity-receipt-finalize")
	if err != nil {
		t.Fatalf("finalize receipt maturity: %v", err)
	}
	paymentMaturity, _ := advanceToApproved(t, vouchers, voudomain.EntityBillMaturity, voudomain.DraftInput{
		BusinessDate: "2026-08-02", Currency: "CNY", MaturityType: "PAYMENT",
		BillLines:     []voudomain.BillLineInput{{BillID: paymentView.Data.BillLines[0].BillID, Purpose: "PRIMARY"}},
		BillCashLines: []voudomain.BillCashLineInput{{FundAccount: refs.fundAccount, Direction: "OUT", AmountType: "PRINCIPAL", Amount: "90.00"}},
	})
	paymentFinalized, err := vouchers.AssertFinalized(t.Context(), voudomain.EntityBillMaturity, voudomain.DocumentRevisionInput{DocumentID: paymentMaturity.DocumentID, Revision: paymentMaturity.Revision}, integrationActorOne, "bill-maturity-payment-finalize")
	if err != nil {
		t.Fatalf("finalize payment maturity: %v", err)
	}
	fund, err := ledger.FundBalance(t.Context(), BalanceInput{Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-08-02", ObjectID: refs.fundAccount.ObjectID}})
	if err != nil || len(fund.Items) != 1 || fund.Items[0].Amount != "10.00" {
		t.Fatalf("fund balance after maturity operations = %+v, err=%v", fund, err)
	}
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityBillMaturity, voudomain.ReverseInput{DocumentID: paymentFinalized.DocumentID, Revision: paymentFinalized.Revision, Reason: "撤回付款到期"}, integrationActorOne, "bill-maturity-payment-unfinalize"); err != nil {
		t.Fatalf("unfinalize payment maturity: %v", err)
	}
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityBillMaturity, voudomain.ReverseInput{DocumentID: receiptFinalized.DocumentID, Revision: receiptFinalized.Revision, Reason: "撤回收款到期"}, integrationActorOne, "bill-maturity-receipt-unfinalize"); err != nil {
		t.Fatalf("unfinalize receipt maturity: %v", err)
	}
}

func TestBillReceiptRespectsLedgerClosingIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, vouchers := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)
	if err := ledger.EnsureReady(t.Context()); err != nil {
		t.Fatalf("prepare ledger closing: %v", err)
	}
	approveZeroIntermediaryCalculations(t, vouchers, "2026-01-01", "2026-07-31")
	closing, err := ledger.GetClosing(t.Context())
	if err != nil {
		t.Fatalf("get closing before bill receipt period close: %v", err)
	}
	if _, err := ledger.Close(t.Context(), ClosingInput{
		Revision: closing.Revision, ClosingDate: "2026-07-31",
	}, integrationActorOne, "bill-receipt-close-period"); err != nil {
		t.Fatalf("close bill receipt period: %v", err)
	}
	_, err = vouchers.Create(t.Context(), voudomain.EntityBillReceipt, voudomain.CreateInput{
		Data: voudomain.DraftInput{
			BusinessDate: "2026-07-31", Currency: "CNY", Counterparty: &refs.customer,
			Handler: &refs.employee, BillLines: []voudomain.BillLineInput{{
				PositionType: "ASSET", Direction: "IN", Purpose: "PRIMARY",
				BillType: "CHECK", BillNo: "BRE-CLOSED", Medium: "PAPER",
				Currency: "CNY", FaceAmount: "1.00", IssueDate: "2026-07-31",
				MaturityDate: "2026-07-31", Drawer: "出票人", Acceptor: "承兑人",
				Payee: "本公司",
			}},
		},
	}, integrationActorOne, "bill-receipt-create-closed-period")
	if err == nil || !strings.Contains(err.Error(), "closed through 2026-07-31") {
		t.Fatalf("closed-period bill receipt error = %v", err)
	}
}

func TestLEDClosingRequiresEveryIntermediaryMonthIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	ledger, vouchers := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)
	if err := ledger.EnsureReady(t.Context()); err != nil {
		t.Fatalf("prepare ledger for skipped intermediary month: %v", err)
	}
	approveZeroIntermediaryCalculation(t, vouchers, "2026-01-31")
	approveZeroIntermediaryCalculation(t, vouchers, "2026-03-31")
	closing, err := ledger.GetClosing(t.Context())
	if err != nil {
		t.Fatalf("get closing before skipped intermediary month: %v", err)
	}
	_, err = ledger.Close(t.Context(), ClosingInput{
		Revision: closing.Revision, ClosingDate: "2026-03-31",
	}, integrationActorOne, "close-with-skipped-intermediary-month")
	var closingErr *DomainError
	if !errors.As(err, &closingErr) {
		t.Fatalf("skipped intermediary month closing error = %v", err)
	}
	closingData, ok := closingErr.Data.(map[string]any)
	if !ok || closingData["firstMissingDate"] != "2026-02-28" {
		t.Fatalf("skipped intermediary month closing error = %s, data = %+v, cause = %v",
			closingErr.Message, closingErr.Data, closingErr.Cause)
	}
	approveZeroIntermediaryCalculation(t, vouchers, "2026-02-28")
	if _, err = ledger.Close(t.Context(), ClosingInput{
		Revision: closing.Revision, ClosingDate: "2026-03-31",
	}, integrationActorOne, "close-after-intermediary-month-complete"); err != nil {
		t.Fatalf("close after completing intermediary months: %v", err)
	}
}

func TestLEDClosingRejectsStaleIntermediaryCalculationIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, vouchers := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)
	approveZeroIntermediaryCalculation(t, vouchers, "2026-01-31")
	advanceToApproved(t, vouchers, voudomain.EntityBillReceipt, voudomain.DraftInput{
		BusinessDate: "2026-01-30", Currency: "CNY", Counterparty: &refs.customer,
		Handler: &refs.employee, BillLines: []voudomain.BillLineInput{{
			PositionType: "ASSET", Direction: "IN", Purpose: "PRIMARY",
			BillType: "CHECK", BillNo: "ICL-STALE-CHECK", Medium: "PAPER",
			Currency: "CNY", FaceAmount: "1.00", IssueDate: "2026-01-30",
			MaturityDate: "2026-01-31", Drawer: "客户", Acceptor: "银行", Payee: "本公司",
		}},
	})
	if err := ledger.EnsureReady(t.Context()); err != nil {
		t.Fatalf("rebuild ledger after backdated stale-source bill: %v", err)
	}
	closing, err := ledger.GetClosing(t.Context())
	if err != nil {
		t.Fatalf("get closing before stale intermediary validation: %v", err)
	}
	if _, err = ledger.Close(t.Context(), ClosingInput{
		Revision: closing.Revision, ClosingDate: "2026-01-31",
	}, integrationActorOne, "close-with-stale-intermediary-calculation"); err == nil ||
		!strings.Contains(err.Error(), "intermediary calculation source changed") {
		t.Fatalf("stale intermediary closing error = %v", err)
	}
}

func TestIntermediaryCalculationPostingRespectsLedgerCutoverIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	ledger, vouchers := newIntegratedServices(t, pool)
	saved, err := ledger.SaveOpening(t.Context(), OpeningSaveInput{
		Revision: 1, CutoverDate: "2026-07-01",
		Inventory: []InventoryOpeningInput{}, Fund: []FundOpeningInput{}, Party: []PartyOpeningInput{},
	}, integrationActorOne, "intermediary-cutover-opening")
	if err != nil {
		t.Fatalf("save intermediary cutover opening: %v", err)
	}
	if _, err = ledger.Activate(t.Context(), RevisionInput{Revision: saved.Revision},
		integrationActorOne, "intermediary-cutover-activate"); err != nil {
		t.Fatalf("activate intermediary cutover opening: %v", err)
	}
	if err = ledger.EnsureReady(t.Context()); err != nil {
		t.Fatalf("prepare intermediary cutover ledger: %v", err)
	}
	source, err := vouchers.IntermediarySource(t.Context(), voudomain.IntermediarySourceInput{BusinessDate: "2026-06-30"})
	if err != nil || len(source.Source.Lines) != 0 || len(source.Source.Bills) != 0 {
		t.Fatalf("pre-cutover intermediary source = %+v, err=%v", source.Source, err)
	}
	script, err := vouchers.GetIntermediaryScript(t.Context())
	if err != nil {
		t.Fatalf("load intermediary cutover script: %v", err)
	}
	checked, _ := advanceToChecked(t, vouchers, voudomain.EntityIntermediaryCalculation, voudomain.DraftInput{
		BusinessDate: "2026-06-30", Currency: "CNY",
		IntermediaryCalculation: &voudomain.IntermediaryCalculationInput{
			Source: source.Source, SourceHash: source.SourceHash, Script: script,
			Result: voudomain.IntermediaryCalculationResult{
				Lines: []voudomain.IntermediaryResultLine{}, Summaries: []voudomain.IntermediarySummary{},
			},
		},
	})
	if _, err = vouchers.Approve(t.Context(), voudomain.EntityIntermediaryCalculation, voudomain.DocumentRevisionInput{
		DocumentID: checked.DocumentID, Revision: checked.Revision,
	}, integrationActorOne, "approve-pre-cutover-intermediary-calculation"); err == nil ||
		!strings.Contains(err.Error(), "predates ledger cutover") {
		t.Fatalf("pre-cutover intermediary approval error = %v", err)
	}
}

func TestLedgerRecutoverRejectsDroppedOtherPayableBalanceIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, _ := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)
	if err := ledger.EnsureReady(t.Context()); err != nil {
		t.Fatalf("prepare ledger for other payable recutover: %v", err)
	}
	opening, err := ledger.GetOpening(t.Context())
	if err != nil {
		t.Fatalf("get ledger before other payable recutover: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO led_party_entries(
		id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
		source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,
		counterparty_entity,counterparty_object_id,counterparty_version_id,
		counterparty_code,counterparty_name,currency,amount_delta_cents,
		account_type,payable_category
	) VALUES($1,$2,'POSTING','intermediary-calculation',$3,'ICL-20260131-0001',$4,1,
		'2026-01-31',now(),$5,'other-payable-recutover','employee',$6,$7,'EMP-RECUTOVER',
		'待结提成员工','CNY',-100,'OTHER_PAYABLE','COMMISSION')`,
		newID(), opening.ActiveGenerationID, newID(), newID(), integrationActorOne,
		refs.employee.ObjectID, refs.employee.VersionID); err != nil {
		t.Fatalf("insert other payable before recutover: %v", err)
	}
	reopened, err := ledger.Reopen(t.Context(), ReopenInput{
		Revision: opening.Revision, Reason: "测试其它应付切点保护",
	}, integrationActorOne, "reopen-with-other-payable")
	if err != nil {
		t.Fatalf("reopen ledger with other payable: %v", err)
	}
	saved, err := ledger.SaveOpening(t.Context(), OpeningSaveInput{
		Revision: reopened.Revision, CutoverDate: "2026-02-01",
		Inventory: []InventoryOpeningInput{}, Fund: []FundOpeningInput{}, Party: []PartyOpeningInput{},
	}, integrationActorOne, "save-recutover-with-other-payable")
	if err != nil {
		t.Fatalf("save recutover with other payable: %v", err)
	}
	if _, err = ledger.Activate(t.Context(), RevisionInput{Revision: saved.Revision},
		integrationActorOne, "activate-recutover-with-other-payable"); err == nil ||
		!strings.Contains(err.Error(), "other payable balances exist") {
		t.Fatalf("other payable recutover activation error = %v", err)
	}
}

func TestIntermediaryCalculationCheckCollectionAndOtherPayableIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	bobService := bobdomain.NewService(pool)
	intermediary := createApprovedReference(t, bobService, bobdomain.EntityOtherParty, bobdomain.CreateDetailInput{
		Code: "LI" + newID(), Name: "LED 居间商", SalespersonEmployeeID: refs.employee.ObjectID,
	})
	billHandler := createApprovedReference(t, bobService, bobdomain.EntityEmployee, bobdomain.CreateDetailInput{
		Code: "LIBH" + newID(), Name: "LED 票据经办人",
	})
	settlement := fixedSettlementReference(t, pool, bobdomain.SettlementTermArrival3)
	refs.customer = createApprovedReference(t, bobService, bobdomain.EntityCustomer, bobdomain.CreateDetailInput{
		Code: "LIC" + newID(), Name: "LED 居间客户", SettlementMethodID: settlement.ObjectID,
		SalespersonEmployeeID: refs.employee.ObjectID, RebateUnitPrice: "0.20",
		IntermediaryOtherPartyID: intermediary.ObjectID,
	})
	carryCustomer := createApprovedReference(t, bobService, bobdomain.EntityCustomer, bobdomain.CreateDetailInput{
		Code: "LICC" + newID(), Name: "LED 票据成本顺延客户", SettlementMethodID: settlement.ObjectID,
		SalespersonEmployeeID: refs.employee.ObjectID,
	})
	ledger, vouchers := newIntegratedServices(t, pool)
	activateEmptyLedger(t, ledger)
	zeroCalculation := approveZeroIntermediaryCalculation(t, vouchers, "2026-06-30")
	reversedZero, err := vouchers.Unapprove(t.Context(), voudomain.EntityIntermediaryCalculation, voudomain.ReverseInput{
		DocumentID: zeroCalculation.DocumentID, Revision: zeroCalculation.Revision, Reason: "撤回零金额居间计算",
	}, integrationActorTwo, "zero-intermediary-calculation-unapprove")
	if err != nil || reversedZero.Status != voudomain.StatusChecked {
		t.Fatalf("unapprove zero intermediary calculation = %+v, err=%v", reversedZero, err)
	}

	advancePurchaseInboundToApproved(t, vouchers, refs, "1", "10.00")
	order, orderView := approveSaleOrder(t, vouchers, refs, "1")
	outbound, _ := advanceSaleOutboundToApproved(t, vouchers, refs, order, orderView, "1")
	delivery, deliveryView := advanceToApproved(t, vouchers, voudomain.EntitySaleDelivery, voudomain.DraftInput{
		BusinessDate: "2026-07-25", SourceDocumentID: outbound.DocumentID,
		Platform: &refs.platform, Vehicle: &refs.vehicle,
	})
	signoff, signoffView := advanceToApproved(t, vouchers, voudomain.EntitySaleSignoff, voudomain.DraftInput{
		BusinessDate: "2026-07-26", SourceDocumentID: delivery.DocumentID,
		SignoffLines: []voudomain.SaleSignoffLineInput{{
			SourceLineID:   deliveryView.Data.ProductLines[0].LineID,
			SignedQuantity: "1", RejectedQuantity: "0",
		}},
	})
	if signoff.Status != voudomain.StatusFinalized || len(signoffView.Data.SignoffLines) != 1 {
		t.Fatalf("approved sale signoff = %+v, view=%+v", signoff, signoffView.Data.SignoffLines)
	}
	advanceToApproved(t, vouchers, voudomain.EntityBillReceipt, voudomain.DraftInput{
		BusinessDate: "2026-07-27", Currency: "CNY", Counterparty: &refs.customer,
		Handler: &billHandler, BillLines: []voudomain.BillLineInput{{
			PositionType: "ASSET", Direction: "IN", Purpose: "PRIMARY",
			BillType: "CHECK", BillNo: "ICL-CHECK-001", Medium: "PAPER",
			Currency: "CNY", FaceAmount: "12.00", IssueDate: "2026-07-27",
			MaturityDate: "2026-08-05", Drawer: "居间客户", Acceptor: "付款银行", Payee: "本公司",
		}},
	})
	advanceToApproved(t, vouchers, voudomain.EntityBillReceipt, voudomain.DraftInput{
		BusinessDate: "2026-07-28", Currency: "CNY", Counterparty: &carryCustomer,
		Handler: &billHandler, BillLines: []voudomain.BillLineInput{{
			PositionType: "ASSET", Direction: "IN", Purpose: "PRIMARY",
			BillType: "CHECK", BillNo: "ICL-CARRY-CHECK", Medium: "PAPER",
			Currency: "CNY", FaceAmount: "7.00", IssueDate: "2026-07-28",
			MaturityDate: "2026-08-06", Drawer: "顺延客户", Acceptor: "付款银行", Payee: "本公司",
		}},
	})
	if _, insertErr := pool.Exec(t.Context(), `INSERT INTO led_party_entries(
		id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
		source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,
		counterparty_entity,counterparty_object_id,counterparty_version_id,
		counterparty_code,counterparty_name,currency,amount_delta_cents
	)
	SELECT $1,generation_id,'POSTING','foreign-currency-test',$2,'FX-COLLECTION',$3,1,
		'2026-07-28',now(),$4,'intermediary-foreign-currency',counterparty_entity,
		counterparty_object_id,counterparty_version_id,counterparty_code,counterparty_name,
		'USD',-amount_delta_cents
	FROM led_party_entries
	WHERE source_document_id=$5 AND account_type='TRADE'
	LIMIT 1`, newID(), newID(), newID(), integrationActorOne, signoff.DocumentID); insertErr != nil {
		t.Fatalf("insert unrelated foreign-currency collection: %v", insertErr)
	}

	julySource, err := vouchers.IntermediarySource(t.Context(), voudomain.IntermediarySourceInput{BusinessDate: "2026-07-31"})
	if err != nil {
		t.Fatalf("load July intermediary source: %v", err)
	}
	if len(julySource.Source.Lines) != 0 || len(julySource.Source.Bills) != 0 {
		t.Fatalf("July intermediary source must defer the check to maturity: %+v", julySource.Source)
	}
	augustSource, err := vouchers.IntermediarySource(t.Context(), voudomain.IntermediarySourceInput{BusinessDate: "2026-08-31"})
	if err != nil {
		t.Fatalf("load August intermediary source: %v", err)
	}
	if len(augustSource.Source.Lines) != 1 || len(augustSource.Source.Bills) != 2 ||
		augustSource.Source.Lines[0].CollectionDate != "2026-08-05" ||
		augustSource.Source.Lines[0].SourceKind != "SALE" ||
		augustSource.Source.Lines[0].RebateUnitPrice != "0.20" ||
		augustSource.Source.Lines[0].Intermediary == nil ||
		augustSource.Source.Lines[0].Intermediary.ObjectID != intermediary.ObjectID ||
		augustSource.Source.Bills[0].Salesperson.ObjectID != refs.employee.ObjectID {
		t.Fatalf("August intermediary source = %+v", augustSource.Source)
	}
	sourceLine := augustSource.Source.Lines[0]
	var matchedBill, carriedBill *voudomain.IntermediarySourceBill
	for index := range augustSource.Source.Bills {
		bill := &augustSource.Source.Bills[index]
		if bill.Customer.ObjectID == refs.customer.ObjectID {
			matchedBill = bill
		} else if bill.Customer.ObjectID == carryCustomer.ObjectID {
			carriedBill = bill
		}
	}
	if matchedBill == nil || carriedBill == nil || matchedBill.BillType != "CHECK" ||
		matchedBill.CostDays != 9 || matchedBill.Salesperson.ObjectID == billHandler.ObjectID {
		t.Fatalf("August bill attribution = %+v", augustSource.Source.Bills)
	}
	script, err := vouchers.GetIntermediaryScript(t.Context())
	if err != nil {
		t.Fatalf("load intermediary script: %v", err)
	}
	calculation := &voudomain.IntermediaryCalculationInput{
		Source: augustSource.Source, SourceHash: augustSource.SourceHash, Script: script,
		Result: voudomain.IntermediaryCalculationResult{
			Lines: []voudomain.IntermediaryResultLine{{
				SourceSignoffLineID: sourceLine.SourceSignoffLineID,
				PremiumUnitPrice:    "0.50", BarrelQuantity: sourceLine.BarrelQuantity,
				BaseCommission: "11.00", PremiumCommission: "5.00", LowPriceCommission: "0.00",
				MarketMaintenanceSubsidy: "2.00", MarketDevelopmentSubsidy: "0.00",
				BillCost: "8.00", BillLineIDs: []string{matchedBill.BillLineID},
				EmployeeAmount: "10.00", IntermediaryAmount: "5.00", RebateAmount: "2.00",
			}},
			Summaries: []voudomain.IntermediarySummary{
				{Payee: sourceLine.Salesperson, Category: "COMMISSION", Amount: "10.00"},
				{Payee: *sourceLine.Intermediary, Category: "INTERMEDIARY", Amount: "5.00"},
				{Payee: sourceLine.Customer, Category: "REBATE", Amount: "2.00"},
			},
		},
	}
	calculationDraft := voudomain.DraftInput{
		BusinessDate: "2026-08-31", Currency: "CNY", IntermediaryCalculation: calculation,
	}
	checkedCalculation, _ := advanceToChecked(t, vouchers, voudomain.EntityIntermediaryCalculation, calculationDraft)
	returnApproved, _ := advanceToApproved(t, vouchers, voudomain.EntitySaleReturn, voudomain.DraftInput{
		BusinessDate: "2026-08-06", Warehouse: &refs.warehouse, ReturnReason: "居间计算来源变更测试",
		ReturnLines: []voudomain.ReturnLineInput{{
			SourceLineID: signoffView.Data.SignoffLines[0].LineID, Quantity: "0.5",
		}},
	})
	returnedSource, err := vouchers.IntermediarySource(t.Context(), voudomain.IntermediarySourceInput{BusinessDate: "2026-08-31"})
	if err != nil || len(returnedSource.Source.Lines) != 1 ||
		returnedSource.Source.Lines[0].SignedQuantity != "0.5" ||
		returnedSource.Source.Lines[0].BarrelQuantity != "0.5" ||
		returnedSource.Source.Lines[0].LineAmount != "6.00" {
		t.Fatalf("intermediary source after partial return = %+v, err=%v", returnedSource.Source, err)
	}
	if _, err = vouchers.Approve(t.Context(), voudomain.EntityIntermediaryCalculation, voudomain.DocumentRevisionInput{
		DocumentID: checkedCalculation.DocumentID, Revision: checkedCalculation.Revision,
	}, integrationActorOne, "approve-stale-intermediary-calculation"); err == nil ||
		!strings.Contains(err.Error(), "calculation source changed") {
		t.Fatalf("stale intermediary calculation approval error = %v", err)
	}
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntitySaleReturn, voudomain.ReverseInput{
		DocumentID: returnApproved.DocumentID, Revision: returnApproved.Revision, Reason: "恢复居间计算来源",
	}, integrationActorTwo, "unapprove-intermediary-source-return"); err != nil {
		t.Fatalf("unapprove intermediary source return: %v", err)
	}
	draftCalculation, err := vouchers.Uncheck(t.Context(), voudomain.EntityIntermediaryCalculation, voudomain.ReverseInput{
		DocumentID: checkedCalculation.DocumentID, Revision: checkedCalculation.Revision, Reason: "重新计算变更来源",
	}, integrationActorTwo, "uncheck-stale-intermediary-calculation")
	if err != nil {
		t.Fatalf("uncheck stale intermediary calculation: %v", err)
	}
	savedCalculation, err := vouchers.Save(t.Context(), voudomain.EntityIntermediaryCalculation, voudomain.SaveInput{
		DocumentID: draftCalculation.DocumentID, Revision: draftCalculation.Revision, Data: calculationDraft,
	}, integrationActorOne, "save-recalculated-intermediary-calculation")
	if err != nil {
		t.Fatalf("save recalculated intermediary calculation: %v", err)
	}
	recheckedCalculation, err := vouchers.Check(t.Context(), voudomain.EntityIntermediaryCalculation, voudomain.DocumentRevisionInput{
		DocumentID: savedCalculation.DocumentID, Revision: savedCalculation.Revision,
	}, integrationActorOne, "check-recalculated-intermediary-calculation")
	if err != nil {
		t.Fatalf("check recalculated intermediary calculation: %v", err)
	}
	approvedCalculation, err := vouchers.Approve(t.Context(), voudomain.EntityIntermediaryCalculation, voudomain.DocumentRevisionInput{
		DocumentID: recheckedCalculation.DocumentID, Revision: recheckedCalculation.Revision,
	}, integrationActorOne, "approve-recalculated-intermediary-calculation")
	if err != nil {
		t.Fatalf("approve recalculated intermediary calculation: %v", err)
	}
	calculationView, err := vouchers.Get(t.Context(), voudomain.EntityIntermediaryCalculation, voudomain.GetInput{
		DocumentID: approvedCalculation.DocumentID,
	})
	if err != nil {
		t.Fatalf("get approved intermediary calculation: %v", err)
	}
	if calculationView.Status != voudomain.StatusFinalized || calculationView.Amount != "17.00" ||
		calculationView.Data.IntermediaryCalculation == nil ||
		len(calculationView.Data.IntermediaryCalculation.Result.Lines) != 1 {
		t.Fatalf("approved intermediary calculation = %+v", calculationView)
	}

	entries, err := ledger.QueryOtherPayable(t.Context(), QueryInput{
		Page: 1, PageSize: 20,
		Filters: QueryFilters{DateFrom: "2026-08-01", DateTo: "2026-08-31", SourceEntity: voudomain.EntityIntermediaryCalculation},
	})
	if err != nil || entries.Total != 3 || len(entries.Items) != 3 {
		t.Fatalf("other payable entries = %+v, err=%v", entries, err)
	}
	amounts := make(map[string]string, len(entries.Items))
	for _, item := range entries.Items {
		if item.Direction != "CREDIT" || item.SourceDocumentID != calculationView.DocumentID {
			t.Fatalf("other payable entry = %+v", item)
		}
		amounts[item.PayableCategory] = item.Amount
	}
	if amounts["COMMISSION"] != "10.00" || amounts["INTERMEDIARY"] != "5.00" || amounts["REBATE"] != "2.00" {
		t.Fatalf("other payable amounts = %+v", amounts)
	}
	balances, err := ledger.OtherPayableBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-08-31"},
	})
	if err != nil || balances.Total != 3 || len(balances.Items) != 3 {
		t.Fatalf("other payable balances = %+v, err=%v", balances, err)
	}
	tradeBalance, err := ledger.PartyBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-08-31", ObjectID: refs.customer.ObjectID},
	}, EntityCustomer)
	var cnyTradeBalance *PartyBalanceView
	for index := range tradeBalance.Items {
		if tradeBalance.Items[index].Currency == "CNY" {
			cnyTradeBalance = &tradeBalance.Items[index]
			break
		}
	}
	if err != nil || cnyTradeBalance == nil ||
		cnyTradeBalance.BalanceType != "ZERO" || cnyTradeBalance.Amount != "0.00" {
		t.Fatalf("customer trade balance must stay separate from other payable: %+v, err=%v", tradeBalance, err)
	}

	septemberCarrySource, err := vouchers.IntermediarySource(t.Context(), voudomain.IntermediarySourceInput{
		BusinessDate: "2026-09-30",
	})
	if err != nil || len(septemberCarrySource.Source.Lines) != 0 ||
		len(septemberCarrySource.Source.Bills) != 1 ||
		septemberCarrySource.Source.Bills[0].BillLineID != carriedBill.BillLineID {
		t.Fatalf("September carried bill source = %+v, err=%v", septemberCarrySource.Source, err)
	}
	_, septemberReturnView := advanceToApproved(t, vouchers, voudomain.EntitySaleReturn, voudomain.DraftInput{
		BusinessDate: "2026-09-05", Warehouse: &refs.warehouse, ReturnReason: "跨月退货冲回居间金额",
		ReturnLines: []voudomain.ReturnLineInput{{
			SourceLineID: signoffView.Data.SignoffLines[0].LineID, Quantity: "0.5",
		}},
	})
	septemberSource, err := vouchers.IntermediarySource(t.Context(), voudomain.IntermediarySourceInput{
		BusinessDate: "2026-09-30",
	})
	if err != nil || len(septemberSource.Source.Lines) != 1 || len(septemberSource.Source.Bills) != 1 {
		t.Fatalf("September return adjustment source = %+v, err=%v", septemberSource.Source, err)
	}
	adjustmentLine := septemberSource.Source.Lines[0]
	if adjustmentLine.SourceKind != "RETURN_ADJUSTMENT" ||
		adjustmentLine.SourceSignoffLineID != sourceLine.SourceSignoffLineID ||
		adjustmentLine.BarrelQuantity != "0.5" ||
		adjustmentLine.AdjustmentEmployeeAmount != "5.00" ||
		adjustmentLine.AdjustmentIntermediaryAmount != "2.50" ||
		adjustmentLine.AdjustmentRebateAmount != "1.00" ||
		len(adjustmentLine.ReturnDocumentNos) != 1 ||
		adjustmentLine.ReturnDocumentNos[0] != septemberReturnView.DocumentNo {
		t.Fatalf("September return adjustment line = %+v", adjustmentLine)
	}
	septemberCalculation, septemberCalculationView := advanceToApproved(
		t, vouchers, voudomain.EntityIntermediaryCalculation, voudomain.DraftInput{
			BusinessDate: "2026-09-30", Currency: "CNY",
			IntermediaryCalculation: &voudomain.IntermediaryCalculationInput{
				Source: septemberSource.Source, SourceHash: septemberSource.SourceHash, Script: script,
				Result: voudomain.IntermediaryCalculationResult{
					Lines: []voudomain.IntermediaryResultLine{{
						SourceSignoffLineID: adjustmentLine.SourceSignoffLineID,
						PremiumUnitPrice:    "0.00", BarrelQuantity: adjustmentLine.BarrelQuantity,
						BaseCommission: "0.00", PremiumCommission: "0.00", LowPriceCommission: "0.00",
						MarketMaintenanceSubsidy: "0.00", MarketDevelopmentSubsidy: "0.00",
						BillCost: "0.00", BillLineIDs: []string{},
						EmployeeAmount: "-5.00", IntermediaryAmount: "-2.50", RebateAmount: "-1.00",
					}},
					Summaries: []voudomain.IntermediarySummary{
						{Payee: adjustmentLine.Salesperson, Category: "COMMISSION", Amount: "-5.00"},
						{Payee: *adjustmentLine.Intermediary, Category: "INTERMEDIARY", Amount: "-2.50"},
						{Payee: adjustmentLine.Customer, Category: "REBATE", Amount: "-1.00"},
					},
				},
			},
		},
	)
	if septemberCalculationView.Amount != "-8.50" {
		t.Fatalf("September return adjustment calculation = %+v", septemberCalculationView)
	}
	septemberEntries, err := ledger.QueryOtherPayable(t.Context(), QueryInput{
		Page: 1, PageSize: 20,
		Filters: QueryFilters{DateFrom: "2026-09-01", DateTo: "2026-09-30", SourceEntity: voudomain.EntityIntermediaryCalculation},
	})
	if err != nil || septemberEntries.Total != 3 || len(septemberEntries.Items) != 3 {
		t.Fatalf("September return adjustment entries = %+v, err=%v", septemberEntries, err)
	}
	septemberAmounts := make(map[string]string, len(septemberEntries.Items))
	for _, item := range septemberEntries.Items {
		if item.Direction != "DEBIT" || item.SourceDocumentID != septemberCalculation.DocumentID {
			t.Fatalf("September return adjustment entry = %+v", item)
		}
		septemberAmounts[item.PayableCategory] = item.Amount
	}
	if septemberAmounts["COMMISSION"] != "5.00" ||
		septemberAmounts["INTERMEDIARY"] != "2.50" || septemberAmounts["REBATE"] != "1.00" {
		t.Fatalf("September return adjustment amounts = %+v", septemberAmounts)
	}
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityIntermediaryCalculation, voudomain.ReverseInput{
		DocumentID: septemberCalculation.DocumentID, Revision: septemberCalculation.Revision, Reason: "撤回跨月退货冲回",
	}, integrationActorTwo, "return-adjustment-intermediary-unapprove"); err != nil {
		t.Fatalf("unapprove September return adjustment calculation: %v", err)
	}

	reversed, err := vouchers.Unapprove(t.Context(), voudomain.EntityIntermediaryCalculation, voudomain.ReverseInput{
		DocumentID: calculationView.DocumentID, Revision: calculationView.Revision, Reason: "撤回居间计算",
	}, integrationActorTwo, "intermediary-calculation-unapprove")
	if err != nil || reversed.Status != voudomain.StatusChecked {
		t.Fatalf("unapprove intermediary calculation = %+v, err=%v", reversed, err)
	}
	entries, err = ledger.QueryOtherPayable(t.Context(), QueryInput{
		Page: 1, PageSize: 20,
		Filters: QueryFilters{DateFrom: "2026-08-01", DateTo: "2026-08-31", SourceEntity: voudomain.EntityIntermediaryCalculation},
	})
	if err != nil || entries.Total != 0 || len(entries.Items) != 0 {
		t.Fatalf("other payable entries after reversal = %+v, err=%v", entries, err)
	}
}

func TestLEDPermissionCatalogIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	var count int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM app_permissions WHERE domain = 'led'`).Scan(&count); err != nil {
		t.Fatalf("count LED permissions: %v", err)
	}
	if count != 23 {
		t.Fatalf("LED permission count = %d, want 23", count)
	}
}

func TestApprovedPostingRebuildPreservesActiveClosingSnapshotsIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, vouchers := newIntegratedServices(t, pool)
	if err := ledger.EnsureReady(t.Context()); err != nil {
		t.Fatalf("initialize ledger for approved-posting rebuild: %v", err)
	}

	approved, _ := advancePurchaseInboundToApproved(t, vouchers, refs, "5", "10.00")
	if approved.Status != voudomain.StatusFinalized {
		t.Fatalf("approved purchase inbound status = %s", approved.Status)
	}
	approveZeroIntermediaryCalculation(t, vouchers, "2026-07-31")
	before, err := ledger.GetClosing(t.Context())
	if err != nil {
		t.Fatalf("get closing before approved-posting rebuild: %v", err)
	}
	_, err = ledger.Close(t.Context(), ClosingInput{
		Revision: before.Revision, ClosingDate: "2026-07-31",
	}, integrationActorOne, "close-before-approved-posting-rebuild")
	if err != nil {
		t.Fatalf("close before approved-posting rebuild: %v", err)
	}
	closed, err := ledger.GetClosing(t.Context())
	if err != nil || len(closed.Inventory) != 1 || closed.Inventory[0].Quantity != "5.0" ||
		closed.Inventory[0].CostAmount != "50.00" {
		t.Fatalf("closing before approved-posting rebuild = %+v, err=%v", closed, err)
	}
	var previousGenerationID string
	if err = pool.QueryRow(t.Context(), `SELECT active_generation_id FROM led_control
		WHERE singleton=true`).Scan(&previousGenerationID); err != nil {
		t.Fatalf("get generation before approved-posting rebuild: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `UPDATE led_control SET rebuild_required=true WHERE singleton=true`); err != nil {
		t.Fatalf("request approved-posting rebuild: %v", err)
	}
	if err = ledger.EnsureReady(t.Context()); err != nil {
		t.Fatalf("run approved-posting rebuild: %v", err)
	}

	after, err := ledger.GetClosing(t.Context())
	if err != nil {
		t.Fatalf("get closing after approved-posting rebuild: %v", err)
	}
	if after.LatestClosingDate != "2026-07-31" || after.OpeningDate != "2026-08-01" ||
		len(after.Inventory) != 1 || after.Inventory[0].Quantity != "5.0" ||
		after.Inventory[0].CostAmount != "50.00" {
		t.Fatalf("closing after approved-posting rebuild = %+v", after)
	}
	var activeGenerationID, previousStatus string
	if err = pool.QueryRow(t.Context(), `SELECT control.active_generation_id,generation.status
		FROM led_control control JOIN led_generations generation ON generation.id=$1
		WHERE control.singleton=true`, previousGenerationID).Scan(&activeGenerationID, &previousStatus); err != nil {
		t.Fatalf("get generations after approved-posting rebuild: %v", err)
	}
	if activeGenerationID == previousGenerationID || previousStatus != "ARCHIVED" {
		t.Fatalf("generation after approved-posting rebuild = active %s, previous %s/%s",
			activeGenerationID, previousGenerationID, previousStatus)
	}
	var replayed int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM led_inventory_entries
		WHERE generation_id=$1 AND source_document_id=$2`, activeGenerationID, approved.DocumentID).Scan(&replayed); err != nil || replayed != 1 {
		t.Fatalf("replayed approved purchase inbound entries = %d, err=%v", replayed, err)
	}
}

func TestApprovedPostingRebuildPreservesActiveOpeningIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	refs := prepareLEDReferences(t, pool)
	ledger, vouchers := newIntegratedServices(t, pool)
	warehouse := ReferenceInput{ObjectID: refs.warehouse.ObjectID, VersionID: refs.warehouse.VersionID}
	product := ReferenceInput{ObjectID: refs.product.ObjectID, VersionID: refs.product.VersionID}
	fundAccount := ReferenceInput{ObjectID: refs.fundAccount.ObjectID, VersionID: refs.fundAccount.VersionID}
	customer := ReferenceInput{ObjectID: refs.customer.ObjectID, VersionID: refs.customer.VersionID}
	saved, err := ledger.SaveOpening(t.Context(), OpeningSaveInput{
		Revision: 1, CutoverDate: "2026-06-01",
		Inventory: []InventoryOpeningInput{{
			Warehouse: warehouse, Product: product,
			Quantity: "10", UnitPrice: "10.00", Currency: "CNY",
		}},
		Fund: []FundOpeningInput{{
			FundAccount: fundAccount, BalanceType: "POSITIVE", Amount: "100.00",
		}},
		Party: []PartyOpeningInput{{
			CounterpartyType: "customer", Counterparty: customer,
			Currency: "CNY", BalanceType: "RECEIVABLE", Amount: "50.00",
		}},
		Container: []ContainerOpeningInput{{
			Customer: customer, ContainerType: "SOLVENT", Quantity: 20,
		}},
	}, integrationActorOne, "opening-before-approved-posting-rebuild")
	if err != nil {
		t.Fatalf("save opening before approved-posting rebuild: %v", err)
	}
	_, err = ledger.Activate(t.Context(), RevisionInput{Revision: saved.Revision},
		integrationActorOne, "activate-before-approved-posting-rebuild")
	if err != nil {
		t.Fatalf("activate opening before approved-posting rebuild: %v", err)
	}
	if err = ledger.EnsureReady(t.Context()); err != nil {
		t.Fatalf("prepare active opening before approved-posting rebuild: %v", err)
	}
	activeBeforeRebuild, err := ledger.GetOpening(t.Context())
	if err != nil {
		t.Fatalf("get active opening before approved-posting rebuild: %v", err)
	}
	order, orderView := approveSaleOrder(t, vouchers, refs, "6")
	outbound, _ := advanceSaleOutboundToApproved(t, vouchers, refs, order, orderView, "6")
	if outbound.Status != voudomain.StatusFinalized {
		t.Fatalf("approved sale outbound status = %s", outbound.Status)
	}
	delivery, deliveryView := advanceToApproved(t, vouchers, voudomain.EntitySaleDelivery, voudomain.DraftInput{
		BusinessDate: "2026-07-25", SourceDocumentID: outbound.DocumentID,
		Platform: &refs.platform, Vehicle: &refs.vehicle,
	})
	signoff, _ := advanceToApproved(t, vouchers, voudomain.EntitySaleSignoff, voudomain.DraftInput{
		BusinessDate: "2026-07-26", SourceDocumentID: delivery.DocumentID,
		SignoffLines: []voudomain.SaleSignoffLineInput{{
			SourceLineID:   deliveryView.Data.ProductLines[0].LineID,
			SignedQuantity: "6", RejectedQuantity: "0",
		}},
	})
	if signoff.Status != voudomain.StatusFinalized {
		t.Fatalf("approved sale signoff status = %s", signoff.Status)
	}
	if err = vouchers.ReconcileCompletionStatuses(t.Context()); err != nil {
		t.Fatalf("reconcile sales completion before opening-backed rebuild: %v", err)
	}
	var unfinished int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM vou_documents
		WHERE status <> 'FINALIZED'`).Scan(&unfinished); err != nil || unfinished != 0 {
		t.Fatalf("unfinished documents before opening-backed rebuild = %d, err=%v", unfinished, err)
	}
	approveZeroIntermediaryCalculations(t, vouchers, "2026-06-01", "2026-07-31")
	beforeClosing, err := ledger.GetClosing(t.Context())
	if err != nil {
		t.Fatalf("get closing before opening-backed rebuild: %v", err)
	}
	if _, err = ledger.Close(t.Context(), ClosingInput{
		Revision: beforeClosing.Revision, ClosingDate: "2026-07-31",
	}, integrationActorOne, "close-before-opening-backed-rebuild"); err != nil {
		t.Fatalf("close before opening-backed rebuild: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `UPDATE led_control SET rebuild_required=true WHERE singleton=true`); err != nil {
		t.Fatalf("request approved-posting rebuild with opening: %v", err)
	}
	if err = ledger.EnsureReady(t.Context()); err != nil {
		t.Fatalf("run approved-posting rebuild with opening: %v", err)
	}

	opening, err := ledger.GetOpening(t.Context())
	if err != nil {
		t.Fatalf("get opening after approved-posting rebuild: %v", err)
	}
	if opening.CutoverDate != "2026-06-01" || opening.ActiveGenerationID == activeBeforeRebuild.ActiveGenerationID ||
		len(opening.Inventory) != 1 || opening.Inventory[0].Quantity != "10.0" || opening.Inventory[0].Amount != "100.00" ||
		len(opening.Fund) != 1 || opening.Fund[0].Amount != "100.00" ||
		len(opening.Party) != 1 || opening.Party[0].Amount != "50.00" ||
		len(opening.Container) != 1 || opening.Container[0].Quantity != 20 {
		t.Fatalf("opening after approved-posting rebuild = %+v", opening)
	}
	inventory, err := ledger.InventoryBalance(t.Context(), BalanceInput{
		Page: 1, PageSize: 20, Filters: BalanceFilters{AsOfDate: "2026-07-24"},
	})
	if err != nil || len(inventory.Items) != 1 || inventory.Items[0].Quantity != "4.0" {
		t.Fatalf("inventory after approved-posting rebuild = %+v, err=%v", inventory, err)
	}
	closing, err := ledger.GetClosing(t.Context())
	if err != nil || closing.LatestClosingDate != "2026-07-31" ||
		len(closing.Inventory) != 1 || closing.Inventory[0].Quantity != "4.0" ||
		closing.Inventory[0].CostAmount != "40.00" {
		t.Fatalf("closing after opening-backed rebuild = %+v, err=%v", closing, err)
	}
	var openingEntries, outboundEntries int
	if err = pool.QueryRow(t.Context(), `SELECT
		(SELECT count(*) FROM led_inventory_entries WHERE generation_id=$1 AND entry_type='OPENING'),
		(SELECT count(*) FROM led_inventory_entries WHERE generation_id=$1 AND source_document_id=$2)`,
		opening.ActiveGenerationID, outbound.DocumentID).Scan(&openingEntries, &outboundEntries); err != nil {
		t.Fatalf("read approved-posting rebuilt entries: %v", err)
	}
	if openingEntries != 1 || outboundEntries != 1 {
		t.Fatalf("approved-posting rebuilt entries = opening:%d outbound:%d", openingEntries, outboundEntries)
	}
}

func TestLEDMonthEndClosingAndUncloseIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	ledger, vouchers := newIntegratedServices(t, pool)
	if err := ledger.EnsureReady(t.Context()); err != nil {
		t.Fatalf("initialize ledger: %v", err)
	}
	before, err := ledger.GetClosing(t.Context())
	if err != nil {
		t.Fatalf("get closing before close: %v", err)
	}
	if before.LatestClosingDate != "" || before.OpeningDate != "" {
		t.Fatalf("initial closing = %+v", before)
	}
	var generationID string
	if err = pool.QueryRow(t.Context(), `SELECT active_generation_id FROM led_control
		WHERE singleton=true`).Scan(&generationID); err != nil {
		t.Fatalf("get closing generation: %v", err)
	}
	warehouseID, warehouseVersionID := newID(), newID()
	countWarehouseID, countWarehouseVersionID := newID(), newID()
	productID, productVersionID := newID(), newID()
	purchaseDocumentID, purchaseLineID := newID(), newID()
	saleDocumentID, saleLineID := newID(), newID()
	countDocumentID, countLineID := newID(), newID()
	_, err = pool.Exec(t.Context(), `INSERT INTO led_inventory_entries(
		id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
		source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,
		warehouse_object_id,warehouse_version_id,warehouse_code,warehouse_name,
		product_object_id,product_version_id,product_code,product_name,product_unit,
		quantity_delta_micros,currency,unit_price_cents,amount_cents
	) VALUES
		($1,$2,'POSTING','purchase-inbound',$3,'PIN-TEST',$4,1,'2026-06-01',now(),$5,'cost-in',
		 $6,$7,'WH-1','测试仓库',$8,$9,'P-1','测试商品','件',10000000,'CNY',1000,10000),
		($10,$2,'POSTING','sale-outbound',$11,'OUT-TEST',$12,1,'2026-06-15',now(),$5,'cost-out',
		 $6,$7,'WH-1','测试仓库',$8,$9,'P-1','测试商品','件',-4000000,'CNY',1500,6000),
		($13,$2,'POSTING','inventory-count',$14,'IVC-TEST',$15,1,'2026-06-20',now(),$5,'count-gain',
		 $16,$17,'WH-2','盘点仓库',$8,$9,'P-1','测试商品','件',2000000,NULL,NULL,NULL)`,
		newID(), generationID, purchaseDocumentID, purchaseLineID, integrationActorOne,
		warehouseID, warehouseVersionID, productID, productVersionID,
		newID(), saleDocumentID, saleLineID,
		newID(), countDocumentID, countLineID, countWarehouseID, countWarehouseVersionID)
	if err != nil {
		t.Fatalf("insert closing cost movements: %v", err)
	}
	approveZeroIntermediaryCalculation(t, vouchers, "2026-06-30")
	closed, err := ledger.Close(t.Context(), ClosingInput{
		Revision: before.Revision, ClosingDate: "2026-06-30",
	}, integrationActorOne, "close-june")
	if err != nil {
		t.Fatalf("close June: %v", err)
	}
	if closed.LatestClosingDate != "2026-06-30" || closed.OpeningDate != "2026-07-01" {
		t.Fatalf("closed result = %+v", closed)
	}
	after, err := ledger.GetClosing(t.Context())
	if err != nil {
		t.Fatalf("get generated opening: %v", err)
	}
	if len(after.Inventory) != 2 {
		t.Fatalf("generated inventory opening = %+v", after.Inventory)
	}
	byWarehouse := make(map[string]InventoryOpeningView, len(after.Inventory))
	for _, item := range after.Inventory {
		byWarehouse[item.Warehouse.ObjectID] = item
	}
	if byWarehouse[warehouseID].Quantity != "6.0" ||
		byWarehouse[warehouseID].CostAmount != "60.00" ||
		byWarehouse[countWarehouseID].Quantity != "2.0" ||
		byWarehouse[countWarehouseID].CostAmount != "20.00" {
		t.Fatalf("generated inventory opening = %+v", after.Inventory)
	}
	_, err = pool.Exec(t.Context(), `INSERT INTO vou_documents(
		id,entity,document_no,business_date,currency,total_amount_cents,created_by,updated_by
	) VALUES($1,'sale-order','SOR-20260630-TEST','2026-06-30','CNY',0,$2,$2)`,
		newID(), integrationActorOne)
	if err == nil || !strings.Contains(err.Error(), "closed through 2026-06-30") {
		t.Fatalf("closed document insert error = %v", err)
	}
	unclosed, err := ledger.Unclose(t.Context(), UncloseInput{
		Revision: closed.Revision, Reason: "修正六月单据",
	}, integrationActorTwo, "unclose-june")
	if err != nil {
		t.Fatalf("unclose June: %v", err)
	}
	if unclosed.LatestClosingDate != "" || unclosed.OpeningDate != "" {
		t.Fatalf("unclosed result = %+v", unclosed)
	}
	history, err := ledger.ClosingHistory(t.Context(), HistoryInput{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("closing history: %v", err)
	}
	if history.Total != 1 || len(history.Items) != 1 ||
		history.Items[0].Status != "REVERSED" ||
		history.Items[0].ReverseReason != "修正六月单据" {
		t.Fatalf("closing history = %+v", history)
	}
}
