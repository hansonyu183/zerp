package bob

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) queryProducts(ctx context.Context, input QueryInput) (Page[QueryItem], error) {
	page, err := s.queryObjects(ctx, EntityProduct, input)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	versionIDs := make([]string, 0, len(page.Items)*2)
	seenVersionIDs := make(map[string]struct{}, len(page.Items)*2)
	for _, item := range page.Items {
		for _, version := range []*VersionSummary{item.Effective, item.Candidate} {
			if version == nil {
				continue
			}
			if _, seen := seenVersionIDs[version.VersionID]; !seen {
				seenVersionIDs[version.VersionID] = struct{}{}
				versionIDs = append(versionIDs, version.VersionID)
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
		for _, version := range []*VersionSummary{item.Effective, item.Candidate} {
			if version == nil {
				continue
			}
			version.Summary.UnitConversions = unitConversions[version.VersionID]
			version.Summary.Formula = formulas[version.VersionID]
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
	unitRows, err := s.queries.ListBobProductUnitConversionsByVersionIDs(ctx, versionIDs)
	if err != nil {
		return nil, nil, s.internal("read product unit conversions", err)
	}
	for _, row := range unitRows {
		unitConversions[row.ProductVersionID] = append(unitConversions[row.ProductVersionID], ProductUnitConversion{
			Unit: MeasurementUnitSnapshot{ObjectID: row.UnitObjectID, VersionID: row.UnitVersionID,
				Code: row.UnitCode, Name: row.UnitName, Symbol: row.UnitSymbol},
			Factor: formatMicros(row.FactorMicros),
		})
	}
	formulaRows, err := s.queries.ListBobProductFormulasByVersionIDs(ctx, versionIDs)
	if err != nil {
		return nil, nil, s.internal("read product formulas", err)
	}
	formulas := make(map[string]*ProductFormula, len(formulaRows))
	for _, row := range formulaRows {
		formula := formulas[row.ProductVersionID]
		if formula == nil {
			formula = &ProductFormula{
				Output: QuantitySnapshot{EnteredQuantity: formatMicros(row.OutputEnteredQuantityMicros),
					EnteredUnit: MeasurementUnitSnapshot{ObjectID: row.OutputUnitObjectID, VersionID: row.OutputUnitVersionID,
						Code: row.OutputUnitCode, Name: row.OutputUnitName, Symbol: row.OutputUnitSymbol},
					BaseQuantity: formatMicros(row.OutputBaseQuantityMicros)},
				Components: []ProductFormulaComponent{},
			}
			formulas[row.ProductVersionID] = formula
		}
		if row.LineNo == nil {
			continue
		}
		if row.MaterialObjectID == nil || row.MaterialVersionID == nil || row.MaterialCode == nil ||
			row.MaterialName == nil || row.EnteredQuantityMicros == nil || row.EnteredUnitObjectID == nil ||
			row.EnteredUnitVersionID == nil || row.EnteredUnitCode == nil || row.EnteredUnitName == nil ||
			row.EnteredUnitSymbol == nil || row.BaseQuantityMicros == nil || row.ResolutionStatus == nil ||
			row.RequiresConfirmation == nil {
			return nil, nil, s.internal("read product formulas", errors.New("formula line projection is incomplete"))
		}
		formula.Components = append(formula.Components, ProductFormulaComponent{
			Material: FormulaMaterialReference{ObjectID: *row.MaterialObjectID, VersionID: *row.MaterialVersionID,
				Code: *row.MaterialCode, Name: *row.MaterialName, BehaviorProfile: deref(row.MaterialBehaviorProfile)},
			Quantity: QuantitySnapshot{EnteredQuantity: formatMicros(*row.EnteredQuantityMicros),
				EnteredUnit: MeasurementUnitSnapshot{ObjectID: *row.EnteredUnitObjectID, VersionID: *row.EnteredUnitVersionID,
					Code: *row.EnteredUnitCode, Name: *row.EnteredUnitName, Symbol: *row.EnteredUnitSymbol},
				BaseQuantity: formatMicros(*row.BaseQuantityMicros)},
			ResolutionStatus: *row.ResolutionStatus, RequiresConfirmation: *row.RequiresConfirmation,
		})
	}
	return unitConversions, formulas, nil
}

func (s *Service) getProduct(ctx context.Context, input GetInput) (ObjectView, error) {
	result, err := s.getObject(ctx, EntityProduct, input)
	if err != nil {
		return ObjectView{}, err
	}
	result.Data.UnitConversions, err = loadProductUnitConversions(ctx, s.queries, result.Version.VersionID)
	if err != nil {
		return ObjectView{}, s.internal("read product unit conversions", err)
	}
	result.Data.Formula, err = loadProductFormula(ctx, s.queries, result.Version.VersionID)
	if err != nil {
		return ObjectView{}, s.internal("read product formula", err)
	}
	return result, nil
}

func (s *Service) saveProduct(ctx context.Context, input SaveInput, actorID, requestID string) (MutationResult, error) {
	if err := validateDetailInputFields(EntityProduct, input.Data); err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, err)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, EntityProduct, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if object.CurrentVersionID != input.VersionID || version.Revision != input.Revision || version.Status != StatusDraft && version.Status != StatusEffective {
		return MutationResult{}, conflict(object, version, "version changed before save")
	}
	if version.Status == StatusEffective && (object.EffectiveVersionID == nil || *object.EffectiveVersionID != input.VersionID) {
		return MutationResult{}, conflict(object, version, "product effective version changed before save")
	}
	row, err := qtx.GetBobVersionView(ctx, dbsqlc.GetBobVersionViewParams{ObjectID: input.ObjectID, Entity: EntityProduct, VersionID: input.VersionID})
	if err != nil {
		return MutationResult{}, s.internal("read current product detail", err)
	}
	current := detailView(row)
	current.UnitConversions, err = loadProductUnitConversions(ctx, qtx, input.VersionID)
	if err != nil {
		return MutationResult{}, s.internal("read current product units", err)
	}
	current.Formula, err = loadProductFormula(ctx, qtx, input.VersionID)
	if err != nil {
		return MutationResult{}, s.internal("read current product formula", err)
	}
	data, err := validateDetailData(EntityProduct, mergeDetailInput(current, input.Data))
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, err)
	}
	if data.BehaviorProfile != ProductBehaviorStandardFinished {
		data.Formula = nil
	}
	data, err = s.resolveProductReferences(ctx, tx, data, input.Data.Formula != nil)
	if err != nil {
		return MutationResult{}, err
	}
	validationData := data
	if input.Data.Formula == nil {
		// Omitted formula data means the caller did not edit the formula. Preserve
		// stored snapshots without requiring their references to remain current;
		// candidate creation refreshes them below, while submit/approve still run
		// complete stored-detail validation.
		validationData.Formula = nil
	}
	if err = s.validateDetailReferences(ctx, tx, qtx, EntityProduct, input.ObjectID, validationData); err != nil {
		return MutationResult{}, err
	}
	if version.Status == StatusEffective {
		candidateID := newID()
		if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{ID: candidateID, ObjectID: input.ObjectID, Entity: EntityProduct, VersionNo: object.NextVersionNo, ActorID: actorID}); err != nil {
			return MutationResult{}, s.writeError("insert product candidate", err)
		}
		if err = copyDetail(ctx, qtx, EntityProduct, candidateID, version.ID); err != nil {
			return MutationResult{}, s.writeError("copy product candidate", err)
		}
		if err = updateDetail(ctx, qtx, EntityProduct, candidateID, data); err != nil {
			return MutationResult{}, s.writeError("update product candidate", err)
		}
		if data.BehaviorProfile == ProductBehaviorStandardFinished {
			if err = qtx.RefreshBobProductCandidateFormulaMaterials(ctx, candidateID); err != nil {
				return MutationResult{}, s.writeError("refresh candidate formula materials", err)
			}
			if err = qtx.MarkUnresolvedBobProductCandidateFormulaMaterials(ctx, candidateID); err != nil {
				return MutationResult{}, s.writeError("mark unresolved candidate formula materials", err)
			}
		}
		rows, advanceErr := qtx.AdvanceBobProductCandidate(ctx, dbsqlc.AdvanceBobProductCandidateParams{NewVersionID: candidateID, ActorID: actorID, ObjectID: input.ObjectID, EffectiveVersionID: version.ID, Revision: object.Revision})
		if advanceErr != nil {
			return MutationResult{}, s.writeError("advance product candidate", advanceErr)
		}
		if rows != 1 {
			return MutationResult{}, conflict(object, version, "product changed before candidate save")
		}
		if err = insertAudit(ctx, qtx, auditInput{ObjectID: input.ObjectID, VersionID: candidateID, Entity: EntityProduct, Event: "SAVED", To: StatusDraft, ActorID: actorID, RequestID: requestID, Summary: map[string]any{"sourceVersionId": version.ID, "fields": detailFields(EntityProduct)}}); err != nil {
			return MutationResult{}, s.writeError("audit product candidate save", err)
		}
		if err = tx.Commit(ctx); err != nil {
			return MutationResult{}, s.writeError("commit product candidate save", err)
		}
		return MutationResult{ObjectID: input.ObjectID, ObjectRevision: object.Revision + 1, Enabled: object.Enabled, VersionID: candidateID, Version: object.NextVersionNo, Status: StatusDraft, Revision: 1}, nil
	}
	if err = updateDetail(ctx, qtx, EntityProduct, input.VersionID, data); err != nil {
		return MutationResult{}, s.writeError("update product detail", err)
	}
	rows, err := qtx.MarkBobVersionSaved(ctx, dbsqlc.MarkBobVersionSavedParams{ActorID: actorID, ID: input.VersionID, ObjectID: input.ObjectID, Entity: EntityProduct, Revision: input.Revision})
	if err != nil {
		return MutationResult{}, s.writeError("mark product version saved", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, "product version changed before save")
	}
	if err = qtx.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ID: input.ObjectID, Entity: EntityProduct}); err != nil {
		return MutationResult{}, s.writeError("touch product", err)
	}
	from := version.Status
	if err = insertAudit(ctx, qtx, auditInput{ObjectID: input.ObjectID, VersionID: input.VersionID, Entity: EntityProduct, Event: "SAVED", From: &from, To: StatusDraft, ActorID: actorID, RequestID: requestID, Summary: map[string]any{"fields": detailFields(EntityProduct)}}); err != nil {
		return MutationResult{}, s.writeError("audit product save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit product save", err)
	}
	return mutation(object, version, StatusDraft, input.Revision+1), nil
}

func (s *Service) resolveProductReferences(ctx context.Context, tx pgx.Tx, data DetailView, resolveFormula bool) (DetailView, error) {
	if data.ProductTypeID != "" {
		typeRef, err := s.resolveNamedAuxiliaryReference(ctx, tx, "product-type", data.ProductTypeID, "")
		if err != nil {
			return DetailView{}, err
		}
		data.ProductTypeVersionID, data.ProductTypeCode = typeRef.VersionID, typeRef.Code
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
		snapshot.VersionID, snapshot.Code = unit.VersionID, unit.Code
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
		material, err := s.ResolveCurrentEffectiveReference(ctx, tx, EntityProduct, component.Material.ObjectID)
		if err != nil {
			return DetailView{}, err
		}
		component.Material.VersionID, component.Material.Code = material.VersionID, material.Code
		component.Material.Name = material.Data.Name
		component.Material.BehaviorProfile = material.Data.BehaviorProfile
		component.ResolutionStatus = "CURRENT"
		component.RequiresConfirmation = false
	}
	return data, nil
}
