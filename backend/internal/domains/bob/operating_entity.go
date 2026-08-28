package bob

import (
	"context"
	"errors"
	"fmt"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

// OperatingEntityData is the BOB-owned business shape used by the DCL typed
// service. DCL owns declaration lifecycle; BOB continues to own these rules
// and the current approved read model.
type OperatingEntityData struct {
	Name      string `json:"name"`
	ShortName string `json:"shortName,omitempty"`
	TaxNumber string `json:"taxNumber,omitempty"`
	Address   string `json:"address,omitempty"`
	Phone     string `json:"phone,omitempty"`
	Remark    string `json:"remark,omitempty"`
}

type OperatingEntityIdentity struct {
	ObjectID       string
	Code           string
	ObjectRevision int64
}

type OperatingEntityCurrent struct {
	OperatingEntityIdentity
	SourceApprovalEntryID string
	Enabled               bool
	Data                  OperatingEntityData
}

func ValidateOperatingEntityData(input OperatingEntityData) (OperatingEntityData, error) {
	data, _, err := validateCreate(EntityOperatingEntity, CreateDetailInput{
		Name: strings.TrimSpace(input.Name), ShortName: strings.TrimSpace(input.ShortName),
		TaxNumber: strings.ToUpper(strings.TrimSpace(input.TaxNumber)),
		Address:   strings.TrimSpace(input.Address), Phone: strings.TrimSpace(input.Phone),
		Remark: strings.TrimSpace(input.Remark),
	})
	if err != nil {
		return OperatingEntityData{}, err
	}
	return OperatingEntityData{
		Name: data.Name, ShortName: data.ShortName, TaxNumber: data.TaxNumber,
		Address: data.Address, Phone: data.Phone, Remark: data.Remark,
	}, nil
}

func (s *Service) ReserveOperatingEntityIdentity(ctx context.Context, tx pgx.Tx, actorID string) (OperatingEntityIdentity, error) {
	if tx == nil || !validID(actorID) {
		return OperatingEntityIdentity{}, domainError(ErrorValidation, "invalid operating entity identity request", nil, nil)
	}
	q := s.queries.WithTx(tx)
	counter, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityOperatingEntity})
	if errors.Is(err, pgx.ErrNoRows) {
		return OperatingEntityIdentity{}, domainError(ErrorConflict, "object number exhausted", nil, nil)
	}
	if err != nil {
		return OperatingEntityIdentity{}, s.writeError("allocate operating entity number", err)
	}
	identity := OperatingEntityIdentity{ObjectID: newID(), Code: fmt.Sprintf("OPE-%04d", counter), ObjectRevision: 1}
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{
		ID: identity.ObjectID, Entity: EntityOperatingEntity, Code: identity.Code, ActorID: actorID,
	}); err != nil {
		return OperatingEntityIdentity{}, s.writeError("reserve operating entity identity", err)
	}
	return identity, nil
}

func (s *Service) GetOperatingEntityIdentity(ctx context.Context, tx pgx.Tx, objectID string) (OperatingEntityIdentity, error) {
	if tx == nil || !validID(objectID) {
		return OperatingEntityIdentity{}, domainError(ErrorValidation, "invalid operating entity identity request", nil, nil)
	}
	row, err := s.queries.WithTx(tx).LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: objectID, Entity: EntityOperatingEntity})
	if errors.Is(err, pgx.ErrNoRows) {
		return OperatingEntityIdentity{}, domainError(ErrorValidation, "operating entity not found", nil, nil)
	}
	if err != nil {
		return OperatingEntityIdentity{}, s.internal("lock operating entity identity", err)
	}
	return OperatingEntityIdentity{ObjectID: row.ID, Code: row.Code, ObjectRevision: row.Revision}, nil
}

