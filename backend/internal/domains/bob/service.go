package bob

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/events/bobapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const kilogramMeasurementUnitCode = "UNT-0001"

type Service struct {
	pool                   *pgxpool.Pool
	queries                *dbsqlc.Queries
	afterDeleteDetailsHook func() error
	auxiliaryResolver      AuxiliaryResolver
	coordinators           map[string]*approval.Coordinator[bobapproval.Payload]
}

type AuxiliaryResolver interface {
	ResolveAuxiliaryReference(context.Context, pgx.Tx, string, string, string) (AuxiliaryReference, error)
	ResolveAuxiliaryCode(context.Context, pgx.Tx, string, string) (AuxiliaryReference, error)
}

func NewService(pool *pgxpool.Pool, auxiliaryResolver AuxiliaryResolver, authorizer approval.Authorizer, bus *txevent.Bus) *Service {
	if pool == nil || auxiliaryResolver == nil || authorizer == nil || bus == nil {
		panic("bob: persistence, auxiliary resolver, authorizer and event bus are required")
	}
	coordinators := make(map[string]*approval.Coordinator[bobapproval.Payload], len(publicApprovalEntities))
	for _, entity := range publicApprovalEntities {
		coordinator, err := approval.NewCoordinator("bob", entity, authorizer, bus, bobapproval.Topic(entity))
		if err != nil {
			panic(err)
		}
		coordinators[entity] = coordinator
	}
	return &Service{pool: pool, queries: dbsqlc.New(pool), auxiliaryResolver: auxiliaryResolver, coordinators: coordinators}
}

func (s *Service) coordinator(entity string) (*approval.Coordinator[bobapproval.Payload], error) {
	coordinator, ok := s.coordinators[entity]
	if !ok {
		return nil, domainError(ErrorValidation, "unsupported BOB approval entity", nil, nil)
	}
	return coordinator, nil
}

func bobApprovalPayload(objectID, entity, code string, enabled bool) bobapproval.Payload {
	return bobapproval.Payload{ObjectID: objectID, Entity: entity, Code: code, Enabled: enabled}
}

func genericEntity(entity string) bool {
	return slices.Contains([]string{EntityEmployee, EntityProduct, EntityWarehouse, EntityVehicle, EntityFundAccount, EntityOperatingEntity}, entity)
}

func (s *Service) Query(ctx context.Context, entity string, input QueryInput) (Page[QueryItem], error) {
	if entity == EntityEmployee {
		return s.queryEmploymentRelationships(ctx, input)
	}
	if entity == EntityProduct {
		return s.queryProducts(ctx, input)
	}
	return s.queryObjects(ctx, entity, input)
}

