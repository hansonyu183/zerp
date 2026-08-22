//go:build integration

package vou

import "testing"

func approvePricingDocument(t *testing.T, service *Service, entity string, draft DraftInput) MutationResult {
	t.Helper()
	created, err := service.Create(t.Context(), entity, CreateInput{Data: draft}, integrationActorOne, "pricing-create")
	if err != nil {
		t.Fatalf("create %s: %v", entity, err)
	}
	checked, err := service.Check(t.Context(), entity, DocumentRevisionInput{DocumentID: created.DocumentID, Revision: created.Revision}, integrationActorOne, "pricing-check")
	if err != nil {
		t.Fatalf("check %s: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, DocumentRevisionInput{DocumentID: created.DocumentID, Revision: checked.Revision}, integrationActorTwo, "pricing-approve")
	if err != nil {
		t.Fatalf("approve %s: %v", entity, err)
	}
	return approved
}

func TestPricingReferencesAndZeroOrderIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)

	salePricing := approvePricingDocument(t, service, EntitySalePricing, DraftInput{
		BusinessDate: "2026-07-20", Currency: "CNY",
		PriceLines: []PriceLineInput{{Product: ProductReferenceInput{ObjectID: refs.product.ObjectID}, UnitPrice: "12.30"}},
	})
	zeroSalePricing := approvePricingDocument(t, service, EntitySalePricing, DraftInput{
		BusinessDate: "2026-07-21", Currency: "CNY",
		PriceLines: []PriceLineInput{{Product: ProductReferenceInput{ObjectID: refs.product.ObjectID}, UnitPrice: "0.00"}},
	})
	purchaseInquiry := approvePricingDocument(t, service, EntityPurchaseInquiry, DraftInput{
		BusinessDate: "2026-07-21", Currency: "CNY", Supplier: &refs.supplier,
		PriceLines: []PriceLineInput{{Product: ProductReferenceInput{ObjectID: refs.product.ObjectID}, UnitPrice: "8.60"}},
	})

	saleRef, err := service.PriceReference(t.Context(), EntitySaleOrder, PriceReferenceInput{
		BusinessDate: "2026-07-22", Currency: "CNY", Products: []ReferenceInput{refs.product},
	})
	if err != nil || len(saleRef.Lines) != 1 || saleRef.Lines[0].UnitPrice != "0.00" ||
		saleRef.Lines[0].SourceDocumentID != zeroSalePricing.DocumentID ||
		saleRef.Lines[0].SourceDocumentID == salePricing.DocumentID {
		t.Fatalf("sale reference=%+v err=%v", saleRef, err)
	}
	purchaseRef, err := service.PriceReference(t.Context(), EntityPurchaseOrder, PriceReferenceInput{
		BusinessDate: "2026-07-22", Currency: "CNY", Supplier: &refs.supplier,
		Products: []ReferenceInput{refs.product},
	})
	if err != nil || len(purchaseRef.Lines) != 1 || purchaseRef.Lines[0].UnitPrice != "8.60" ||
		purchaseRef.Lines[0].SourceDocumentID != purchaseInquiry.DocumentID {
		t.Fatalf("purchase reference=%+v err=%v", purchaseRef, err)
	}

	zeroOrder, err := service.Create(t.Context(), EntityPurchaseOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-19", Currency: "CNY", Supplier: &refs.supplier,
		Warehouse:    &refs.warehouse,
		ProductLines: []ProductLineInput{integrationProductLine(t, refs.product, "2", "0.00")},
	}}, integrationActorOne, "zero-order-create")
	if err != nil {
		t.Fatalf("create zero-price order: %v", err)
	}
	view, err := service.Get(t.Context(), EntityPurchaseOrder, GetInput{DocumentID: zeroOrder.DocumentID})
	if err != nil || view.Amount != "0.00" || len(view.Data.ProductLines) != 1 ||
		view.Data.ProductLines[0].ReferenceUnitPrice != "0.00" ||
		view.Data.ProductLines[0].ReferenceDocumentID != "" {
		t.Fatalf("zero order=%+v err=%v", view, err)
	}
	checked, err := service.Check(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: zeroOrder.DocumentID, Revision: zeroOrder.Revision,
	}, integrationActorOne, "zero-order-check")
	if err != nil {
		t.Fatalf("check zero-price order: %v", err)
	}
	if _, err = service.Approve(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: zeroOrder.DocumentID, Revision: checked.Revision,
	}, integrationActorTwo, "zero-order-approve"); err != nil {
		t.Fatalf("approve zero-price order: %v", err)
	}
	inbound, err := service.CreatePurchaseInbound(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-19", SourceDocumentID: zeroOrder.DocumentID, Warehouse: &refs.warehouse,
		SourceLines: []SourceQuantityLineInput{{SourceLineID: view.Data.ProductLines[0].LineID, BaseQuantity: "2"}},
	}}, integrationActorOne, "zero-inbound-create")
	if err != nil {
		t.Fatalf("create zero-price inbound: %v", err)
	}
	inboundView, err := service.Get(t.Context(), EntityPurchaseInbound, GetInput{DocumentID: inbound.DocumentID})
	if err != nil || inboundView.Amount != "0.00" || inboundView.Data.ProductLines[0].UnitPrice != "0.00" {
		t.Fatalf("zero inbound=%+v err=%v", inboundView, err)
	}
}