func (s *Service) ApplyOperatingEntityCurrent(
	ctx context.Context,
	tx pgx.Tx,
	objectID string,
	approvalEntryID string,
	enabled bool,
	data OperatingEntityData,
	actorID string,
) (OperatingEntityCurrent, error) {
	if tx == nil || !validID(objectID) || !validID(approvalEntryID) || !validID(actorID) {
		return OperatingEntityCurrent{}, domainError(ErrorValidation, "invalid operating entity current apply", nil, nil)
	}
	validated, err := ValidateOperatingEntityData(data)
	if err != nil {
		return OperatingEntityCurrent{}, err
	}
	q := s.queries.WithTx(tx)
	if err = q.UpsertBobOperatingEntityCurrent(ctx, dbsqlc.UpsertBobOperatingEntityCurrentParams{
		ObjectID: objectID, SourceApprovalEntryID: approvalEntryID, LegalName: validated.Name,
		ShortName: nilIfEmpty(validated.ShortName), TaxNumber: nilIfEmpty(validated.TaxNumber),
		Address: nilIfEmpty(validated.Address), Phone: nilIfEmpty(validated.Phone), Remark: nilIfEmpty(validated.Remark),
		Enabled: enabled, ActorID: actorID,
	}); err != nil {
		return OperatingEntityCurrent{}, s.writeError("apply operating entity current data", err)
	}
	object, err := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ObjectID: objectID, Entity: EntityOperatingEntity})
	if err != nil {
		return OperatingEntityCurrent{}, s.writeError("touch operating entity current data", err)
	}
	return OperatingEntityCurrent{
		OperatingEntityIdentity: OperatingEntityIdentity{ObjectID: object.ID, Code: object.Code, ObjectRevision: object.Revision},
		SourceApprovalEntryID:   approvalEntryID, Enabled: enabled, Data: validated,
	}, nil
}

func (s *Service) RemoveOperatingEntityCurrent(ctx context.Context, tx pgx.Tx, objectID, actorID string) (OperatingEntityIdentity, error) {
	if tx == nil || !validID(objectID) || !validID(actorID) {
		return OperatingEntityIdentity{}, domainError(ErrorValidation, "invalid operating entity current removal", nil, nil)
	}
	q := s.queries.WithTx(tx)
	rows, err := q.DeleteBobOperatingEntityCurrent(ctx, objectID)
	if err != nil {
		return OperatingEntityIdentity{}, s.writeError("remove operating entity current data", err)
	}
	if rows != 1 {
		return OperatingEntityIdentity{}, domainError(ErrorConflict, "operating entity current data changed", nil, nil)
	}
	object, err := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ObjectID: objectID, Entity: EntityOperatingEntity})
	if err != nil {
		return OperatingEntityIdentity{}, s.writeError("touch operating entity current removal", err)
	}
	return OperatingEntityIdentity{ObjectID: object.ID, Code: object.Code, ObjectRevision: object.Revision}, nil
}

func (s *Service) DeleteOperatingEntityIdentity(ctx context.Context, tx pgx.Tx, objectID string, objectRevision int64) error {
	if tx == nil || !validID(objectID) || objectRevision < 1 {
		return domainError(ErrorValidation, "invalid operating entity identity deletion", nil, nil)
	}
	rows, err := s.queries.WithTx(tx).DeleteBobObject(ctx, dbsqlc.DeleteBobObjectParams{
		ObjectID: objectID, Entity: EntityOperatingEntity, ObjectRevision: objectRevision,
	})
	if err != nil {
		return s.writeError("delete operating entity identity", err)
	}
	if rows != 1 {
		return domainError(ErrorConflict, "operating entity identity changed", nil, nil)
	}
	return nil
}

func (s *Service) EnsureOperatingEntityUnapproveAllowed(ctx context.Context, tx pgx.Tx, approvalEntryID string) error {
	if tx == nil || !validID(approvalEntryID) {
		return domainError(ErrorValidation, "invalid operating entity unapprove request", nil, nil)
	}
	return s.ensureUnapproveAllowed(ctx, s.queries.WithTx(tx), approvalEntryID)
}

func (s *Service) getOperatingEntityCurrent(ctx context.Context, input GetInput) (ObjectView, error) {
	if !validID(input.ObjectID) {
		return ObjectView{}, domainError(ErrorValidation, "invalid operating entity get request", nil, nil)
	}
	row, err := s.queries.GetBobOperatingEntityCurrent(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "operating entity not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get operating entity current data", err)
	}
	entry := dbsqlc.ApprovalEntry{
		ID: row.ApprovalEntryID, Domain: row.Domain, Entity: EntityOperatingEntity,
		SubjectID: row.ObjectID, VersionNo: row.VersionNo, Status: row.Status,
		Revision: row.ApprovalRevision, CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt,
		UpdatedBy: row.UpdatedBy, UpdatedAt: row.ApprovalUpdatedAt,
		SubmittedBy: row.SubmittedBy, SubmittedAt: row.SubmittedAt,
		ApprovedBy: row.ApprovedBy, ApprovedAt: row.ApprovedAt,
	}
	return ObjectView{
		ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code,
		ObjectRevision: row.ObjectRevision, Enabled: row.Enabled, SourceApprovalEntryID: entry.ID, SourceVersionNo: versionNumber(entry.VersionNo),
		Data: DetailView{Name: row.LegalName, ShortName: deref(row.ShortName), TaxNumber: deref(row.TaxNumber),
			Address: deref(row.Address), Phone: deref(row.Phone), Remark: deref(row.Remark)},
		UpdatedAt: row.UpdatedAt.Time,
	}, nil
}

