//go:build integration

package wfl

import (
	"context"
	"encoding/json"
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
	if err = vouchers.RegisterCompletionSubscriptions(events); err != nil {
		t.Fatalf("register voucher completion subscriptions: %v", err)
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
	finalize bool,
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
	if finalize {
		result = advanceWorkflowDocument(t, service, entity, created)
	}
	view, err := service.Get(t.Context(), entity, voudomain.GetInput{DocumentID: result.DocumentID})
	if err != nil {
		t.Fatalf("get %s: %v", entity, err)
	}
	return result, view
}

func TestWorkflowQuerySalesProgressByUnitIntegration(t *testing.T) {
	pool := workflowIntegrationPool(t)
	truncateWorkflowIntegration(t, pool)
	t.Cleanup(func() { truncateWorkflowIntegration(t, pool) })
	workflows, vouchers, refs := newWorkflowIntegrationServices(t, pool)

	order, orderView := createWorkflowDocument(t, vouchers, voudomain.EntitySaleOrder, voudomain.DraftInput{
		BusinessDate: "2026-07-31", Currency: "CNY", Customer: &refs.customer,
		Warehouse: &refs.warehouse,
		ProductLines: []voudomain.ProductLineInput{
			{Product: refs.products[0], OrderedQuantity: "12", UnitPrice: "10"},
			{Product: refs.products[1], OrderedQuantity: "5", UnitPrice: "20"},
			{Product: refs.products[2], OrderedQuantity: "4", UnitPrice: "30"},
		},
	}, true)
	lines := orderView.Data.ProductLines
	var generatedOutboundID string
	var generatedOutboundRevision int64
	var generatedOutboundCreator string
	if err := pool.QueryRow(t.Context(), `SELECT d.id,d.revision,d.created_by
		FROM vou_documents d JOIN vou_sale_outbound_details detail ON detail.document_id=d.id
		WHERE detail.source_order_id=$1 AND d.status='DRAFT'`, order.DocumentID).
		Scan(&generatedOutboundID, &generatedOutboundRevision, &generatedOutboundCreator); err != nil {
		t.Fatalf("load generated outbound draft: %v", err)
	}
	var sourceCreator, processCreator, processAuditActor, generatedAuditActor string
	if err := pool.QueryRow(t.Context(), `SELECT created_by FROM vou_documents WHERE id=$1`, order.DocumentID).Scan(&sourceCreator); err != nil {
		t.Fatalf("load source order creator: %v", err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT created_by FROM wfl_process_instances WHERE id=$1`, order.DocumentID).Scan(&processCreator); err != nil {
		t.Fatalf("load workflow creator: %v", err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT actor_id FROM wfl_audit_events
		WHERE process_id=$1 ORDER BY occurred_at LIMIT 1`, order.DocumentID).Scan(&processAuditActor); err != nil {
		t.Fatalf("load workflow audit actor: %v", err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT actor_id FROM vou_audit_events
		WHERE document_id=$1 AND event_type='CREATED' ORDER BY occurred_at LIMIT 1`, generatedOutboundID).Scan(&generatedAuditActor); err != nil {
		t.Fatalf("load generated outbound audit actor: %v", err)
	}
	if sourceCreator != workflowIntegrationActor || generatedOutboundCreator != systemidentity.UserID ||
		generatedAuditActor != systemidentity.UserID || processCreator != systemidentity.UserID ||
		processAuditActor != systemidentity.UserID {
		t.Fatalf("automatic actors source=%s outbound=%s outboundAudit=%s process=%s processAudit=%s",
			sourceCreator, generatedOutboundCreator, generatedAuditActor, processCreator, processAuditActor)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin generated outbound cleanup: %v", err)
	}
	for _, statement := range []string{
		`DELETE FROM wfl_process_documents WHERE document_id=$1`,
		`DELETE FROM vou_audit_events WHERE document_id=$1`,
		`DELETE FROM vou_sale_outbound_lines WHERE document_id=$1`,
		`DELETE FROM vou_sale_outbound_details WHERE document_id=$1`,
		`DELETE FROM vou_documents WHERE id=$1`,
	} {
		if _, err = tx.Exec(t.Context(), statement, generatedOutboundID); err != nil {
			_ = tx.Rollback(t.Context())
			t.Fatalf("delete generated outbound draft: %v", err)
		}
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit generated outbound cleanup: %v", err)
	}
	_ = generatedOutboundRevision
	outboundOne, outboundOneView := createWorkflowDocument(t, vouchers, voudomain.EntitySaleOutbound, voudomain.DraftInput{
		BusinessDate: "2026-07-31", SourceDocumentID: order.DocumentID, Warehouse: &refs.warehouse,
		SourceLines: []voudomain.SourceQuantityLineInput{
			{SourceLineID: lines[0].LineID, Quantity: "6"},
			{SourceLineID: lines[1].LineID, Quantity: "2"},
			{SourceLineID: lines[2].LineID, Quantity: "4"},
		},
	}, true)
	deliveryOne, deliveryOneView := createWorkflowDocument(t, vouchers, voudomain.EntitySaleDelivery, voudomain.DraftInput{
		BusinessDate: "2026-07-31", SourceDocumentID: outboundOne.DocumentID,
		Platform: &refs.platform, Vehicle: &refs.vehicle,
	}, true)
	projectionTx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin delivery condition projection: %v", err)
	}
	deliveryProjection, err := loadConditionProjection(t.Context(), projectionTx, deliveryOne.DocumentID)
	_ = projectionTx.Rollback(t.Context())
	if err != nil {
		t.Fatalf("load delivery condition projection: %v", err)
	}
	matched, err := evaluateCondition(json.RawMessage(`{"lineAny":{"field":"quantity","operator":"EQ","value":6}}`), deliveryProjection)
	if err != nil || !matched || len(deliveryProjection.Lines) != 3 {
		t.Fatalf("delivery line condition matched=%t lines=%d err=%v projection=%+v", matched, len(deliveryProjection.Lines), err, deliveryProjection)
	}
	_, signoffOneView := createWorkflowDocument(t, vouchers, voudomain.EntitySaleSignoff, voudomain.DraftInput{
		BusinessDate: "2026-07-31", SourceDocumentID: deliveryOne.DocumentID,
		SignoffLines: []voudomain.SaleSignoffLineInput{
			{SourceLineID: deliveryOneView.Data.ProductLines[0].LineID, SignedQuantity: "4", RejectedQuantity: "1"},
			{SourceLineID: deliveryOneView.Data.ProductLines[1].LineID, SignedQuantity: "1", RejectedQuantity: "1"},
			{SourceLineID: deliveryOneView.Data.ProductLines[2].LineID, SignedQuantity: "4", RejectedQuantity: "0"},
		},
	}, true)
	projectionTx, err = pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin signoff condition projection: %v", err)
	}
	signoffProjection, err := loadConditionProjection(t.Context(), projectionTx, signoffOneView.DocumentID)
	_ = projectionTx.Rollback(t.Context())
	if err != nil {
		t.Fatalf("load signoff condition projection: %v", err)
	}
	matched, err = evaluateCondition(json.RawMessage(`{"lineAny":{"field":"quantity","operator":"EQ","value":4}}`), signoffProjection)
	if err != nil || !matched {
		t.Fatalf("signoff line condition matched=%t err=%v projection=%+v", matched, err, signoffProjection)
	}
	var refusalOneID string
	var refusalOneRevision int64
	if err := pool.QueryRow(t.Context(), `SELECT d.id,d.revision
		FROM vou_documents d JOIN vou_sale_return_details r ON r.document_id=d.id
		WHERE r.source_signoff_id=$1`, signoffOneView.DocumentID).
		Scan(&refusalOneID, &refusalOneRevision); err != nil {
		t.Fatalf("load first refusal return: %v", err)
	}
	advanceWorkflowDocument(t, vouchers, voudomain.EntitySaleReturn, voudomain.MutationResult{
		DocumentID: refusalOneID, Revision: refusalOneRevision,
	})

	outboundTwo, _ := createWorkflowDocument(t, vouchers, voudomain.EntitySaleOutbound, voudomain.DraftInput{
		BusinessDate: "2026-07-31", SourceDocumentID: order.DocumentID, Warehouse: &refs.warehouse,
		SourceLines: []voudomain.SourceQuantityLineInput{{SourceLineID: lines[0].LineID, Quantity: "2"}},
	}, true)
	deliveryTwo, deliveryTwoView := createWorkflowDocument(t, vouchers, voudomain.EntitySaleDelivery, voudomain.DraftInput{
		BusinessDate: "2026-07-31", SourceDocumentID: outboundTwo.DocumentID,
		Platform: &refs.platform, Vehicle: &refs.vehicle,
	}, true)
	createWorkflowDocument(t, vouchers, voudomain.EntitySaleSignoff, voudomain.DraftInput{
		BusinessDate: "2026-07-31", SourceDocumentID: deliveryTwo.DocumentID,
		SignoffLines: []voudomain.SaleSignoffLineInput{{
			SourceLineID:   deliveryTwoView.Data.ProductLines[0].LineID,
			SignedQuantity: "1", RejectedQuantity: "1",
		}},
	}, true)
	createWorkflowDocument(t, vouchers, voudomain.EntitySaleOutbound, voudomain.DraftInput{
		BusinessDate: "2026-07-31", SourceDocumentID: order.DocumentID, Warehouse: &refs.warehouse,
		SourceLines: []voudomain.SourceQuantityLineInput{{SourceLineID: lines[0].LineID, Quantity: "2"}},
	}, true)
	afterSaleOne, _ := createWorkflowDocument(t, vouchers, voudomain.EntitySaleReturn, voudomain.DraftInput{
		BusinessDate: "2026-07-31", Warehouse: &refs.warehouse, ReturnReason: "售后退回",
		ReturnLines: []voudomain.ReturnLineInput{{
			SourceLineID: signoffOneView.Data.SignoffLines[0].LineID, Quantity: "1",
		}},
	}, true)
	_ = afterSaleOne
	createWorkflowDocument(t, vouchers, voudomain.EntitySaleReturn, voudomain.DraftInput{
		BusinessDate: "2026-07-31", Warehouse: &refs.warehouse, ReturnReason: "售后处理中",
		ReturnLines: []voudomain.ReturnLineInput{{
			SourceLineID: signoffOneView.Data.SignoffLines[0].LineID, Quantity: "0.5",
		}},
	}, false)

	page, err := workflows.SalesQuery(t.Context(), QueryInput{Page: 1, PageSize: 20})
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("sales query items=%d err=%v", len(page.Items), err)
	}
	item := page.Items[0]
	if item.RootDocumentNo != order.DocumentNo || item.PartyName != "流程客户" ||
		item.BusinessDate != "2026-07-31" || item.Currency != "CNY" {
		t.Fatalf("sales list key data = %+v", item.ProcessListItem)
	}
	if item.Summary.Unit != "KG" || !item.Summary.WarehouseAvailable ||
		item.Summary.ShortageQuantity != "5000" || item.Summary.OutboundQuantity != "12004" ||
		item.Summary.InTransitQuantity != "2000" || item.Summary.SignedQuantity != "6004" ||
		item.Summary.OrderedQuantity != "17004" || item.Summary.NetSignedQuantity != "5004" {
		t.Fatalf("sales kg summary = %+v", item.Summary)
	}
	if len(item.ProgressGroups) != 2 {
		t.Fatalf("sales progress groups = %+v", item.ProgressGroups)
	}
	groups := map[string]SalesProgressGroup{}
	for _, group := range item.ProgressGroups {
		groups[group.Unit] = group
	}
	ton := groups["吨"]
	if ton.ProductCount != 2 || ton.OrderedQuantity != "17" ||
		ton.OutboundProcessingQuantity != "9" || ton.FinalizedOutboundQuantity != "12" ||
		ton.InTransitQuantity != "2" || ton.SignedQuantity != "6" ||
		ton.RejectedQuantity != "3" || ton.LossQuantity != "1" ||
		ton.RefusalReturnProcessingQuantity != "1" || ton.RefusalReturnedQuantity != "2" ||
		ton.AfterSaleReturnProcessingQuantity != "0.5" || ton.AfterSaleReturnedQuantity != "1" ||
		ton.NetSignedQuantity != "5" || ton.RemainingQuantity != "9" {
		t.Fatalf("sales ton progress = %+v", ton)
	}
	bucket := groups["件"]
	if bucket.ProductCount != 1 || bucket.OrderedQuantity != "4" ||
		bucket.SignedQuantity != "4" || bucket.RemainingQuantity != "0" {
		t.Fatalf("sales bucket progress = %+v", bucket)
	}
	_ = outboundOneView
}

func TestWorkflowQueryPurchaseProgressByUnitIntegration(t *testing.T) {
	pool := workflowIntegrationPool(t)
	truncateWorkflowIntegration(t, pool)
	t.Cleanup(func() { truncateWorkflowIntegration(t, pool) })
	workflows, vouchers, refs := newWorkflowIntegrationServices(t, pool)

	order, _ := createWorkflowDocument(t, vouchers, voudomain.EntityPurchaseOrder, voudomain.DraftInput{
		BusinessDate: "2026-07-31", Currency: "CNY", Supplier: &refs.supplier,
		Purchaser: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []voudomain.ProductLineInput{
			{Product: refs.products[0], OrderedQuantity: "10", UnitPrice: "10"},
			{Product: refs.products[1], OrderedQuantity: "5", UnitPrice: "20"},
			{Product: refs.products[2], OrderedQuantity: "4", UnitPrice: "30"},
		},
	}, false)
	checkedOrder, err := vouchers.Check(t.Context(), voudomain.EntityPurchaseOrder, voudomain.DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: order.Revision,
	}, workflowIntegrationActor, "wfl-purchase-order-check")
	if err != nil {
		t.Fatalf("check purchase order: %v", err)
	}
	order, err = vouchers.Approve(t.Context(), voudomain.EntityPurchaseOrder, voudomain.DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: checkedOrder.Revision,
	}, workflowIntegrationActor, "wfl-purchase-order-approve")
	if err != nil {
		t.Fatalf("approve purchase order: %v", err)
	}
	orderView, err := vouchers.Get(t.Context(), voudomain.EntityPurchaseOrder, voudomain.GetInput{
		DocumentID: order.DocumentID,
	})
	if err != nil {
		t.Fatalf("get purchase order: %v", err)
	}
	lines := orderView.Data.ProductLines
	inbound, inboundView := createWorkflowDocument(t, vouchers, voudomain.EntityPurchaseInbound, voudomain.DraftInput{
		BusinessDate: "2026-07-31", SourceDocumentID: order.DocumentID, Warehouse: &refs.warehouse,
		SourceLines: []voudomain.SourceQuantityLineInput{
			{SourceLineID: lines[0].LineID, Quantity: "4"},
			{SourceLineID: lines[1].LineID, Quantity: "2"},
			{SourceLineID: lines[2].LineID, Quantity: "4"},
		},
	}, true)
	createWorkflowDocument(t, vouchers, voudomain.EntityPurchaseInbound, voudomain.DraftInput{
		BusinessDate: "2026-07-31", SourceDocumentID: order.DocumentID, Warehouse: &refs.warehouse,
		SourceLines: []voudomain.SourceQuantityLineInput{{SourceLineID: lines[0].LineID, Quantity: "2"}},
	}, false)
	createWorkflowDocument(t, vouchers, voudomain.EntityPurchaseReturn, voudomain.DraftInput{
		BusinessDate: "2026-07-31", Warehouse: &refs.warehouse, ReturnReason: "已完成退货",
		ReturnLines: []voudomain.ReturnLineInput{{
			SourceLineID: inboundView.Data.ProductLines[0].LineID, Quantity: "1",
		}},
	}, true)
	createWorkflowDocument(t, vouchers, voudomain.EntityPurchaseReturn, voudomain.DraftInput{
		BusinessDate: "2026-07-31", Warehouse: &refs.warehouse, ReturnReason: "退货处理中",
		ReturnLines: []voudomain.ReturnLineInput{{
			SourceLineID: inboundView.Data.ProductLines[1].LineID, Quantity: "1",
		}},
	}, false)

	page, err := workflows.PurchaseQuery(t.Context(), QueryInput{Page: 1, PageSize: 20})
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("purchase query items=%d err=%v", len(page.Items), err)
	}
	item := page.Items[0]
	if item.RootDocumentNo != order.DocumentNo || item.PartyName != "流程供应商" ||
		item.BusinessDate != "2026-07-31" || item.Currency != "CNY" {
		t.Fatalf("purchase list key data = %+v", item.ProcessListItem)
	}
	if item.Summary.Unit != "KG" || item.Summary.OrderedQuantity != "15004" ||
		item.Summary.InboundQuantity != "6004" || item.Summary.ReturnProcessingQuantity != "1000" ||
		item.Summary.NetInboundQuantity != "5004" {
		t.Fatalf("purchase kg summary = %+v", item.Summary)
	}
	groups := map[string]PurchaseProgressGroup{}
	for _, group := range item.ProgressGroups {
		groups[group.Unit] = group
	}
	if len(groups) != 2 {
		t.Fatalf("purchase progress groups = %+v", item.ProgressGroups)
	}
	ton := groups["吨"]
	if ton.ProductCount != 2 || ton.OrderedQuantity != "15" ||
		ton.InboundProcessingQuantity != "2" || ton.FinalizedInboundQuantity != "6" ||
		ton.ReturnProcessingQuantity != "1" || ton.ReturnedQuantity != "1" ||
		ton.NetInboundQuantity != "5" || ton.RemainingQuantity != "8" {
		t.Fatalf("purchase ton progress = %+v", ton)
	}
	bucket := groups["件"]
	if bucket.ProductCount != 1 || bucket.OrderedQuantity != "4" ||
		bucket.FinalizedInboundQuantity != "4" || bucket.RemainingQuantity != "0" {
		t.Fatalf("purchase bucket progress = %+v", bucket)
	}
	_ = inbound
}
