//go:build integration

package vou

import (
	"context"
	"sync"
	"testing"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/businessdate"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
)

func TestFulfilledPurchaseOrderAllowsReturnDraftInOpenPeriodIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	closingID := newID()
	t.Cleanup(func() {
		cleanupContext := context.Background()
		if _, err := pool.Exec(cleanupContext, `UPDATE led_control
			SET last_closing_id=NULL WHERE singleton=true`); err != nil {
			t.Errorf("clear closing control: %v", err)
		}
		if _, err := pool.Exec(cleanupContext, `DELETE FROM led_closings WHERE id=$1`, closingID); err != nil {
			t.Errorf("delete closing: %v", err)
		}
		truncateVOU(t, pool)
	})
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	order, err := service.CreateManagedPurchaseOrder(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28", Currency: "CNY",
		Supplier: &refs.supplier, Purchaser: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{{
			Product: refs.product, OrderedQuantity: "3", UnitPrice: "12.00",
		}},
	}}, integrationActorOne, "closed-purchase-create")
	if err != nil {
		t.Fatalf("create purchase order: %v", err)
	}
	checkedOrder, err := service.Check(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: order.Revision,
	}, integrationActorOne, "closed-purchase-check")
	if err != nil {
		t.Fatalf("check purchase order: %v", err)
	}
	_, err = service.Approve(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: checkedOrder.Revision,
	}, integrationActorOne, "closed-purchase-approve")
	if err != nil {
		t.Fatalf("approve purchase order: %v", err)
	}
	orderView, err := service.Get(t.Context(), EntityPurchaseOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil {
		t.Fatalf("get purchase order: %v", err)
	}
	orderLineID := orderView.Data.ProductLines[0].LineID
	inbound, err := service.CreatePurchaseInbound(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-29", SourceDocumentID: order.DocumentID,
		Warehouse:   &refs.warehouse,
		SourceLines: []SourceQuantityLineInput{{SourceLineID: orderLineID, Quantity: "3"}},
	}}, integrationActorOne, "closed-purchase-inbound-create")
	if err != nil {
		t.Fatalf("create purchase inbound: %v", err)
	}
	checkedInbound, err := service.Check(t.Context(), EntityPurchaseInbound, DocumentRevisionInput{
		DocumentID: inbound.DocumentID, Revision: inbound.Revision,
	}, integrationActorOne, "closed-purchase-inbound-check")
	if err != nil {
		t.Fatalf("check purchase inbound: %v", err)
	}
	approvedInbound, err := service.Approve(t.Context(), EntityPurchaseInbound, DocumentRevisionInput{
		DocumentID: inbound.DocumentID, Revision: checkedInbound.Revision,
	}, integrationActorOne, "closed-purchase-inbound-approve")
	if err != nil {
		t.Fatalf("approve purchase inbound: %v", err)
	}
	inboundView, err := service.Get(t.Context(), EntityPurchaseInbound, GetInput{DocumentID: approvedInbound.DocumentID})
	if err != nil {
		t.Fatalf("get purchase inbound: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO led_closings(
		id,closing_date,opening_date,revision,closed_by,request_id
	) VALUES($1,$2::date,$3::date,1,$4,$5)`, closingID, "2026-07-31", "2026-08-01",
		integrationActorOne, "closed-purchase-closing"); err != nil {
		t.Fatalf("insert closing: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `UPDATE led_control SET
		last_closing_id=$1,revision=revision+1,updated_at=now(),updated_by=$2
		WHERE singleton=true`, closingID, integrationActorOne); err != nil {
		t.Fatalf("set closing control: %v", err)
	}
	returnDraft, err := service.CreatePurchaseReturn(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-08-01", Warehouse: &refs.warehouse,
		ReturnReason: "开放期间采购退货",
		ReturnLines: []ReturnLineInput{{
			SourceLineID: inboundView.Data.ProductLines[0].LineID, Quantity: "1",
		}},
	}}, integrationActorOne, "fulfilled-purchase-return-create")
	if err != nil || returnDraft.Status != StatusDraft {
		t.Fatalf("create return draft = %+v, err=%v", returnDraft, err)
	}
	var orderStatus, fulfillment string
	var childCount int
	if err = pool.QueryRow(t.Context(), `SELECT d.status,o.fulfillment_status
		FROM vou_documents d JOIN vou_purchase_order_details o ON o.document_id=d.id
		WHERE d.id=$1`, order.DocumentID).Scan(&orderStatus, &fulfillment); err != nil {
		t.Fatalf("read closed purchase order: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM vou_documents
		WHERE parent_document_id=$1`, order.DocumentID).Scan(&childCount); err != nil {
		t.Fatalf("count rolled back purchase children: %v", err)
	}
	if orderStatus != StatusApproved || fulfillment != "FULFILLED" || childCount != 2 {
		t.Fatalf("fulfilled purchase order changed = status:%s fulfillment:%s children:%d", orderStatus, fulfillment, childCount)
	}
}

