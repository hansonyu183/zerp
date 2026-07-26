package bob

import (
	"context"
	"errors"
	"slices"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool                   *pgxpool.Pool
	queries                *dbsqlc.Queries
	afterDeleteDetailsHook func() error
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, queries: dbsqlc.New(pool)}
}

func (s *Service) Query(ctx context.Context, entity string, input QueryInput) (Page[QueryItem], error) {
	offset, validPage := pageOffset(input.Page, input.PageSize)
	if !validEntity(entity) || !validPage {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid query", nil, nil)
	}
	filters, err := validateQueryFilters(entity, input.Filters)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	statuses := uniqueStrings(filters.Status)
	for _, status := range statuses {
		if !validStatus(status) {
			return Page[QueryItem]{}, domainError(ErrorValidation, "invalid status filter", nil, nil)
		}
	}
	sortField, sortOrder := "updatedAt", "desc"
	if len(input.Sort) > 1 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "only one sort item is allowed", nil, nil)
	}
	if len(input.Sort) == 1 {
		sortField, sortOrder = input.Sort[0].Field, strings.ToLower(input.Sort[0].Order)
		if !slices.Contains([]string{"updatedAt", "code", "name", "status", "version"}, sortField) ||
			!slices.Contains([]string{"asc", "desc"}, sortOrder) {
			return Page[QueryItem]{}, domainError(ErrorValidation, "invalid sort", nil, nil)
		}
	}
	if statuses == nil {
		statuses = []string{}
	}
	countParams := dbsqlc.CountBobObjectsParams{
		Entity: entity, Statuses: statuses, Keyword: filters.Keyword,
		CustomerType: filters.CustomerType, SupplierType: filters.SupplierType,
		CategoryID: filters.CategoryID, DepartmentID: filters.DepartmentID,
		PositionID: filters.PositionID, SalespersonEmployeeID: filters.SalespersonEmployeeID,
		Currency:     filters.Currency,
		TargetEntity: filters.TargetEntity, ParentID: filters.ParentID, RootOnly: filters.RootOnly,
	}
	total, err := s.queries.CountBobObjects(ctx, countParams)
	if err != nil {
		return Page[QueryItem]{}, s.internal("count objects", err)
	}
	rows, err := s.queries.ListBobObjects(ctx, dbsqlc.ListBobObjectsParams{
		Entity: entity, Statuses: statuses, Keyword: filters.Keyword, SortField: sortField, SortOrder: sortOrder,
		CustomerType: filters.CustomerType, SupplierType: filters.SupplierType,
		CategoryID: filters.CategoryID, DepartmentID: filters.DepartmentID,
		PositionID: filters.PositionID, SalespersonEmployeeID: filters.SalespersonEmployeeID,
		Currency:     filters.Currency,
		TargetEntity: filters.TargetEntity, ParentID: filters.ParentID, RootOnly: filters.RootOnly,
		PageOffset: offset, PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[QueryItem]{}, s.internal("list objects", err)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, queryItem(row))
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) Get(ctx context.Context, entity string, input GetInput) (ObjectView, error) {
	if !validEntity(entity) || !validID(input.ObjectID) || (input.VersionID != "" && !validID(input.VersionID)) {
		return ObjectView{}, domainError(ErrorValidation, "invalid object or version", nil, nil)
	}
	row, err := s.queries.GetBobVersionView(ctx, dbsqlc.GetBobVersionViewParams{
		ObjectID: input.ObjectID, Entity: entity, VersionID: input.VersionID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "object or version not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get object", err)
	}
	return objectView(row), nil
}

