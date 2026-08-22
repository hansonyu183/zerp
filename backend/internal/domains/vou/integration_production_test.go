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
	bobService := newBOBIntegrationService(pool)
	suffix := newID()
	createFinished := func(code, name, formulaQuantity string) ReferenceInput {
		t.Helper()
		return createApprovedBOB(t, bobService, bobdomain.EntityProduct, bobdomain.CreateDetailInput{
			Code: code + suffix, Name: name, ProductTypeID: "01JPTP00000000000000000003",
			DefaultInputUnitID: "01JAVX00000000000000000013", PricingUnitID: integrationKGUnitID,
			UnitConversions: []bobdomain.ProductUnitConversion{
				{Unit: bobdomain.MeasurementUnitSnapshot{ObjectID: integrationKGUnitID}, Factor: "1"},
				{Unit: bobdomain.MeasurementUnitSnapshot{ObjectID: "01JAVX00000000000000000013"}, Factor: "1"},
			}, DefaultPackagingSpec: "1",
			Formula: &bobdomain.ProductFormula{
				Output: bobdomain.QuantitySnapshot{
					EnteredQuantity: "1", EnteredUnit: bobdomain.MeasurementUnitSnapshot{ObjectID: "01JAVX00000000000000000013"}, BaseQuantity: "1",
				},
				Components: []bobdomain.ProductFormulaComponent{{
					Material: bobdomain.FormulaMaterialReference{
						ObjectID: refs.product.ObjectID, VersionID: refs.product.VersionID,
					},
					Quantity: bobdomain.QuantitySnapshot{
						EnteredQuantity: formulaQuantity, EnteredUnit: bobdomain.MeasurementUnitSnapshot{ObjectID: integrationTonUnitID}, BaseQuantity: formulaQuantity,
					}, ResolutionStatus: "CURRENT",
				}},
			},
		})
	}
	firstFinished := createFinished("VPA", "订单成品 A", "2")
	secondFinished := createFinished("VPB", "订单成品 B", "3")
	orderLine := func(product ReferenceInput, quantity, price, formulaQuantity string) ProductLineInput {
		line := ProductLineInput{
			Product: ProductReferenceInput{ObjectID: product.ObjectID}, EnteredQuantity: quantity,
			EnteredUnit:  UnitReferenceInput{ObjectID: "01JAVX00000000000000000013"},
			BaseQuantity: quantity, UnitPrice: price,
		}
		line.Formula = &FormulaInput{
			Output:     QuantitySnapshotInput{EnteredQuantity: "1", EnteredUnit: UnitReferenceInput{ObjectID: "01JAVX00000000000000000013"}, BaseQuantity: "1"},
			SourceType: "PRODUCT_FIXED",
			Components: []FormulaComponentInput{{
				Material: ProductReferenceInput{ObjectID: refs.product.ObjectID},
				Quantity: QuantitySnapshotInput{EnteredQuantity: formulaQuantity, EnteredUnit: UnitReferenceInput{ObjectID: integrationTonUnitID}, BaseQuantity: formulaQuantity},
			}},
		}
		return line
	}
	productionOutput := func(source, output, loss, materialEntered, materialBase string) ProductionOutputInput {
		return ProductionOutputInput{
			SourceOrderLineID: source, EnteredQuantity: output,
			EnteredUnit:  UnitReferenceInput{ObjectID: "01JAVX00000000000000000013"},
			BaseQuantity: output, LossRate: loss,
			Materials: []ProductionMaterialInput{{
				FormulaLineNo: 1, ActualMaterial: ProductReferenceInput{ObjectID: refs.product.ObjectID},
				ActualEnteredQuantity: materialEntered, ActualEnteredUnit: UnitReferenceInput{ObjectID: integrationTonUnitID},
				ActualBaseQuantity: materialBase,
			}},
		}
	}
	service := newIntegrationService(t, pool)
	order, err := service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-29", Currency: "CNY",
		Customer: &refs.customer, Salesperson: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{
			orderLine(firstFinished, "10", "10.00", "2"),
			orderLine(secondFinished, "8", "20.00", "3"),
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
	if approved.Status != StatusApproved {
		t.Fatalf("source sale order status = %s", approved.Status)
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
				productionOutput(orderView.Data.ProductLines[0].LineID, "4", "10", "0.0088", "8.8"),
				productionOutput(orderView.Data.ProductLines[1].LineID, "2.5", "0", "0.0075", "7.5"),
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
		view.Data.ProductionLines[0].Materials[0].SuggestedBaseQuantity != "8.8" {
		t.Fatalf("order production view = %+v", view)
	}
	saved, err := service.Save(t.Context(), EntityOrderProduction, SaveInput{
		DocumentID: production.DocumentID, Revision: production.Revision,
		Data: DraftInput{
			BusinessDate:      "2026-07-29",
			MaterialWarehouse: &refs.warehouse,
			FinishedWarehouse: &refs.warehouse,
			ProductionLines: []ProductionOutputInput{
				productionOutput(orderView.Data.ProductLines[0].LineID, "5", "10", "0.011", "11"),
				productionOutput(orderView.Data.ProductLines[1].LineID, "2.5", "0", "0.0075", "7.5"),
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
			ProductionLines: []ProductionOutputInput{
				productionOutput(orderView.Data.ProductLines[0].LineID, "6", "0", "0.012", "12"),
			},
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
			ProductionLines: []ProductionOutputInput{
				productionOutput(orderView.Data.ProductLines[0].LineID, "10", "0", "0.02", "20"),
			},
		},
	}, integrationActorOne, "order-production-after-release"); err != nil {
		t.Fatalf("quantity allocation was not released after delete: %v", err)
	}
}
