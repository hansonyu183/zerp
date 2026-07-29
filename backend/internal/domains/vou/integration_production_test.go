//go:build integration

package vou

import (
	"errors"
	"testing"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
)

func TestVOUOrderProductionSnapshotsMultipleLinesAndReservesQuantityIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	bobService := bobdomain.NewService(pool)
	suffix := newID()
	createFinished := func(code, name, formulaQuantity string) ReferenceInput {
		t.Helper()
		return createApprovedBOB(t, bobService, bobdomain.EntityProduct, bobdomain.CreateDetailInput{
			Code: code + suffix, Name: name, Unit: "件",
			ProductKind: bobdomain.ProductKindStandardFinished,
			Formula: &bobdomain.ProductFormula{
				BaseOutputQuantity: "1",
				Components: []bobdomain.ProductFormulaComponent{{
					Material: bobdomain.FormulaMaterialReference{
						ObjectID: refs.product.ObjectID, VersionID: refs.product.VersionID,
					},
					Quantity: formulaQuantity,
				}},
			},
		})
	}
	firstFinished := createFinished("VPA", "订单成品 A", "2")
	secondFinished := createFinished("VPB", "订单成品 B", "3")
	service := newIntegrationService(t, pool)
	order, err := service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-29", Currency: "CNY",
		Customer: &refs.customer, Salesperson: &refs.employee,
		ProductLines: []ProductLineInput{
			{
				Product: firstFinished, OrderedQuantity: "10", UnitPrice: "10.00",
				Formula: &FormulaInput{
					BaseOutputQuantity: "1", SourceType: "PRODUCT_FIXED",
					Components: []FormulaComponentInput{{
						Material: refs.product, Quantity: "2",
					}},
				},
			},
			{
				Product: secondFinished, OrderedQuantity: "8", UnitPrice: "20.00",
				Formula: &FormulaInput{
					BaseOutputQuantity: "1", SourceType: "PRODUCT_FIXED",
					Components: []FormulaComponentInput{{
						Material: refs.product, Quantity: "3",
					}},
				},
			},
		},
	}}, integrationActorOne, "production-order-create")
	if err != nil {
		t.Fatalf("create source sale order: %v", err)
	}
	checked, err := service.Check(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: order.Revision,
	}, integrationActorOne, "production-order-check")
	if err != nil {
		t.Fatalf("check source sale order: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: checked.Revision,
	}, integrationActorOne, "production-order-approve")
	if err != nil {
		t.Fatalf("approve source sale order: %v", err)
	}
	if _, err = service.Finalize(t.Context(), EntitySaleOrder, FinalizeInput{
		DocumentID: order.DocumentID, Revision: approved.Revision,
	}, integrationActorOne, "production-order-finalize"); err != nil {
		t.Fatalf("finalize source sale order: %v", err)
	}
	orderView, err := service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil {
		t.Fatalf("get source sale order: %v", err)
	}
	if len(orderView.Data.ProductLines) != 2 {
		t.Fatalf("source order lines = %d, want 2", len(orderView.Data.ProductLines))
	}

	production, err := service.Create(t.Context(), EntityOrderProduction, CreateInput{
		ParentEntity: EntitySaleOrder, ParentDocumentID: order.DocumentID,
		Data: DraftInput{
			BusinessDate:      "2026-07-29",
			MaterialWarehouse: &refs.warehouse,
			FinishedWarehouse: &refs.warehouse,
			ProductionLines: []ProductionOutputInput{
				{
					SourceOrderLineID: orderView.Data.ProductLines[0].LineID,
					OutputQuantity:    "4",
					LossRate:          "10",
					Materials: []ProductionMaterialInput{{
						FormulaLineNo: 1, ActualMaterial: refs.product,
						ActualQuantity: "8.8",
					}},
				},
				{
					SourceOrderLineID: orderView.Data.ProductLines[1].LineID,
					OutputQuantity:    "2.5",
					LossRate:          "0",
					Materials: []ProductionMaterialInput{{
						FormulaLineNo: 1, ActualMaterial: refs.product,
						ActualQuantity: "7.5",
					}},
				},
			},
		},
	}, integrationActorOne, "order-production-create")
	if err != nil {
		t.Fatalf("create order production: %v", err)
	}
	view, err := service.Get(t.Context(), EntityOrderProduction, GetInput{
		DocumentID: production.DocumentID,
	})
	if err != nil {
		t.Fatalf("get order production: %v", err)
	}
	if view.Amount != "0.00" || view.Data.Currency != "" ||
		view.ParentDocumentID != order.DocumentID ||
		len(view.Data.ProductionLines) != 2 ||
		view.Data.ProductionLines[0].Materials[0].SuggestedQuantity != "8.8" {
		t.Fatalf("order production view = %+v", view)
	}
	saved, err := service.Save(t.Context(), EntityOrderProduction, SaveInput{
		DocumentID: production.DocumentID, Revision: production.Revision,
		Data: DraftInput{
			BusinessDate:      "2026-07-29",
			MaterialWarehouse: &refs.warehouse,
			FinishedWarehouse: &refs.warehouse,
			ProductionLines: []ProductionOutputInput{
				{
					SourceOrderLineID: orderView.Data.ProductLines[0].LineID,
					OutputQuantity:    "5",
					LossRate:          "10",
					Materials: []ProductionMaterialInput{{
						FormulaLineNo: 1, ActualMaterial: refs.product,
						ActualQuantity: "11",
					}},
				},
				{
					SourceOrderLineID: orderView.Data.ProductLines[1].LineID,
					OutputQuantity:    "2.5",
					LossRate:          "0",
					Materials: []ProductionMaterialInput{{
						FormulaLineNo: 1, ActualMaterial: refs.product,
						ActualQuantity: "7.5",
					}},
				},
			},
		},
	}, integrationActorOne, "order-production-save")
	if err != nil {
		t.Fatalf("save order production: %v", err)
	}

	_, err = service.Create(t.Context(), EntityOrderProduction, CreateInput{
		ParentEntity: EntitySaleOrder, ParentDocumentID: order.DocumentID,
		Data: DraftInput{
			BusinessDate:      "2026-07-29",
			MaterialWarehouse: &refs.warehouse,
			FinishedWarehouse: &refs.warehouse,
			ProductionLines: []ProductionOutputInput{{
				SourceOrderLineID: orderView.Data.ProductLines[0].LineID,
				OutputQuantity:    "6",
				LossRate:          "0",
				Materials: []ProductionMaterialInput{{
					FormulaLineNo: 1, ActualMaterial: refs.product,
					ActualQuantity: "12",
				}},
			}},
		},
	}, integrationActorOne, "order-production-over-reserve")
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorConflict {
		t.Fatalf("over-reserved production error = %v", err)
	}

	if _, err = service.Delete(t.Context(), EntityOrderProduction, DeleteInput{
		DocumentID: production.DocumentID,
		Revision:   saved.Revision,
		Reason:     "重建生产单",
	}, integrationActorOne, "order-production-delete"); err != nil {
		t.Fatalf("delete order production: %v", err)
	}
	if _, err = service.Create(t.Context(), EntityOrderProduction, CreateInput{
		ParentEntity: EntitySaleOrder, ParentDocumentID: order.DocumentID,
		Data: DraftInput{
			BusinessDate:      "2026-07-29",
			MaterialWarehouse: &refs.warehouse,
			FinishedWarehouse: &refs.warehouse,
			ProductionLines: []ProductionOutputInput{{
				SourceOrderLineID: orderView.Data.ProductLines[0].LineID,
				OutputQuantity:    "10",
				LossRate:          "0",
				Materials: []ProductionMaterialInput{{
					FormulaLineNo: 1, ActualMaterial: refs.product,
					ActualQuantity: "20",
				}},
			}},
		},
	}, integrationActorOne, "order-production-after-release"); err != nil {
		t.Fatalf("reservation was not released after delete: %v", err)
	}
}