func (s *Service) queryObjects(ctx context.Context, entity string, input QueryInput) (Page[QueryItem], error) {
	offset, valid := pageOffset(input.Page, input.PageSize)
	if !genericEntity(entity) || !valid {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid query", nil, nil)
	}
	filters, err := validateQueryFilters(entity, input.Filters)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	for _, status := range uniqueStrings(filters.Status) {
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
	enabledFilter := int32(-1)
	if filters.Enabled != nil {
		if *filters.Enabled {
			enabledFilter = 1
		} else {
			enabledFilter = 0
		}
	}
	statusFilter := uniqueStrings(filters.Status)
	params := bobListParams(entity, filters, enabledFilter, statusFilter, sortField, sortOrder, offset, int32(input.PageSize))
	rows, err := s.queries.ListBobObjects(ctx, params)
	if err != nil {
		return Page[QueryItem]{}, s.internal("list BOB objects", err)
	}
	total, err := s.queries.CountBobObjects(ctx, bobCountParams(params))
	if err != nil {
		return Page[QueryItem]{}, s.internal("count BOB objects", err)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, row := range rows {
		item := QueryItem{ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, ObjectRevision: row.ObjectRevision, Enabled: row.Enabled, UpdatedAt: row.UpdatedAt.Time}
		if row.ApprovalEntryID != "" {
			version, loadErr := s.versionSummary(ctx, s.queries, entity, row.ApprovalEntryID)
			if loadErr != nil {
				return Page[QueryItem]{}, loadErr
			}
			item.LatestApproved = &version
		}
		if row.OpenApprovalEntryID != "" {
			version, loadErr := s.versionSummary(ctx, s.queries, entity, row.OpenApprovalEntryID)
			if loadErr != nil {
				return Page[QueryItem]{}, loadErr
			}
			item.OpenVersion = &version
		}
		items = append(items, item)
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func bobListParams(entity string, filters QueryFilters, enabledFilter int32, statuses []string, sortField, sortOrder string, offset, limit int32) dbsqlc.ListBobObjectsParams {
	return dbsqlc.ListBobObjectsParams{
		Entity: entity, Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabledFilter, StatusFilter: statuses,
		CategoryID: filters.CategoryID, DepartmentID: filters.DepartmentID, PositionID: filters.PositionID,
		Currency: filters.Currency, ProductTypeID: filters.ProductTypeID, OperatingEntityID: filters.OperatingEntityID,
		DefaultPurchaserEmployeeID: filters.DefaultPurchaserEmployeeID, Capability: strings.TrimSpace(filters.Capability),
		CustomerType: filters.CustomerType, SalesAttributionType: strings.TrimSpace(filters.SalesAttributionType),
		SalesAttributionSubjectID: strings.TrimSpace(filters.SalesAttributionSubjectID),
		SortField:                 sortField, SortOrder: sortOrder, RowOffset: offset, RowLimit: limit,
	}
}

func bobCountParams(input dbsqlc.ListBobObjectsParams) dbsqlc.CountBobObjectsParams {
	return dbsqlc.CountBobObjectsParams{
		Entity: input.Entity, Keyword: input.Keyword, EnabledFilter: input.EnabledFilter, StatusFilter: input.StatusFilter,
		CategoryID: input.CategoryID, DepartmentID: input.DepartmentID, PositionID: input.PositionID,
		Currency: input.Currency, ProductTypeID: input.ProductTypeID, OperatingEntityID: input.OperatingEntityID,
		DefaultPurchaserEmployeeID: input.DefaultPurchaserEmployeeID, Capability: input.Capability,
		CustomerType: input.CustomerType, SalesAttributionType: input.SalesAttributionType,
		SalesAttributionSubjectID: input.SalesAttributionSubjectID,
	}
}

func (s *Service) versionSummary(ctx context.Context, q *dbsqlc.Queries, entity, entryID string) (VersionSummary, error) {
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "bob", Entity: entity})
	if err != nil {
		return VersionSummary{}, s.internal("get BOB approval entry", err)
	}
	data, err := loadDetail(ctx, q, entity, entryID)
	if err != nil {
		return VersionSummary{}, s.internal("load BOB approval payload", err)
	}
	return VersionSummary{Approval: approvalMeta(entry), Summary: data}, nil
}

func (s *Service) Get(ctx context.Context, entity string, input GetInput) (ObjectView, error) {
	if !validEntity(entity) || !validID(input.ObjectID) || (input.ApprovalEntryID != "" && !validID(input.ApprovalEntryID)) {
		return ObjectView{}, domainError(ErrorValidation, "invalid get request", nil, nil)
	}
	object, err := s.queries.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: input.ObjectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get BOB object", err)
	}
	entryID := input.ApprovalEntryID
	if entryID == "" {
		open, openErr := s.queries.GetBobOpenEntry(ctx, dbsqlc.GetBobOpenEntryParams{Entity: entity, ObjectID: input.ObjectID})
		if openErr == nil {
			entryID = open.ID
		} else if !errors.Is(openErr, pgx.ErrNoRows) {
			return ObjectView{}, s.internal("get open BOB approval", openErr)
		} else {
			latest, latestErr := s.queries.GetBobLatestApprovedEntry(ctx, dbsqlc.GetBobLatestApprovedEntryParams{Entity: entity, ObjectID: input.ObjectID})
			if errors.Is(latestErr, pgx.ErrNoRows) {
				return ObjectView{}, domainError(ErrorValidation, "object version not found", nil, nil)
			}
			if latestErr != nil {
				return ObjectView{}, s.internal("get latest approved BOB version", latestErr)
			}
			entryID = latest.ID
		}
	}
	entry, err := s.entryForObject(ctx, s.queries, entity, input.ObjectID, entryID)
	if err != nil {
		return ObjectView{}, err
	}
	data, err := loadDetail(ctx, s.queries, entity, entryID)
	if err != nil {
		return ObjectView{}, s.internal("load BOB payload", err)
	}
	result := ObjectView{ObjectID: object.ID, Entity: object.Entity, Code: object.Code, ObjectRevision: object.Revision, Enabled: object.Enabled, Approval: approvalMeta(entry), Data: data, UpdatedAt: object.UpdatedAt.Time}
	if entity == EntityEmployee {
		identity, identityErr := s.queries.GetBobEmploymentRelationshipIdentity(ctx, input.ObjectID)
		if identityErr != nil {
			return ObjectView{}, s.internal("read employment relationship identity", identityErr)
		}
		result.Relationship = &RelationshipIdentityView{PartyID: identity.PartyID, PartyKind: identity.PartyKind,
			PartyDisplayName: identity.PartyDisplayName, OperatingEntityID: identity.OperatingEntityID,
			OperatingEntityCode: identity.OperatingEntityCode, OperatingEntityName: identity.OperatingEntityName}
	}
	return result, nil
}

func (s *Service) Create(ctx context.Context, entity string, input CreateInput, actor approval.Actor) (MutationResult, error) {
	if !genericEntity(entity) || !validActorAndRequest(actor.ID(), actor.RequestID()) {
		return MutationResult{}, domainError(ErrorValidation, "invalid create request", nil, nil)
	}
	data, _, err := validateCreate(entity, input.Data)
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid create request", nil, err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin BOB create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	if entity == EntityFundAccount {
		data, err = s.resolveFundAccountOperating(ctx, tx, data)
	}
	if err == nil && entity == EntityProduct {
		data, err = s.resolveProductReferences(ctx, tx, data, true)
	}
	if err != nil {
		return MutationResult{}, err
	}
	if data, err = s.resolveDetailReferenceSnapshots(ctx, tx, entity, "", data, false); err != nil {
		return MutationResult{}, err
	}
	counter, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorConflict, "object number exhausted", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.writeError("allocate BOB object number", err)
	}
	objectID := newID()
	code := fmt.Sprintf("%s-%04d", objectPrefix(entity), counter)
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: objectID, Entity: entity, Code: code, ActorID: actor.ID()}); err != nil {
		return MutationResult{}, s.writeError("insert BOB object", err)
	}
	entry, err := s.createFirstApproval(ctx, tx, entity, objectID, code, true, actor)
	if err != nil {
		return MutationResult{}, translateApprovalError(err)
	}
	if err = insertDetail(ctx, q, entity, entry.ID, data); err != nil {
		return MutationResult{}, s.writeError("insert BOB approval payload", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit BOB create", err)
	}
	return approvalMutation(objectID, 1, true, entry), nil
}

