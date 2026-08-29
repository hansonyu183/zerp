package vou

import (
	"context"
	"errors"
	"math"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

func auxiliaryString(data map[string]any, key string) string {
	value, _ := data[key].(string)
	return value
}

func auxiliaryInt32(data map[string]any, key string) int32 {
	switch value := data[key].(type) {
	case int:
		return int32(value)
	case int32:
		return value
	case int64:
		return int32(value)
	case float64:
		if value >= math.MinInt32 && value <= math.MaxInt32 {
			return int32(value)
		}
	}
	return 0
}

func auxiliaryOptionalInt32(data map[string]any, key string) *int32 {
	if _, exists := data[key]; !exists || data[key] == nil {
		return nil
	}
	value := auxiliaryInt32(data, key)
	return &value
}

func (s *Service) resolveReference(
	ctx context.Context,
	tx pgx.Tx,
	kind string,
	input *ReferenceInput,
) (*bobdomain.EffectiveReference, error) {
	if input == nil {
		return nil, nil
	}
	ref, err := s.resolver.ValidateHistoricalReference(ctx, tx, kind, input.ObjectID, input.ApprovalEntryID)
	if err != nil {
		return nil, domainError(ErrorConflict, kind+" reference is not effective", nil, err)
	}
	return &ref, nil
}

func (s *Service) resolveSelectedReference(
	ctx context.Context,
	tx pgx.Tx,
	kind string,
	input *ReferenceInput,
	preserved *bobdomain.EffectiveReference,
	newDocument bool,
) (*bobdomain.EffectiveReference, error) {
	if input == nil {
		return nil, nil
	}
	var ref bobdomain.EffectiveReference
	var err error
	if !newDocument && preserved != nil && input.ObjectID == preserved.ObjectID && input.ApprovalEntryID == preserved.ApprovalEntryID {
		ref, err = s.resolver.ValidateHistoricalReference(ctx, tx, kind, input.ObjectID, input.ApprovalEntryID)
	} else {
		ref, err = s.resolver.ResolveCurrentReference(ctx, tx, kind, input.ObjectID)
		if err == nil && input.ApprovalEntryID != "" && input.ApprovalEntryID != ref.ApprovalEntryID {
			return nil, domainError(ErrorConflict, kind+" reference does not match the latest approved version", nil, nil)
		}
	}
	if err != nil {
		return nil, domainError(ErrorConflict, kind+" reference is not effective", nil, err)
	}
	return &ref, nil
}

func (s *Service) resolveSelectedAuxiliaryReference(
	ctx context.Context,
	tx pgx.Tx,
	entity string,
	input *AuxiliaryReferenceInput,
	preserved *bobdomain.EffectiveReference,
	newDocument bool,
) (*bobdomain.EffectiveReference, error) {
	if input == nil {
		return nil, nil
	}
	if !newDocument && preserved != nil && input.ObjectID == preserved.ObjectID {
		return preserved, nil
	}
	ref, err := s.auxResolver.ResolveCurrentAuxiliaryReference(ctx, tx, entity, input.ObjectID)
	if err != nil {
		return nil, domainError(ErrorConflict, entity+" reference is not approved", nil, err)
	}
	return &bobdomain.EffectiveReference{ObjectID: ref.ObjectID,
		Entity: ref.Entity, Code: ref.Code, Data: bobdomain.DetailView{
			Name: auxiliaryString(ref.Data, "name"), TermCode: auxiliaryString(ref.Data, "termCode"),
			RuleType: auxiliaryString(ref.Data, "ruleType"), MonthOffset: auxiliaryInt32(ref.Data, "monthOffset"),
			DayOfMonth: auxiliaryOptionalInt32(ref.Data, "dayOfMonth"), DayOffset: auxiliaryInt32(ref.Data, "dayOffset"),
			DueDays: auxiliaryInt32(ref.Data, "dueDays"), CutoffDay: auxiliaryInt32(ref.Data, "cutoffDay"),
			DefaultSalesSurcharge: auxiliaryString(ref.Data, "defaultSalesSurcharge"),
			Description:           auxiliaryString(ref.Data, "description"),
		}}, nil
}

func (s *Service) resolveDraftParties(
	ctx context.Context,
	tx pgx.Tx,
	draft validatedDraft,
	preserved resolvedDraft,
	newDocument bool,
	result *resolvedDraft,
) error {
	var err error
	if result.Customer, err = s.resolveSelectedReference(ctx, tx, bobdomain.EntityCustomerAccount, draft.Customer, preserved.Customer, newDocument); err != nil {
		return err
	}
	if result.Supplier, err = s.resolveSelectedReference(ctx, tx, bobdomain.EntitySupplier, draft.Supplier, preserved.Supplier, newDocument); err != nil {
		return err
	}
	if result.Counterparty, err = s.resolveSelectedReference(ctx, tx, draft.CounterpartyType, draft.Counterparty, preserved.Counterparty, newDocument); err != nil {
		return err
	}
	if result.Employee, err = s.resolveSelectedReference(ctx, tx, bobdomain.EntityEmployee, draft.Employee, preserved.Employee, newDocument); err != nil {
		return err
	}
	if result.InterestParty, err = s.resolveSelectedReference(ctx, tx, bobdomain.EntityOtherUnit, draft.InterestParty, preserved.InterestParty, newDocument); err != nil {
		return err
	}
	if result.Settlement, err = s.resolveSelectedAuxiliaryReference(ctx, tx, auxdomain.EntitySettlementMethod, draft.SettlementMethod, preserved.Settlement, newDocument); err != nil {
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
		result.Salesperson, err = s.resolveSelectedReference(ctx, tx, bobdomain.EntityEmployee, draft.Salesperson, preserved.Salesperson, allowDefaults)
	} else if preserved.Salesperson != nil {
		result.Salesperson = preserved.Salesperson
	} else if entity == EntitySaleOrder && allowDefaults && result.Customer != nil {
		result.Salesperson, err = s.resolveCustomerSalesperson(ctx, tx, *result.Customer)
	} else if entity == EntitySaleOrder {
		err = domainError(ErrorConflict, "salesperson is required", nil, nil)
	}
	if err != nil {
		return err
	}

	if draft.Purchaser != nil {
		result.Purchaser, err = s.resolveSelectedReference(ctx, tx, bobdomain.EntityEmployee, draft.Purchaser, preserved.Purchaser, allowDefaults)
	} else if preserved.Purchaser != nil {
		result.Purchaser = preserved.Purchaser
	} else if entity == EntityPurchaseOrder && allowDefaults && result.Supplier != nil {
		result.Purchaser, err = s.resolveCurrentEmployee(
			ctx,
			tx,
			result.Supplier.Data.DefaultPurchaserEmployeeID,
			"supplier default purchaser",
		)
	} else if entity == EntityPurchaseOrder {
		err = domainError(ErrorConflict, "purchaser is required", nil, nil)
	}
	return err
}

func (s *Service) resolveCustomerSalesperson(
	ctx context.Context,
	tx pgx.Tx,
	customer bobdomain.EffectiveReference,
) (*bobdomain.EffectiveReference, error) {
	attribution, err := s.queries.WithTx(tx).GetVouSalesAttributionSnapshot(ctx, customer.ApprovalEntryID)
	if err != nil {
		return nil, s.internal("read customer sales attribution snapshot", err)
	}
	if deref(attribution.PrimarySalesAttributionType) != bobdomain.SalesAttributionInternalEmployee {
		return nil, domainError(ErrorConflict, "salesperson is required", nil, nil)
	}
	return s.resolveReference(ctx, tx, bobdomain.EntityEmployee, &ReferenceInput{
		ObjectID:        deref(attribution.PrimarySalesSubjectID),
		ApprovalEntryID: deref(attribution.PrimarySalesSubjectApprovalEntryID),
	})
}

func (s *Service) resolveCurrentEmployee(
	ctx context.Context,
	tx pgx.Tx,
	objectID string,
	field string,
) (*bobdomain.EffectiveReference, error) {
	ref, err := s.resolver.ResolveCurrentReference(ctx, tx, bobdomain.EntityEmployee, objectID)
	if err != nil {
		return nil, domainError(ErrorConflict, field+" is not an effective employee", nil, err)
	}
	return &ref, nil
}

func (s *Service) resolveDraftAccounts(
	ctx context.Context,
	tx pgx.Tx,
	draft validatedDraft,
	preserved resolvedDraft,
	newDocument bool,
	result *resolvedDraft,
) error {
	var err error
	if result.Handler, err = s.resolveSelectedReference(ctx, tx, bobdomain.EntityEmployee, draft.Handler, preserved.Handler, newDocument); err != nil {
		return err
	}
	if result.Warehouse, err = s.resolveSelectedReference(ctx, tx, bobdomain.EntityWarehouse, draft.Warehouse, preserved.Warehouse, newDocument); err != nil {
		return err
	}
	if result.FundAccount, err = s.resolveSelectedReference(ctx, tx, bobdomain.EntityFundAccount, draft.FundAccount, preserved.FundAccount, newDocument); err != nil {
		return err
	}
	if result.FundAccount != nil && result.FundAccount.Data.Currency != draft.Currency {
		return domainError(ErrorConflict, "fund account currency does not match document currency", nil, nil)
	}
	for _, line := range draft.BillCashLines {
		var saved *bobdomain.EffectiveReference
		if len(result.BillFunds) < len(preserved.BillFunds) {
			saved = &preserved.BillFunds[len(result.BillFunds)]
		}
		fund, resolveErr := s.resolveSelectedReference(ctx, tx, bobdomain.EntityFundAccount, &line.FundAccount, saved, newDocument)
		if resolveErr != nil {
			return resolveErr
		}
		if fund.Data.Currency != draft.Currency {
			return domainError(ErrorConflict, "fund account currency does not match document currency", nil, nil)
		}
		result.BillFunds = append(result.BillFunds, *fund)
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
	return left != nil && right != nil && left.ObjectID == right.ObjectID && left.ApprovalEntryID == right.ApprovalEntryID
}

func (s *Service) resolveSettlement(
	ctx context.Context,
	tx pgx.Tx,
	party *bobdomain.EffectiveReference,
	label string,
) (*bobdomain.EffectiveReference, error) {
	if party == nil || party.Data.SettlementMethodID == "" {
		return nil, domainError(ErrorConflict, label+" settlement method is not configured", nil, nil)
	}
	if party.Data.TermCode != "" && party.Data.RuleType != "" && party.Data.SettlementMethodCode != "" {
		return &bobdomain.EffectiveReference{
			ObjectID: party.Data.SettlementMethodID, Entity: auxdomain.EntitySettlementMethod,
			Code: party.Data.SettlementMethodCode,
			Data: bobdomain.DetailView{
				Name: party.Data.SettlementMethodName, TermCode: party.Data.TermCode, RuleType: party.Data.RuleType,
				MonthOffset: party.Data.MonthOffset, DayOfMonth: party.Data.DayOfMonth, DayOffset: party.Data.DayOffset,
				DueDays: party.Data.DueDays, CutoffDay: party.Data.CutoffDay,
				DefaultSalesSurcharge: party.Data.DefaultSalesSurcharge,
			},
		}, nil
	}
	return nil, domainError(ErrorConflict, label+" settlement snapshot is incomplete", nil, nil)
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
		product, err := s.resolveCurrentProduct(ctx, tx, draft.PriceLines[index].Product.ObjectID)
		if err != nil {
			return err
		}
		draft.PriceLines[index].Product.ApprovalEntryID = product.ApprovalEntryID
		result.Products = append(result.Products, *product)
	}
	for index := range draft.ProductLines {
		line := &draft.ProductLines[index]
		product, err := s.resolveCurrentProduct(ctx, tx, line.Product.ObjectID)
		if err != nil {
			return err
		}
		line.Product.ApprovalEntryID = product.ApprovalEntryID
		if !productHasUnit(product.Data, line.EnteredUnitID) {
			return domainError(ErrorConflict, "entered unit is not configured for product", nil, nil)
		}
		enteredUnit, err := productUnitSnapshot(product.Data, line.EnteredUnitID)
		if err != nil {
			return err
		}
		if err = validateUnitQuantityScale(line.EnteredQuantity, enteredUnit); err != nil {
			return err
		}
		result.Products = append(result.Products, *product)
		if entity != EntitySaleOrder {
			result.FormulaMaterials = append(result.FormulaMaterials, nil)
			continue
		}
		switch product.Data.BehaviorProfile {
		case bobdomain.ProductBehaviorPackaging:
			if line.Formula != nil {
				return domainError(ErrorValidation, "packaging products cannot contain a formula", nil, nil)
			}
			result.FormulaMaterials = append(result.FormulaMaterials, nil)
			continue
		case bobdomain.ProductBehaviorRawMaterial:
			defaultUnit := product.Data.DefaultInputUnitID
			line.Formula = &fixedFormula{
				Output: fixedQuantitySnapshot{EnteredQuantity: 1_000_000, EnteredUnitID: defaultUnit, BaseQuantity: 1_000_000}, SourceType: "RAW_SELF",
				Components: []fixedFormulaComponent{{
					Material: line.Product,
					Quantity: fixedQuantitySnapshot{EnteredQuantity: 1_000_000, EnteredUnitID: defaultUnit, BaseQuantity: 1_000_000},
				}},
			}
		case bobdomain.ProductBehaviorStandardFinished:
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
		case bobdomain.ProductBehaviorCustomFinished:
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
			return domainError(ErrorConflict, "unsupported product behavior profile", nil, nil)
		}
		if !productHasUnit(product.Data, line.Formula.Output.EnteredUnitID) {
			return domainError(ErrorConflict, "formula output unit is not configured for product", nil, nil)
		}
		outputUnit, err := productUnitSnapshot(product.Data, line.Formula.Output.EnteredUnitID)
		if err != nil {
			return err
		}
		if err = validateUnitQuantityScale(line.Formula.Output.EnteredQuantity, outputUnit); err != nil {
			return err
		}
		materials := make([]bobdomain.EffectiveReference, 0, len(line.Formula.Components))
		for componentIndex := range line.Formula.Components {
			component := &line.Formula.Components[componentIndex]
			material, materialErr := s.resolver.ResolveCurrentReference(
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
			if material.Data.BehaviorProfile != bobdomain.ProductBehaviorRawMaterial {
				return domainError(ErrorConflict, "formula component must reference a raw material", nil, nil)
			}
			if !productHasUnit(material.Data, component.Quantity.EnteredUnitID) {
				return domainError(ErrorConflict, "formula material unit is not configured for product", nil, nil)
			}
			componentUnit, unitErr := productUnitSnapshot(material.Data, component.Quantity.EnteredUnitID)
			if unitErr != nil {
				return unitErr
			}
			if unitErr = validateUnitQuantityScale(component.Quantity.EnteredQuantity, componentUnit); unitErr != nil {
				return unitErr
			}
			component.Material = ReferenceInput{
				ObjectID:        material.ObjectID,
				ApprovalEntryID: material.ApprovalEntryID,
			}
			materials = append(materials, material)
		}
		result.FormulaMaterials = append(result.FormulaMaterials, materials)
	}
	for index := range draft.InventoryCountLines {
		line := &draft.InventoryCountLines[index]
		product, err := s.resolveCurrentProduct(ctx, tx, line.Product.ObjectID)
		if err != nil {
			return err
		}
		line.Product.ApprovalEntryID = product.ApprovalEntryID
		if !productHasUnit(product.Data, line.EnteredUnitID) {
			return domainError(ErrorConflict, "entered unit is not configured for product", nil, nil)
		}
		enteredUnit, err := productUnitSnapshot(product.Data, line.EnteredUnitID)
		if err != nil {
			return err
		}
		if err = validateUnitQuantityScale(line.EnteredQuantity, enteredUnit); err != nil {
			return err
		}
		result.Products = append(result.Products, *product)
	}
	return nil
}

func (s *Service) resolveCurrentProduct(
	ctx context.Context, tx pgx.Tx, objectID string,
) (*bobdomain.EffectiveReference, error) {
	product, err := s.resolver.ResolveCurrentReference(
		ctx, tx, bobdomain.EntityProduct, objectID,
	)
	if err != nil {
		return nil, domainError(ErrorConflict, "product is not currently effective", nil, err)
	}
	return &product, nil
}

func productHasUnit(product bobdomain.DetailView, unitID string) bool {
	for _, conversion := range product.UnitConversions {
		if conversion.Unit.ObjectID == unitID {
			return true
		}
	}
	return false
}
