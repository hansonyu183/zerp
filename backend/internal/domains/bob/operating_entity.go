package bob

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

// OperatingEntityData is the BOB business-data shape used by the DCL declaration
// service. DCL owns the stable subject and declaration lifecycle; BOB owns the
// validation rules and exposes current effective read-only business data.
type OperatingEntityData struct {
	Name      string `json:"name"`
	ShortName string `json:"shortName,omitempty"`
	TaxNumber string `json:"taxNumber,omitempty"`
	Address   string `json:"address,omitempty"`
	Phone     string `json:"phone,omitempty"`
	Remark    string `json:"remark,omitempty"`
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

func (s *Service) EnsureOperatingEntityUnapproveAllowed(ctx context.Context, tx pgx.Tx, approvalEntryID string) error {
	return s.EnsureUnapproveAllowed(ctx, tx, approvalEntryID)
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
	code, codeErr := requiredSubjectCode(row.Code)
	if codeErr != nil {
		return ObjectView{}, codeErr
	}
	return ObjectView{
		ObjectID: row.ObjectID, Entity: row.Entity, Code: code,
		Enabled: row.Enabled, SourceApprovalEntryID: entry.ID, SourceVersionNo: versionNumber(entry.VersionNo),
		Data: DetailView{Name: row.LegalName, ShortName: deref(row.ShortName), TaxNumber: deref(row.TaxNumber),
			Address: deref(row.Address), Phone: deref(row.Phone), Remark: deref(row.Remark)},
		UpdatedAt: row.UpdatedAt.Time,
	}, nil
}

func (s *Service) queryOperatingEntities(ctx context.Context, q *dbsqlc.Queries, input QueryInput) (Page[QueryItem], error) {
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
	rows, err := q.ListBobOperatingEntities(ctx, dbsqlc.ListBobOperatingEntitiesParams{
		Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabledFilter,
		SortField: sortField, SortOrder: sortOrder,
		RowOffset: offset, RowLimit: int32(input.PageSize),
	})
	if err != nil {
		return Page[QueryItem]{}, s.internal("list operating entities", err)
	}
	total, err := q.CountBobOperatingEntities(ctx, dbsqlc.CountBobOperatingEntitiesParams{
		Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabledFilter,
	})
	if err != nil {
		return Page[QueryItem]{}, s.internal("count operating entities", err)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, row := range rows {
		code, codeErr := requiredSubjectCode(row.Code)
		if codeErr != nil {
			return Page[QueryItem]{}, codeErr
		}
		items = append(items, QueryItem{
			ObjectID: row.ObjectID, Entity: row.Entity, Code: code,
			Enabled: row.Enabled, SourceApprovalEntryID: row.ApprovalEntryID,
			SourceVersionNo: versionNumber(row.VersionNo),
			Data: DetailView{Name: row.LegalName, ShortName: deref(row.ShortName), TaxNumber: deref(row.TaxNumber),
				Address: deref(row.Address), Phone: deref(row.Phone), Remark: deref(row.Remark)},
			UpdatedAt: row.UpdatedAt.Time,
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
	entry, err := s.requireHistoricalApprovalEntry(ctx, q, approvalEntryID, EntityOperatingEntity, objectID, "BOB approval snapshot is unavailable")
	if err != nil {
		return EffectiveReference{}, err
	}
	identity, err := q.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: objectID, Entity: EntityOperatingEntity})
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
	code, codeErr := requiredSubjectCode(identity.Code)
	if codeErr != nil {
		return EffectiveReference{}, codeErr
	}
	return EffectiveReference{
		ObjectID: identity.ID, Entity: identity.Entity, Code: code, ApprovalEntryID: entry.ID, VersionNo: versionNumber(entry.VersionNo),
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
	code, codeErr := requiredSubjectCode(row.Code)
	if codeErr != nil {
		return EffectiveReference{}, codeErr
	}
	return EffectiveReference{
		ObjectID: row.ObjectID, Entity: row.Entity, Code: code, ApprovalEntryID: row.ApprovalEntryID, VersionNo: versionNumber(row.VersionNo),
		Data: DetailView{
			Name: row.LegalName, ShortName: deref(row.ShortName), TaxNumber: deref(row.TaxNumber),
			Address: deref(row.Address), Phone: deref(row.Phone), Remark: deref(row.Remark),
		},
	}, nil
}