func (s *Service) Create(ctx context.Context, entity string, input CreateInput, actorID, requestID string) (MutationResult, error) {
	data, code, err := validateCreate(entity, input.Data)
	if err != nil || !validActorAndRequest(actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid create request", nil, err)
	}
	objectID, versionID := newID(), newID()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.validateDetailReferences(ctx, qtx, entity, objectID, data); err != nil {
		return MutationResult{}, err
	}
	if err = qtx.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{
		ID: objectID, Entity: entity, Code: code, CurrentVersionID: versionID, ActorID: actorID,
	}); err != nil {
		return MutationResult{}, s.writeError("insert object", err)
	}
	if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{
		ID: versionID, ObjectID: objectID, Entity: entity, VersionNo: 1, ActorID: actorID,
	}); err != nil {
		return MutationResult{}, s.writeError("insert version", err)
	}
	if err = insertDetail(ctx, qtx, entity, versionID, data); err != nil {
		return MutationResult{}, s.writeError("insert detail", err)
	}
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: objectID, VersionID: versionID, Entity: entity, Event: "CREATED", To: StatusDraft,
		ActorID: actorID, RequestID: requestID, Summary: map[string]any{"fields": append([]string{"code"}, detailFields(entity)...)},
	}); err != nil {
		return MutationResult{}, s.writeError("audit create", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit create", err)
	}
	return MutationResult{ObjectID: objectID, ObjectRevision: 1, VersionID: versionID, Version: 1, Status: StatusDraft, Revision: 1}, nil
}

func (s *Service) Save(ctx context.Context, entity string, input SaveInput, actorID, requestID string) (MutationResult, error) {
	if !validWriteInput(entity, input.ObjectID, input.VersionID, input.Revision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, nil)
	}
	if err := validateDetailInputFields(entity, input.Data); err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, err)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, entity, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if object.CurrentVersionID != input.VersionID || object.EffectiveVersionID != nil || version.Revision != input.Revision ||
		!slices.Contains([]string{StatusDraft, StatusRejected}, version.Status) {
		return MutationResult{}, conflict(object, version, "version changed before save")
	}
	row, readErr := qtx.GetBobVersionView(ctx, dbsqlc.GetBobVersionViewParams{
		ObjectID: input.ObjectID, Entity: entity, VersionID: input.VersionID,
	})
	if readErr != nil {
		return MutationResult{}, s.internal("read current detail", readErr)
	}
	current := detailView(row)
	data, err := validateDetailData(entity, mergeDetailInput(current, input.Data))
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, err)
	}
	if entity == EntityCategory && data.TargetEntity != current.TargetEntity {
		referenced, referenceErr := qtx.BobObjectHasExternalReferences(ctx, dbsqlc.BobObjectHasExternalReferencesParams{
			TargetObjectID: input.ObjectID, TargetVersionID: input.VersionID,
		})
		if referenceErr != nil {
			return MutationResult{}, s.internal("check category target references", referenceErr)
		}
		if referenced {
			return MutationResult{}, domainError(ErrorConflict, "referenced category target cannot change", nil, nil)
		}
	}
	if err = s.validateDetailReferences(ctx, qtx, entity, input.ObjectID, data); err != nil {
		return MutationResult{}, err
	}
	if err = updateDetail(ctx, qtx, entity, input.VersionID, data); err != nil {
		return MutationResult{}, s.writeError("update detail", err)
	}
	rows, err := qtx.MarkBobVersionSaved(ctx, dbsqlc.MarkBobVersionSavedParams{
		ActorID: actorID, ID: input.VersionID, ObjectID: input.ObjectID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("mark version saved", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, "version changed before save")
	}
	if err = qtx.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ID: input.ObjectID, Entity: entity}); err != nil {
		return MutationResult{}, s.internal("touch object", err)
	}
	from := version.Status
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: input.ObjectID, VersionID: input.VersionID, Entity: entity, Event: "SAVED", From: &from, To: from,
		ActorID: actorID, RequestID: requestID, Summary: map[string]any{"fields": detailFields(entity)},
	}); err != nil {
		return MutationResult{}, s.writeError("audit save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit save", err)
	}
	return mutation(object, version, version.Status, input.Revision+1), nil
}

