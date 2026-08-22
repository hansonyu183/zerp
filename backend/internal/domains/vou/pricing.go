package vou

import (
	"context"
	"errors"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

func (s *Service) findPriceReference(
	ctx context.Context,
	q *dbsqlc.Queries,
	entity, productObjectID, supplierObjectID, currency string,
	businessDate time.Time,
) (priceReference, error) {
	if entity == EntitySaleOrder {
		row, err := q.FindVouSalePriceReference(ctx, dbsqlc.FindVouSalePriceReferenceParams{
			ProductObjectID: productObjectID, Currency: stringPtr(currency), BusinessDate: dateValue(businessDate),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return priceReference{}, nil
		}
		if err != nil {
			return priceReference{}, err
		}
		date := row.BusinessDate.Time
		return priceReference{UnitPrice: row.UnitPriceCents, DocumentID: row.SourceDocumentID,
			DocumentNo: row.SourceDocumentNo, LineID: row.SourceLineID, BusinessDate: &date}, nil
	}
	row, err := q.FindVouPurchasePriceReference(ctx, dbsqlc.FindVouPurchasePriceReferenceParams{
		ProductObjectID: productObjectID, SupplierObjectID: supplierObjectID,
		Currency: stringPtr(currency), BusinessDate: dateValue(businessDate),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return priceReference{}, nil
	}
	if err != nil {
		return priceReference{}, err
	}
	date := row.BusinessDate.Time
	return priceReference{UnitPrice: row.UnitPriceCents, DocumentID: row.SourceDocumentID,
		DocumentNo: row.SourceDocumentNo, LineID: row.SourceLineID, BusinessDate: &date}, nil
}

func (s *Service) applyPriceReferences(
	ctx context.Context,
	q *dbsqlc.Queries,
	entity string,
	draft *validatedDraft,
	refs resolvedDraft,
) error {
	if entity != EntitySaleOrder && entity != EntityPurchaseOrder {
		return nil
	}
	supplierID := ""
	if refs.Supplier != nil {
		supplierID = refs.Supplier.ObjectID
	}
	for index := range draft.ProductLines {
		ref, err := s.findPriceReference(ctx, q, entity, refs.Products[index].ObjectID,
			supplierID, draft.Currency, draft.BusinessDate)
		if err != nil {
			return s.internal("resolve price reference", err)
		}
		draft.ProductLines[index].Reference = ref
	}
	return nil
}

func (s *Service) PriceReference(
	ctx context.Context,
	entity string,
	input PriceReferenceInput,
) (PriceReferenceView, error) {
	if entity != EntitySaleOrder && entity != EntityPurchaseOrder {
		return PriceReferenceView{}, domainError(ErrorValidation, "invalid price reference entity", nil, nil)
	}
	businessDate, err := time.Parse(dateLayout, strings.TrimSpace(input.BusinessDate))
	if err != nil {
		return PriceReferenceView{}, domainError(ErrorValidation, "invalid businessDate", nil, nil)
	}
	currency := strings.ToUpper(strings.TrimSpace(input.Currency))
	if !currencyPattern.MatchString(currency) || len(input.Products) == 0 || len(input.Products) > 200 {
		return PriceReferenceView{}, domainError(ErrorValidation, "invalid price reference request", nil, nil)
	}
	if err = validateReference(input.Supplier, "supplier", entity == EntityPurchaseOrder); err != nil {
		return PriceReferenceView{}, err
	}
	if entity == EntitySaleOrder && input.Supplier != nil {
		return PriceReferenceView{}, domainError(ErrorValidation, "supplier does not apply to sale order", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PriceReferenceView{}, s.internal("begin price reference", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	supplierID := ""
	if input.Supplier != nil {
		supplier, resolveErr := s.resolveReference(ctx, tx, bobdomain.EntitySupplier, input.Supplier)
		if resolveErr != nil {
			return PriceReferenceView{}, resolveErr
		}
		supplierID = supplier.ObjectID
	}
	result := PriceReferenceView{Lines: make([]PriceReferenceLineView, 0, len(input.Products))}
	seen := make(map[string]struct{}, len(input.Products))
	for _, productInput := range input.Products {
		if err = validateReference(&productInput, "product", true); err != nil {
			return PriceReferenceView{}, err
		}
		if _, ok := seen[productInput.ObjectID]; ok {
			return PriceReferenceView{}, domainError(ErrorValidation, "duplicate product", nil, nil)
		}
		seen[productInput.ObjectID] = struct{}{}
		product, resolveErr := s.resolveReference(ctx, tx, bobdomain.EntityProduct, &productInput)
		if resolveErr != nil {
			return PriceReferenceView{}, resolveErr
		}
		ref, lookupErr := s.findPriceReference(ctx, q, entity, product.ObjectID, supplierID, currency, businessDate)
		if lookupErr != nil {
			return PriceReferenceView{}, s.internal("resolve price reference", lookupErr)
		}
		line := PriceReferenceLineView{ProductObjectID: product.ObjectID, UnitPrice: formatMoney(ref.UnitPrice),
			SourceDocumentID: ref.DocumentID, SourceDocumentNo: ref.DocumentNo}
		if ref.BusinessDate != nil {
			line.SourceBusinessDate = ref.BusinessDate.Format(dateLayout)
		}
		result.Lines = append(result.Lines, line)
	}
	return result, nil
}