func objectPrefix(entity string) string {
	return map[string]string{EntityCustomer: "CUS", EntityCustomerAccount: "CUA", EntitySupplier: "SUP", EntityOtherUnit: "OTU", EntityEmployee: "EMP", EntitySalesPartner: "SLP", EntityProduct: "PRD", EntityWarehouse: "WHS", EntityVehicle: "VEH", EntityFundAccount: "FAC", EntityOperatingEntity: "OPE"}[entity]
}

func (s *Service) Save(ctx context.Context, entity string, input SaveInput, actor approval.Actor) (MutationResult, error) {
	if !genericEntity(entity) || !validWriteInput(entity, input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor.ID(), actor.RequestID()) {
		return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, nil)
	}
	if err := validateDetailInputFields(entity, input.Data); err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin BOB save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	object, err := q.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: input.ObjectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock BOB object", err)
	}
	entry, err := s.entryForObject(ctx, q, entity, input.ObjectID, input.ApprovalEntryID)
	if err != nil {
		return MutationResult{}, err
	}
	if entry.Revision != input.ApprovalRevision {
		return MutationResult{}, domainErrorWithKey(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, nil)
	}
	target := approvalEntry(entry)
	if approval.Status(entry.Status) == approval.StatusApproved {
		target, err = s.createNextApproval(ctx, tx, entity, input.ObjectID, object.Code, object.Enabled, actor)
		if err != nil {
			return MutationResult{}, translateApprovalError(err)
		}
		if err = copyDetail(ctx, q, entity, target.ID, entry.ID); err != nil {
			return MutationResult{}, s.writeError("copy BOB approval payload", err)
		}
	} else if approval.Status(entry.Status) != approval.StatusDraft {
		return MutationResult{}, domainError(ErrorConflict, "only a draft or latest approved version can be saved", nil, nil)
	}
	current, err := loadDetail(ctx, q, entity, target.ID)
	if err != nil {
		return MutationResult{}, s.internal("load BOB draft payload", err)
	}
	data, err := validateDetailData(entity, mergeDetailInput(current, input.Data))
	if err != nil {
		return MutationResult{}, domainError(ErrorValidation, "invalid save request", nil, err)
	}
	if entity == EntityFundAccount {
		data, err = s.resolveFundAccountOperating(ctx, tx, data)
	}
	if err == nil && entity == EntityProduct {
		data, err = s.resolveProductReferences(ctx, tx, data, true)
	}
	if err != nil {
		return MutationResult{}, err
	}
	if data, err = s.resolveDetailReferenceSnapshots(ctx, tx, entity, input.ObjectID, data, false); err != nil {
		return MutationResult{}, err
	}
	if err = updateDetail(ctx, q, entity, target.ID, data); err != nil {
		return MutationResult{}, s.writeError("update BOB approval payload", err)
	}
	target, err = s.transitionApproval(ctx, tx, entity, input.ObjectID, object.Code, object.Enabled, target.ID, target.Revision, approval.ActionSaved, "", actor)
	if err != nil {
		return MutationResult{}, translateApprovalError(err)
	}
	touched, err := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actor.ID(), ObjectID: input.ObjectID, Entity: entity})
	if err != nil {
		return MutationResult{}, s.writeError("touch BOB object", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit BOB save", err)
	}
	return approvalMutation(touched.ID, touched.Revision, touched.Enabled, target), nil
}