func (s *Service) Delete(ctx context.Context, entity string, input DeleteInput) error {
	if !validDeleteInput(entity, input) {
		return domainError(ErrorValidation, "invalid delete request", nil, nil)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, entity, input.ObjectID, input.VersionID)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if object.Revision != input.ObjectRevision ||
		object.CurrentVersionID != input.VersionID ||
		object.EffectiveVersionID != nil ||
		object.NextVersionNo != 2 ||
		version.VersionNo != 1 ||
		version.Status != StatusDraft ||
		version.Revision != input.Revision ||
		version.SubmittedAt.Valid ||
		version.SubmittedBy != nil ||
		version.ReviewedAt.Valid ||
		version.ReviewedBy != nil {
		return conflict(object, version, "first draft cannot be deleted in its current state")
	}
	versionCount, err := qtx.CountBobVersions(ctx, dbsqlc.CountBobVersionsParams{
		ObjectID: input.ObjectID,
		Entity:   entity,
	})
	if err != nil {
		return s.internal("count versions before delete", err)
	}
	if versionCount != 1 {
		return conflict(object, version, "object has version history")
	}
	auditDeletable, err := qtx.BobDraftAuditIsDeletable(ctx, dbsqlc.BobDraftAuditIsDeletableParams{
		ObjectID:  input.ObjectID,
		VersionID: input.VersionID,
		Entity:    entity,
	})
	if err != nil {
		return s.internal("validate draft audit before delete", err)
	}
	if auditDeletable == nil || !*auditDeletable {
		return conflict(object, version, "object has lifecycle history")
	}
	referenced, err := qtx.BobObjectHasExternalReferences(ctx, dbsqlc.BobObjectHasExternalReferencesParams{
		TargetObjectID:  input.ObjectID,
		TargetVersionID: input.VersionID,
	})
	if err != nil {
		return s.internal("check external references before delete", err)
	}
	if referenced {
		return conflict(object, version, "object or version is referenced")
	}

	auditRows, err := qtx.DeleteBobAuditEventsForDraft(ctx, dbsqlc.DeleteBobAuditEventsForDraftParams{
		ObjectID:  input.ObjectID,
		VersionID: input.VersionID,
		Entity:    entity,
	})
	if err != nil {
		return s.writeError("delete draft audit events", err)
	}
	if auditRows < 1 {
		return conflict(object, version, "draft audit changed before delete")
	}
	detailRows, err := deleteDetail(ctx, qtx, entity, input.VersionID)
	if err != nil {
		return s.writeError("delete version detail", err)
	}
	if detailRows != 1 {
		return conflict(object, version, "version detail changed before delete")
	}
	if s.afterDeleteDetailsHook != nil {
		if err = s.afterDeleteDetailsHook(); err != nil {
			return s.internal("delete draft interrupted", err)
		}
	}
	versionRows, err := qtx.DeleteBobFirstVersion(ctx, dbsqlc.DeleteBobFirstVersionParams{
		VersionID: input.VersionID,
		ObjectID:  input.ObjectID,
		Entity:    entity,
		Revision:  input.Revision,
	})
	if err != nil {
		return s.writeError("delete first version", err)
	}
	if versionRows != 1 {
		return conflict(object, version, "version changed before delete")
	}
	objectRows, err := qtx.DeleteBobObject(ctx, dbsqlc.DeleteBobObjectParams{
		ObjectID:       input.ObjectID,
		Entity:         entity,
		VersionID:      input.VersionID,
		ObjectRevision: input.ObjectRevision,
	})
	if err != nil {
		return s.writeError("delete object", err)
	}
	if objectRows != 1 {
		return conflict(object, version, "object changed before delete")
	}
	if err = tx.Commit(ctx); err != nil {
		return s.writeError("commit delete", err)
	}
	return nil
}

func (s *Service) Submit(ctx context.Context, entity string, input VersionRevisionInput, actorID, requestID string) (MutationResult, error) {
	if !validWriteInput(entity, input.ObjectID, input.VersionID, input.Revision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid submit request", nil, nil)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, entity, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if object.CurrentVersionID != input.VersionID || object.EffectiveVersionID != nil || version.Revision != input.Revision ||
		!slices.Contains([]string{StatusDraft, StatusRejected}, version.Status) {
		return MutationResult{}, conflict(object, version, "version changed before submit")
	}
	if err = s.validateStoredDetail(ctx, qtx, entity, input.ObjectID, input.VersionID); err != nil {
		return MutationResult{}, err
	}
	rows, err := qtx.SubmitBobVersion(ctx, dbsqlc.SubmitBobVersionParams{
		ActorID: &actorID, ID: input.VersionID, ObjectID: input.ObjectID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("submit version", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, "version changed before submit")
	}
	if err = qtx.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ID: input.ObjectID, Entity: entity}); err != nil {
		return MutationResult{}, s.internal("touch object", err)
	}
	from := version.Status
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: input.ObjectID, VersionID: input.VersionID, Entity: entity, Event: "SUBMITTED", From: &from, To: StatusPending,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("audit submit", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit submit", err)
	}
	return mutation(object, version, StatusPending, input.Revision+1), nil
}

