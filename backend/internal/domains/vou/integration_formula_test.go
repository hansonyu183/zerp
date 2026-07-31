//go:build integration

package vou

import (
	"testing"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
)

func TestVOUFormulaDefaultsAndOrderSnapshotsIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	bobService := bobdomain.NewService(pool)
	suffix := newID()

	standard := createApprovedBOB(t, bobService, bobdomain.EntityProduct, bobdomain.CreateDetailInput{
		Code:        "VFS" + suffix,
		Name:        "固定配方成品",
		Unit:        "吨",
		ProductKind: bobdomain.ProductKindStandardFinished,
		Formula: &bobdomain.ProductFormula{
			BaseOutputQuantity: "100",
			Components: []bobdomain.ProductFormulaComponent{{
				Material: bobdomain.FormulaMaterialReference{
					ObjectID:  refs.product.ObjectID,
					VersionID: refs.product.VersionID,
				},
				Quantity: "25.5",
			}},
		},
	})
	custom := createApprovedBOB(t, bobService, bobdomain.EntityProduct, bobdomain.CreateDetailInput{
		Code:        "VFC" + suffix,
		Name:        "客户定制成品",
		Unit:        "吨",
		ProductKind: bobdomain.ProductKindCustomFinished,
	})
	service := newIntegrationService(t, pool)

	rawDefault, err := service.FormulaDefault(t.Context(), FormulaDefaultInput{
		Product: refs.product,
	})
	if err != nil {
		t.Fatalf("raw formula default: %v", err)
	}
	if rawDefault.SourceType != "RAW_SELF" || rawDefault.Formula == nil ||
		len(rawDefault.Formula.Components) != 1 ||
		rawDefault.Formula.Components[0].Material.ObjectID != refs.product.ObjectID {
		t.Fatalf("raw default = %+v", rawDefault)
	}

	fixedDefault, err := service.FormulaDefault(t.Context(), FormulaDefaultInput{
		Product: standard,
	})
	if err != nil {
		t.Fatalf("fixed formula default: %v", err)
	}
	if fixedDefault.SourceType != "PRODUCT_FIXED" || fixedDefault.Formula == nil ||
		fixedDefault.Formula.BaseOutputQuantity != "100.0" ||
		fixedDefault.Formula.Components[0].Quantity != "25.5" {
		t.Fatalf("fixed default = %+v", fixedDefault)
	}

	manualDefault, err := service.FormulaDefault(t.Context(), FormulaDefaultInput{
		Customer: &refs.customer,
		Product:  custom,
	})
	if err != nil {
		t.Fatalf("initial custom formula default: %v", err)
	}
	if manualDefault.SourceType != "MANUAL" || manualDefault.Formula != nil {
		t.Fatalf("initial custom default = %+v", manualDefault)
	}

	order, err := service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28",
		Currency:     "CNY",
		Customer:     &refs.customer,
		Salesperson:  &refs.employee,
		ProductLines: []ProductLineInput{{
			Product: custom, OrderedQuantity: "2", UnitPrice: "10.00",
			Formula: &FormulaInput{
				BaseOutputQuantity: "100",
				SourceType:         "MANUAL",
				Components: []FormulaComponentInput{{
					Material: refs.product,
					Quantity: "30",
				}},
			},
		}},
	}}, integrationActorOne, "formula-custom-order-create")
	if err != nil {
		t.Fatalf("create custom formula order: %v", err)
	}
	orderView, err := service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil {
		t.Fatalf("get custom formula order: %v", err)
	}
	snapshot := orderView.Data.ProductLines[0].Formula
	if snapshot == nil || snapshot.SourceType != "MANUAL" ||
		snapshot.Components[0].Quantity != "30.0" {
		t.Fatalf("custom order snapshot = %+v", snapshot)
	}
	if _, err = service.Check(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID,
		Revision:   order.Revision,
	}, integrationActorOne, "formula-custom-order-check"); err != nil {
		t.Fatalf("check custom formula order: %v", err)
	}

	latestDefault, err := service.FormulaDefault(t.Context(), FormulaDefaultInput{
		Customer: &refs.customer,
		Product:  custom,
	})
	if err != nil {
		t.Fatalf("latest custom formula default: %v", err)
	}
	if latestDefault.SourceType != "CUSTOMER_LATEST" ||
		latestDefault.SourceDocumentID != order.DocumentID ||
		latestDefault.SourceDocumentNo != order.DocumentNo ||
		latestDefault.Formula == nil ||
		latestDefault.Formula.Components[0].Quantity != "30.0" {
		t.Fatalf("latest custom default = %+v", latestDefault)
	}

	fixedOrder, err := service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28",
		Currency:     "CNY",
		Customer:     &refs.customer,
		Salesperson:  &refs.employee,
		ProductLines: []ProductLineInput{{
			Product: standard, OrderedQuantity: "1", UnitPrice: "12.00",
			Formula: &FormulaInput{
				BaseOutputQuantity: fixedDefault.Formula.BaseOutputQuantity,
				SourceType:         fixedDefault.SourceType,
				Components: []FormulaComponentInput{{
					Material: refs.product,
					Quantity: fixedDefault.Formula.Components[0].Quantity,
				}},
			},
		}},
	}}, integrationActorOne, "formula-fixed-order-create")
	if err != nil {
		t.Fatalf("create fixed formula order: %v", err)
	}
	fixedOrderView, err := service.Get(t.Context(), EntitySaleOrder, GetInput{
		DocumentID: fixedOrder.DocumentID,
	})
	if err != nil {
		t.Fatalf("get fixed formula order: %v", err)
	}
	if fixedOrderView.Data.ProductLines[0].Formula == nil ||
		fixedOrderView.Data.ProductLines[0].Formula.SourceType != "PRODUCT_FIXED" {
		t.Fatalf("fixed order snapshot = %+v", fixedOrderView.Data.ProductLines[0].Formula)
	}

	rawView, err := bobService.Get(t.Context(), bobdomain.EntityProduct, bobdomain.GetInput{
		ObjectID: refs.product.ObjectID,
	})
	if err != nil {
		t.Fatalf("get raw material before edit: %v", err)
	}
	editedRaw := reverseApprovedBOBToDraft(
		t, bobService, bobdomain.EntityProduct, rawView, "formula-raw-edit",
	)
	submittedRaw, err := bobService.Submit(
		t.Context(),
		bobdomain.EntityProduct,
		bobdomain.VersionRevisionInput{
			ObjectID:  editedRaw.ObjectID,
			VersionID: editedRaw.VersionID,
			Revision:  editedRaw.Revision,
		},
		integrationActorOne,
		"formula-raw-submit",
	)
	if err != nil {
		t.Fatalf("submit raw material: %v", err)
	}
	approvedRaw, err := bobService.Approve(
		t.Context(),
		bobdomain.EntityProduct,
		bobdomain.ReviewInput{
			ObjectID:  submittedRaw.ObjectID,
			VersionID: submittedRaw.VersionID,
			Revision:  submittedRaw.Revision,
		},
		integrationActorTwo,
		"formula-raw-approve",
	)
	if err != nil {
		t.Fatalf("approve raw material: %v", err)
	}

	refreshedDefault, err := service.FormulaDefault(t.Context(), FormulaDefaultInput{
		Product: standard,
	})
	if err != nil {
		t.Fatalf("fixed default after raw material update: %v", err)
	}
	if refreshedDefault.Formula == nil ||
		refreshedDefault.Formula.Components[0].Material.VersionID != approvedRaw.VersionID {
		t.Fatalf("refreshed fixed default = %+v", refreshedDefault)
	}
	if _, err = service.Create(t.Context(), EntitySelfProduction, CreateInput{Data: DraftInput{
		BusinessDate:      "2026-07-28",
		MaterialWarehouse: &refs.warehouse,
		FinishedWarehouse: &refs.warehouse,
		ProductionLines: []ProductionOutputInput{{
			Product:        &standard,
			OutputQuantity: "100",
			LossRate:       "0",
			Materials: []ProductionMaterialInput{{
				FormulaLineNo: 1,
				ActualMaterial: ReferenceInput{
					ObjectID:  approvedRaw.ObjectID,
					VersionID: approvedRaw.VersionID,
				},
				ActualQuantity: "25.5",
			}},
		}},
	}}, integrationActorOne, "formula-self-production-current-material"); err != nil {
		t.Fatalf("create self production with refreshed formula material: %v", err)
	}
	refreshedCustomerDefault, err := service.FormulaDefault(t.Context(), FormulaDefaultInput{
		Customer: &refs.customer,
		Product:  custom,
	})
	if err != nil {
		t.Fatalf("customer default after raw material update: %v", err)
	}
	if refreshedCustomerDefault.Formula == nil ||
		refreshedCustomerDefault.Formula.Components[0].Material.VersionID != approvedRaw.VersionID {
		t.Fatalf("refreshed customer default = %+v", refreshedCustomerDefault)
	}

	rebasedOrder, err := service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28",
		Currency:     "CNY",
		Customer:     &refs.customer,
		Salesperson:  &refs.employee,
		ProductLines: []ProductLineInput{{
			Product: standard, OrderedQuantity: "1", UnitPrice: "12.00",
			Formula: &FormulaInput{
				BaseOutputQuantity: fixedDefault.Formula.BaseOutputQuantity,
				SourceType:         fixedDefault.SourceType,
				Components: []FormulaComponentInput{{
					Material: refs.product,
					Quantity: fixedDefault.Formula.Components[0].Quantity,
				}},
			},
		}},
	}}, integrationActorOne, "formula-rebased-order-create")
	if err != nil {
		t.Fatalf("create order from stale formula material version: %v", err)
	}
	rebasedOrderView, err := service.Get(t.Context(), EntitySaleOrder, GetInput{
		DocumentID: rebasedOrder.DocumentID,
	})
	if err != nil {
		t.Fatalf("get rebased formula order: %v", err)
	}
	rebasedFormula := rebasedOrderView.Data.ProductLines[0].Formula
	if rebasedFormula == nil ||
		rebasedFormula.Components[0].Material.VersionID != approvedRaw.VersionID {
		t.Fatalf("rebased order formula = %+v", rebasedFormula)
	}
	if fixedOrderView.Data.ProductLines[0].Formula.Components[0].Material.VersionID !=
		refs.product.VersionID {
		t.Fatalf("historical formula snapshot changed = %+v", fixedOrderView.Data.ProductLines[0].Formula)
	}
}
