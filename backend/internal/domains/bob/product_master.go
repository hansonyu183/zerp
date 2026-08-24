package bob

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) queryProducts(ctx context.Context, input QueryInput) (Page[QueryItem], error) {
	page, err := s.queryObjects(ctx, EntityProduct, input)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	for index := range page.Items {
		item := &page.Items[index]
		current := item.Candidate
		if current == nil {
			current = item.Effective
		}
		if current == nil {
			continue
		}
		current.Summary.UnitConversions, err = loadProductUnitConversions(ctx, s.queries, current.VersionID)
		if err != nil {
			return Page[QueryItem]{}, s.internal("read product unit conversions", err)
		}
		current.Summary.Formula, err = loadProductFormula(ctx, s.queries, current.VersionID)
		if err != nil {
			return Page[QueryItem]{}, s.internal("read product formula", err)
		}
	}
	return page, nil
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
