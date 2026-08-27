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
	payloadRows, err := s.queries.ListBobProductPayloadsForVersions(ctx, versionIDs)
	if err != nil {
		return Page[QueryItem]{}, s.internal("load product current payloads", err)
	}
	entryRows, err := s.queries.ListBobProductApprovalEntriesForVersions(ctx, versionIDs)
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
		page.Items = append(page.Items, QueryItem{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ObjectRevision: r.ObjectRevision, Enabled: r.Enabled, UpdatedAt: r.UpdatedAt.Time, LatestApproved: &VersionSummary{Approval: approvalMeta(entry), Summary: productDetailFromRow(payload)}})
	}
	unitConversions, formulas, err := s.loadProductListEnrichments(ctx, versionIDs)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	for index := range page.Items {
		item := &page.Items[index]
		for _, version := range []*VersionSummary{item.LatestApproved, item.OpenVersion} {
			if version == nil {
				continue
			}
			entryID := version.Approval.ApprovalEntryID
			version.Summary.UnitConversions = unitConversions[entryID]
			version.Summary.Formula = formulas[entryID]
		}
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
	conversionRows, err := s.queries.ListBobProductUnitConversionsForVersions(ctx, versionIDs)
	if err != nil {
		return nil, nil, s.internal("read product unit conversions", err)
	}
	for _, row := range conversionRows {
		unitConversions[row.ProductApprovalEntryID] = append(unitConversions[row.ProductApprovalEntryID], ProductUnitConversion{
			Unit: MeasurementUnitSnapshot{
				ObjectID: row.UnitObjectID, ApprovalEntryID: row.UnitApprovalEntryID,
				Code: row.UnitCode, Name: row.UnitName, Symbol: row.UnitSymbol,
			},
			Factor: formatMicros(row.FactorMicros),
		})
	}
	formulas := make(map[string]*ProductFormula, len(versionIDs))
	formulaRows, err := s.queries.ListBobProductFormulasForVersions(ctx, versionIDs)
	if err != nil {
		return nil, nil, s.internal("read product formulas", err)
	}
	for _, row := range formulaRows {
		formulas[row.ProductApprovalEntryID] = &ProductFormula{
			Output: QuantitySnapshot{
				EnteredQuantity: formatMicros(row.OutputEnteredQuantityMicros),
				BaseQuantity:    formatMicros(row.OutputBaseQuantityMicros),
				EnteredUnit: MeasurementUnitSnapshot{
					ObjectID: row.OutputUnitObjectID, ApprovalEntryID: row.OutputUnitApprovalEntryID,
					Code: row.OutputUnitCode, Name: row.OutputUnitName, Symbol: row.OutputUnitSymbol,
				},
			},
			Components: []ProductFormulaComponent{},
		}
	}
	lineRows, err := s.queries.ListBobProductFormulaLinesForVersions(ctx, versionIDs)
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
					ObjectID: row.EnteredUnitObjectID, ApprovalEntryID: row.EnteredUnitApprovalEntryID,
					Code: row.EnteredUnitCode, Name: row.EnteredUnitName, Symbol: row.EnteredUnitSymbol,
				},
			},
			ResolutionStatus: row.ResolutionStatus, RequiresConfirmation: row.RequiresConfirmation,
		})
	}
	return unitConversions, formulas, nil
}

func (s *Service) resolveProductReferences(ctx context.Context, tx pgx.Tx, data DetailView, resolveFormula, preserveSources bool) (DetailView, error) {
	if data.CategoryID != "" {
		if preserveSources && data.CategoryApprovalEntryID != "" {
			// The complete stored snapshot remains authoritative until submit.
		} else {
			category, err := s.resolveNamedAuxiliaryReference(ctx, tx, "product-category", data.CategoryID, "")
			if err != nil {
				return DetailView{}, err
			}
			data.CategoryApprovalEntryID, data.CategoryCode = category.ApprovalEntryID, category.Code
			data.CategoryName = mapString(category.Data, "name")
		}
	}
	if data.ProductTypeID != "" {
		if preserveSources && data.ProductTypeApprovalEntryID != "" {
			// Preserve the exact type snapshot already held by this draft.
		} else {
			typeRef, err := s.resolveNamedAuxiliaryReference(ctx, tx, "product-type", data.ProductTypeID, "")
			if err != nil {
				return DetailView{}, err
			}
			data.ProductTypeApprovalEntryID, data.ProductTypeCode = typeRef.ApprovalEntryID, typeRef.Code
			data.ProductTypeName = mapString(typeRef.Data, "name")
			data.BehaviorProfile = mapString(typeRef.Data, "behaviorProfile")
			if !validProductBehavior(data.BehaviorProfile) {
				return DetailView{}, domainError(ErrorConflict, "product type behavior profile is unavailable", nil, nil)
			}
		}
	}
	resolveUnit := func(snapshot *MeasurementUnitSnapshot) error {
		if preserveSources && snapshot.ApprovalEntryID != "" {
			return nil
		}
		unit, err := s.resolveNamedAuxiliaryReference(ctx, tx, "measurement-unit", snapshot.ObjectID, "")
		if err != nil {
			return err
		}
		snapshot.ApprovalEntryID, snapshot.Code = unit.ApprovalEntryID, unit.Code
		snapshot.Name, snapshot.Symbol = mapString(unit.Data, "name"), mapString(unit.Data, "symbol")
		return nil
	}
	resolveUnitEntry := func(objectID string, entryID *string) error {
		if objectID == "" {
			*entryID = ""
			return nil
		}
		if preserveSources && *entryID != "" {
			return nil
		}
		unit, err := s.resolveNamedAuxiliaryReference(ctx, tx, "measurement-unit", objectID, "")
		if err != nil {
			return err
		}
		*entryID = unit.ApprovalEntryID
		return nil
	}
	if err := resolveUnitEntry(data.DefaultInputUnitID, &data.DefaultInputUnitApprovalEntryID); err != nil {
		return DetailView{}, err
	}
	if err := resolveUnitEntry(data.PricingUnitID, &data.PricingUnitApprovalEntryID); err != nil {
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
