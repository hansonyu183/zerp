//go:build integration

package vou

import (
	"context"
	"sync"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
)

func TestReconcileCompletionDoesNotReopenClosedPeriodParentIntegration(t *testing.T) {
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

	order, orderView := finalizedSalesOrder(t, service, refs, "1")
	outbound, _ := advanceSalesDocument(t, service, EntitySaleOutbound, DraftInput{
		BusinessDate: "2026-08-01", SourceDocumentID: order.DocumentID,
		Warehouse: &refs.warehouse,
		SourceLines: []SourceQuantityLineInput{{
			SourceLineID: orderView.Data.ProductLines[0].LineID, Quantity: "1",
		}},
	}, true)
	if _, err := service.Create(t.Context(), EntitySaleDelivery, CreateInput{Data: DraftInput{
		BusinessDate: "2026-08-02", SourceDocumentID: outbound.DocumentID,
		Platform: &refs.platform, Vehicle: &refs.vehicle,
	}}, integrationActorOne, "closed-parent-delivery-create"); err != nil {
		t.Fatalf("create unfinished delivery: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE vou_documents
		SET status='FINALIZED',executed_at=now(),executed_by=$1,
			revision=revision+1,updated_at=now(),updated_by=$1
		WHERE id IN ($2,$3)`, systemidentity.UserID, order.DocumentID, outbound.DocumentID); err != nil {
		t.Fatalf("prepare legacy finalized chain: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO led_closings(
		id,closing_date,opening_date,revision,closed_by,request_id
	) VALUES($1,$2::date,$3::date,1,$4,$5)`,
		closingID, "2026-07-31", "2026-08-01", integrationActorOne, "closed-parent-closing"); err != nil {
		t.Fatalf("insert closing: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE led_control
		SET last_closing_id=$1,revision=revision+1,updated_at=now(),updated_by=$2
		WHERE singleton=true`, closingID, integrationActorOne); err != nil {
		t.Fatalf("set closing control: %v", err)
	}

	if err := service.ReconcileCompletionStatuses(t.Context()); err != nil {
		t.Fatalf("reconcile completion statuses: %v", err)
	}
	var orderStatus, outboundStatus string
	if err := pool.QueryRow(t.Context(), `SELECT status FROM vou_documents WHERE id=$1`, order.DocumentID).
		Scan(&orderStatus); err != nil {
		t.Fatalf("read closed order status: %v", err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT status FROM vou_documents WHERE id=$1`, outbound.DocumentID).
		Scan(&outboundStatus); err != nil {
		t.Fatalf("read open outbound status: %v", err)
	}
	if orderStatus != StatusFinalized || outboundStatus != StatusApproved {
		t.Fatalf("reconciled statuses = order:%s outbound:%s", orderStatus, outboundStatus)
	}
}

func advanceSalesDocument(
	t *testing.T,
	service *Service,
	entity string,
	data DraftInput,
	approve bool,
) (MutationResult, DocumentView) {
	t.Helper()
	created, err := service.Create(
		t.Context(), entity, CreateInput{Data: data}, integrationActorOne, "sales-chain-create",
	)
	if err != nil {
		t.Fatalf("create %s: %v", entity, err)
	}
	checked, err := service.Check(t.Context(), entity, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Revision,
	}, integrationActorOne, "sales-chain-check")
	if err != nil {
		t.Fatalf("check %s: %v", entity, err)
	}
	result := checked
	if approve {
		result, err = service.Approve(t.Context(), entity, DocumentRevisionInput{
			DocumentID: created.DocumentID, Revision: checked.Revision,
		}, integrationActorOne, "sales-chain-approve")
		if err != nil {
			t.Fatalf("approve %s: %v", entity, err)
		}
	}
	view, err := service.Get(t.Context(), entity, GetInput{DocumentID: result.DocumentID})
	if err != nil {
		t.Fatalf("get %s: %v", entity, err)
	}
	return result, view
}

func finalizedSalesOrder(
	t *testing.T,
	service *Service,
	refs integrationReferences,
	quantity string,
) (MutationResult, DocumentView) {
	t.Helper()
	return advanceSalesDocument(t, service, EntitySaleOrder, DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
		Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{{
			Product: refs.product, OrderedQuantity: quantity, UnitPrice: "12.00",
		}},
	}, true)
}

