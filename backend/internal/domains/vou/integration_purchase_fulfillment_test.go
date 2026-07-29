//go:build integration

package vou

import (
	"sync"
	"testing"
)

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
		finalized, finalizeErr := service.Finalize(
			t.Context(), EntityPurchaseInbound, FinalizeInput{
				DocumentID: inbound.DocumentID, Revision: approvedInbound.Revision,
			}, integrationActorOne, requestID+"-finalize")
		if finalizeErr != nil {
			t.Fatalf("finalize inbound: %v", finalizeErr)
		}
		return finalized
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
	returnFinalized, err := service.Finalize(t.Context(), EntityPurchaseReturn, FinalizeInput{
		DocumentID: purchaseReturn.DocumentID, Revision: returnApproved.Revision,
	}, integrationActorOne, "purchase-return-finalize")
	if err != nil {
		t.Fatalf("finalize purchase return: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT fulfillment_status
		FROM vou_purchase_order_details WHERE document_id=$1`, order.DocumentID).
		Scan(&fulfillment); err != nil || fulfillment != "OPEN" {
		t.Fatalf("purchase return did not reopen order: %s, err=%v", fulfillment, err)
	}
	replacement := createInbound("2", "replacement-inbound")
	if _, err = service.Unfinalize(t.Context(), EntityPurchaseReturn, ReverseInput{
		DocumentID: purchaseReturn.DocumentID, Revision: returnFinalized.Revision,
		Reason: "尝试撤销",
	}, integrationActorOne, "purchase-return-unfinalize-blocked"); err == nil {
		t.Fatal("purchase return reversal ignored replacement inbound reservation")
	}
	if _, err = service.DeletePurchaseInbound(t.Context(), ReverseInput{
		DocumentID: replacement.DocumentID, Revision: replacement.Revision, Reason: "释放替代入库",
	}, integrationActorOne, "replacement-delete"); err != nil {
		t.Fatalf("delete replacement inbound: %v", err)
	}
	if _, err = service.Unfinalize(t.Context(), EntityPurchaseReturn, ReverseInput{
		DocumentID: purchaseReturn.DocumentID, Revision: returnFinalized.Revision,
		Reason: "撤销采购退货",
	}, integrationActorOne, "purchase-return-unfinalize"); err != nil {
		t.Fatalf("unfinalize purchase return: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT fulfillment_status
		FROM vou_purchase_order_details WHERE document_id=$1`, order.DocumentID).
		Scan(&fulfillment); err != nil || fulfillment != "FULFILLED" {
		t.Fatalf("purchase return reversal did not complete order: %s, err=%v", fulfillment, err)
	}
	if _, err = service.Unfinalize(t.Context(), EntityPurchaseInbound, ReverseInput{
		DocumentID: first.DocumentID, Revision: finalizedFirst.Revision, Reason: "来源有退货",
	}, integrationActorOne, "source-inbound-unfinalize-blocked"); err == nil {
		t.Fatal("source inbound with purchase return was unfinalized")
	}
	if _, err = service.Unfinalize(t.Context(), EntityPurchaseInbound, ReverseInput{
		DocumentID: second.DocumentID, Revision: finalizedSecond.Revision, Reason: "验收撤回",
	}, integrationActorOne, "inbound-unfinalize"); err != nil {
		t.Fatalf("unfinalize inbound: %v", err)
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
	if err != nil || closed.Status != StatusShortClosed {
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
	if err != nil || reopened.Status != StatusShortCloseRequested {
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