func (s *Service) Approve(ctx context.Context, entity string, input ReviewInput, actorID, requestID string) (MutationResult, error) {
	comment, err := optionalComment(input.Comment)
	if err != nil || !validWriteInput(entity, input.ObjectID, input.VersionID, input.Revision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid approval request", nil, err)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, entity, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if object.CurrentVersionID != input.VersionID || object.EffectiveVersionID != nil || version.Status != StatusPending || version.Revision != input.Revision {
		return MutationResult{}, conflict(object, version, "version changed before approval")
	}
	if version.SubmittedBy == nil || *version.SubmittedBy == actorID {
		return MutationResult{}, domainError(ErrorConflict, "submitter cannot review the same version", conflictData(object, version), nil)
	}
	if err = s.validateStoredDetail(ctx, qtx, entity, input.ObjectID, input.VersionID); err != nil {
		return MutationResult{}, err
	}
	rows, err := qtx.ApproveBobVersion(ctx, dbsqlc.ApproveBobVersionParams{
		ActorID: &actorID, Comment: comment, ID: input.VersionID, ObjectID: input.ObjectID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("approve version", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, "version changed before approval")
	}
	rows, err = qtx.SetBobObjectEffective(ctx, dbsqlc.SetBobObjectEffectiveParams{
		VersionID: &input.VersionID, ActorID: actorID, ID: input.ObjectID, Entity: entity, Revision: object.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("set effective version", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, "object changed before approval")
	}
	from := StatusPending
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: input.ObjectID, VersionID: input.VersionID, Entity: entity, Event: "APPROVED", From: &from, To: StatusEffective,
		ActorID: actorID, RequestID: requestID, Comment: comment,
	}); err != nil {
		return MutationResult{}, s.writeError("audit approval", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit approval", err)
	}
	result := mutation(object, version, StatusEffective, input.Revision+1)
	result.ObjectRevision++
	return result, nil
}

func (s *Service) Reject(ctx context.Context, entity string, input ReviewInput, actorID, requestID string) (MutationResult, error) {
	comment, err := requiredComment(input.Comment)
	if err != nil || !validWriteInput(entity, input.ObjectID, input.VersionID, input.Revision, actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid rejection request", nil, err)
	}
	tx, qtx, object, version, err := s.lockTarget(ctx, entity, input.ObjectID, input.VersionID)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if object.CurrentVersionID != input.VersionID || object.EffectiveVersionID != nil || version.Status != StatusPending || version.Revision != input.Revision {
		return MutationResult{}, conflict(object, version, "version changed before rejection")
	}
	if version.SubmittedBy == nil || *version.SubmittedBy == actorID {
		return MutationResult{}, domainError(ErrorConflict, "submitter cannot review the same version", conflictData(object, version), nil)
	}
	rows, err := qtx.RejectBobVersion(ctx, dbsqlc.RejectBobVersionParams{
		ActorID: &actorID, Comment: comment, ID: input.VersionID, ObjectID: input.ObjectID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("reject version", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, "version changed before rejection")
	}
	if err = qtx.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ID: input.ObjectID, Entity: entity}); err != nil {
		return MutationResult{}, s.internal("touch object", err)
	}
	from := StatusPending
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: input.ObjectID, VersionID: input.VersionID, Entity: entity, Event: "REJECTED", From: &from, To: StatusRejected,
		ActorID: actorID, RequestID: requestID, Comment: comment,
	}); err != nil {
		return MutationResult{}, s.writeError("audit rejection", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit rejection", err)
	}
	return mutation(object, version, StatusRejected, input.Revision+1), nil
}