func (s *Service) Delete(ctx context.Context, entity string, input DeleteInput, actor approval.Actor) error {
	if !validDeleteInput(entity, input) || !validActorAndRequest(actor.ID(), actor.RequestID()) {
		return domainError(ErrorValidation, "invalid delete request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return s.internal("begin BOB delete", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	object, err := q.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: input.ObjectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		return s.internal("lock BOB object", err)
	}
	if object.Revision != input.ObjectRevision {
		return domainError(ErrorConflict, "object changed", nil, nil)
	}
	entry, err := s.entryForObject(ctx, q, entity, input.ObjectID, input.ApprovalEntryID)
	if err != nil {
		return err
	}
	if approval.Status(entry.Status) != approval.StatusDraft || entry.Revision != input.ApprovalRevision {
		return domainError(ErrorConflict, "only the current draft can be deleted", nil, nil)
	}
	_, latestErr := q.GetBobLatestApprovedEntry(ctx, dbsqlc.GetBobLatestApprovedEntryParams{Entity: entity, ObjectID: input.ObjectID})
	hasApproved := latestErr == nil
	if latestErr != nil && !errors.Is(latestErr, pgx.ErrNoRows) {
		return s.internal("check BOB approved history", latestErr)
	}
	if _, err = deleteDetail(ctx, q, entity, entry.ID); err != nil {
		return s.writeError("delete BOB approval payload", err)
	}
	coordinator, err := s.coordinator(entity)
	if err != nil {
		return err
	}
	if err = coordinator.DeleteDraftVersion(ctx, tx, entry.ID, entry.Revision, actor, s.approvalPayload(input.ObjectID, entity, object.Code, object.Enabled)); err != nil {
		return translateApprovalError(err)
	}
	if !hasApproved {
		rows, deleteErr := q.DeleteBobObject(ctx, dbsqlc.DeleteBobObjectParams{ObjectID: input.ObjectID, Entity: entity, ObjectRevision: input.ObjectRevision})
		if deleteErr != nil {
			return s.writeError("delete BOB object", deleteErr)
		}
		if rows != 1 {
			return domainError(ErrorConflict, "object changed", nil, nil)
		}
	}
	if s.afterDeleteDetailsHook != nil {
		if err = s.afterDeleteDetailsHook(); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Service) Submit(ctx context.Context, entity string, input VersionRevisionInput, actor approval.Actor) (MutationResult, error) {
	return s.transition(ctx, entity, input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, "", approval.ActionSubmitted, actor)
}

func (s *Service) Approve(ctx context.Context, entity string, input ReviewInput, actor approval.Actor) (MutationResult, error) {
	return s.transition(ctx, entity, input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, "", approval.ActionApproved, actor)
}

func (s *Service) Reject(ctx context.Context, entity string, input ReviewInput, actor approval.Actor) (MutationResult, error) {
	return s.transition(ctx, entity, input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, stringValue(input.Reason), approval.ActionRejected, actor)
}

func (s *Service) Unsubmit(ctx context.Context, entity string, input ReverseInput, actor approval.Actor) (MutationResult, error) {
	return s.transition(ctx, entity, input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, input.Reason, approval.ActionUnsubmitted, actor)
}

func (s *Service) Unapprove(ctx context.Context, entity string, input ReverseInput, actor approval.Actor) (MutationResult, error) {
	return s.transition(ctx, entity, input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, input.Reason, approval.ActionUnapproved, actor)
}

func (s *Service) transition(ctx context.Context, entity, objectID, entryID string, revision int64, reason string, action approval.Action, actor approval.Actor) (MutationResult, error) {
	if !validWriteInput(entity, objectID, entryID, revision, actor.ID(), actor.RequestID()) {
		return MutationResult{}, domainError(ErrorValidation, "invalid lifecycle request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin BOB lifecycle transition", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	object, err := q.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: objectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock BOB object", err)
	}
	entry, err := s.entryForObject(ctx, q, entity, objectID, entryID)
	if err != nil {
		return MutationResult{}, err
	}
	if entry.Revision != revision {
		return MutationResult{}, domainErrorWithKey(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, nil)
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		if err = s.validateStoredApprovalDetail(ctx, tx, q, entity, objectID, entryID); err != nil {
			return MutationResult{}, err
		}
	}
	var transitioned approval.Entry
	if action == approval.ActionUnapproved {
		coordinator, coordinatorErr := s.coordinator(entity)
		if coordinatorErr != nil {
			return MutationResult{}, coordinatorErr
		}
		prepared, prepareErr := coordinator.Prepare(ctx, tx, action, entryID, revision, actor, reason)
		if prepareErr != nil {
			return MutationResult{}, translateApprovalError(prepareErr)
		}
		if err = s.ensureUnapproveAllowed(ctx, q, entryID); err != nil {
			return MutationResult{}, err
		}
		transitioned, err = coordinator.Commit(ctx, tx, prepared, s.approvalPayload(objectID, entity, object.Code, object.Enabled))
	} else {
		transitioned, err = s.transitionApproval(ctx, tx, entity, objectID, object.Code, object.Enabled, entryID, revision, action, reason, actor)
	}
	if err != nil {
		return MutationResult{}, translateApprovalError(err)
	}
	touched, err := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actor.ID(), ObjectID: objectID, Entity: entity})
	if err != nil {
		return MutationResult{}, s.writeError("touch BOB object", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit BOB lifecycle transition", err)
	}
	return approvalMutation(touched.ID, touched.Revision, touched.Enabled, transitioned), nil
}

func (s *Service) Enable(ctx context.Context, entity string, input ObjectRevisionInput, actor approval.Actor) (MutationResult, error) {
	return s.setEnabled(ctx, entity, input, true, actor)
}

func (s *Service) Disable(ctx context.Context, entity string, input ObjectRevisionInput, actor approval.Actor) (MutationResult, error) {
	return s.setEnabled(ctx, entity, input, false, actor)
}

func (s *Service) setEnabled(ctx context.Context, entity string, input ObjectRevisionInput, enabled bool, actor approval.Actor) (MutationResult, error) {
	if !validEntity(entity) || !validID(input.ObjectID) || input.ObjectRevision < 1 || !validActorAndRequest(actor.ID(), actor.RequestID()) {
		return MutationResult{}, domainError(ErrorValidation, "invalid object state request", nil, nil)
	}
	if entity == EntityWarehouse && !enabled {
		return s.disableWarehouse(ctx, input, actor)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin BOB object state transition", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	object, err := q.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: input.ObjectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorValidation, "object not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock BOB object", err)
	}
	if object.Revision != input.ObjectRevision || object.Enabled == enabled {
		return MutationResult{}, domainError(ErrorConflict, "object state changed", nil, nil)
	}
	latest, err := q.GetBobLatestApprovedEntry(ctx, dbsqlc.GetBobLatestApprovedEntryParams{Entity: entity, ObjectID: input.ObjectID})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorConflict, "an approved version is required", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("get latest approved BOB version", err)
	}
	if !enabled {
		counts, referenceErr := listActiveReferenceCounts(ctx, q, entity, input.ObjectID)
		if referenceErr != nil {
			return MutationResult{}, s.internal("scan current BOB references", referenceErr)
		}
		if len(counts) != 0 {
			return MutationResult{}, domainErrorWithKey(ErrorConflict, "bob_disable_blocked", "object is referenced by current BOB facts", ActiveReferenceBlockers{References: counts}, nil)
		}
	}
	rows, err := q.SetBobObjectEnabled(ctx, dbsqlc.SetBobObjectEnabledParams{Enabled: enabled, ActorID: actor.ID(), ObjectID: input.ObjectID, Entity: entity, ObjectRevision: input.ObjectRevision})
	if err != nil {
		return MutationResult{}, s.writeError("set BOB object enabled", err)
	}
	if rows != 1 {
		return MutationResult{}, domainError(ErrorConflict, "object state changed", nil, nil)
	}
	object.Revision++
	object.Enabled = enabled
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit BOB object state transition", err)
	}
	return MutationResult{ObjectID: object.ID, ObjectRevision: object.Revision, Enabled: enabled, Approval: approvalMeta(latest)}, nil
}

