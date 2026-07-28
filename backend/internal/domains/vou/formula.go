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
	if err := validateReference(&input.Product, "product", true); err != nil {
		return FormulaDefaultView{}, err
	}
	if err := validateReference(input.Customer, "customer", false); err != nil {
		return FormulaDefaultView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return FormulaDefaultView{}, s.internal("begin formula default", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	product, err := s.resolveReference(ctx, tx, bobdomain.EntityProduct, &input.Product)
	if err != nil {
		return FormulaDefaultView{}, err
	}
	switch product.Data.ProductKind {
	case bobdomain.ProductKindPackaging:
		return FormulaDefaultView{SourceType: "NOT_APPLICABLE"}, nil
	case bobdomain.ProductKindRawMaterial:
		material := referenceView(*product)
		material.ProductKind = bobdomain.ProductKindRawMaterial
		formula := &FormulaView{
			BaseOutputQuantity: "1.0", SourceType: "RAW_SELF",
			Components: []FormulaComponentView{{
				Material: material, Quantity: "1.0",
			}},
		}
		return FormulaDefaultView{SourceType: "RAW_SELF", Formula: formula}, nil
	case bobdomain.ProductKindStandardFinished:
		if product.Data.Formula == nil {
			return FormulaDefaultView{}, domainError(
				ErrorConflict, "standard finished product formula is not configured", nil, nil,
			)
		}
		formula := formulaFromProduct(product.Data.Formula)
		return FormulaDefaultView{SourceType: "PRODUCT_FIXED", Formula: formula}, nil
	case bobdomain.ProductKindCustomFinished:
		if input.Customer == nil {
			return FormulaDefaultView{}, domainError(
				ErrorValidation, "customer is required for custom product formula", nil, nil,
			)
		}
		if _, err = s.resolveReference(ctx, tx, bobdomain.EntityCustomer, input.Customer); err != nil {
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
		formula.SourceType = "CUSTOMER_LATEST"
		formula.SourceDocumentID = latest.SourceDocumentID
		formula.SourceDocumentNo = latest.SourceDocumentNo
		return FormulaDefaultView{
			SourceType: "CUSTOMER_LATEST", SourceDocumentID: latest.SourceDocumentID,
			SourceDocumentNo: latest.SourceDocumentNo, Formula: formula,
		}, nil
	default:
		return FormulaDefaultView{}, domainError(ErrorConflict, "unsupported product kind", nil, nil)
	}
}

func formulaFromProduct(input *bobdomain.ProductFormula) *FormulaView {
	result := &FormulaView{
		BaseOutputQuantity: input.BaseOutputQuantity, SourceType: "PRODUCT_FIXED",
		Components: make([]FormulaComponentView, 0, len(input.Components)),
	}
	for _, component := range input.Components {
		material := ReferenceView{
			ObjectID: component.Material.ObjectID, VersionID: component.Material.VersionID,
			Entity: bobdomain.EntityProduct, Code: component.Material.Code,
			Name: component.Material.Name, Unit: component.Material.Unit,
			ProductKind: component.Material.ProductKind,
		}
		result.Components = append(result.Components, FormulaComponentView{
			Material: material, Quantity: component.Quantity,
		})
	}
	return result
}

func referenceView(input bobdomain.EffectiveReference) ReferenceView {
	return ReferenceView{
		ObjectID: input.ObjectID, VersionID: input.VersionID, Entity: input.Entity,
		Code: input.Code, Name: input.Data.Name, Unit: input.Data.Unit,
		ProductKind: input.Data.ProductKind,
	}
}
