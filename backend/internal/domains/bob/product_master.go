package bob

import (
	"context"
	"github.com/jackc/pgx/v5"
)

func (s *Service) queryProducts(ctx context.Context, input QueryInput) (Page[QueryItem], error) {
	page, err := s.queryObjects(ctx, EntityProduct, input)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	versionIDs := make([]string, 0, len(page.Items)*2)
	seenApprovalEntryIDs := make(map[string]struct{}, len(page.Items)*2)
	for _, item := range page.Items {
		for _, version := range []*VersionSummary{item.LatestApproved, item.OpenVersion} {
			if version == nil {
				continue
			}
			entryID := version.Approval.ApprovalEntryID
			if _, seen := seenApprovalEntryIDs[entryID]; !seen {
				seenApprovalEntryIDs[entryID] = struct{}{}
				versionIDs = append(versionIDs, entryID)
			}
		}
	}
	if len(versionIDs) == 0 {
		return page, nil
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
	formulas := make(map[string]*ProductFormula, len(versionIDs))
	for _, approvalEntryID := range versionIDs {
		conversions, err := loadProductUnitConversions(ctx, s.queries, approvalEntryID)
		if err != nil {
			return nil, nil, s.internal("read product unit conversions", err)
		}
		formula, err := loadProductFormula(ctx, s.queries, approvalEntryID)
		if err != nil {
			return nil, nil, s.internal("read product formula", err)
		}
		unitConversions[approvalEntryID] = conversions
		if formula != nil {
			formulas[approvalEntryID] = formula
		}
	}
	return unitConversions, formulas, nil
}

func (s *Service) resolveProductReferences(ctx context.Context, tx pgx.Tx, data DetailView, resolveFormula, requireFormulaConfirmation bool) (DetailView, error) {
	if data.ProductTypeID != "" {
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
	resolveUnit := func(snapshot *MeasurementUnitSnapshot) error {
		unit, err := s.resolveNamedAuxiliaryReference(ctx, tx, "measurement-unit", snapshot.ObjectID, "")
		if err != nil {
			return err
		}
		snapshot.ApprovalEntryID, snapshot.Code = unit.ApprovalEntryID, unit.Code
		snapshot.Name, snapshot.Symbol = mapString(unit.Data, "name"), mapString(unit.Data, "symbol")
		return nil
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
			component.RequiresConfirmation = component.RequiresConfirmation || requireFormulaConfirmation ||
				(previousApprovalEntryID != "" && previousApprovalEntryID != material.ApprovalEntryID)
		}
	}
	return data, nil
}