func (s *Service) Versions(ctx context.Context, entity string, input HistoryInput) (Page[VersionHistoryItem], error) {
	if !validHistoryInput(entity, input) {
		return Page[VersionHistoryItem]{}, domainError(ErrorValidation, "invalid version history request", nil, nil)
	}
	rows, err := s.queries.ListApprovalVersions(ctx, dbsqlc.ListApprovalVersionsParams{Domain: "bob", Entity: entity, SubjectID: input.ObjectID})
	if err != nil {
		return Page[VersionHistoryItem]{}, s.internal("list BOB versions", err)
	}
	start := (input.Page - 1) * input.PageSize
	if start > len(rows) {
		start = len(rows)
	}
	end := min(start+input.PageSize, len(rows))
	items := make([]VersionHistoryItem, 0, end-start)
	for _, row := range rows[start:end] {
		data, loadErr := loadDetail(ctx, s.queries, entity, row.ID)
		if loadErr != nil {
			return Page[VersionHistoryItem]{}, s.internal("load BOB version payload", loadErr)
		}
		items = append(items, VersionHistoryItem{Approval: approvalMeta(row), Summary: data})
	}
	return Page[VersionHistoryItem]{Items: items, Total: int64(len(rows)), Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) AuditHistory(ctx context.Context, entity string, input HistoryInput) (Page[AuditEventView], error) {
	if !validHistoryInput(entity, input) {
		return Page[AuditEventView]{}, domainError(ErrorValidation, "invalid audit history request", nil, nil)
	}
	offset := mustPageOffset(input.Page, input.PageSize)
	rows, err := s.queries.ListBobApprovalEvents(ctx, dbsqlc.ListBobApprovalEventsParams{Entity: entity, ObjectID: input.ObjectID, RowLimit: int32(input.PageSize), RowOffset: offset})
	if err != nil {
		return Page[AuditEventView]{}, s.internal("list BOB approval events", err)
	}
	total, err := s.queries.CountBobApprovalEvents(ctx, dbsqlc.CountBobApprovalEventsParams{Entity: entity, ObjectID: input.ObjectID})
	if err != nil {
		return Page[AuditEventView]{}, s.internal("count BOB approval events", err)
	}
	items := make([]AuditEventView, 0, len(rows))
	for _, row := range rows {
		items = append(items, approvalEventView(row))
	}
	return Page[AuditEventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) ResolveApprovedReference(ctx context.Context, tx pgx.Tx, entity, objectID, approvalEntryID string) (EffectiveReference, error) {
	if !validEntity(entity) || !validID(objectID) || !validID(approvalEntryID) {
		return EffectiveReference{}, domainError(ErrorValidation, "invalid BOB reference", nil, nil)
	}
	q := s.queries.WithTx(tx)
	row, err := q.ResolveBobLatestApprovedReferenceByEntry(ctx, dbsqlc.ResolveBobLatestApprovedReferenceByEntryParams{ApprovalEntryID: approvalEntryID, ObjectID: objectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB reference is not the latest approved version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve approved BOB reference", err)
	}
	data, err := loadDetail(ctx, q, entity, row.ApprovalEntryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load approved BOB reference payload", err)
	}
	return EffectiveReference{ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, ApprovalEntryID: row.ApprovalEntryID, Data: data}, nil
}

func (s *Service) ResolveLatestApprovedReference(ctx context.Context, tx pgx.Tx, entity, objectID string) (EffectiveReference, error) {
	if !validEntity(entity) || !validID(objectID) {
		return EffectiveReference{}, domainError(ErrorValidation, "invalid BOB reference", nil, nil)
	}
	q := s.queries.WithTx(tx)
	row, err := q.ResolveBobLatestApprovedReference(ctx, dbsqlc.ResolveBobLatestApprovedReferenceParams{ObjectID: objectID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB reference has no latest approved version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve latest approved BOB reference", err)
	}
	data, err := loadDetail(ctx, q, entity, row.ApprovalEntryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load latest approved BOB reference payload", err)
	}
	return EffectiveReference{ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, ApprovalEntryID: row.ApprovalEntryID, Data: data}, nil
}

func (s *Service) entryForObject(ctx context.Context, q *dbsqlc.Queries, entity, objectID, entryID string) (dbsqlc.ApprovalEntry, error) {
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "bob", Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && entry.SubjectID != objectID) {
		return dbsqlc.ApprovalEntry{}, domainError(ErrorValidation, "approval entry does not belong to object", nil, nil)
	}
	if err != nil {
		return dbsqlc.ApprovalEntry{}, s.internal("get BOB approval entry", err)
	}
	return entry, nil
}

func (s *Service) validateStoredApprovalDetail(ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, entity, objectID, entryID string) error {
	if entity == EntityCustomer {
		identity, err := q.GetBobCustomerRelationship(ctx, objectID)
		if err != nil {
			return s.internal("load customer relationship for validation", err)
		}
		_, err = s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, identity.OperatingEntityID)
		return err
	}
	if entity == EntityCustomerAccount {
		entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "bob", Entity: entity})
		if err != nil {
			return s.internal("load customer approval for validation", err)
		}
		version, err := s.loadCustomerVersionWithQueries(ctx, q, entry)
		if err != nil {
			return err
		}
		if _, err = normalizeCustomerAccount(version.Data); err != nil {
			return domainError(ErrorValidation, "invalid customer account", nil, err)
		}
		if version.Data.OperatingEntity == nil || version.Data.SalesAttribution.SubjectApprovalEntryID == "" {
			return domainError(ErrorValidation, "customer references are incomplete", nil, nil)
		}
		if _, err = s.ResolveApprovedReference(ctx, tx, EntityOperatingEntity, version.Data.OperatingEntityID, version.Data.OperatingEntity.ApprovalEntryID); err != nil {
			return err
		}
		for _, auxiliary := range []struct {
			entity   string
			objectID string
			snapshot *CustomerSnapshot
		}{
			{entity: "settlement-method", objectID: version.Data.SettlementMethodID, snapshot: version.Data.SettlementMethod},
			{entity: "payment-method", objectID: version.Data.PaymentMethodID, snapshot: version.Data.PaymentMethod},
		} {
			if auxiliary.objectID == "" {
				continue
			}
			if auxiliary.snapshot == nil || auxiliary.snapshot.ApprovalEntryID == "" {
				return domainError(ErrorConflict, auxiliary.entity+" approval snapshot is missing", nil, nil)
			}
			if _, err = s.resolveNamedAuxiliaryReference(ctx, tx, auxiliary.entity, auxiliary.objectID, auxiliary.snapshot.ApprovalEntryID); err != nil {
				return err
			}
		}
		subjectEntity := EntitySalesPartner
		if version.Data.PrimarySalesAttribution.Type == SalesAttributionInternalEmployee {
			subjectEntity = EntityEmployee
		}
		if _, err = s.ResolveApprovedReference(ctx, tx, subjectEntity, version.Data.PrimarySalesAttribution.SubjectObjectID, version.Data.SalesAttribution.SubjectApprovalEntryID); err != nil {
			return err
		}
		return nil
	}
	if entity == EntitySupplier {
		version, err := loadSupplierVersionWithQueries(ctx, q, entryID)
		if err != nil {
			return s.internal("load supplier approval for validation", err)
		}
		if err = validateSupplierEffective(version.Data); err != nil {
			return domainError(ErrorValidation, "supplier references are incomplete", nil, err)
		}
		data := supplierDetail(version.Data)
		if _, err = s.resolveDetailReferenceSnapshots(ctx, tx, entity, objectID, data, true); err != nil {
			return err
		}
		identity, identityErr := q.GetBobSupplierRelationship(ctx, objectID)
		if identityErr != nil {
			return s.internal("load supplier relationship for validation", identityErr)
		}
		_, err = s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, identity.OperatingEntityID)
		return err
	}
	if entity == EntitySalesPartner {
		data, err := loadDetail(ctx, q, entity, entryID)
		if err != nil {
			return s.internal("load sales relationship payload for validation", err)
		}
		partner, err := normalizeSalesPartnerData(SalesPartnerData{
			Capabilities: data.SalesCapabilities, ContactName: data.ContactName,
			ContactPhone: data.ContactPhone, Email: data.Email, Address: data.Address, Remark: data.Remark,
		})
		if err != nil {
			return err
		}
		if err = validateEffectiveSalesPartnerCapabilities(partner.Capabilities); err != nil {
			return err
		}
		identity, identityErr := q.GetBobSalesPartnerRelationship(ctx, objectID)
		if identityErr != nil {
			return s.internal("load sales relationship for validation", identityErr)
		}
		_, err = s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, identity.OperatingEntityID)
		return err
	}
	data, err := loadDetail(ctx, q, entity, entryID)
	if err != nil {
		return s.internal("load BOB approval payload for validation", err)
	}
	data, err = validateDetailData(entity, data)
	if err != nil {
		return err
	}
	if entity == EntityProduct {
		if data.Formula != nil {
			for index := range data.Formula.Components {
				component := &data.Formula.Components[index]
				material, resolveErr := s.ResolveApprovedReference(
					ctx, tx, EntityProduct, component.Material.ObjectID, component.Material.ApprovalEntryID,
				)
				if resolveErr != nil {
					return resolveErr
				}
				component.Material.Code = material.Code
				component.Material.Name = material.Data.Name
				component.Material.BehaviorProfile = material.Data.BehaviorProfile
			}
		}
		if err = validateProductComplete(data); err != nil {
			return err
		}
	}
	if entity == EntityEmployee {
		identity, identityErr := q.GetBobEmploymentRelationship(ctx, objectID)
		if identityErr != nil {
			return s.internal("load employment relationship for validation", identityErr)
		}
		if _, err = s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, identity.OperatingEntityID); err != nil {
			return err
		}
	}
	if entity == EntityOtherUnit {
		identity, identityErr := q.GetBobOtherUnitRelationship(ctx, objectID)
		if identityErr != nil {
			return s.internal("load service relationship for validation", identityErr)
		}
		if _, err = s.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, identity.OperatingEntityID); err != nil {
			return err
		}
	}
	_, err = s.resolveDetailReferenceSnapshots(ctx, tx, entity, objectID, data, true)
	return err
}