func TestPurchaseFulfillmentQuantitiesAndReservationsIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	general := bobdomain.SupplierTypeGeneral
	prepaid := fixedSettlementReference(t, pool, bobdomain.SettlementTermPrepaid)
	refs.supplier = createApprovedBOB(t, bobdomain.NewService(pool), bobdomain.EntitySupplier, bobdomain.CreateDetailInput{
		Code: "VSP" + newID(), Name: "VOU 预付供应商", SupplierType: &general,
		SettlementMethodID: prepaid.ObjectID, SalespersonEmployeeID: refs.employee.ObjectID,
	})
	refs.product = createApprovedBOB(t, bobdomain.NewService(pool), bobdomain.EntityProduct, bobdomain.CreateDetailInput{
		Code: "VPP" + newID(), Name: "VOU 预付采购包装物", Unit: "件",
		ProductKind: bobdomain.ProductKindPackaging,
	})
	activateSettlementLedgerForParty(
		t, pool, "supplier", refs.supplier, 12000,
		businessdate.Today().Format(businessdate.Layout),
	)
	bus := txevent.NewBus()
	registerSettlementPosting := func(entity string, sign int64) {
		t.Helper()
		if err := bus.Subscribe(DocumentApprovedTopic(entity), "test-led-posting",
			func(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
				event := raw.(DocumentApprovedEvent)
				var amount int64
				if err := tx.QueryRow(ctx, `SELECT total_amount_cents FROM vou_documents WHERE id=$1`, event.DocumentID).Scan(&amount); err != nil {
					return err
				}
				_, err := tx.Exec(ctx, `INSERT INTO led_party_entries(
					id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
					source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,
					counterparty_entity,counterparty_object_id,counterparty_version_id,
					counterparty_code,counterparty_name,currency,amount_delta_cents
				) SELECT $1,active_generation_id,'POSTING',$2,$3,$4,'',$5,$6::date,now(),$7,$8,
					'supplier',$9,$10,'SUPPLIER','VOU 预付供应商','CNY',$11
				FROM led_control WHERE singleton AND status='ACTIVE'`,
					newID(), entity, event.DocumentID, event.DocumentNo, event.Revision,
					businessdate.Today(), event.ActorID, event.RequestID,
					refs.supplier.ObjectID, refs.supplier.VersionID, sign*amount)
				return err
			}); err != nil {
			t.Fatalf("register %s settlement posting: %v", entity, err)
		}
		if err := bus.Subscribe(DocumentUnapprovedTopic(entity), "test-led-reversal",
			func(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
				event := raw.(DocumentUnapprovedEvent)
				_, err := tx.Exec(ctx, `DELETE FROM led_party_entries
					WHERE source_entity=$1 AND source_document_id=$2`, entity, event.DocumentID)
				return err
			}); err != nil {
			t.Fatalf("register %s settlement reversal: %v", entity, err)
		}
	}
	registerSettlementPosting(EntityPurchaseInbound, -1)
	registerSettlementPosting(EntityPurchaseReturn, 1)
	service := newIntegrationServiceWithBus(t, pool, bus)

	order, err := service.CreateManagedPurchaseOrder(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28", Currency: "CNY",
		Supplier: &refs.supplier, Purchaser: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{{
			Product: refs.product, OrderedQuantity: "10", UnitPrice: "12.00",
		}},
	}}, integrationActorOne, "purchase-create")
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	checked, err := service.Check(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: order.Revision,
	}, integrationActorOne, "purchase-check")
	if err != nil {
		domainErr, _ := err.(*DomainError)
		t.Fatalf("check order: %#v cause=%v", err, domainErr.Cause)
	}
	var orderAmount, prepaidBalance int64
	if err = pool.QueryRow(t.Context(), `SELECT document.total_amount_cents,
		COALESCE(sum(entry.amount_delta_cents),0)::bigint
		FROM vou_documents document
		JOIN vou_purchase_order_details detail ON detail.document_id=document.id
		LEFT JOIN led_party_entries entry ON entry.counterparty_entity='supplier'
		 AND entry.counterparty_object_id=detail.supplier_object_id
		 AND entry.currency=document.currency AND entry.account_type='TRADE'
		WHERE document.id=$1 GROUP BY document.total_amount_cents`, order.DocumentID).
		Scan(&orderAmount, &prepaidBalance); err != nil || orderAmount != 12000 || prepaidBalance != 12000 {
		t.Fatalf("prepaid purchase setup = amount:%d balance:%d err=%v", orderAmount, prepaidBalance, err)
	}
	approved, err := service.Approve(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: checked.Revision,
	}, integrationActorOne, "purchase-approve")
	if err != nil {
		t.Fatalf("approve order: %v", err)
	}
	view, err := service.Get(t.Context(), EntityPurchaseOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	sourceLineID := view.Data.ProductLines[0].LineID
	createInbound := func(quantity, requestID string) MutationResult {
		t.Helper()
		result, createErr := service.CreatePurchaseInbound(t.Context(), CreateInput{Data: DraftInput{
			BusinessDate: "2026-07-28", SourceDocumentID: order.DocumentID,
			Warehouse: &refs.warehouse,
			SourceLines: []SourceQuantityLineInput{{
				SourceLineID: sourceLineID, Quantity: quantity,
			}},
		}}, integrationActorOne, requestID)
		if createErr != nil {
			t.Fatalf("create inbound %s: %v", quantity, createErr)
		}
		return result
	}
	approveInbound := func(inbound MutationResult, requestID string) MutationResult {
		t.Helper()
		checkedInbound, checkErr := service.Check(
			t.Context(), EntityPurchaseInbound, DocumentRevisionInput{
				DocumentID: inbound.DocumentID, Revision: inbound.Revision,
			}, integrationActorOne, requestID+"-check")
		if checkErr != nil {
			t.Fatalf("check inbound: %v", checkErr)
		}
		approvedInbound, approveErr := service.Approve(
			t.Context(), EntityPurchaseInbound, DocumentRevisionInput{
				DocumentID: inbound.DocumentID, Revision: checkedInbound.Revision,
			}, integrationActorOne, requestID+"-approve")
		if approveErr != nil {
			t.Fatalf("approve inbound: %v", approveErr)
		}
		if approvedInbound.Status != StatusApproved {
			t.Fatalf("approved inbound status = %s", approvedInbound.Status)
		}
		return approvedInbound
	}

	first := createInbound("4", "inbound-one")
	if _, err = service.CreatePurchaseInbound(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28", SourceDocumentID: order.DocumentID,
		Warehouse: &refs.warehouse,
		SourceLines: []SourceQuantityLineInput{{
			SourceLineID: sourceLineID, Quantity: "7",
		}},
	}}, integrationActorOne, "inbound-over"); err == nil {
		t.Fatal("cumulative inbound overage was accepted")
	}
	approvedFirst := approveInbound(first, "inbound-one")
	firstView, err := service.Get(t.Context(), EntityPurchaseInbound, GetInput{
		DocumentID: first.DocumentID,
	})
	if err != nil {
		t.Fatalf("get first inbound: %v", err)
	}
	partialReturn, err := service.CreatePurchaseReturn(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-29", Warehouse: &refs.warehouse,
		ReturnReason: "部分入库退货",
		ReturnLines: []ReturnLineInput{{
			SourceLineID: firstView.Data.ProductLines[0].LineID, Quantity: "1",
		}},
	}}, integrationActorOne, "partial-purchase-return-create")
	if err != nil {
		t.Fatalf("create partial purchase return: %v", err)
	}
	partialChecked, err := service.Check(t.Context(), EntityPurchaseReturn, DocumentRevisionInput{
		DocumentID: partialReturn.DocumentID, Revision: partialReturn.Revision,
	}, integrationActorOne, "partial-purchase-return-check")
	if err != nil {
		t.Fatalf("check partial purchase return: %v", err)
	}
	partialApproved, err := service.Approve(t.Context(), EntityPurchaseReturn, DocumentRevisionInput{
		DocumentID: partialReturn.DocumentID, Revision: partialChecked.Revision,
	}, integrationActorOne, "partial-purchase-return-approve")
	if err != nil {
		t.Fatalf("approve partial purchase return: %v", err)
	}
	var reservationActive bool
	var reservedAmount int64
	if err = pool.QueryRow(t.Context(), `SELECT active,reserved_amount_cents
		FROM vou_settlement_reservations WHERE order_id=$1`, order.DocumentID).
		Scan(&reservationActive, &reservedAmount); err != nil || !reservationActive || reservedAmount != 8400 {
		t.Fatalf("partial purchase return reservation = active:%t amount:%d err=%v", reservationActive, reservedAmount, err)
	}
	partialReversed, err := service.Unapprove(t.Context(), EntityPurchaseReturn, ReverseInput{
		DocumentID: partialReturn.DocumentID, Revision: partialApproved.Revision,
		Reason: "清理部分退货测试",
	}, integrationActorOne, "partial-purchase-return-unapprove")
	if err != nil {
		t.Fatalf("unapprove partial purchase return: %v", err)
	}
	partialDraft, err := service.Uncheck(t.Context(), EntityPurchaseReturn, DocumentRevisionInput{
		DocumentID: partialReturn.DocumentID, Revision: partialReversed.Revision,
	}, integrationActorOne, "partial-purchase-return-uncheck")
	if err != nil {
		t.Fatalf("uncheck partial purchase return: %v", err)
	}
	if _, err = service.Delete(t.Context(), EntityPurchaseReturn, DeleteInput{
		DocumentID: partialReturn.DocumentID, Revision: partialDraft.Revision,
		Reason: "清理部分退货测试",
	}, integrationActorOne, "partial-purchase-return-delete"); err != nil {
		t.Fatalf("delete partial purchase return: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT active,reserved_amount_cents
		FROM vou_settlement_reservations WHERE order_id=$1`, order.DocumentID).
		Scan(&reservationActive, &reservedAmount); err != nil || !reservationActive || reservedAmount != 7200 {
		t.Fatalf("partial return reversal reservation = active:%t amount:%d err=%v", reservationActive, reservedAmount, err)
	}

	draft := createInbound("6", "inbound-draft")
	if _, err = service.DeletePurchaseInbound(t.Context(), ReverseInput{
		DocumentID: draft.DocumentID, Revision: draft.Revision, Reason: "重新拆分",
	}, integrationActorOne, "inbound-delete"); err != nil {
		t.Fatalf("delete inbound draft: %v", err)
	}
	second := createInbound("6", "inbound-two")
	approvedSecond := approveInbound(second, "inbound-two")

	var fulfillment string
	if err = pool.QueryRow(t.Context(), `SELECT fulfillment_status
		FROM vou_purchase_order_details
		WHERE document_id=$1`, order.DocumentID).Scan(&fulfillment); err != nil {
		t.Fatalf("read fulfillment: %v", err)
	}
	if fulfillment != "FULFILLED" {
		t.Fatalf("fulfillment = %s", fulfillment)
	}
	temporaryReturn, err := service.CreatePurchaseReturn(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-29", Warehouse: &refs.warehouse,
		ReturnReason: "临时采购退货",
		ReturnLines: []ReturnLineInput{{
			SourceLineID: firstView.Data.ProductLines[0].LineID, Quantity: "1",
		}},
	}}, integrationActorOne, "temporary-purchase-return-create")
	if err != nil {
		t.Fatalf("create temporary purchase return: %v", err)
	}
	orderWithDraftReturn, err := service.Get(t.Context(), EntityPurchaseOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil || orderWithDraftReturn.Status != StatusApproved {
		t.Fatalf("draft return changed order lifecycle: status=%s err=%v", orderWithDraftReturn.Status, err)
	}
	if _, err = service.Delete(t.Context(), EntityPurchaseReturn, DeleteInput{
		DocumentID: temporaryReturn.DocumentID, Revision: temporaryReturn.Revision,
		Reason: "取消临时采购退货",
	}, integrationActorOne, "temporary-purchase-return-delete"); err != nil {
		t.Fatalf("delete temporary purchase return: %v", err)
	}
	orderWithoutDraftReturn, err := service.Get(t.Context(), EntityPurchaseOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil || orderWithoutDraftReturn.Status != StatusApproved {
		t.Fatalf("deleting draft return changed order lifecycle: status=%s err=%v", orderWithoutDraftReturn.Status, err)
	}
	if _, err = pool.Exec(t.Context(), `DELETE FROM vou_settlement_reservations WHERE order_id=$1`, order.DocumentID); err != nil {
		t.Fatalf("remove completed legacy reservation fixture: %v", err)
	}
	purchaseReturn, err := service.CreatePurchaseReturn(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-29", Warehouse: &refs.warehouse,
		ReturnReason: "供应商质量退货",
		ReturnLines: []ReturnLineInput{{
			SourceLineID: firstView.Data.ProductLines[0].LineID, Quantity: "2",
		}},
	}}, integrationActorOne, "purchase-return-create")
	if err != nil {
		t.Fatalf("create purchase return: %v", err)
	}
	returnChecked, err := service.Check(t.Context(), EntityPurchaseReturn, DocumentRevisionInput{
		DocumentID: purchaseReturn.DocumentID, Revision: purchaseReturn.Revision,
	}, integrationActorOne, "purchase-return-check")
	if err != nil {
		t.Fatalf("check purchase return: %v", err)
	}
	returnApproved, err := service.Approve(t.Context(), EntityPurchaseReturn, DocumentRevisionInput{
		DocumentID: purchaseReturn.DocumentID, Revision: returnChecked.Revision,
	}, integrationActorOne, "purchase-return-approve")
	if err != nil {
		t.Fatalf("approve purchase return: %v", err)
	}
	if returnApproved.Status != StatusApproved {
		t.Fatalf("approved purchase return status = %s", returnApproved.Status)
	}
	if err = pool.QueryRow(t.Context(), `SELECT fulfillment_status
		FROM vou_purchase_order_details WHERE document_id=$1`, order.DocumentID).
		Scan(&fulfillment); err != nil || fulfillment != "OPEN" {
		t.Fatalf("purchase return did not restore available quantity: %s, err=%v", fulfillment, err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT active,reserved_amount_cents
		FROM vou_settlement_reservations WHERE order_id=$1`, order.DocumentID).
		Scan(&reservationActive, &reservedAmount); err != nil || !reservationActive || reservedAmount != 2400 {
		t.Fatalf("purchase return reservation = active:%t amount:%d err=%v", reservationActive, reservedAmount, err)
	}
	replacement := createInbound("2", "replacement-inbound")
	if _, err = service.Unapprove(t.Context(), EntityPurchaseReturn, ReverseInput{
		DocumentID: purchaseReturn.DocumentID, Revision: returnApproved.Revision,
		Reason: "尝试撤销",
	}, integrationActorOne, "purchase-return-unapprove-blocked"); err == nil {
		t.Fatal("purchase return reversal ignored replacement inbound reservation")
	}
	if _, err = service.DeletePurchaseInbound(t.Context(), ReverseInput{
		DocumentID: replacement.DocumentID, Revision: replacement.Revision, Reason: "释放替代入库",
	}, integrationActorOne, "replacement-delete"); err != nil {
		t.Fatalf("delete replacement inbound: %v", err)
	}
	if _, err = service.Unapprove(t.Context(), EntityPurchaseInbound, ReverseInput{
		DocumentID: first.DocumentID, Revision: approvedFirst.Revision, Reason: "来源有退货",
	}, integrationActorOne, "source-inbound-unapprove-blocked"); err == nil {
		t.Fatal("source inbound with purchase return was unapproved")
	}
	if _, err = service.Unapprove(t.Context(), EntityPurchaseReturn, ReverseInput{
		DocumentID: purchaseReturn.DocumentID, Revision: returnApproved.Revision,
		Reason: "撤销采购退货",
	}, integrationActorOne, "purchase-return-unapprove"); err != nil {
		t.Fatalf("unapprove purchase return: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT fulfillment_status
		FROM vou_purchase_order_details WHERE document_id=$1`, order.DocumentID).
		Scan(&fulfillment); err != nil || fulfillment != "FULFILLED" {
		t.Fatalf("purchase return reversal did not restore fulfilled quantity: %s, err=%v", fulfillment, err)
	}
	if _, err = service.Unapprove(t.Context(), EntityPurchaseInbound, ReverseInput{
		DocumentID: second.DocumentID, Revision: approvedSecond.Revision, Reason: "验收撤回",
	}, integrationActorOne, "inbound-unapprove"); err != nil {
		t.Fatalf("unapprove inbound: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT fulfillment_status
		FROM vou_purchase_order_details WHERE document_id=$1`, order.DocumentID).
		Scan(&fulfillment); err != nil || fulfillment != "OPEN" {
		t.Fatalf("fulfillment after inbound unapproval = %s, err=%v", fulfillment, err)
	}

	_ = approved
}

func TestPurchaseFulfillmentConcurrentInboundReservationAllowsOneWinnerIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)

	order, err := service.CreateManagedPurchaseOrder(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28", Currency: "CNY",
		Supplier: &refs.supplier, Purchaser: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{{
			Product: refs.product, OrderedQuantity: "10", UnitPrice: "12.00",
		}},
	}}, integrationActorOne, "concurrent-purchase-create")
	if err != nil {
		t.Fatal(err)
	}
	checked, err := service.Check(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: order.Revision,
	}, integrationActorOne, "concurrent-purchase-check")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Approve(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: checked.Revision,
	}, integrationActorOne, "concurrent-purchase-approve"); err != nil {
		t.Fatal(err)
	}
	view, err := service.Get(t.Context(), EntityPurchaseOrder, GetInput{
		DocumentID: order.DocumentID,
	})
	if err != nil {
		t.Fatal(err)
	}
	sourceLineID := view.Data.ProductLines[0].LineID

	start := make(chan struct{})
	results := make(chan error, 2)
	var workers sync.WaitGroup
	for _, requestID := range []string{"concurrent-inbound-one", "concurrent-inbound-two"} {
		workers.Add(1)
		go func(requestID string) {
			defer workers.Done()
			<-start
			_, createErr := service.CreatePurchaseInbound(t.Context(), CreateInput{Data: DraftInput{
				BusinessDate: "2026-07-28", SourceDocumentID: order.DocumentID,
				Warehouse: &refs.warehouse,
				SourceLines: []SourceQuantityLineInput{{
					SourceLineID: sourceLineID, Quantity: "6",
				}},
			}}, integrationActorOne, requestID)
			results <- createErr
		}(requestID)
	}
	close(start)
	workers.Wait()
	close(results)

	successes := 0
	failures := 0
	for createErr := range results {
		if createErr == nil {
			successes++
		} else {
			failures++
		}
	}
	if successes != 1 || failures != 1 {
		t.Fatalf("concurrent reservations = %d success/%d failure, want 1/1", successes, failures)
	}
	var reserved int64
	if err = pool.QueryRow(t.Context(), `
		SELECT COALESCE(sum(quantity_micros), 0)
		FROM vou_purchase_inbound_lines
		WHERE source_order_line_id = $1`, sourceLineID).Scan(&reserved); err != nil {
		t.Fatal(err)
	}
	if reserved != 6_000_000 {
		t.Fatalf("reserved quantity = %d, want 6000000", reserved)
	}
}
