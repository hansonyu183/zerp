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
		TRUNCATE led_asset_entries,led_assets,led_asset_number_assignments,led_asset_number_counters,
			led_inventory_cost_allocations,led_closing_container,led_closing_party,
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

func newIntegratedServices(t *testing.T, pool *pgxpool.Pool) (*Service, *voudomain.Service) {
	t.Helper()
	bobService := bobdomain.NewService(pool)
	bus := txevent.NewBus()
	ledger, err := NewService(pool, bobService)
	if err != nil {
		t.Fatalf("new LED service: %v", err)
	}
	if err = ledger.RegisterSubscriptions(bus); err != nil {
		t.Fatalf("register LED subscriptions: %v", err)
	}
	vouchers, err := voudomain.NewService(
		pool, bobService, auxiliaryrefs.New(auxdomain.NewService(pool)), bus, voudomain.AttachmentOptions{Root: t.TempDir()},
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	if err != nil {
		t.Fatalf("new VOU service: %v", err)
	}
	return ledger, vouchers
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
	t *testing.T, service *voudomain.Service, entity string, draft voudomain.DraftInput,
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
	approved, err := service.Approve(t.Context(), entity, voudomain.DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: reviewed.Revision,
	}, integrationActorOne, "led-vou-approve")
	if err != nil {
		t.Fatalf("approve %s: %v", entity, err)
	}
	view, err := service.Get(t.Context(), entity, voudomain.GetInput{DocumentID: created.DocumentID})
	if err != nil {
		t.Fatalf("get %s: %v", entity, err)
	}
	return approved, view
}

