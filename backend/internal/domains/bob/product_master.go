package bob

import (
	"context"
	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) queryProducts(ctx context.Context, input QueryInput) (Page[QueryItem], error) {
	offset, ok := pageOffset(input.Page, input.PageSize)
	if !ok || len(input.Sort) > 1 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid product query", nil, nil)
	}
	f, err := validateQueryFilters(EntityProduct, input.Filters)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	field, order := "updatedAt", "desc"
	if len(input.Sort) == 1 {
		field, order = input.Sort[0].Field, input.Sort[0].Order
		if field != "updatedAt" && field != "code" && field != "name" {
			return Page[QueryItem]{}, domainError(ErrorValidation, "invalid product query sort", nil, nil)
		}
	}
	enabled := int32(-1)
	if f.Enabled != nil {
		if *f.Enabled {
			enabled = 1
		} else {
			enabled = 0
		}
	}
	rows, err := s.queries.ListBobProductsCurrent(ctx, dbsqlc.ListBobProductsCurrentParams{Keyword: f.Keyword, EnabledFilter: enabled, CategoryID: f.CategoryID, ProductTypeID: f.ProductTypeID, SortField: field, SortOrder: order, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[QueryItem]{}, s.internal("list product current", err)
	}
	total, err := s.queries.CountBobProductsCurrent(ctx, dbsqlc.CountBobProductsCurrentParams{Keyword: f.Keyword, EnabledFilter: enabled, CategoryID: f.CategoryID, ProductTypeID: f.ProductTypeID})
	if err != nil {
		return Page[QueryItem]{}, s.internal("count product current", err)
	}
	page := Page[QueryItem]{Items: make([]QueryItem, 0, len(rows)), Total: total, Page: input.Page, PageSize: input.PageSize}
	versionIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		versionIDs = append(versionIDs, row.ApprovalEntryID)
	}
	if len(versionIDs) == 0 {
		return page, nil
	}
	payloadRows, err := s.queries.ListDCLProductSnapshotsByEntryIDs(ctx, versionIDs)
	if err != nil {
		return Page[QueryItem]{}, s.internal("load product current payloads", err)
	}
	entryRows, err := s.queries.ListDCLProductApprovalEntriesByEntryIDs(ctx, versionIDs)
	if err != nil {
		return Page[QueryItem]{}, s.internal("load product current approvals", err)
	}
	payloads := make(map[string]dbsqlc.DclProductVersion, len(payloadRows))
	for _, payload := range payloadRows {
		payloads[payload.ApprovalEntryID] = payload
	}
	entries := make(map[string]dbsqlc.ApprovalEntry, len(entryRows))
	for _, entry := range entryRows {
		entries[entry.ID] = entry
	}
	for _, r := range rows {
		payload, payloadOK := payloads[r.ApprovalEntryID]
		entry, entryOK := entries[r.ApprovalEntryID]
		if !payloadOK || !entryOK {
			return Page[QueryItem]{}, s.internal("load product current", pgx.ErrNoRows)
		}
		page.Items = append(page.Items, QueryItem{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ObjectRevision: r.ObjectRevision, Enabled: r.Enabled, SourceApprovalEntryID: entry.ID, SourceVersionNo: versionNumber(entry.VersionNo), Data: productDetailFromRow(payload), UpdatedAt: r.UpdatedAt.Time})
	}
	unitConversions, formulas, err := s.loadProductListEnrichments(ctx, versionIDs)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	for index := range page.Items {
		item := &page.Items[index]
		item.Data.UnitConversions = unitConversions[item.SourceApprovalEntryID]
		enrichDefaultInputUnit(&item.Data)
		item.Data.Formula = formulas[item.SourceApprovalEntryID]
	}
	return page, nil
}

