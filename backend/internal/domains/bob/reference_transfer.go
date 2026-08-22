package bob

import (
	"context"
	"errors"
	"sort"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
)

type ReferenceTransferInput struct {
	Entity               string `json:"entity"`
	SourceObjectID       string `json:"sourceObjectId"`
	TargetObjectID       string `json:"targetObjectId"`
	SourceObjectRevision int64  `json:"sourceObjectRevision"`
}

type ReferenceTransferResult struct {
	SourceObjectID  string `json:"sourceObjectId"`
	TargetObjectID  string `json:"targetObjectId"`
	AffectedObjects int    `json:"affectedObjects"`
}

type ReferenceQueryInput struct {
	Entity          string `json:"entity"`
	Keyword         string `json:"keyword"`
	SourceObjectID  string `json:"sourceObjectId"`
	BehaviorProfile string `json:"behaviorProfile"`
}

type ReferenceCandidate struct {
	ObjectID           string                  `json:"objectId"`
	VersionID          string                  `json:"versionId"`
	Code               string                  `json:"code"`
	Name               string                  `json:"name"`
	BehaviorProfile    string                  `json:"behaviorProfile,omitempty"`
	DefaultInputUnitID string                  `json:"defaultInputUnitId,omitempty"`
	PricingUnitID      string                  `json:"pricingUnitId,omitempty"`
	UnitConversions    []ProductUnitConversion `json:"unitConversions,omitempty"`
}

func (s *Service) QueryReferenceCandidates(ctx context.Context, input ReferenceQueryInput) ([]ReferenceCandidate, error) {
	if input.Entity != EntityCustomerAccount && input.Entity != EntityOperatingEntity && input.Entity != EntityEmployee && input.Entity != EntityOtherUnit &&
		input.Entity != EntitySupplier && input.Entity != EntitySalesPartner && input.Entity != EntityProduct {
		return nil, domainError(ErrorValidation, "invalid BOB reference entity", nil, nil)
	}
	if input.SourceObjectID != "" && !validID(input.SourceObjectID) {
		return nil, domainError(ErrorValidation, "invalid BOB reference source", nil, nil)
	}
	if input.BehaviorProfile != "" && (input.Entity != EntityProduct || !validProductBehavior(input.BehaviorProfile)) {
		return nil, domainError(ErrorValidation, "invalid product behavior profile", nil, nil)
	}
	rows, err := s.queries.QueryBobReferenceCandidates(ctx, dbsqlc.QueryBobReferenceCandidatesParams{
		Entity: input.Entity, Keyword: input.Keyword, SourceObjectID: input.SourceObjectID,
		BehaviorProfile: input.BehaviorProfile,
	})
	if err != nil {
		return nil, s.internal("query BOB reference candidates", err)
	}
	result := make([]ReferenceCandidate, 0, len(rows))
	for _, row := range rows {
		candidate := ReferenceCandidate{ObjectID: row.ObjectID, VersionID: deref(row.VersionID), Code: row.Code, Name: row.Name,
			BehaviorProfile: row.BehaviorProfile, DefaultInputUnitID: row.DefaultInputUnitID, PricingUnitID: row.PricingUnitID}
		if input.Entity == EntityProduct {
			candidate.UnitConversions, err = loadProductUnitConversions(ctx, s.queries, candidate.VersionID)
			if err != nil {
				return nil, s.internal("read product reference unit conversions", err)
			}
		}
		result = append(result, candidate)
	}
	return result, nil
}

type directReferenceUse struct {
	objectID string
	entity   string
	role     string
}

type referenceTransferCandidate struct {
	objectID       string
	entity         string
	oldVersionID   string
	oldRevision    int64
	newVersionID   string
	newVersionNo   int32
	objectRevision int64
}

