package vou

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

func (s *Service) resolveReference(
	ctx context.Context,
	tx pgx.Tx,
	kind string,
	input *ReferenceInput,
) (*bobdomain.EffectiveReference, error) {
	if input == nil {
		return nil, nil
	}
	ref, err := s.resolver.ResolveEffectiveReference(ctx, tx, kind, input.ObjectID, input.VersionID)
	if err != nil {
		return nil, domainError(ErrorConflict, kind+" reference is not effective", nil, err)
	}
	return &ref, nil
}

func (s *Service) resolveDraftParties(
	ctx context.Context,
	tx pgx.Tx,
	draft validatedDraft,
	result *resolvedDraft,
) error {
	var err error
	if result.Customer, err = s.resolveReference(ctx, tx, bobdomain.EntityCustomer, draft.Customer); err != nil {
		return err
	}
	if result.Supplier, err = s.resolveReference(ctx, tx, bobdomain.EntitySupplier, draft.Supplier); err != nil {
		return err
	}
	if result.Supplier != nil && result.Supplier.Data.SupplierType != bobdomain.SupplierTypeGeneral {
		return domainError(ErrorConflict, "supplier must be a general supplier", nil, nil)
	}
	if result.Counterparty, err = s.resolveReference(ctx, tx, draft.CounterpartyType, draft.Counterparty); err != nil {
		return err
	}
	if result.Employee, err = s.resolveReference(ctx, tx, bobdomain.EntityEmployee, draft.Employee); err != nil {
		return err
	}
	return nil
}

func (s *Service) resolveDraftPersonnel(
	ctx context.Context,
	tx pgx.Tx,
	entity string,
	draft validatedDraft,
	preserved resolvedDraft,
	allowDefaults bool,
	result *resolvedDraft,
) error {
	var err error
	if draft.Salesperson != nil {
		result.Salesperson, err = s.resolveReference(ctx, tx, bobdomain.EntityEmployee, draft.Salesperson)
	} else if preserved.Salesperson != nil {
		result.Salesperson = preserved.Salesperson
	} else if entity == EntitySaleOrder && allowDefaults && result.Customer != nil {
		result.Salesperson, err = s.resolveCurrentEmployee(
			ctx,
			tx,
			result.Customer.Data.SalespersonEmployeeID,
			"customer salesperson",
		)
	} else if entity == EntitySaleOrder {
		err = domainError(ErrorConflict, "salesperson is required", nil, nil)
	}
	if err != nil {
		return err
	}

	if draft.Purchaser != nil {
		result.Purchaser, err = s.resolveReference(ctx, tx, bobdomain.EntityEmployee, draft.Purchaser)
	} else if preserved.Purchaser != nil {
		result.Purchaser = preserved.Purchaser
	} else if entity == EntityPurchaseOrder && allowDefaults && result.Supplier != nil {
		result.Purchaser, err = s.resolveCurrentEmployee(
			ctx,
			tx,
			result.Supplier.Data.SalespersonEmployeeID,
			"supplier salesperson",
		)
	} else if entity == EntityPurchaseOrder {
		err = domainError(ErrorConflict, "purchaser is required", nil, nil)
	}
	return err
}

func (s *Service) resolveCurrentEmployee(
	ctx context.Context,
	tx pgx.Tx,
	objectID string,
	field string,
) (*bobdomain.EffectiveReference, error) {
	ref, err := s.resolver.ResolveCurrentEffectiveReference(ctx, tx, bobdomain.EntityEmployee, objectID)
	if err != nil {
		return nil, domainError(ErrorConflict, field+" is not an effective employee", nil, err)
	}
	return &ref, nil
}

func (s *Service) resolveDraftAccounts(
	ctx context.Context,
	tx pgx.Tx,
	draft validatedDraft,
	result *resolvedDraft,
) error {
	var err error
	if result.Handler, err = s.resolveReference(ctx, tx, bobdomain.EntityEmployee, draft.Handler); err != nil {
		return err
	}
	if result.Warehouse, err = s.resolveReference(ctx, tx, bobdomain.EntityWarehouse, draft.Warehouse); err != nil {
		return err
	}
	if result.FundAccount, err = s.resolveReference(ctx, tx, bobdomain.EntityFundAccount, draft.FundAccount); err != nil {
		return err
	}
	if result.FundAccount != nil && result.FundAccount.Data.Currency != draft.Currency {
		return domainError(ErrorConflict, "fund account currency does not match document currency", nil, nil)
	}
	return nil
}

func (s *Service) resolveDraftSettlements(
	ctx context.Context,
	tx pgx.Tx,
	entity string,
	preserved resolvedDraft,
	result *resolvedDraft,
) error {
	var err error
	switch entity {
	case EntitySaleOrder:
		if sameReference(result.Customer, preserved.Customer) && preserved.CustomerSettlement != nil {
			result.CustomerSettlement = preserved.CustomerSettlement
		} else {
			result.CustomerSettlement, err = s.resolveSettlement(ctx, tx, result.Customer, "customer")
		}
	case EntityPurchaseOrder:
		if sameReference(result.Supplier, preserved.Supplier) && preserved.SupplierSettlement != nil {
			result.SupplierSettlement = preserved.SupplierSettlement
		} else {
			result.SupplierSettlement, err = s.resolveSettlement(ctx, tx, result.Supplier, "supplier")
		}
	}
	return err
}