func (s *Service) queryOperatingEntities(ctx context.Context, input QueryInput) (Page[QueryItem], error) {
	offset, valid := pageOffset(input.Page, input.PageSize)
	if !valid {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid query", nil, nil)
	}
	filters, err := validateQueryFilters(EntityOperatingEntity, input.Filters)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	sortField, sortOrder := "updatedAt", "desc"
	if len(input.Sort) > 1 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "only one sort item is allowed", nil, nil)
	}
	if len(input.Sort) == 1 {
		sortField, sortOrder = input.Sort[0].Field, strings.ToLower(input.Sort[0].Order)
		validField := sortField == "updatedAt" || sortField == "code" || sortField == "name"
		if !validField || (sortOrder != "asc" && sortOrder != "desc") {
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
	rows, err := s.queries.ListBobOperatingEntities(ctx, dbsqlc.ListBobOperatingEntitiesParams{
		Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabledFilter,
		SortField: sortField, SortOrder: sortOrder,
		RowOffset: offset, RowLimit: int32(input.PageSize),
	})
	if err != nil {
		return Page[QueryItem]{}, s.internal("list operating entities", err)
	}
	total, err := s.queries.CountBobOperatingEntities(ctx, dbsqlc.CountBobOperatingEntitiesParams{
		Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabledFilter,
	})
	if err != nil {
		return Page[QueryItem]{}, s.internal("count operating entities", err)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, row := range rows {
		view, getErr := s.getOperatingEntityCurrent(ctx, GetInput{ObjectID: row.ObjectID})
		if getErr != nil {
			return Page[QueryItem]{}, getErr
		}
		items = append(items, QueryItem{
			ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code,
			ObjectRevision: row.ObjectRevision, Enabled: row.Enabled, SourceApprovalEntryID: view.SourceApprovalEntryID,
			SourceVersionNo: view.SourceVersionNo, Data: view.Data, UpdatedAt: row.UpdatedAt.Time,
		})
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) validateOperatingEntitySnapshotReference(
	ctx context.Context,
	q *dbsqlc.Queries,
	objectID string,
	approvalEntryID string,
) (EffectiveReference, error) {
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{
		ID: approvalEntryID, Domain: "dcl", Entity: EntityOperatingEntity,
	})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (entry.SubjectID != objectID || entry.Status != string(approval.StatusApproved))) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("validate DCL operating entity snapshot", err)
	}
	identity, err := q.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: objectID, Entity: EntityOperatingEntity})
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("load operating entity identity", err)
	}
	stored, err := q.GetDCLOperatingEntityVersion(ctx, approvalEntryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("load DCL operating entity snapshot", err)
	}
	return EffectiveReference{
		ObjectID: identity.ID, Entity: identity.Entity, Code: identity.Code, ApprovalEntryID: entry.ID,
		Data: DetailView{
			Name: stored.LegalName, ShortName: deref(stored.ShortName), TaxNumber: deref(stored.TaxNumber),
			Address: deref(stored.Address), Phone: deref(stored.Phone), Remark: deref(stored.Remark),
		},
	}, nil
}

func (s *Service) resolveOperatingEntityCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	row, err := q.GetBobOperatingEntityCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB reference has no latest approved version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve operating entity current reference", err)
	}
	return EffectiveReference{
		ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, ApprovalEntryID: row.ApprovalEntryID,
		Data: DetailView{
			Name: row.LegalName, ShortName: deref(row.ShortName), TaxNumber: deref(row.TaxNumber),
			Address: deref(row.Address), Phone: deref(row.Phone), Remark: deref(row.Remark),
		},
	}, nil
}