func (s *Service) TransferReferences(
	ctx context.Context, input ReferenceTransferInput, actorID, requestID string,
) (ReferenceTransferResult, error) {
	if !validID(input.SourceObjectID) || !validID(input.TargetObjectID) ||
		input.SourceObjectID == input.TargetObjectID || input.SourceObjectRevision < 1 ||
		!isTransferableReferenceEntity(input.Entity) ||
		!validActorAndRequest(actorID, requestID) {
		return ReferenceTransferResult{}, domainError(ErrorValidation, "invalid reference transfer", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ReferenceTransferResult{}, s.internal("begin reference transfer", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	var sourceEntity, sourceCurrentVersionID string
	var sourceRevision int64
	var sourceEffectiveVersionID *string
	var sourceEnabled bool
	source, err := qtx.LockReferenceTransferSource(ctx, input.SourceObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ReferenceTransferResult{}, domainError(ErrorValidation, "source object not found", nil, nil)
	}
	if err != nil {
		return ReferenceTransferResult{}, s.internal("lock reference source", err)
	}
	sourceEntity, sourceRevision, sourceEnabled, sourceCurrentVersionID, sourceEffectiveVersionID = source.Entity, source.Revision, source.Enabled, source.CurrentVersionID, source.EffectiveVersionID
	sourceHasSupportedCandidate := (sourceEntity == EntitySupplier || sourceEntity == EntityOtherUnit ||
		sourceEntity == EntitySalesPartner) && sourceEffectiveVersionID != nil
	if sourceEntity != input.Entity || sourceRevision != input.SourceObjectRevision || !sourceEnabled || sourceEffectiveVersionID == nil ||
		(!sourceHasSupportedCandidate && sourceCurrentVersionID != *sourceEffectiveVersionID) {
		return ReferenceTransferResult{}, domainError(ErrorConflict, "source object changed before transfer", nil, nil)
	}
	target, err := qtx.LockReferenceTransferTarget(ctx, dbsqlc.LockReferenceTransferTargetParams{ObjectID: input.TargetObjectID, Entity: sourceEntity})
	if errors.Is(err, pgx.ErrNoRows) {
		return ReferenceTransferResult{}, domainError(ErrorConflict, "target object is not a current effective object of the same type", nil, nil)
	}
	if err != nil {
		return ReferenceTransferResult{}, s.internal("lock reference target", err)
	}
	targetVersionID := deref(target)
	uses, err := listDirectReferenceUses(ctx, qtx, sourceEntity, input.SourceObjectID)
	if err != nil {
		return ReferenceTransferResult{}, s.internal("scan direct references", err)
	}
	candidateByObject := make(map[string]referenceTransferCandidate)
	for _, use := range uses {
		candidate, exists := candidateByObject[use.objectID]
		if !exists {
			candidate, err = s.prepareReferenceTransferCandidate(ctx, tx, qtx, use, actorID)
			if err != nil {
				return ReferenceTransferResult{}, err
			}
			candidateByObject[use.objectID] = candidate
		}
		if err = s.replaceDirectReference(ctx, tx, qtx, use, candidate.newVersionID, sourceEntity, input.SourceObjectID, input.TargetObjectID, targetVersionID); err != nil {
			return ReferenceTransferResult{}, err
		}
	}
	for _, candidate := range candidateByObject {
		if err = s.finalizeReferenceTransferCandidate(ctx, tx, qtx, candidate, input, actorID, requestID); err != nil {
			return ReferenceTransferResult{}, err
		}
	}
	rows, err := qtx.DisableReferenceTransferSource(ctx, dbsqlc.DisableReferenceTransferSourceParams{ActorID: actorID, ObjectID: input.SourceObjectID, Entity: sourceEntity, Revision: sourceRevision})
	if err != nil {
		return ReferenceTransferResult{}, s.writeError("disable reference source", err)
	}
	if rows != 1 {
		return ReferenceTransferResult{}, domainError(ErrorConflict, "source object changed before transfer", nil, nil)
	}
	if err = insertAudit(ctx, qtx, auditInput{ObjectID: input.SourceObjectID, VersionID: *sourceEffectiveVersionID,
		Entity: sourceEntity, Event: "DISABLED", To: StatusEffective, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"replacementObjectId": input.TargetObjectID, "affectedObjects": len(candidateByObject)}}); err != nil {
		return ReferenceTransferResult{}, s.writeError("audit disabled reference source", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return ReferenceTransferResult{}, s.writeError("commit reference transfer", err)
	}
	return ReferenceTransferResult{SourceObjectID: input.SourceObjectID, TargetObjectID: input.TargetObjectID, AffectedObjects: len(candidateByObject)}, nil
}

func isTransferableReferenceEntity(entity string) bool {
	return entity == EntityOperatingEntity || entity == EntityEmployee || entity == EntityOtherUnit ||
		entity == EntitySupplier || entity == EntitySalesPartner || entity == EntityProduct
}

func listDirectReferenceUses(ctx context.Context, q *dbsqlc.Queries, entity, objectID string) ([]directReferenceUse, error) {
	uses := []directReferenceUse{}
	switch entity {
	case EntityEmployee:
		rows, err := q.ListCustomerSalesReferencesForEmployee(ctx, &objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
		rows2, err := q.ListSupplierPurchaserReferencesForEmployee(ctx, &objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows2 {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
		rows4, err := q.ListWarehouseManagerReferencesForEmployee(ctx, &objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows4 {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
	case EntityOtherUnit:
		rows, err := q.ListVehiclePlatformReferences(ctx, objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
	case EntitySalesPartner:
		rows, err := q.ListCustomerSalesReferencesForSalesPartner(ctx, &objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
	case EntityOperatingEntity:
		rows, err := q.ListCustomerOperatingReferences(ctx, &objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
		rows2, err := q.ListFundOperatingReferences(ctx, &objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows2 {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
	case EntityProduct:
		rows, err := q.ListFormulaMaterialReferences(ctx, objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
	}
	sort.Slice(uses, func(left, right int) bool {
		if uses[left].objectID != uses[right].objectID {
			return uses[left].objectID < uses[right].objectID
		}
		return uses[left].role < uses[right].role
	})
	return uses, nil
}

func (s *Service) prepareReferenceTransferCandidate(
	ctx context.Context, tx pgx.Tx, qtx *dbsqlc.Queries, use directReferenceUse, actorID string,
) (referenceTransferCandidate, error) {
	object, err := qtx.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ID: use.objectID, Entity: use.entity})
	if err != nil {
		return referenceTransferCandidate{}, s.internal("lock referencing object", err)
	}
	if object.EffectiveVersionID == nil || object.CurrentVersionID != *object.EffectiveVersionID {
		return referenceTransferCandidate{}, domainError(ErrorConflict, "referencing object already has a candidate version", nil, nil)
	}
	oldVersion, err := qtx.LockBobVersion(ctx, dbsqlc.LockBobVersionParams{ID: object.CurrentVersionID, ObjectID: use.objectID, Entity: use.entity})
	if err != nil || oldVersion.Status != StatusEffective {
		return referenceTransferCandidate{}, domainError(ErrorConflict, "referencing object is not currently effective", nil, err)
	}
	newVersionID := newID()
	if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{ID: newVersionID, ObjectID: use.objectID, Entity: use.entity, VersionNo: object.NextVersionNo, ActorID: actorID}); err != nil {
		return referenceTransferCandidate{}, s.writeError("insert transfer version", err)
	}
	if err = copyDetail(ctx, qtx, use.entity, newVersionID, object.CurrentVersionID); err != nil {
		return referenceTransferCandidate{}, s.writeError("copy transfer version detail", err)
	}
	return referenceTransferCandidate{objectID: use.objectID, entity: use.entity, oldVersionID: oldVersion.ID,
		oldRevision: oldVersion.Revision, newVersionID: newVersionID, newVersionNo: object.NextVersionNo,
		objectRevision: object.Revision}, nil
}

func (s *Service) finalizeReferenceTransferCandidate(
	ctx context.Context, tx pgx.Tx, qtx *dbsqlc.Queries, candidate referenceTransferCandidate,
	input ReferenceTransferInput, actorID, requestID string,
) error {
	rows, err := qtx.InvalidateBobVersion(ctx, dbsqlc.InvalidateBobVersionParams{ActorID: actorID,
		ID: candidate.oldVersionID, ObjectID: candidate.objectID, Entity: candidate.entity, Revision: candidate.oldRevision})
	if err != nil || rows != 1 {
		return s.writeError("freeze transferred reference version", err)
	}
	submittedBy := systemidentity.UserID
	rows, err = qtx.ActivateReferenceTransferVersion(ctx, dbsqlc.ActivateReferenceTransferVersionParams{SubmittedBy: &submittedBy, ActorID: &actorID, VersionID: candidate.newVersionID, ObjectID: candidate.objectID, Entity: candidate.entity})
	if err != nil || rows != 1 {
		return s.writeError("activate transferred reference version", err)
	}
	rows, err = qtx.SwitchReferenceTransferObject(ctx, dbsqlc.SwitchReferenceTransferObjectParams{NewVersionID: candidate.newVersionID, ActorID: actorID, ObjectID: candidate.objectID, Entity: candidate.entity, Revision: candidate.objectRevision, OldVersionID: candidate.oldVersionID})
	if err != nil || rows != 1 {
		return s.writeError("switch transferred reference version", err)
	}
	from := StatusEffective
	return insertAudit(ctx, qtx, auditInput{ObjectID: candidate.objectID, VersionID: candidate.newVersionID,
		Entity: candidate.entity, Event: "BULK_BOB_REFERENCE_TRANSFERRED", From: &from, To: StatusEffective,
		ActorID: actorID, RequestID: requestID, Summary: map[string]any{"sourceObjectId": input.SourceObjectID,
			"targetObjectId": input.TargetObjectID, "sourceVersionId": candidate.oldVersionID}})
}

func (s *Service) replaceDirectReference(
	ctx context.Context, tx pgx.Tx, qtx *dbsqlc.Queries, use directReferenceUse, candidateID, targetEntity, sourceObjectID, targetObjectID, targetVersionID string,
) error {
	if targetEntity == EntityOperatingEntity {
		snapshot, err := s.resolveOperatingEntityReference(ctx, tx, targetObjectID)
		if err != nil {
			return err
		}
		switch use.role {
		case "customer-operating":
			err = qtx.ReplaceCustomerOperatingEntityReference(ctx, dbsqlc.ReplaceCustomerOperatingEntityReferenceParams{TargetObjectID: &targetObjectID, Code: &snapshot.Code, Name: &snapshot.Name, TaxNumber: &snapshot.TaxNumber, Address: &snapshot.Address, Phone: &snapshot.Phone, VersionID: candidateID})
		case "fund-operating":
			err = qtx.ReplaceFundOperatingEntityReference(ctx, dbsqlc.ReplaceFundOperatingEntityReferenceParams{TargetObjectID: &targetObjectID, TargetVersionID: &targetVersionID, Code: &snapshot.Code, Name: &snapshot.Name, VersionID: candidateID})
		}
		if err != nil {
			return s.writeError("replace direct reference", err)
		}
		return nil
	}
	target, err := s.ResolveEffectiveReference(ctx, tx, targetEntity, targetObjectID, targetVersionID)
	if err != nil {
		return err
	}
	if err = validateReferenceTransferTarget(ctx, qtx, use.role, targetObjectID, targetVersionID); err != nil {
		return err
	}
	switch use.role {
	case "customer-sales", "customer-sales-external-part-time", "customer-sales-channel-partner":
		err = qtx.ReplaceCustomerSalesReference(ctx, dbsqlc.ReplaceCustomerSalesReferenceParams{TargetObjectID: &targetObjectID, TargetVersionID: &targetVersionID, Code: &target.Code, Name: &target.Data.Name, VersionID: candidateID})
	case "supplier-purchaser":
		err = qtx.ReplaceSupplierPurchaserReference(ctx, dbsqlc.ReplaceSupplierPurchaserReferenceParams{TargetObjectID: &targetObjectID, VersionID: candidateID})
	case "warehouse-manager":
		err = qtx.ReplaceWarehouseManagerReference(ctx, dbsqlc.ReplaceWarehouseManagerReferenceParams{TargetObjectID: &targetObjectID, VersionID: candidateID})
	case "vehicle-platform":
		err = qtx.ReplaceVehiclePlatformReference(ctx, dbsqlc.ReplaceVehiclePlatformReferenceParams{TargetObjectID: targetObjectID, VersionID: candidateID})
	case "formula-material":
		err = qtx.ReplaceFormulaMaterialReference(ctx, dbsqlc.ReplaceFormulaMaterialReferenceParams{TargetObjectID: targetObjectID, TargetVersionID: targetVersionID, ProductVersionID: candidateID, SourceObjectID: sourceObjectID})
	}
	if err != nil {
		return s.writeError("replace direct reference", err)
	}
	return nil
}

func validateReferenceTransferTarget(ctx context.Context, q *dbsqlc.Queries, role, objectID, versionID string) error {
	switch role {
	case "formula-material":
		behavior, err := q.GetReferenceTransferTargetProductBehavior(ctx, dbsqlc.GetReferenceTransferTargetProductBehaviorParams{ObjectID: objectID, VersionID: &versionID})
		if err != nil {
			return domainError(ErrorConflict, "reference transfer target is unavailable", nil, err)
		}
		if role == "formula-material" && deref(behavior) != ProductBehaviorRawMaterial {
			return domainError(ErrorConflict, "formula material replacement must be a raw material", nil, nil)
		}
	case "vehicle-platform":
		eligible, err := q.ReferenceTransferTargetIsServiceRelationship(ctx, dbsqlc.ReferenceTransferTargetIsServiceRelationshipParams{ObjectID: objectID, VersionID: &versionID})
		if err != nil {
			return domainError(ErrorConflict, "vehicle platform replacement is unavailable", nil, err)
		}
		if !eligible {
			return domainError(ErrorConflict, "vehicle platform replacement must be an effective service relationship", nil, nil)
		}
	case "customer-sales-external-part-time", "customer-sales-channel-partner":
		capability := SalesCapabilityExternalPartTime
		if role == "customer-sales-channel-partner" {
			capability = SalesCapabilityChannelPartner
		}
		eligible, err := q.ReferenceTransferTargetHasSalesCapability(ctx, dbsqlc.ReferenceTransferTargetHasSalesCapabilityParams{
			ObjectID: objectID, VersionID: &versionID, Capability: capability,
		})
		if err != nil {
			return domainError(ErrorConflict, "sales relationship replacement is unavailable", nil, err)
		}
		if !eligible {
			return domainError(ErrorConflict, "sales relationship replacement lacks the required capability", nil, nil)
		}
	}
	return nil
}