func (s *Service) ensureUnapproveAllowed(ctx context.Context, q *dbsqlc.Queries, entryID string) error {
	counts, err := listBobApprovalEntryReferenceCounts(ctx, q, entryID)
	if err != nil {
		return s.internal("scan exact BOB approval-entry references before unapprove", err)
	}
	if len(counts) != 0 {
		return domainErrorWithKey(ErrorConflict, "bob_unapprove_blocked", "approved version is referenced by current BOB facts", ActiveReferenceBlockers{References: counts}, nil)
	}
	voucherCounts, err := listVoucherApprovalEntryReferenceCounts(ctx, q, entryID)
	if err != nil {
		return s.internal("scan VOU approval-entry references before unapprove", err)
	}
	if len(voucherCounts) != 0 {
		return domainErrorWithKey(ErrorConflict, "bob_unapprove_blocked", "approved version is referenced by existing VOU facts", ActiveReferenceBlockers{References: voucherCounts}, nil)
	}
	return nil
}

func (s *Service) resolveDetailReferenceSnapshots(ctx context.Context, tx pgx.Tx, entity, objectID string, data DetailView, exact bool) (DetailView, error) {
	resolveBob := func(referenceEntity, referenceObjectID string, approvalEntryID *string) error {
		if referenceObjectID == "" {
			*approvalEntryID = ""
			return nil
		}
		if referenceObjectID == objectID {
			return domainError(ErrorValidation, "object cannot reference itself", nil, nil)
		}
		var reference EffectiveReference
		var err error
		if exact {
			if *approvalEntryID == "" {
				return domainError(ErrorConflict, referenceEntity+" approval snapshot is missing", nil, nil)
			}
			reference, err = s.ResolveApprovedReference(ctx, tx, referenceEntity, referenceObjectID, *approvalEntryID)
		} else {
			reference, err = s.ResolveLatestApprovedReference(ctx, tx, referenceEntity, referenceObjectID)
		}
		if err != nil {
			return err
		}
		*approvalEntryID = reference.ApprovalEntryID
		return nil
	}
	resolveAux := func(referenceEntity, referenceObjectID string, approvalEntryID *string) error {
		if referenceObjectID == "" {
			*approvalEntryID = ""
			return nil
		}
		requestedEntryID := ""
		if exact {
			requestedEntryID = *approvalEntryID
			if requestedEntryID == "" {
				return domainError(ErrorConflict, referenceEntity+" approval snapshot is missing", nil, nil)
			}
		}
		reference, err := s.resolveNamedAuxiliaryReference(ctx, tx, referenceEntity, referenceObjectID, requestedEntryID)
		if err != nil {
			return err
		}
		*approvalEntryID = reference.ApprovalEntryID
		return nil
	}

	if entity == EntityEmployee {
		if err := resolveAux("department", data.DepartmentID, &data.DepartmentApprovalEntryID); err != nil {
			return DetailView{}, err
		}
		if err := resolveAux("position", data.PositionID, &data.PositionApprovalEntryID); err != nil {
			return DetailView{}, err
		}
	}
	if entity == EntityProduct {
		if err := resolveAux("product-category", data.CategoryID, &data.CategoryApprovalEntryID); err != nil {
			return DetailView{}, err
		}
		if err := resolveAux("product-type", data.ProductTypeID, &data.ProductTypeApprovalEntryID); err != nil {
			return DetailView{}, err
		}
		if err := resolveAux("measurement-unit", data.DefaultInputUnitID, &data.DefaultInputUnitApprovalEntryID); err != nil {
			return DetailView{}, err
		}
		if err := resolveAux("measurement-unit", data.PricingUnitID, &data.PricingUnitApprovalEntryID); err != nil {
			return DetailView{}, err
		}
		for index := range data.UnitConversions {
			unit := &data.UnitConversions[index].Unit
			if err := resolveAux("measurement-unit", unit.ObjectID, &unit.ApprovalEntryID); err != nil {
				return DetailView{}, err
			}
		}
		if data.Formula != nil {
			if err := resolveAux("measurement-unit", data.Formula.Output.EnteredUnit.ObjectID, &data.Formula.Output.EnteredUnit.ApprovalEntryID); err != nil {
				return DetailView{}, err
			}
			for index := range data.Formula.Components {
				component := &data.Formula.Components[index]
				if err := resolveBob(EntityProduct, component.Material.ObjectID, &component.Material.ApprovalEntryID); err != nil {
					return DetailView{}, err
				}
				if err := resolveAux("measurement-unit", component.Quantity.EnteredUnit.ObjectID, &component.Quantity.EnteredUnit.ApprovalEntryID); err != nil {
					return DetailView{}, err
				}
			}
		}
	}
	if entity == EntityWarehouse {
		if err := resolveBob(EntityEmployee, data.ManagerEmployeeID, &data.ManagerEmployeeApprovalEntryID); err != nil {
			return DetailView{}, err
		}
	}
	if entity == EntityFundAccount {
		if err := resolveBob(EntityOperatingEntity, data.OperatingEntityID, &data.OperatingEntityApprovalEntryID); err != nil {
			return DetailView{}, err
		}
	}
	if entity == EntitySupplier {
		if err := resolveBob(EntityEmployee, data.DefaultPurchaserEmployeeID, &data.DefaultPurchaserApprovalEntryID); err != nil {
			return DetailView{}, err
		}
		if err := resolveAux("settlement-method", data.SettlementMethodID, &data.SettlementMethodApprovalEntryID); err != nil {
			return DetailView{}, err
		}
	}
	if entity == EntityOtherUnit {
		if err := resolveAux("settlement-method", data.SettlementMethodID, &data.SettlementMethodApprovalEntryID); err != nil {
			return DetailView{}, err
		}
	}
	if entity == EntityVehicle {
		if !validCarrierAffiliation(data.CarrierAffiliation) {
			return DetailView{}, domainError(ErrorValidation, "invalid vehicle carrier affiliation", nil, nil)
		}
		if data.CarrierAffiliation.Type == "INTERNAL" {
			if err := resolveBob(EntityOperatingEntity, data.CarrierAffiliation.OperatingEntityID, &data.CarrierAffiliation.OperatingApprovalEntryID); err != nil {
				return DetailView{}, err
			}
		} else if err := resolveBob(EntityOtherUnit, data.CarrierAffiliation.ServiceRelationshipObjectID, &data.CarrierAffiliation.ServiceApprovalEntryID); err != nil {
			return DetailView{}, err
		}
	}
	return data, nil
}