func (s *Service) loadProductListEnrichments(
	ctx context.Context, versionIDs []string,
) (map[string][]ProductUnitConversion, map[string]*ProductFormula, error) {
	unitConversions := make(map[string][]ProductUnitConversion, len(versionIDs))
	for _, versionID := range versionIDs {
		unitConversions[versionID] = []ProductUnitConversion{}
	}
	conversionRows, err := s.queries.ListDCLProductUnitConversionsByEntryIDs(ctx, versionIDs)
	if err != nil {
		return nil, nil, s.internal("read product unit conversions", err)
	}
	for _, row := range conversionRows {
		unitConversions[row.ProductApprovalEntryID] = append(unitConversions[row.ProductApprovalEntryID], ProductUnitConversion{
			Unit: MeasurementUnitSnapshot{
				ObjectID: row.UnitObjectID,
				Code:     row.UnitCode, Name: row.UnitName, Symbol: row.UnitSymbol,
				QuantityScale: row.UnitQuantityScale,
			},
			Factor: formatMicros(row.FactorMicros),
		})
	}
	formulas := make(map[string]*ProductFormula, len(versionIDs))
	formulaRows, err := s.queries.ListDCLProductFormulasByEntryIDs(ctx, versionIDs)
	if err != nil {
		return nil, nil, s.internal("read product formulas", err)
	}
	for _, row := range formulaRows {
		formulas[row.ProductApprovalEntryID] = &ProductFormula{
			Output: QuantitySnapshot{
				EnteredQuantity: formatMicros(row.OutputEnteredQuantityMicros),
				BaseQuantity:    formatMicros(row.OutputBaseQuantityMicros),
				EnteredUnit: MeasurementUnitSnapshot{
					ObjectID: row.OutputUnitObjectID,
					Code:     row.OutputUnitCode, Name: row.OutputUnitName, Symbol: row.OutputUnitSymbol,
					QuantityScale: row.OutputUnitQuantityScale,
				},
			},
			Components: []ProductFormulaComponent{},
		}
	}
	lineRows, err := s.queries.ListDCLProductFormulaLinesByEntryIDs(ctx, versionIDs)
	if err != nil {
		return nil, nil, s.internal("read product formula lines", err)
	}
	for _, row := range lineRows {
		formula := formulas[row.ProductApprovalEntryID]
		if formula == nil {
			return nil, nil, s.internal("read product formula lines", pgx.ErrNoRows)
		}
		formula.Components = append(formula.Components, ProductFormulaComponent{
			Material: FormulaMaterialReference{
				ObjectID: row.MaterialObjectID, ApprovalEntryID: row.MaterialApprovalEntryID,
				Code: row.MaterialCode, Name: row.MaterialName,
				BehaviorProfile: stringValue(row.MaterialBehaviorProfile),
			},
			Quantity: QuantitySnapshot{
				EnteredQuantity: formatMicros(row.EnteredQuantityMicros),
				BaseQuantity:    formatMicros(row.BaseQuantityMicros),
				EnteredUnit: MeasurementUnitSnapshot{
					ObjectID: row.EnteredUnitObjectID,
					Code:     row.EnteredUnitCode, Name: row.EnteredUnitName, Symbol: row.EnteredUnitSymbol,
					QuantityScale: row.EnteredUnitQuantityScale,
				},
			},
			ResolutionStatus: row.ResolutionStatus, RequiresConfirmation: row.RequiresConfirmation,
		})
	}
	return unitConversions, formulas, nil
}

