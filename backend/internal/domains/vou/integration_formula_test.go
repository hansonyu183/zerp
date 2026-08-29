//go:build integration

package vou

import (
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
)

func TestVOUFormulaDefaultsAndOrderSnapshotsIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	bobService := newBOBIntegrationService(pool)
	suffix := newID()

	standard := createApprovedBOB(t, bobService, bobdomain.EntityProduct, bobdomain.CreateDetailInput{
		Code: "VFS" + suffix, Name: "固定配方成品", ProductTypeID: "01JPTP00000000000000000003",
		DefaultInputUnitID: integrationTonUnitID, PricingUnitID: integrationKGUnitID,
		UnitConversions: []bobdomain.ProductUnitConversion{
			{Unit: bobdomain.MeasurementUnitSnapshot{ObjectID: integrationKGUnitID}, Factor: "1"},
			{Unit: bobdomain.MeasurementUnitSnapshot{ObjectID: integrationTonUnitID}, Factor: "1000"},
		}, DefaultPackagingSpec: "1000",
		Formula: &bobdomain.ProductFormula{
			Output: bobdomain.QuantitySnapshot{
				EnteredQuantity: "100", EnteredUnit: bobdomain.MeasurementUnitSnapshot{ObjectID: integrationTonUnitID}, BaseQuantity: "100000",
			},
			Components: []bobdomain.ProductFormulaComponent{{
				Material: bobdomain.FormulaMaterialReference{
					ObjectID:        refs.product.ObjectID,
					ApprovalEntryID: refs.product.ApprovalEntryID,
				},
				Quantity: bobdomain.QuantitySnapshot{
					EnteredQuantity: "25.5", EnteredUnit: bobdomain.MeasurementUnitSnapshot{ObjectID: integrationTonUnitID}, BaseQuantity: "25500",
				}, ResolutionStatus: "CURRENT",
			}},
		},
	})
	custom := createApprovedBOB(t, bobService, bobdomain.EntityProduct, bobdomain.CreateDetailInput{
		Code: "VFC" + suffix, Name: "客户定制成品", ProductTypeID: "01JPTP00000000000000000005",
		DefaultInputUnitID: integrationTonUnitID, PricingUnitID: integrationKGUnitID,
		UnitConversions: []bobdomain.ProductUnitConversion{
			{Unit: bobdomain.MeasurementUnitSnapshot{ObjectID: integrationKGUnitID}, Factor: "1"},
			{Unit: bobdomain.MeasurementUnitSnapshot{ObjectID: integrationTonUnitID}, Factor: "1000"},
		}, DefaultPackagingSpec: "1000",
	})
	service := newIntegrationService(t, pool)

	rawDefault, err := service.FormulaDefault(t.Context(), FormulaDefaultInput{
		Product: ProductReferenceInput{ObjectID: refs.product.ObjectID},
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
		Product: ProductReferenceInput{ObjectID: standard.ObjectID},
	})
	if err != nil {
		t.Fatalf("fixed formula default: %v", err)
	}
	if fixedDefault.SourceType != "PRODUCT_FIXED" || fixedDefault.Formula == nil ||
		fixedDefault.Formula.Output.BaseQuantity != "100000" ||
		fixedDefault.Formula.Components[0].Quantity.BaseQuantity != "25500" {
		t.Fatalf("fixed default = %+v", fixedDefault)
	}

	manualDefault, err := service.FormulaDefault(t.Context(), FormulaDefaultInput{
		Customer: &refs.customer,
		Product:  ProductReferenceInput{ObjectID: custom.ObjectID},
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
		Warehouse:    &refs.warehouse,
		ProductLines: []ProductLineInput{func() ProductLineInput {
			line := integrationProductLine(t, custom, "2", "10.00")
			line.Formula = &FormulaInput{
				Output:     QuantitySnapshotInput{EnteredQuantity: "100", EnteredUnit: UnitReferenceInput{ObjectID: integrationTonUnitID}, BaseQuantity: "100000"},
				SourceType: "MANUAL",
				Components: []FormulaComponentInput{{
					Material: ProductReferenceInput{ObjectID: refs.product.ObjectID},
					Quantity: QuantitySnapshotInput{EnteredQuantity: "30", EnteredUnit: UnitReferenceInput{ObjectID: integrationTonUnitID}, BaseQuantity: "30000"},
				}},
			}
			return line
		}()},
	}}, integrationApprovalActor(t, integrationActorOne, "formula-custom-order-create"))
	if err != nil {
		t.Fatalf("create custom formula order: %v", err)
	}
	orderView, err := service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil {
		t.Fatalf("get custom formula order: %v", err)
	}
	snapshot := orderView.Data.ProductLines[0].Formula
	if snapshot == nil || snapshot.SourceType != "MANUAL" ||
		snapshot.Components[0].Quantity.BaseQuantity != "30000.0" {
		t.Fatalf("custom order snapshot = %+v", snapshot)
	}
	if _, err = service.Submit(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID,
		Revision:   order.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "formula-custom-order-check")); err != nil {
		t.Fatalf("check custom formula order: %v", err)
	}

	latestDefault, err := service.FormulaDefault(t.Context(), FormulaDefaultInput{
		Customer: &refs.customer,
		Product:  ProductReferenceInput{ObjectID: custom.ObjectID},
	})
	if err != nil {
		t.Fatalf("latest custom formula default: %v", err)
	}
	if latestDefault.SourceType != "CUSTOMER_LATEST" ||
		latestDefault.SourceDocumentID != order.DocumentID ||
		latestDefault.SourceDocumentNo != order.DocumentNo ||
		latestDefault.Formula == nil ||
		latestDefault.Formula.Components[0].Quantity.BaseQuantity != "30000.0" {
		t.Fatalf("latest custom default = %+v", latestDefault)
	}

	fixedOrder, err := service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28",
		Currency:     "CNY",
		Customer:     &refs.customer,
		Salesperson:  &refs.employee,
		Warehouse:    &refs.warehouse,
		ProductLines: []ProductLineInput{func() ProductLineInput {
			line := integrationProductLine(t, standard, "1", "12.00")
			line.Formula = &FormulaInput{
				Output:     QuantitySnapshotInput{EnteredQuantity: fixedDefault.Formula.Output.EnteredQuantity, EnteredUnit: UnitReferenceInput{ObjectID: fixedDefault.Formula.Output.EnteredUnit.ObjectID}, BaseQuantity: fixedDefault.Formula.Output.BaseQuantity},
				SourceType: fixedDefault.SourceType,
				Components: []FormulaComponentInput{{
					Material: ProductReferenceInput{ObjectID: refs.product.ObjectID},
					Quantity: QuantitySnapshotInput{EnteredQuantity: fixedDefault.Formula.Components[0].Quantity.EnteredQuantity, EnteredUnit: UnitReferenceInput{ObjectID: fixedDefault.Formula.Components[0].Quantity.EnteredUnit.ObjectID}, BaseQuantity: fixedDefault.Formula.Components[0].Quantity.BaseQuantity},
				}},
			}
			return line
		}()},
	}}, integrationApprovalActor(t, integrationActorOne, "formula-fixed-order-create"))
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
	rawData := dcldomain.ProductInputFromData(dcldomain.ProductData{
		Name: rawView.Data.Name, CategoryID: rawView.Data.CategoryID,
		Specification: rawView.Data.Specification, Model: rawView.Data.Model,
		Barcode: rawView.Data.Barcode, Remark: rawView.Data.Remark,
		ProductTypeID: rawView.Data.ProductTypeID, DefaultInputUnitID: rawView.Data.DefaultInputUnitID,
		PricingUnitID: rawView.Data.PricingUnitID, UnitConversions: rawView.Data.UnitConversions,
		Returnable: rawView.Data.Returnable, DefaultPackagingSpec: rawView.Data.DefaultPackagingSpec,
		Formula: rawView.Data.Formula,
	})
	productDeclarations := dcldomain.NewProductService(pool, bobService, authorization.Func(nil), txevent.NewBus())
	rawDeclaration, err := productDeclarations.Get(t.Context(), dcldomain.ProductGetInput{
		ObjectID: rawView.ObjectID, ApprovalEntryID: rawView.SourceApprovalEntryID,
	}, trustedIntegrationActor(t, "formula-raw-get-declaration"))
	if err != nil {
		t.Fatalf("get raw material declaration before edit: %v", err)
	}
	editedRaw, err := productDeclarations.Save(t.Context(), dcldomain.ProductSaveInput{
		ObjectID:         rawView.ObjectID,
		ApprovalEntryID:  rawDeclaration.Approval.ApprovalEntryID,
		ApprovalRevision: rawDeclaration.Approval.Revision,
		Enabled:          rawView.Enabled, Data: rawData,
	}, trustedIntegrationActor(t, "formula-raw-edit"))
	if err != nil {
		t.Fatalf("create raw material candidate: %v", err)
	}
	submittedRaw, err := productDeclarations.Submit(
		t.Context(),
		dcldomain.ProductVersionInput{
			ObjectID:         editedRaw.ObjectID,
			ApprovalEntryID:  editedRaw.Approval.ApprovalEntryID,
			ApprovalRevision: editedRaw.Approval.Revision,
		},
		trustedIntegrationActor(t, "formula-raw-submit"),
	)
	if err != nil {
		t.Fatalf("submit raw material: %v", err)
	}
	approvedRaw, err := productDeclarations.Approve(
		t.Context(),
		dcldomain.ProductVersionInput{
			ObjectID:         submittedRaw.ObjectID,
			ApprovalEntryID:  submittedRaw.Approval.ApprovalEntryID,
			ApprovalRevision: submittedRaw.Approval.Revision,
		},
		trustedIntegrationActor(t, "formula-raw-approve"),
	)
	if err != nil {
		t.Fatalf("approve raw material: %v", err)
	}

	refreshedDefault, err := service.FormulaDefault(t.Context(), FormulaDefaultInput{
		Product: ProductReferenceInput{ObjectID: standard.ObjectID},
	})
	if err != nil {
		t.Fatalf("fixed default after raw material update: %v", err)
	}
	if refreshedDefault.Formula == nil ||
		refreshedDefault.Formula.Components[0].Material.ApprovalEntryID != approvedRaw.Approval.ApprovalEntryID {
		t.Fatalf("refreshed fixed default = %+v", refreshedDefault)
	}
	if _, err = service.Create(t.Context(), EntitySelfProduction, CreateInput{Data: DraftInput{
		BusinessDate:      "2026-07-28",
		MaterialWarehouse: &refs.warehouse,
		FinishedWarehouse: &refs.warehouse,
		ProductionLines: []ProductionOutputInput{{
			Product:         &ProductReferenceInput{ObjectID: standard.ObjectID},
			EnteredQuantity: "100", EnteredUnit: UnitReferenceInput{ObjectID: integrationTonUnitID},
			BaseQuantity: "100000", LossRate: "0",
			Materials: []ProductionMaterialInput{{
				FormulaLineNo:         1,
				ActualMaterial:        ProductReferenceInput{ObjectID: approvedRaw.ObjectID},
				ActualEnteredQuantity: "25.5", ActualEnteredUnit: UnitReferenceInput{ObjectID: integrationTonUnitID},
				ActualBaseQuantity: "25500",
			}},
		}},
	}}, integrationApprovalActor(t, integrationActorOne, "formula-self-production-current-material")); err != nil {
		t.Fatalf("create self production with refreshed formula material: %v", err)
	}
	refreshedCustomerDefault, err := service.FormulaDefault(t.Context(), FormulaDefaultInput{
		Customer: &refs.customer,
		Product:  ProductReferenceInput{ObjectID: custom.ObjectID},
	})
	if err != nil {
		t.Fatalf("customer default after raw material update: %v", err)
	}
	if refreshedCustomerDefault.Formula == nil ||
		refreshedCustomerDefault.Formula.Components[0].Material.ApprovalEntryID != approvedRaw.Approval.ApprovalEntryID {
		t.Fatalf("refreshed customer default = %+v", refreshedCustomerDefault)
	}

	rebasedOrder, err := service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28",
		Currency:     "CNY",
		Customer:     &refs.customer,
		Salesperson:  &refs.employee,
		Warehouse:    &refs.warehouse,
		ProductLines: []ProductLineInput{func() ProductLineInput {
			line := integrationProductLine(t, standard, "1", "12.00")
			line.Formula = &FormulaInput{
				Output:     QuantitySnapshotInput{EnteredQuantity: fixedDefault.Formula.Output.EnteredQuantity, EnteredUnit: UnitReferenceInput{ObjectID: fixedDefault.Formula.Output.EnteredUnit.ObjectID}, BaseQuantity: fixedDefault.Formula.Output.BaseQuantity},
				SourceType: fixedDefault.SourceType,
				Components: []FormulaComponentInput{{
					Material: ProductReferenceInput{ObjectID: refs.product.ObjectID},
					Quantity: QuantitySnapshotInput{EnteredQuantity: fixedDefault.Formula.Components[0].Quantity.EnteredQuantity, EnteredUnit: UnitReferenceInput{ObjectID: fixedDefault.Formula.Components[0].Quantity.EnteredUnit.ObjectID}, BaseQuantity: fixedDefault.Formula.Components[0].Quantity.BaseQuantity},
				}},
			}
			return line
		}()},
	}}, integrationApprovalActor(t, integrationActorOne, "formula-rebased-order-create"))
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
		rebasedFormula.Components[0].Material.ApprovalEntryID != approvedRaw.Approval.ApprovalEntryID {
		t.Fatalf("rebased order formula = %+v", rebasedFormula)
	}
	if fixedOrderView.Data.ProductLines[0].Formula.Components[0].Material.ApprovalEntryID !=
		refs.product.ApprovalEntryID {
		t.Fatalf("historical formula snapshot changed = %+v", fixedOrderView.Data.ProductLines[0].Formula)
	}
}
