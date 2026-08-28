package vou

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

func (s *Service) FormulaDefault(
	ctx context.Context, input FormulaDefaultInput,
) (FormulaDefaultView, error) {
	if !validID(input.Product.ObjectID) {
		return FormulaDefaultView{}, domainError(ErrorValidation, "invalid product", nil, nil)
	}
	if err := validateReference(input.Customer, "customer", false); err != nil {
		return FormulaDefaultView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return FormulaDefaultView{}, s.internal("begin formula default", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	product, err := s.resolveCurrentProduct(ctx, tx, input.Product.ObjectID)
	if err != nil {
		return FormulaDefaultView{}, err
	}
	switch product.Data.BehaviorProfile {
	case bobdomain.ProductBehaviorPackaging:
		return FormulaDefaultView{SourceType: "NOT_APPLICABLE"}, nil
	case bobdomain.ProductBehaviorRawMaterial:
		material := referenceView(*product)
		material.BehaviorProfile = bobdomain.ProductBehaviorRawMaterial
		unit, unitErr := productUnitSnapshot(product.Data, product.Data.DefaultInputUnitID)
		if unitErr != nil {
			return FormulaDefaultView{}, unitErr
		}
		quantity := QuantitySnapshotView{
			EnteredQuantity: "1.0",
			EnteredUnit:     UnitSnapshotView{ObjectID: unit.ObjectID, Code: unit.Code, Name: unit.Name, Symbol: unit.Symbol},
			BaseQuantity:    "1.0",
		}
		formula := &FormulaView{
			Output: quantity, SourceType: "RAW_SELF",
			Components: []FormulaComponentView{{
				Material: material, Quantity: quantity,
			}},
		}
		return FormulaDefaultView{SourceType: "RAW_SELF", Formula: formula}, nil
	case bobdomain.ProductBehaviorStandardFinished:
		if product.Data.Formula == nil {
			return FormulaDefaultView{}, domainError(
				ErrorConflict, "standard finished product formula is not configured", nil, nil,
			)
		}
		formula := formulaFromProduct(product.Data.Formula)
		if err = s.refreshFormulaMaterials(ctx, tx, formula); err != nil {
			return FormulaDefaultView{}, err
		}
		return FormulaDefaultView{SourceType: "PRODUCT_FIXED", Formula: formula}, nil
	case bobdomain.ProductBehaviorCustomFinished:
		if input.Customer == nil {
			return FormulaDefaultView{}, domainError(
				ErrorValidation, "customer is required for custom product formula", nil, nil,
			)
		}
		if _, err = s.resolveReference(ctx, tx, bobdomain.EntityCustomerAccount, input.Customer); err != nil {
			return FormulaDefaultView{}, err
		}
		latest, latestErr := s.queries.WithTx(tx).FindLatestCustomerSaleOrderFormula(
			ctx, dbsqlc.FindLatestCustomerSaleOrderFormulaParams{
				CustomerObjectID: input.Customer.ObjectID,
				ProductObjectID:  input.Product.ObjectID,
			},
		)
		if errors.Is(latestErr, pgx.ErrNoRows) {
			return FormulaDefaultView{SourceType: "MANUAL"}, nil
		}
		if latestErr != nil {
			return FormulaDefaultView{}, s.internal("read latest customer formula", latestErr)
		}
		formula, loadErr := loadSaleOrderFormula(ctx, s.queries.WithTx(tx), latest.ProductLineID)
		if loadErr != nil {
			return FormulaDefaultView{}, s.internal("load latest customer formula", loadErr)
		}
		if err = s.refreshFormulaMaterials(ctx, tx, formula); err != nil {
			return FormulaDefaultView{}, err
		}
		formula.SourceType = "CUSTOMER_LATEST"
		formula.SourceDocumentID = latest.SourceDocumentID
		formula.SourceDocumentNo = latest.SourceDocumentNo
		return FormulaDefaultView{
			SourceType: "CUSTOMER_LATEST", SourceDocumentID: latest.SourceDocumentID,
			SourceDocumentNo: latest.SourceDocumentNo, Formula: formula,
		}, nil
	default:
		return FormulaDefaultView{}, domainError(ErrorConflict, "unsupported product behavior profile", nil, nil)
	}
}

func (s *Service) refreshFormulaMaterials(
	ctx context.Context, tx pgx.Tx, formula *FormulaView,
) error {
	for index := range formula.Components {
		material, err := s.resolver.ResolveLatestApprovedReference(
			ctx,
			tx,
			bobdomain.EntityProduct,
			formula.Components[index].Material.ObjectID,
		)
		if err != nil {
			return domainError(
				ErrorConflict,
				"formula material is not currently effective",
				nil,
				err,
			)
		}
		if material.Data.BehaviorProfile != bobdomain.ProductBehaviorRawMaterial {
			return domainError(
				ErrorConflict,
				"formula component must reference a raw material",
				nil,
				nil,
			)
		}
		formula.Components[index].Material = referenceView(material)
	}
	return nil
}

func formulaFromProduct(input *bobdomain.ProductFormula) *FormulaView {
	result := &FormulaView{
		Output: QuantitySnapshotView{
			EnteredQuantity: input.Output.EnteredQuantity,
			EnteredUnit: UnitSnapshotView{
				ObjectID: input.Output.EnteredUnit.ObjectID,
				Code:     input.Output.EnteredUnit.Code, Name: input.Output.EnteredUnit.Name, Symbol: input.Output.EnteredUnit.Symbol,
			},
			BaseQuantity: input.Output.BaseQuantity,
		}, SourceType: "PRODUCT_FIXED",
		Components: make([]FormulaComponentView, 0, len(input.Components)),
	}
	for _, component := range input.Components {
		material := ReferenceView{
			ObjectID: component.Material.ObjectID, ApprovalEntryID: component.Material.ApprovalEntryID,
			Entity: bobdomain.EntityProduct, Code: component.Material.Code,
			Name: component.Material.Name, Unit: component.Quantity.EnteredUnit.Symbol,
			BehaviorProfile: component.Material.BehaviorProfile,
		}
		result.Components = append(result.Components, FormulaComponentView{
			Material: material,
			Quantity: QuantitySnapshotView{
				EnteredQuantity: component.Quantity.EnteredQuantity,
				EnteredUnit: UnitSnapshotView{
					ObjectID: component.Quantity.EnteredUnit.ObjectID,
					Code:     component.Quantity.EnteredUnit.Code, Name: component.Quantity.EnteredUnit.Name,
					Symbol: component.Quantity.EnteredUnit.Symbol,
				},
				BaseQuantity: component.Quantity.BaseQuantity,
			},
		})
	}
	return result
}

func referenceView(input bobdomain.EffectiveReference) ReferenceView {
	return ReferenceView{
		ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, Entity: input.Entity,
		Code: input.Code, Name: input.Data.Name, Unit: defaultUnitSymbol(input.Data),
		BehaviorProfile:    input.Data.BehaviorProfile,
		DefaultInputUnitID: input.Data.DefaultInputUnitID,
		PricingUnitID:      input.Data.PricingUnitID,
		UnitConversions:    input.Data.UnitConversions,
	}
}