func (s *Service) resolveSettlementSnapshot(ctx context.Context, tx pgx.Tx, data DetailView) (DetailView, error) {
	if data.SettlementMethodID == "" {
		return data, nil
	}
	reference, err := s.resolveAuxiliaryReference(ctx, tx, "settlement-method", data.SettlementMethodID, "")
	if err != nil {
		return DetailView{}, err
	}
	data.SettlementMethodApprovalEntryID = reference.ApprovalEntryID
	data.SettlementMethodCode, data.SettlementMethodName = reference.Code, reference.Data.Name
	data.TermCode, data.RuleType = reference.Data.TermCode, reference.Data.RuleType
	data.MonthOffset, data.DayOfMonth, data.DayOffset = reference.Data.MonthOffset, reference.Data.DayOfMonth, reference.Data.DayOffset
	data.DueDays, data.CutoffDay, data.DefaultSalesSurcharge = reference.Data.DueDays, reference.Data.CutoffDay, reference.Data.DefaultSalesSurcharge
	return data, nil
}

func (s *Service) resolveAuxiliaryReference(ctx context.Context, tx pgx.Tx, entity, objectID, approvalEntryID string) (EffectiveReference, error) {
	reference, err := s.auxiliaryResolver.ResolveAuxiliaryReference(ctx, tx, entity, objectID, approvalEntryID)
	if err != nil {
		return EffectiveReference{}, domainError(ErrorConflict, entity+" reference is unavailable", nil, err)
	}
	dayOfMonth := int32(mapInt(reference.Data, "dayOfMonth"))
	var dayOfMonthPointer *int32
	if dayOfMonth > 0 {
		dayOfMonthPointer = &dayOfMonth
	}
	return EffectiveReference{ObjectID: reference.ObjectID, Entity: entity, Code: reference.Code, ApprovalEntryID: reference.ApprovalEntryID, Data: DetailView{Name: mapString(reference.Data, "name"), ParentID: mapString(reference.Data, "parentId"), Description: mapString(reference.Data, "description"), TermCode: mapString(reference.Data, "termCode"), RuleType: mapString(reference.Data, "ruleType"), MonthOffset: int32(mapInt(reference.Data, "monthOffset")), DayOfMonth: dayOfMonthPointer, DayOffset: int32(mapInt(reference.Data, "dayOffset")), DueDays: int32(mapInt(reference.Data, "dayOffset")), CutoffDay: int32(mapInt(reference.Data, "dayOfMonth")), DefaultSalesSurcharge: mapString(reference.Data, "defaultSalesSurcharge")}}, nil
}