func sameReference(left, right *bobdomain.EffectiveReference) bool {
	return left != nil && right != nil && left.ObjectID == right.ObjectID && left.VersionID == right.VersionID
}

func (s *Service) resolveSettlement(
	ctx context.Context,
	tx pgx.Tx,
	party *bobdomain.EffectiveReference,
	label string,
) (*bobdomain.EffectiveReference, error) {
	if party == nil || party.Data.SettlementMethodID == "" ||
		party.Data.SettlementMethodVersionID == "" {
		return nil, domainError(ErrorConflict, label+" settlement method is not configured", nil, nil)
	}
	return s.resolveReference(ctx, tx, bobdomain.EntitySettlementMethod, &ReferenceInput{
		ObjectID:  party.Data.SettlementMethodID,
		VersionID: party.Data.SettlementMethodVersionID,
	})
}

func (s *Service) resolveDraftProducts(
	ctx context.Context,
	tx pgx.Tx,
	entity string,
	draft validatedDraft,
	result *resolvedDraft,
) error {
	q := s.queries.WithTx(tx)
	for index := range draft.PriceLines {
		product, err := s.resolveReference(ctx, tx, bobdomain.EntityProduct, &draft.PriceLines[index].Product)
		if err != nil {
			return err
		}
		result.Products = append(result.Products, *product)
	}
	for index := range draft.ProductLines {
		line := &draft.ProductLines[index]
		product, err := s.resolveReference(ctx, tx, bobdomain.EntityProduct, &line.Product)
		if err != nil {
			return err
		}
		result.Products = append(result.Products, *product)
		if entity != EntitySaleOrder {
			result.FormulaMaterials = append(result.FormulaMaterials, nil)
			continue
		}
		switch product.Data.ProductKind {
		case bobdomain.ProductKindPackaging:
			if line.Formula != nil {
				return domainError(ErrorValidation, "packaging products cannot contain a formula", nil, nil)
			}
			result.FormulaMaterials = append(result.FormulaMaterials, nil)
			continue
		case bobdomain.ProductKindRawMaterial:
			line.Formula = &fixedFormula{
				BaseOutputQuantity: 1_000_000, SourceType: "RAW_SELF",
				Components: []fixedFormulaComponent{{
					Material: line.Product, Quantity: 1_000_000,
				}},
			}
		case bobdomain.ProductKindStandardFinished:
			if product.Data.Formula == nil {
				return domainError(
					ErrorConflict, "standard finished product formula is not configured", nil, nil,
				)
			}
			if line.Formula == nil {
				return domainError(ErrorValidation, "standard finished product formula is required", nil, nil)
			}
			line.Formula.SourceType = "PRODUCT_FIXED"
			line.Formula.SourceDocumentID = ""
			line.Formula.SourceDocumentNo = ""
		case bobdomain.ProductKindCustomFinished:
			if line.Formula == nil {
				return domainError(ErrorValidation, "custom finished product formula is required", nil, nil)
			}
			line.Formula.SourceType = "MANUAL"
			if draft.Customer != nil {
				latest, latestErr := q.FindLatestCustomerSaleOrderFormula(
					ctx, dbsqlc.FindLatestCustomerSaleOrderFormulaParams{
						CustomerObjectID: draft.Customer.ObjectID,
						ProductObjectID:  product.ObjectID,
					},
				)
				if latestErr != nil && !errors.Is(latestErr, pgx.ErrNoRows) {
					return s.internal("read latest customer formula", latestErr)
				}
				if latestErr == nil &&
					latest.SourceDocumentID == line.Formula.SourceDocumentID &&
					latest.SourceDocumentNo == line.Formula.SourceDocumentNo {
					line.Formula.SourceType = "CUSTOMER_LATEST"
				} else {
					line.Formula.SourceDocumentID = ""
					line.Formula.SourceDocumentNo = ""
				}
			}
		default:
			return domainError(ErrorConflict, "unsupported product kind", nil, nil)
		}
		materials := make([]bobdomain.EffectiveReference, 0, len(line.Formula.Components))
		for componentIndex := range line.Formula.Components {
			component := &line.Formula.Components[componentIndex]
			material, materialErr := s.resolver.ResolveCurrentEffectiveReference(
				ctx,
				tx,
				bobdomain.EntityProduct,
				component.Material.ObjectID,
			)
			if materialErr != nil {
				return domainError(
					ErrorConflict,
					"formula material is not currently effective",
					nil,
					materialErr,
				)
			}
			if material.Data.ProductKind != bobdomain.ProductKindRawMaterial {
				return domainError(ErrorConflict, "formula component must reference a raw material", nil, nil)
			}
			component.Material = ReferenceInput{
				ObjectID:  material.ObjectID,
				VersionID: material.VersionID,
			}
			materials = append(materials, material)
		}
		result.FormulaMaterials = append(result.FormulaMaterials, materials)
	}
	for index := range draft.InventoryCountLines {
		product, err := s.resolveReference(
			ctx, tx, bobdomain.EntityProduct, &draft.InventoryCountLines[index].Product,
		)
		if err != nil {
			return err
		}
		result.Products = append(result.Products, *product)
	}
	return nil
}