func (s *Service) resolveProductReferences(ctx context.Context, tx pgx.Tx, data DetailView, resolveFormula, preserveSources bool) (DetailView, error) {
	if data.CategoryID != "" {
		{
			category, err := s.resolveNamedAuxiliaryReference(ctx, tx, "product-category", data.CategoryID)
			if err != nil {
				return DetailView{}, err
			}
			data.CategoryCode = category.Code
			data.CategoryName = mapString(category.Data, "name")
		}
	}
	if data.ProductTypeID != "" {
		{
			typeRef, err := s.resolveNamedAuxiliaryReference(ctx, tx, "product-type", data.ProductTypeID)
			if err != nil {
				return DetailView{}, err
			}
			data.ProductTypeCode = typeRef.Code
			data.ProductTypeName = mapString(typeRef.Data, "name")
			data.BehaviorProfile = mapString(typeRef.Data, "behaviorProfile")
			if !validProductBehavior(data.BehaviorProfile) {
				return DetailView{}, domainError(ErrorConflict, "product type behavior profile is unavailable", nil, nil)
			}
		}
	}
	resolveUnit := func(snapshot *MeasurementUnitSnapshot) error {
		unit, err := s.resolveNamedAuxiliaryReference(ctx, tx, "measurement-unit", snapshot.ObjectID)
		if err != nil {
			return err
		}
		snapshot.Code = unit.Code
		snapshot.Name, snapshot.Symbol = mapString(unit.Data, "name"), mapString(unit.Data, "symbol")
		snapshot.QuantityScale = int32(mapInt(unit.Data, "quantityScale"))
		if snapshot.QuantityScale < 0 || snapshot.QuantityScale > 6 {
			return domainError(ErrorConflict, "measurement unit quantity scale is unavailable", nil, nil)
		}
		return nil
	}
	resolveUnitEntry := func(objectID string) error {
		if objectID == "" {
			return nil
		}
		_, err := s.resolveNamedAuxiliaryReference(ctx, tx, "measurement-unit", objectID)
		if err != nil {
			return err
		}
		return nil
	}
	if err := resolveUnitEntry(data.DefaultInputUnitID); err != nil {
		return DetailView{}, err
	}
	if err := resolveUnitEntry(data.PricingUnitID); err != nil {
		return DetailView{}, err
	}
	for index := range data.UnitConversions {
		if err := resolveUnit(&data.UnitConversions[index].Unit); err != nil {
			return DetailView{}, err
		}
	}
	if !resolveFormula || data.Formula == nil {
		return data, nil
	}
	if err := resolveUnit(&data.Formula.Output.EnteredUnit); err != nil {
		return DetailView{}, err
	}
	for index := range data.Formula.Components {
		component := &data.Formula.Components[index]
		if err := resolveUnit(&component.Quantity.EnteredUnit); err != nil {
			return DetailView{}, err
		}
		previousApprovalEntryID := component.Material.ApprovalEntryID
		if preserveSources && previousApprovalEntryID != "" {
			continue
		}
		material, err := s.ResolveLatestApprovedReference(ctx, tx, EntityProduct, component.Material.ObjectID)
		if err != nil {
			return DetailView{}, err
		}
		component.Material.ApprovalEntryID, component.Material.Code = material.ApprovalEntryID, material.Code
		component.Material.Name = material.Data.Name
		component.Material.BehaviorProfile = material.Data.BehaviorProfile
		if material.Data.BehaviorProfile != ProductBehaviorRawMaterial {
			component.ResolutionStatus = "UNRESOLVED"
			component.RequiresConfirmation = false
		} else {
			component.ResolutionStatus = "CURRENT"
			component.RequiresConfirmation = component.RequiresConfirmation ||
				(previousApprovalEntryID != "" && previousApprovalEntryID != material.ApprovalEntryID)
		}
	}
	return data, nil
}

