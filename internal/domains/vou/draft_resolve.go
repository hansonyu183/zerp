package vou

import (
	"context"

	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
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
	} else if allowDefaults && result.Customer != nil {
		result.Salesperson, err = s.resolveCurrentEmployee(
			ctx,
			tx,
			result.Customer.Data.SalespersonEmployeeID,
			"customer salesperson",
		)
	} else if entity == EntitySaleOrder || entity == EntityIntermediarySaleOrder {
		err = domainError(ErrorConflict, "salesperson is required", nil, nil)
	}
	if err != nil {
		return err
	}

	if draft.Purchaser != nil {
		result.Purchaser, err = s.resolveReference(ctx, tx, bobdomain.EntityEmployee, draft.Purchaser)
	} else if preserved.Purchaser != nil {
		result.Purchaser = preserved.Purchaser
	} else if allowDefaults && result.Supplier != nil {
		result.Purchaser, err = s.resolveCurrentEmployee(
			ctx,
			tx,
			result.Supplier.Data.SalespersonEmployeeID,
			"supplier salesperson",
		)
	} else if entity == EntityPurchaseOrder || entity == EntityIntermediarySaleOrder {
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
	result *resolvedDraft,
) error {
	var err error
	switch entity {
	case EntitySaleOrder:
		result.CustomerSettlement, err = s.resolveSettlement(ctx, tx, result.Customer, "customer")
	case EntityPurchaseOrder:
		result.SupplierSettlement, err = s.resolveSettlement(ctx, tx, result.Supplier, "supplier")
	case EntityIntermediarySaleOrder:
		if result.CustomerSettlement, err = s.resolveSettlement(
			ctx, tx, result.Customer, "customer",
		); err == nil {
			result.SupplierSettlement, err = s.resolveSettlement(ctx, tx, result.Supplier, "supplier")
		}
	}
	return err
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
	draft validatedDraft,
	result *resolvedDraft,
) error {
	for _, line := range draft.ProductLines {
		product, err := s.resolveReference(ctx, tx, bobdomain.EntityProduct, &line.Product)
		if err != nil {
			return err
		}
		result.Products = append(result.Products, *product)
	}
	return nil
}