func (s *Service) resolveNamedAuxiliaryReference(ctx context.Context, tx pgx.Tx, entity, objectID, approvalEntryID string) (AuxiliaryReference, error) {
	reference, err := s.auxiliaryResolver.ResolveAuxiliaryReference(ctx, tx, entity, objectID, approvalEntryID)
	if err != nil {
		return AuxiliaryReference{}, domainError(ErrorConflict, entity+" reference is unavailable", nil, err)
	}
	return reference, nil
}

func mapString(data map[string]any, key string) string { value, _ := data[key].(string); return value }
func mapInt(data map[string]any, key string) int {
	switch value := data[key].(type) {
	case int:
		return value
	case int32:
		return int(value)
	case int64:
		return int(value)
	case float64:
		return int(value)
	case json.Number:
		number, _ := value.Int64()
		return int(number)
	default:
		return 0
	}
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func translateApprovalError(err error) error {
	var approvalErr *approval.Error
	if !errors.As(err, &approvalErr) {
		return err
	}
	kind := ErrorInternal
	switch approvalErr.Kind {
	case approval.ErrorValidation, approval.ErrorNotFound:
		kind = ErrorValidation
	case approval.ErrorConflict:
		kind = ErrorConflict
	}
	return domainErrorWithKey(kind, approvalErr.ErrorKey, approvalErr.Message, nil, err)
}