func advancePurchaseInboundToApproved(
	t *testing.T,
	service *voudomain.Service,
	refs integrationRefs,
	quantity, unitPrice string,
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

func finalizeSaleOrder(
	t *testing.T,
	service *voudomain.Service,
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
	finalized, err := service.Finalize(t.Context(), voudomain.EntitySaleOrder, voudomain.FinalizeInput{
		DocumentID: approved.DocumentID, Revision: approved.Revision,
	}, integrationActorOne, "sale-order-finalize")
	if err != nil {
		t.Fatalf("finalize sale order: %v", err)
	}
	return finalized, view
}

func advanceSaleOutboundToApproved(
	t *testing.T,
	service *voudomain.Service,
	refs integrationRefs,
	order voudomain.MutationResult,
	orderView voudomain.DocumentView,
	quantity string,
) (voudomain.MutationResult, voudomain.DocumentView) {
	t.Helper()
	return advanceToApproved(t, service, voudomain.EntitySaleOutbound, voudomain.DraftInput{
		BusinessDate: "2026-07-24", SourceDocumentID: order.DocumentID,
		Warehouse: &refs.warehouse,
		SourceLines: []voudomain.SourceQuantityLineInput{{
			SourceLineID: orderView.Data.ProductLines[0].LineID, Quantity: quantity,
			Remark: "销售出库行",
		}},
	})
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
	if _, err := vouchers.Finalize(t.Context(), voudomain.EntityAssetAcquisition, voudomain.FinalizeInput{
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
		if _, err = vouchers.Finalize(t.Context(), voudomain.EntityAssetDepreciation, voudomain.FinalizeInput{
			DocumentID: approved.DocumentID, Revision: approved.Revision,
		}, integrationActorOne, "asset-depreciation-finalize"); err != nil {
			t.Fatalf("finalize depreciation %s: %v", month, err)
		}
	}

	sale, _ := advanceToApproved(t, vouchers, voudomain.EntityAssetSale, voudomain.DraftInput{
		BusinessDate: "2026-04-20", Currency: "CNY", CounterpartyType: "customer", Counterparty: &refs.customer,
		AssetSaleLines: []voudomain.AssetSaleLineInput{{AssetID: assetID, SaleAmount: "900.00"}},
	})
	if _, err = vouchers.Finalize(t.Context(), voudomain.EntityAssetSale, voudomain.FinalizeInput{
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
	if _, err = vouchers.Finalize(t.Context(), voudomain.EntityAssetLiquidation, voudomain.FinalizeInput{DocumentID: liquidation.DocumentID, Revision: liquidation.Revision}, integrationActorOne, "asset-liquidation-finalize"); err != nil {
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

	inactiveApproved, _ := advancePurchaseInboundToApproved(t, vouchers, refs, "1", "1.00")
	_, err := vouchers.Finalize(t.Context(), voudomain.EntityPurchaseInbound, voudomain.FinalizeInput{
		DocumentID: inactiveApproved.DocumentID, Revision: inactiveApproved.Revision,
	}, integrationActorOne, "inactive-execute")
	if err == nil {
		t.Fatal("inactive ledger allowed VOU execution")
	}

	activateEmptyLedger(t, ledger)
	purchaseApproved, _ := advancePurchaseInboundToApproved(t, vouchers, refs, "5", "10.00")
	purchaseExecuted, err := vouchers.Finalize(t.Context(), voudomain.EntityPurchaseInbound, voudomain.FinalizeInput{
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
	saleOrder, saleOrderView := finalizeSaleOrder(t, vouchers, refs, "6")
	saleApproved, _ := advanceSaleOutboundToApproved(
		t, vouchers, refs, saleOrder, saleOrderView, "6",
	)
	_, err = vouchers.Finalize(t.Context(), voudomain.EntitySaleOutbound, voudomain.FinalizeInput{
		DocumentID: saleApproved.DocumentID, Revision: saleApproved.Revision,
	}, integrationActorOne, "negative-sale-outbound")
	if err == nil {
		t.Fatal("negative inventory sale was accepted")
	}
	saleOrder, saleOrderView = finalizeSaleOrder(t, vouchers, refs, "4")
	saleApproved, _ = advanceSaleOutboundToApproved(
		t, vouchers, refs, saleOrder, saleOrderView, "4",
	)
	saleExecuted, err := vouchers.Finalize(t.Context(), voudomain.EntitySaleOutbound, voudomain.FinalizeInput{
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
	_, err = vouchers.Unfinalize(t.Context(), voudomain.EntityPurchaseInbound, voudomain.ReverseInput{
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
	saleReversed, err := vouchers.Unfinalize(t.Context(), voudomain.EntitySaleOutbound, voudomain.ReverseInput{
		DocumentID: saleExecuted.DocumentID, Revision: saleExecuted.Revision, Reason: "撤销销售",
	}, integrationActorOne, "sale-unexecute")
	if err != nil || saleReversed.Status != voudomain.StatusApproved {
		t.Fatalf("unexecute sale = %+v, err=%v", saleReversed, err)
	}
	var saleEntryCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM led_inventory_entries
		WHERE source_document_id=$1`, saleExecuted.DocumentID).Scan(&saleEntryCount); err != nil {
		t.Fatal(err)
	}
	if saleEntryCount != 0 {
		t.Fatalf("unfinalized sale entries = %d, want 0", saleEntryCount)
	}
	if _, err = vouchers.Unfinalize(t.Context(), voudomain.EntityPurchaseInbound, voudomain.ReverseInput{
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
	if _, err := vouchers.Finalize(t.Context(), voudomain.EntityPurchaseInbound,
		voudomain.FinalizeInput{DocumentID: purchase.DocumentID, Revision: purchase.Revision},
		integrationActorOne, "inventory-count-purchase"); err != nil {
		t.Fatalf("finalize purchase: %v", err)
	}

	approved, _ := advanceToApproved(t, vouchers, voudomain.EntityInventoryCount, voudomain.DraftInput{
		BusinessDate: "2026-07-25", Currency: "CNY", Warehouse: &refs.warehouse,
		InventoryCountLines: []voudomain.InventoryCountLineInput{{
			Product: refs.product, ActualQuantity: "7", Remark: "首次盘点",
		}},
	})
	finalized, err := vouchers.Finalize(t.Context(), voudomain.EntityInventoryCount,
		voudomain.FinalizeInput{DocumentID: approved.DocumentID, Revision: approved.Revision},
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
	if _, err = vouchers.Unfinalize(t.Context(), voudomain.EntityInventoryCount,
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
	if _, err := vouchers.Finalize(t.Context(), voudomain.EntityPurchaseInbound, voudomain.FinalizeInput{
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
	finalized, err := vouchers.Finalize(
		t.Context(),
		voudomain.EntitySelfProduction,
		voudomain.FinalizeInput{
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

	reversed, err := vouchers.Unfinalize(
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
	if err != nil || reversed.Status != voudomain.StatusApproved {
		t.Fatalf("unfinalize production = %+v, err=%v", reversed, err)
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
	if _, err := vouchers.Finalize(t.Context(), voudomain.EntityPurchaseInbound, voudomain.FinalizeInput{
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
	if _, err = vouchers.Finalize(t.Context(), voudomain.EntityPurchaseReturn, voudomain.FinalizeInput{
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
	if _, err := vouchers.Finalize(t.Context(), voudomain.EntityPurchaseInbound, voudomain.FinalizeInput{
		DocumentID: purchaseApproved.DocumentID, Revision: purchaseApproved.Revision,
	}, integrationActorOne, "sale-chain-purchase-finalize"); err != nil {
		t.Fatalf("finalize purchase: %v", err)
	}

	order, orderView := finalizeSaleOrder(t, vouchers, refs, "6")
	outboundApproved, _ := advanceSaleOutboundToApproved(t, vouchers, refs, order, orderView, "6")
	outbound, err := vouchers.Finalize(t.Context(), voudomain.EntitySaleOutbound, voudomain.FinalizeInput{
		DocumentID: outboundApproved.DocumentID, Revision: outboundApproved.Revision,
	}, integrationActorOne, "sale-chain-outbound-finalize")
	if err != nil {
		t.Fatalf("finalize sale outbound: %v", err)
	}

	deliveryApproved, deliveryView := advanceToApproved(t, vouchers, voudomain.EntitySaleDelivery, voudomain.DraftInput{
		BusinessDate: "2026-07-25", SourceDocumentID: outbound.DocumentID,
		Platform: &refs.platform, Vehicle: &refs.vehicle,
	})
	delivery, err := vouchers.Finalize(t.Context(), voudomain.EntitySaleDelivery, voudomain.FinalizeInput{
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
	signoff, err := vouchers.Finalize(t.Context(), voudomain.EntitySaleSignoff, voudomain.FinalizeInput{
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
	if _, err = vouchers.Finalize(t.Context(), voudomain.EntitySaleReturn, voudomain.FinalizeInput{
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
	afterSale, err := vouchers.Finalize(t.Context(), voudomain.EntitySaleReturn, voudomain.FinalizeInput{
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
	receiptExecuted, err := vouchers.Finalize(t.Context(), voudomain.EntityCustomerReceipt, voudomain.FinalizeInput{
		DocumentID: receiptApproved.DocumentID, Revision: receiptApproved.Revision,
	}, integrationActorOne, "receipt-execute")
	if err != nil {
		t.Fatalf("execute receipt: %v", err)
	}
	paymentApproved, _ := advanceToApproved(t, vouchers, voudomain.EntitySupplierPayment, voudomain.DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "supplier",
		Counterparty: &refs.supplier, FundAccount: &refs.fundAccount, Handler: &refs.employee, Amount: "30.00",
	})
	if _, err := vouchers.Finalize(t.Context(), voudomain.EntitySupplierPayment, voudomain.FinalizeInput{
		DocumentID: paymentApproved.DocumentID, Revision: paymentApproved.Revision,
	}, integrationActorOne, "payment-execute"); err != nil {
		t.Fatalf("execute payment: %v", err)
	}
	expenseApproved, _ := advanceToApproved(t, vouchers, voudomain.EntityExpenseReimbursement, voudomain.DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Employee: &refs.employee,
		FundAccount:  &refs.fundAccount,
		ExpenseLines: []voudomain.ExpenseLineInput{{Category: "交通", Description: "测试", Amount: "20.00"}},
	})
	if _, err := vouchers.Finalize(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.FinalizeInput{
		DocumentID: expenseApproved.DocumentID, Revision: expenseApproved.Revision,
	}, integrationActorOne, "expense-execute"); err != nil {
		t.Fatalf("execute expense: %v", err)
	}
	incomeApproved, _ := advanceToApproved(t, vouchers, voudomain.EntityOtherIncome, voudomain.DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", SourceName: "测试收入",
		FundAccount: &refs.fundAccount, Handler: &refs.employee, Amount: "5.00",
	})
	if _, err := vouchers.Finalize(t.Context(), voudomain.EntityOtherIncome, voudomain.FinalizeInput{
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
	receiptApprovedAgain, err := vouchers.Unfinalize(
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
	receiptExecuted, err = vouchers.Finalize(
		t.Context(),
		voudomain.EntityCustomerReceipt,
		voudomain.FinalizeInput{
			DocumentID: receiptApprovedAgain.DocumentID,
			Revision:   receiptApprovedAgain.Revision,
		},
		integrationActorOne,
		"receipt-refinalize",
	)
	if err != nil {
		t.Fatalf("refinalize receipt: %v", err)
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
	if _, err = vouchers.Unfinalize(t.Context(), voudomain.EntityCustomerReceipt, voudomain.ReverseInput{
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
	loanFinalized, err := vouchers.Finalize(t.Context(), voudomain.EntityEmployeeLoan, voudomain.FinalizeInput{
		DocumentID: loan.DocumentID, Revision: loan.Revision,
	}, integrationActorOne, "employee-loan-finalize")
	if err != nil {
		t.Fatalf("finalize employee loan: %v", err)
	}

	repayment, _ := advanceToApproved(t, vouchers, voudomain.EntityEmployeeRepayment, voudomain.DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Counterparty: &refs.employee,
		FundAccount: &refs.fundAccount, Handler: &refs.employee, Amount: "30.00",
	})
	if _, err := vouchers.Finalize(t.Context(), voudomain.EntityEmployeeRepayment, voudomain.FinalizeInput{
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
	writeoffFinalized, err := vouchers.Finalize(t.Context(), voudomain.EntityEmployeeLoanWriteoff, voudomain.FinalizeInput{
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

	excess, _ := advanceToApproved(t, vouchers, voudomain.EntityEmployeeLoanWriteoff, voudomain.DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Employee: &refs.employee,
		ExpenseLines: []voudomain.ExpenseLineInput{{Category: "差旅", Description: "超额核销", Amount: "20.01"}},
	})
	if _, err = vouchers.Finalize(t.Context(), voudomain.EntityEmployeeLoanWriteoff, voudomain.FinalizeInput{
		DocumentID: excess.DocumentID, Revision: excess.Revision,
	}, integrationActorOne, "employee-writeoff-excess"); err == nil {
		t.Fatal("employee loan writeoff exceeded the as-of-date balance")
	}
	if _, err = vouchers.Unfinalize(t.Context(), voudomain.EntityEmployeeLoan, voudomain.ReverseInput{
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

	if _, err = vouchers.Unfinalize(t.Context(), voudomain.EntityEmployeeLoanWriteoff, voudomain.ReverseInput{
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

func TestLEDPermissionCatalogIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	var count int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM app_permissions WHERE domain = 'led'`).Scan(&count); err != nil {
		t.Fatalf("count LED permissions: %v", err)
	}
	if count != 20 {
		t.Fatalf("LED permission count = %d, want 20", count)
	}
}

func TestLEDMonthEndClosingAndUncloseIntegration(t *testing.T) {
	pool := ledIntegrationPool(t)
	truncateLedgerAndVOU(t, pool)
	t.Cleanup(func() { truncateLedgerAndVOU(t, pool) })
	ledger, _ := newIntegratedServices(t, pool)
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
