//go:build integration

package vou

import (
	"sync"
	"testing"
)

func advanceSalesDocument(
	t *testing.T,
	service *Service,
	entity string,
	data DraftInput,
	finalize bool,
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
	approved, err := service.Approve(t.Context(), entity, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: checked.Revision,
	}, integrationActorOne, "sales-chain-approve")
	if err != nil {
		t.Fatalf("approve %s: %v", entity, err)
	}
	result := approved
	if finalize {
		result, err = service.Finalize(t.Context(), entity, FinalizeInput{
			DocumentID: approved.DocumentID, Revision: approved.Revision,
		}, integrationActorOne, "sales-chain-finalize")
		if err != nil {
			t.Fatalf("finalize %s: %v", entity, err)
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
	if deliveryView.DocumentNo[:2] != "SD" ||
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
	if signoffView.DocumentNo[:2] != "SS" ||
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

	orderView, err := service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: order.DocumentID})
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
			_, err := service.Finalize(t.Context(), EntitySaleOutbound, FinalizeInput{
				DocumentID: document.DocumentID, Revision: document.Revision,
			}, integrationActorOne, "concurrent-outbound-finalize")
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