func (s *Service) Edit(ctx context.Context, entity string, input ObjectRevisionInput, actorID, requestID string) (MutationResult, error) {
	if !validEntity(entity) || !validID(input.ObjectID) || input.ObjectRevision < 1 || !validActorAndRequest(actorID, requestID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid edit request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin edit", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	object, err := qtx.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ID: input.ObjectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock object", err)
	}
	if object.Revision != input.ObjectRevision || object.EffectiveVersionID == nil || object.CurrentVersionID != *object.EffectiveVersionID {
		return MutationResult{}, domainError(ErrorConflict, "object cannot be edited in its current state", map[string]any{
			"objectRevision": object.Revision, "currentVersionId": object.CurrentVersionID,
		}, nil)
	}
	oldVersion, err := qtx.LockBobVersion(ctx, dbsqlc.LockBobVersionParams{
		ID: *object.EffectiveVersionID, ObjectID: input.ObjectID, Entity: entity,
	})
	if err != nil {
		return MutationResult{}, s.internal("lock effective version", err)
	}
	if oldVersion.Status != StatusEffective {
		return MutationResult{}, conflict(object, oldVersion, "effective version changed before edit")
	}
	newVersionID := newID()
	if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{
		ID: newVersionID, ObjectID: input.ObjectID, Entity: entity, VersionNo: object.NextVersionNo, ActorID: actorID,
	}); err != nil {
		return MutationResult{}, s.writeError("insert edit version", err)
	}
	if err = copyDetail(ctx, qtx, entity, newVersionID, oldVersion.ID); err != nil {
		return MutationResult{}, s.writeError("copy edit detail", err)
	}
	rows, err := qtx.InvalidateBobVersion(ctx, dbsqlc.InvalidateBobVersionParams{
		ActorID: actorID, ID: oldVersion.ID, ObjectID: input.ObjectID, Entity: entity, Revision: oldVersion.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("invalidate effective version", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, oldVersion, "effective version changed before edit")
	}
	rows, err = qtx.AdvanceBobObjectForEdit(ctx, dbsqlc.AdvanceBobObjectForEditParams{
		NewVersionID: newVersionID, ActorID: actorID, ID: input.ObjectID, Entity: entity,
		Revision: input.ObjectRevision, OldVersionID: oldVersion.ID,
	})
	if err != nil {
		return MutationResult{}, s.writeError("advance object for edit", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, oldVersion, "object changed before edit")
	}
	fromEffective, fromNone := StatusEffective, (*string)(nil)
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: input.ObjectID, VersionID: oldVersion.ID, Entity: entity, Event: "INVALIDATED", From: &fromEffective, To: StatusInvalid,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("audit invalidation", err)
	}
	if err = insertAudit(ctx, qtx, auditInput{
		ObjectID: input.ObjectID, VersionID: newVersionID, Entity: entity, Event: "EDIT_STARTED", From: fromNone, To: StatusDraft,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("audit edit", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit edit", err)
	}
	return MutationResult{
		ObjectID: input.ObjectID, ObjectRevision: input.ObjectRevision + 1, VersionID: newVersionID,
		Version: object.NextVersionNo, Status: StatusDraft, Revision: 1,
	}, nil
}

func (s *Service) Versions(ctx context.Context, entity string, input HistoryInput) (Page[VersionHistoryItem], error) {
	if !validHistoryInput(entity, input) {
		return Page[VersionHistoryItem]{}, domainError(ErrorValidation, "invalid versions request", nil, nil)
	}
	if _, err := s.Get(ctx, entity, GetInput{ObjectID: input.ObjectID}); err != nil {
		return Page[VersionHistoryItem]{}, err
	}
	total, err := s.queries.CountBobVersions(ctx, dbsqlc.CountBobVersionsParams{ObjectID: input.ObjectID, Entity: entity})
	if err != nil {
		return Page[VersionHistoryItem]{}, s.internal("count versions", err)
	}
	rows, err := s.queries.ListBobVersions(ctx, dbsqlc.ListBobVersionsParams{
		ObjectID: input.ObjectID, Entity: entity, PageOffset: mustPageOffset(input.Page, input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[VersionHistoryItem]{}, s.internal("list versions", err)
	}
	items := make([]VersionHistoryItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, versionHistoryItem(row))
	}
	return Page[VersionHistoryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) AuditHistory(ctx context.Context, entity string, input HistoryInput) (Page[AuditEventView], error) {
	if !validHistoryInput(entity, input) {
		return Page[AuditEventView]{}, domainError(ErrorValidation, "invalid audit history request", nil, nil)
	}
	if _, err := s.Get(ctx, entity, GetInput{ObjectID: input.ObjectID}); err != nil {
		return Page[AuditEventView]{}, err
	}
	total, err := s.queries.CountBobAuditEvents(ctx, dbsqlc.CountBobAuditEventsParams{ObjectID: input.ObjectID, Entity: entity})
	if err != nil {
		return Page[AuditEventView]{}, s.internal("count audit events", err)
	}
	rows, err := s.queries.ListBobAuditEvents(ctx, dbsqlc.ListBobAuditEventsParams{
		ObjectID: input.ObjectID, Entity: entity, PageOffset: mustPageOffset(input.Page, input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[AuditEventView]{}, s.internal("list audit events", err)
	}
	items := make([]AuditEventView, 0, len(rows))
	for _, row := range rows {
		items = append(items, auditEventView(row))
	}
	return Page[AuditEventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

// ResolveEffectiveReference must be called with the transaction that will write
// the consuming business record. The shared row lock is held until that
// transaction finishes, preventing a concurrent edit from invalidating the
// reference between validation and the consuming write.
func (s *Service) ResolveEffectiveReference(ctx context.Context, tx pgx.Tx, entity, objectID, versionID string) (EffectiveReference, error) {
	if !validEntity(entity) || !validID(objectID) || !validID(versionID) {
		return EffectiveReference{}, domainError(ErrorValidation, "invalid effective reference", nil, nil)
	}
	row, err := s.queries.WithTx(tx).ResolveBobEffectiveReference(ctx, dbsqlc.ResolveBobEffectiveReferenceParams{
		ObjectID: objectID, Entity: entity, VersionID: versionID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "version is not currently effective", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve effective reference", err)
	}
	if entity == EntityVehicle {
		if err = s.validatePlatformReference(ctx, s.queries.WithTx(tx), deref(row.PlatformObjectID)); err != nil {
			return EffectiveReference{}, err
		}
	}
	return EffectiveReference{
		ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, VersionID: row.VersionID,
		Data: effectiveReferenceDetail(row),
	}, nil
}

// ResolveCurrentEffectiveReference resolves an object's current effective
// version without requiring callers to already know its version ID.
func (s *Service) ResolveCurrentEffectiveReference(
	ctx context.Context, tx pgx.Tx, entity, objectID string,
) (EffectiveReference, error) {
	if !validEntity(entity) || !validID(objectID) {
		return EffectiveReference{}, domainError(ErrorValidation, "invalid current effective reference", nil, nil)
	}
	row, err := s.queries.WithTx(tx).ResolveCurrentBobEffectiveReference(
		ctx,
		dbsqlc.ResolveCurrentBobEffectiveReferenceParams{ObjectID: objectID, Entity: entity},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "object is not currently effective", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve current effective reference", err)
	}
	if entity == EntityVehicle {
		if err = s.validatePlatformReference(ctx, s.queries.WithTx(tx), deref(row.PlatformObjectID)); err != nil {
			return EffectiveReference{}, err
		}
	}
	return EffectiveReference{
		ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, VersionID: row.VersionID,
		Data: effectiveReferenceDetail(row),
	}, nil
}

func (s *Service) lockTarget(ctx context.Context, entity, objectID, versionID string) (
	pgx.Tx, *dbsqlc.Queries, dbsqlc.LockBobObjectRow, dbsqlc.LockBobVersionRow, error,
) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, dbsqlc.LockBobObjectRow{}, dbsqlc.LockBobVersionRow{}, s.internal("begin transaction", err)
	}
	qtx := s.queries.WithTx(tx)
	object, err := qtx.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ID: objectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		tx.Rollback(ctx) //nolint:errcheck
		return nil, nil, object, dbsqlc.LockBobVersionRow{}, domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		tx.Rollback(ctx) //nolint:errcheck
		return nil, nil, object, dbsqlc.LockBobVersionRow{}, s.internal("lock object", err)
	}
	version, err := qtx.LockBobVersion(ctx, dbsqlc.LockBobVersionParams{ID: versionID, ObjectID: objectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		tx.Rollback(ctx) //nolint:errcheck
		return nil, nil, object, version, domainError(ErrorValidation, "version not found", nil, nil)
	}
	if err != nil {
		tx.Rollback(ctx) //nolint:errcheck
		return nil, nil, object, version, s.internal("lock version", err)
	}
	return tx, qtx, object, version, nil
}

func (s *Service) validateStoredDetail(ctx context.Context, q *dbsqlc.Queries, entity, objectID, versionID string) error {
	row, err := q.GetBobVersionView(ctx, dbsqlc.GetBobVersionViewParams{ObjectID: objectID, Entity: entity, VersionID: versionID})
	if err != nil {
		return s.internal("read stored detail", err)
	}
	data, err := validateDetailData(entity, detailView(row))
	if err != nil {
		return err
	}
	return s.validateDetailReferences(ctx, q, entity, objectID, data)
}

func effectiveReferenceDetail(row dbsqlc.BobVersionView) DetailView {
	data := detailView(row)
	data.AccountNumber = ""
	return data
}

func (s *Service) validateDetailReferences(
	ctx context.Context,
	q *dbsqlc.Queries,
	entity string,
	objectID string,
	data DetailView,
) error {
	if entity == EntityVehicle {
		if err := s.validatePlatformReference(ctx, q, data.PlatformObjectID); err != nil {
			return err
		}
	}
	if data.CategoryID != "" {
		target, err := q.LockEffectiveCategoryReference(ctx, data.CategoryID)
		if errors.Is(err, pgx.ErrNoRows) {
			return domainError(ErrorConflict, "category is not currently effective", nil, nil)
		}
		if err != nil {
			return s.internal("lock category reference", err)
		}
		if target != entity {
			return domainError(ErrorConflict, "category does not match entity", nil, nil)
		}
	}
	type reference struct {
		entity string
		id     string
	}
	references := make([]reference, 0, 4)
	add := func(targetEntity, id string) {
		if id != "" {
			references = append(references, reference{entity: targetEntity, id: id})
		}
	}
	add(EntityDepartment, data.DepartmentID)
	add(EntityPosition, data.PositionID)
	add(EntityEmployee, data.ManagerEmployeeID)
	add(EntitySettlementMethod, data.SettlementMethodID)
	add(EntityEmployee, data.SalespersonEmployeeID)
	if entity == EntityDepartment {
		add(EntityDepartment, data.ParentID)
	}
	slices.SortFunc(references, func(left, right reference) int {
		if compared := strings.Compare(left.id, right.id); compared != 0 {
			return compared
		}
		return strings.Compare(left.entity, right.entity)
	})
	for _, target := range references {
		if target.id == objectID {
			return domainError(ErrorValidation, "object cannot reference itself", nil, nil)
		}
		if _, err := q.LockEffectiveBobReference(ctx, dbsqlc.LockEffectiveBobReferenceParams{
			ObjectID: target.id, Entity: target.entity,
		}); errors.Is(err, pgx.ErrNoRows) {
			return domainError(ErrorConflict, target.entity+" reference is not currently effective", nil, nil)
		} else if err != nil {
			return s.internal("lock "+target.entity+" reference", err)
		}
	}
	if entity == EntityCategory && data.ParentID != "" {
		if data.ParentID == objectID {
			return domainError(ErrorValidation, "category cannot reference itself", nil, nil)
		}
		target, err := q.LockEffectiveCategoryReference(ctx, data.ParentID)
		if errors.Is(err, pgx.ErrNoRows) {
			return domainError(ErrorConflict, "category parent is not currently effective", nil, nil)
		}
		if err != nil {
			return s.internal("lock category parent", err)
		}
		if target != data.TargetEntity {
			return domainError(ErrorConflict, "category parent target does not match", nil, nil)
		}
	}
	return nil
}

func (s *Service) validatePlatformReference(ctx context.Context, q *dbsqlc.Queries, platformObjectID string) error {
	if !validID(platformObjectID) {
		return domainError(ErrorValidation, "invalid logistics platform reference", nil, nil)
	}
	_, err := q.LockEffectiveLogisticsPlatform(ctx, platformObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorConflict, "logistics platform is not currently effective", nil, nil)
	}
	if err != nil {
		return s.internal("lock logistics platform", err)
	}
	return nil
}