func TestVOUIntegrationSalesOrderOutboundDeliverySignoffAndShortClose(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)

	order, orderView := finalizedSalesOrder(t, service, refs, "10")
	var orderCreator string
	if err := pool.QueryRow(t.Context(), `SELECT created_by FROM vou_documents WHERE id=$1`, order.DocumentID).Scan(&orderCreator); err != nil {
		t.Fatalf("load sales order creator: %v", err)
	}
	if orderCreator != integrationActorOne {
		t.Fatalf("sales order creator = %s, want human actor", orderCreator)
	}
	orderLineID := orderView.Data.ProductLines[0].LineID
	outboundOne, outboundView := advanceSalesDocument(t, service, EntitySaleOutbound, DraftInput{
		BusinessDate: "2026-07-25", SourceDocumentID: order.DocumentID,
		Warehouse: &refs.warehouse,
		SourceLines: []SourceQuantityLineInput{{
			SourceLineID: orderLineID, Quantity: "6",
		}},
	}, true)
	if outboundView.DocumentNo[:3] != "SOB" ||
		outboundView.ParentDocumentID != order.DocumentID ||
		outboundView.Data.ProductLines[0].Quantity != "6.0" {
		t.Fatalf("outbound view = %+v", outboundView)
	}

	deliveryOne, deliveryView := advanceSalesDocument(t, service, EntitySaleDelivery, DraftInput{
		BusinessDate: "2026-07-26", SourceDocumentID: outboundOne.DocumentID,
		Platform: &refs.platform, Vehicle: &refs.vehicle,
	}, true)
	if deliveryView.DocumentNo[:3] != "SDL" ||
		deliveryView.ParentDocumentID != outboundOne.DocumentID {
		t.Fatalf("delivery view = %+v", deliveryView)
	}
	if _, err := service.Create(t.Context(), EntitySaleDelivery, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-26", SourceDocumentID: outboundOne.DocumentID,
		Platform: &refs.platform, Vehicle: &refs.vehicle,
	}}, integrationActorOne, "duplicate-delivery"); err == nil {
		t.Fatal("second delivery for one outbound was accepted")
	}

	signoffOne, signoffView := advanceSalesDocument(t, service, EntitySaleSignoff, DraftInput{
		BusinessDate: "2026-07-27", SourceDocumentID: deliveryOne.DocumentID,
		SignoffLines: []SaleSignoffLineInput{{
			SourceLineID:   deliveryView.Data.ProductLines[0].LineID,
			SignedQuantity: "4", RejectedQuantity: "1",
		}},
	}, true)
	if signoffView.DocumentNo[:3] != "SSF" ||
		signoffView.Data.SignoffLines[0].LossQuantity != "1.0" {
		t.Fatalf("signoff view = %+v", signoffView)
	}
	if _, err := service.Create(t.Context(), EntitySaleSignoff, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-27", SourceDocumentID: deliveryOne.DocumentID,
		SignoffLines: []SaleSignoffLineInput{{
			SourceLineID:   deliveryView.Data.ProductLines[0].LineID,
			SignedQuantity: "6", RejectedQuantity: "0",
		}},
	}}, integrationActorOne, "duplicate-signoff"); err == nil {
		t.Fatal("second signoff for one delivery was accepted")
	}
	var refusalID string
	var refusalRevision int64
	if err := pool.QueryRow(t.Context(), `SELECT d.id,d.revision
		FROM vou_documents d JOIN vou_sale_return_details r ON r.document_id=d.id
		WHERE r.source_signoff_id=$1`, signoffOne.DocumentID).Scan(&refusalID, &refusalRevision); err != nil {
		t.Fatalf("load refusal return: %v", err)
	}
	var refusalCreator, refusalAuditActor string
	if err := pool.QueryRow(t.Context(), `SELECT created_by FROM vou_documents WHERE id=$1`, refusalID).Scan(&refusalCreator); err != nil {
		t.Fatalf("load refusal return creator: %v", err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT actor_id FROM vou_audit_events
		WHERE document_id=$1 AND event_type='CREATED' ORDER BY occurred_at LIMIT 1`, refusalID).Scan(&refusalAuditActor); err != nil {
		t.Fatalf("load refusal return audit: %v", err)
	}
	if refusalCreator != systemidentity.UserID || refusalAuditActor != systemidentity.UserID {
		t.Fatalf("automatic refusal actors = creator:%s audit:%s", refusalCreator, refusalAuditActor)
	}
	savedRefusal, err := service.Save(t.Context(), EntitySaleReturn, SaveInput{
		DocumentID: refusalID, Revision: refusalRevision, Data: DraftInput{
			BusinessDate: "2026-07-27", Warehouse: &refs.warehouse, ReturnReason: "包装破损拒收",
		},
	}, integrationActorOne, "refusal-save")
	if err != nil {
		t.Fatalf("save refusal return header: %v", err)
	}
	unapprovedSignoff, err := service.Unapprove(t.Context(), EntitySaleSignoff, ReverseInput{
		DocumentID: signoffOne.DocumentID, Revision: signoffOne.Revision, Reason: "修正签收测试",
	}, integrationActorOne, "signoff-unapprove")
	if err != nil {
		t.Fatalf("unapprove signoff with automatic refusal draft: %v", err)
	}
	var refusalCount int64
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM vou_sale_return_details
		WHERE source_signoff_id=$1`, signoffOne.DocumentID).Scan(&refusalCount); err != nil || refusalCount != 0 {
		t.Fatalf("automatic refusal drafts after unapprove = %d, err=%v", refusalCount, err)
	}
	signoffOne, err = service.Approve(t.Context(), EntitySaleSignoff, DocumentRevisionInput{
		DocumentID: signoffOne.DocumentID, Revision: unapprovedSignoff.Revision,
	}, integrationActorOne, "signoff-reapprove")
	if err != nil {
		t.Fatalf("reapprove signoff: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT d.id,d.revision
		FROM vou_documents d JOIN vou_sale_return_details r ON r.document_id=d.id
		WHERE r.source_signoff_id=$1`, signoffOne.DocumentID).Scan(&refusalID, &refusalRevision); err != nil {
		t.Fatalf("load regenerated refusal return: %v", err)
	}
	if savedRefusal.Revision == refusalRevision {
		t.Fatal("automatic refusal return was not regenerated")
	}
	refusalChecked, err := service.Check(t.Context(), EntitySaleReturn, DocumentRevisionInput{
		DocumentID: refusalID, Revision: refusalRevision,
	}, integrationActorOne, "refusal-check")
	if err != nil {
		t.Fatalf("check refusal return: %v", err)
	}
	refusalApproved, err := service.Approve(t.Context(), EntitySaleReturn, DocumentRevisionInput{
		DocumentID: refusalID, Revision: refusalChecked.Revision,
	}, integrationActorOne, "refusal-approve")
	if err != nil {
		t.Fatalf("approve refusal return: %v", err)
	}
	if refusalApproved.Status != StatusFinalized {
		t.Fatalf("approved refusal return status = %s", refusalApproved.Status)
	}
	afterSale, err := service.Create(t.Context(), EntitySaleReturn, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28", Warehouse: &refs.warehouse, ReturnReason: "客户退回",
		ReturnLines: []ReturnLineInput{{
			SourceLineID: signoffView.Data.SignoffLines[0].LineID, Quantity: "2",
		}},
	}}, integrationActorOne, "after-sale-return")
	if err != nil {
		t.Fatalf("create after-sale return: %v", err)
	}
	if _, err = service.Create(t.Context(), EntitySaleReturn, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28", Warehouse: &refs.warehouse, ReturnReason: "超量退货",
		ReturnLines: []ReturnLineInput{{
			SourceLineID: signoffView.Data.SignoffLines[0].LineID, Quantity: "3",
		}},
	}}, integrationActorOne, "over-return"); err == nil {
		t.Fatal("cumulative after-sale over-return was accepted")
	}
	if _, err = service.Delete(t.Context(), EntitySaleReturn, DeleteInput{
		DocumentID: afterSale.DocumentID, Revision: afterSale.Revision, Reason: "取消测试退货",
	}, integrationActorOne, "delete-after-sale-return"); err != nil {
		t.Fatalf("delete after-sale return: %v", err)
	}

	orderView, err = service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil {
		t.Fatalf("get order balances: %v", err)
	}
	if orderView.Data.SignedQuantity != "4.0" ||
		orderView.Data.InTransitQuantity != "0.0" ||
		orderView.Data.RemainingQuantity != "6.0" ||
		orderView.Data.FulfillmentStatus != "OPEN" {
		t.Fatalf("order balances after first signoff = %+v", orderView.Data)
	}

	requested, err := service.ShortCloseRequest(t.Context(), ReverseInput{
		DocumentID: order.DocumentID, Revision: orderView.Revision, Reason: "客户取消剩余需求",
	}, integrationActorOne, "short-close-request")
	if err != nil {
		t.Fatalf("request short close: %v", err)
	}
	if _, err = service.ShortCloseConfirm(t.Context(), DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: requested.Revision,
	}, integrationActorOne, "same-user-short-close"); err == nil {
		t.Fatal("short close requester confirmed their own request")
	}
	closed, err := service.ShortCloseConfirm(t.Context(), DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: requested.Revision,
	}, integrationActorTwo, "short-close-confirm")
	if err != nil {
		t.Fatalf("confirm short close: %v", err)
	}
	reopened, err := service.ShortCloseUnconfirm(t.Context(), ReverseInput{
		DocumentID: order.DocumentID, Revision: closed.Revision, Reason: "恢复剩余需求",
	}, integrationActorOne, "short-close-unconfirm")
	if err != nil || reopened.Revision <= closed.Revision {
		t.Fatalf("unconfirm short close = %+v err=%v", reopened, err)
	}

	outboundTwo, _ := advanceSalesDocument(t, service, EntitySaleOutbound, DraftInput{
		BusinessDate: "2026-07-28", SourceDocumentID: order.DocumentID,
		Warehouse: &refs.warehouse,
		SourceLines: []SourceQuantityLineInput{{
			SourceLineID: orderLineID, Quantity: "6",
		}},
	}, true)
	deliveryTwo, deliveryTwoView := advanceSalesDocument(t, service, EntitySaleDelivery, DraftInput{
		BusinessDate: "2026-07-29", SourceDocumentID: outboundTwo.DocumentID,
		Platform: &refs.platform, Vehicle: &refs.vehicle,
	}, true)
	_, _ = advanceSalesDocument(t, service, EntitySaleSignoff, DraftInput{
		BusinessDate: "2026-07-30", SourceDocumentID: deliveryTwo.DocumentID,
		SignoffLines: []SaleSignoffLineInput{{
			SourceLineID:   deliveryTwoView.Data.ProductLines[0].LineID,
			SignedQuantity: "6", RejectedQuantity: "0",
		}},
	}, true)
	orderView, err = service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil || orderView.Data.FulfillmentStatus != "FULFILLED" ||
		orderView.Data.SignedQuantity != "10.0" ||
		orderView.Data.RemainingQuantity != "0.0" {
		t.Fatalf("fulfilled order = %+v err=%v", orderView.Data, err)
	}
	if _, err = service.ShortCloseRequest(t.Context(), ReverseInput{
		DocumentID: order.DocumentID, Revision: orderView.Revision, Reason: "不应允许",
	}, integrationActorOne, "fulfilled-short-close"); err == nil {
		t.Fatal("fulfilled order accepted short close")
	}

	if signoffOne.Status != StatusFinalized {
		t.Fatalf("first signoff status = %s", signoffOne.Status)
	}
}

func TestVOUIntegrationConcurrentOutboundReservationAllowsOneWinner(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	order, orderView := finalizedSalesOrder(t, service, refs, "10")
	sourceLineID := orderView.Data.ProductLines[0].LineID

	approved := make([]MutationResult, 2)
	for index := range approved {
		approved[index], _ = advanceSalesDocument(t, service, EntitySaleOutbound, DraftInput{
			BusinessDate: "2026-07-25", SourceDocumentID: order.DocumentID,
			Warehouse: &refs.warehouse,
			SourceLines: []SourceQuantityLineInput{{
				SourceLineID: sourceLineID, Quantity: "6",
			}},
		}, false)
	}

	results := make(chan error, len(approved))
	var group sync.WaitGroup
	for _, document := range approved {
		group.Add(1)
		go func() {
			defer group.Done()
			_, err := service.Approve(t.Context(), EntitySaleOutbound, DocumentRevisionInput{
				DocumentID: document.DocumentID, Revision: document.Revision,
			}, integrationActorOne, "concurrent-outbound-approve")
			results <- err
		}()
	}
	group.Wait()
	close(results)
	successes, conflicts := 0, 0
	for err := range results {
		if err == nil {
			successes++
		} else {
			conflicts++
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent outbound results successes=%d conflicts=%d", successes, conflicts)
	}
}