func (s *Service) resolveProductDraftReferences(ctx context.Context, tx pgx.Tx, data, previous DetailView) (DetailView, error) {
	resolveUnit := func(snapshot *MeasurementUnitSnapshot) error {
		unit, err := s.resolveNamedAuxiliaryReference(ctx, tx, "measurement-unit", snapshot.ObjectID)
		if err != nil {
			return err
		}
		snapshot.Code = unit.Code
		snapshot.Name, snapshot.Symbol = mapString(unit.Data, "name"), mapString(unit.Data, "symbol")
		snapshot.QuantityScale = int32(mapInt(unit.Data, "quantityScale"))
		if snapshot.QuantityScale < 0 || snapshot.QuantityScale > 6 {
			return domainError(ErrorConflict, "measurement unit quantity scale is unavailable", nil, nil)
		}
		return nil
	}
	resolveUnitID := func(objectID string) error {
		if objectID == "" {
			return nil
		}
		_, err := s.resolveNamedAuxiliaryReference(ctx, tx, "measurement-unit", objectID)
		return err
	}
	if data.CategoryID == previous.CategoryID {
		data.CategoryCode, data.CategoryName = previous.CategoryCode, previous.CategoryName
	} else if data.CategoryID != "" {
		category, err := s.resolveNamedAuxiliaryReference(ctx, tx, "product-category", data.CategoryID)
		if err != nil {
			return DetailView{}, err
		}
		data.CategoryCode, data.CategoryName = category.Code, mapString(category.Data, "name")
	}
	if data.ProductTypeID == previous.ProductTypeID {
		data.ProductTypeCode, data.ProductTypeName, data.BehaviorProfile = previous.ProductTypeCode, previous.ProductTypeName, previous.BehaviorProfile
	} else if data.ProductTypeID != "" {
		typeRef, err := s.resolveNamedAuxiliaryReference(ctx, tx, "product-type", data.ProductTypeID)
		if err != nil {
			return DetailView{}, err
		}
		data.ProductTypeCode, data.ProductTypeName = typeRef.Code, mapString(typeRef.Data, "name")
		data.BehaviorProfile = mapString(typeRef.Data, "behaviorProfile")
	}
	if !validProductBehavior(data.BehaviorProfile) {
		return DetailView{}, domainError(ErrorConflict, "product type behavior profile is unavailable", nil, nil)
	}
	if data.DefaultInputUnitID != previous.DefaultInputUnitID {
		if err := resolveUnitID(data.DefaultInputUnitID); err != nil {
			return DetailView{}, err
		}
	}
	if data.PricingUnitID != previous.PricingUnitID {
		if err := resolveUnitID(data.PricingUnitID); err != nil {
			return DetailView{}, err
		}
	}
	previousUnits := make(map[string]MeasurementUnitSnapshot, len(previous.UnitConversions))
	for _, conversion := range previous.UnitConversions {
		previousUnits[conversion.Unit.ObjectID] = conversion.Unit
	}
	for index := range data.UnitConversions {
		unit := &data.UnitConversions[index].Unit
		if previousUnit, exists := previousUnits[unit.ObjectID]; exists {
			*unit = previousUnit
			continue
		}
		if err := resolveUnit(unit); err != nil {
			return DetailView{}, err
		}
	}
	if data.Formula == nil {
		return data, nil
	}
	if previous.Formula != nil && data.Formula.Output.EnteredUnit.ObjectID == previous.Formula.Output.EnteredUnit.ObjectID {
		data.Formula.Output.EnteredUnit = previous.Formula.Output.EnteredUnit
	} else if err := resolveUnit(&data.Formula.Output.EnteredUnit); err != nil {
		return DetailView{}, err
	}
	previousComponents := make(map[string]ProductFormulaComponent)
	if previous.Formula != nil {
		previousComponents = make(map[string]ProductFormulaComponent, len(previous.Formula.Components))
		for _, component := range previous.Formula.Components {
			previousComponents[component.Material.ObjectID] = component
		}
	}
	for index := range data.Formula.Components {
		component := &data.Formula.Components[index]
		previousComponent, unchangedMaterial := previousComponents[component.Material.ObjectID]
		if unchangedMaterial {
			component.Material = previousComponent.Material
		} else {
			material, err := s.ResolveLatestApprovedReference(ctx, tx, EntityProduct, component.Material.ObjectID)
			if err != nil {
				return DetailView{}, err
			}
			component.Material.ApprovalEntryID, component.Material.Code = material.ApprovalEntryID, material.Code
			component.Material.Name, component.Material.BehaviorProfile = material.Data.Name, material.Data.BehaviorProfile
			if material.Data.BehaviorProfile != ProductBehaviorRawMaterial {
				component.ResolutionStatus, component.RequiresConfirmation = "UNRESOLVED", false
			} else {
				component.ResolutionStatus = "CURRENT"
			}
		}
		if unchangedMaterial && component.Quantity.EnteredUnit.ObjectID == previousComponent.Quantity.EnteredUnit.ObjectID {
			component.Quantity.EnteredUnit = previousComponent.Quantity.EnteredUnit
		} else if err := resolveUnit(&component.Quantity.EnteredUnit); err != nil {
			return DetailView{}, err
		}
	}
	return data, nil
}
