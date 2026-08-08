//go:build integration

package vou

import (
	"context"
	"sync"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
)

func TestClosedPurchaseOrderAllowsPostCloseInboundProgressIntegration(t *testing.T) {
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
	approvedOrder, err := service.Approve(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
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
	createInbound := func(requestID string) MutationResult {
		t.Helper()
		created, createErr := service.CreatePurchaseInbound(t.Context(), CreateInput{Data: DraftInput{
			BusinessDate: "2026-08-01", SourceDocumentID: order.DocumentID,
			Warehouse:   &refs.warehouse,
			SourceLines: []SourceQuantityLineInput{{SourceLineID: orderLineID, Quantity: "1"}},
		}}, integrationActorOne, requestID)
		if createErr != nil {
			t.Fatalf("create purchase inbound: %v", createErr)
		}
		return created
	}
	beforeClose := createInbound("closed-purchase-inbound-before-close")
	if _, err = pool.Exec(t.Context(), `UPDATE vou_documents SET
		status='FINALIZED',executed_at=now(),executed_by=$1,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2`,
		systemidentity.UserID, approvedOrder.DocumentID); err != nil {
		t.Fatalf("prepare legacy finalized purchase order: %v", err)
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
	afterClose := createInbound("closed-purchase-inbound-after-close")
	approveInbound := func(inbound MutationResult, requestID string) MutationResult {
		t.Helper()
		checked, checkErr := service.Check(t.Context(), EntityPurchaseInbound, DocumentRevisionInput{
			DocumentID: inbound.DocumentID, Revision: inbound.Revision,
		}, integrationActorOne, requestID+"-check")
		if checkErr != nil {
			t.Fatalf("check purchase inbound: %v", checkErr)
		}
		approved, approveErr := service.Approve(t.Context(), EntityPurchaseInbound, DocumentRevisionInput{
			DocumentID: inbound.DocumentID, Revision: checked.Revision,
		}, integrationActorOne, requestID+"-approve")
		if approveErr != nil {
			t.Fatalf("approve purchase inbound: %v", approveErr)
		}
		return approved
	}
	if result := approveInbound(beforeClose, "closed-purchase-inbound-before-close"); result.Status != StatusFinalized {
		t.Fatalf("pre-close draft inbound status = %s", result.Status)
	}
	if result := approveInbound(afterClose, "closed-purchase-inbound-after-close"); result.Status != StatusFinalized {
		t.Fatalf("post-close inbound status = %s", result.Status)
	}
	var orderStatus, fulfillment string
	if err = pool.QueryRow(t.Context(), `SELECT d.status,o.fulfillment_status
		FROM vou_documents d JOIN vou_purchase_order_details o ON o.document_id=d.id
		WHERE d.id=$1`, order.DocumentID).Scan(&orderStatus, &fulfillment); err != nil {
		t.Fatalf("read closed purchase order: %v", err)
	}
	if orderStatus != StatusFinalized || fulfillment != "OPEN" {
		t.Fatalf("closed purchase order changed = status:%s fulfillment:%s", orderStatus, fulfillment)
	}
}

func TestPurchaseFulfillmentPartialInboundCompletionAndReopenIntegration(t *testing.T) {
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
	finalizeInbound := func(inbound MutationResult, requestID string) MutationResult {
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
		if approvedInbound.Status != StatusFinalized {
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
	finalizedFirst := finalizeInbound(first, "inbound-one")

	draft := createInbound("6", "inbound-draft")
	if _, err = service.DeletePurchaseInbound(t.Context(), ReverseInput{
		DocumentID: draft.DocumentID, Revision: draft.Revision, Reason: "重新拆分",
	}, integrationActorOne, "inbound-delete"); err != nil {
		t.Fatalf("delete inbound draft: %v", err)
	}
	second := createInbound("6", "inbound-two")
	finalizedSecond := finalizeInbound(second, "inbound-two")

	var fulfillment string
	if err = pool.QueryRow(t.Context(), `SELECT fulfillment_status
		FROM vou_purchase_order_details
		WHERE document_id=$1`, order.DocumentID).Scan(&fulfillment); err != nil {
		t.Fatalf("read completion: %v", err)
	}
	if fulfillment != "FULFILLED" {
		t.Fatalf("completion = %s", fulfillment)
	}
	firstView, err := service.Get(t.Context(), EntityPurchaseInbound, GetInput{
		DocumentID: first.DocumentID,
	})
	if err != nil {
		t.Fatalf("get first inbound: %v", err)
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
	reopenedOrder, err := service.Get(t.Context(), EntityPurchaseOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil || reopenedOrder.Status != StatusApproved {
		t.Fatalf("temporary return did not reopen order: status=%s err=%v", reopenedOrder.Status, err)
	}
	if _, err = service.Delete(t.Context(), EntityPurchaseReturn, DeleteInput{
		DocumentID: temporaryReturn.DocumentID, Revision: temporaryReturn.Revision,
		Reason: "取消临时采购退货",
	}, integrationActorOne, "temporary-purchase-return-delete"); err != nil {
		t.Fatalf("delete temporary purchase return: %v", err)
	}
	completedOrder, err := service.Get(t.Context(), EntityPurchaseOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil || completedOrder.Status != StatusFinalized {
		t.Fatalf("deleting last unfinished child did not complete order: status=%s err=%v", completedOrder.Status, err)
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
	if returnApproved.Status != StatusFinalized {
		t.Fatalf("approved purchase return status = %s", returnApproved.Status)
	}
	if err = pool.QueryRow(t.Context(), `SELECT fulfillment_status
		FROM vou_purchase_order_details WHERE document_id=$1`, order.DocumentID).
		Scan(&fulfillment); err != nil || fulfillment != "OPEN" {
		t.Fatalf("purchase return did not reopen order: %s, err=%v", fulfillment, err)
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
		DocumentID: first.DocumentID, Revision: finalizedFirst.Revision, Reason: "来源有退货",
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
		t.Fatalf("purchase return reversal did not complete order: %s, err=%v", fulfillment, err)
	}
	if _, err = service.Unapprove(t.Context(), EntityPurchaseInbound, ReverseInput{
		DocumentID: second.DocumentID, Revision: finalizedSecond.Revision, Reason: "验收撤回",
	}, integrationActorOne, "inbound-unapprove"); err != nil {
		t.Fatalf("unapprove inbound: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT fulfillment_status
		FROM vou_purchase_order_details WHERE document_id=$1`, order.DocumentID).
		Scan(&fulfillment); err != nil || fulfillment != "OPEN" {
		t.Fatalf("reopened fulfillment = %s, err=%v", fulfillment, err)
	}

	_ = approved
}

func TestPurchaseFulfillmentDualPersonShortCloseIntegration(t *testing.T) {
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
	}}, integrationActorOne, "short-create")
	if err != nil {
		t.Fatal(err)
	}
	checked, err := service.Check(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: order.Revision,
	}, integrationActorOne, "short-check")
	if err != nil {
		domainErr, _ := err.(*DomainError)
		t.Fatalf("check short-close order: %#v cause=%v", err, domainErr.Cause)
	}
	approved, err := service.Approve(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: checked.Revision,
	}, integrationActorOne, "short-approve")
	if err != nil {
		t.Fatalf("approve short-close order: %#v", err)
	}
	requested, err := service.PurchaseShortCloseRequest(t.Context(), ReverseInput{
		DocumentID: order.DocumentID, Revision: approved.Revision, Reason: "供应商缺货",
	}, integrationActorOne, "short-request")
	if err != nil {
		t.Fatalf("request short close: %v", err)
	}
	if _, err = service.PurchaseShortCloseConfirm(t.Context(), DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: requested.Revision,
	}, integrationActorOne, "short-same-user"); err == nil {
		t.Fatal("same user confirmed short close")
	}
	closed, err := service.PurchaseShortCloseConfirm(t.Context(), DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: requested.Revision,
	}, integrationActorTwo, "short-confirm")
	if err != nil || closed.Status != StatusFinalized {
		t.Fatalf("confirm short close = %+v, err=%v", closed, err)
	}
	if _, err = service.CreatePurchaseInbound(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28", SourceDocumentID: order.DocumentID,
		Warehouse: &refs.warehouse,
	}}, integrationActorOne, "short-inbound"); err == nil {
		t.Fatal("short-closed order accepted inbound")
	}
	reopened, err := service.PurchaseShortCloseUnconfirm(t.Context(), ReverseInput{
		DocumentID: order.DocumentID, Revision: closed.Revision, Reason: "恢复采购",
	}, integrationActorTwo, "short-unconfirm")
	if err != nil || reopened.Status != StatusApproved {
		t.Fatalf("unconfirm short close = %+v, err=%v", reopened, err)
	}
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
