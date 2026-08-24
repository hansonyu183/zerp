package bob

import (
	"context"
	"database/sql"
	"fmt"
	"slices"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) queryOperatingEntities(ctx context.Context, input QueryInput) (Page[QueryItem], error) {
	offset, validPage := pageOffset(input.Page, input.PageSize)
	if !validPage || len(input.Sort) > 1 || input.Filters.CustomerType != "" {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid operating entity query", nil, nil)
	}
	statuses := uniqueStrings(input.Filters.Status)
	for _, status := range statuses {
		if !validStatus(status) {
			return Page[QueryItem]{}, domainError(ErrorValidation, "invalid status filter", nil, nil)
		}
	}
	sortField, sortOrder := "updatedAt", "desc"
	if len(input.Sort) == 1 {
		sortField, sortOrder = input.Sort[0].Field, strings.ToLower(input.Sort[0].Order)
	}
	columns := map[string]string{"updatedAt": "o.updated_at", "code": "o.code", "name": "d.legal_name", "status": "v.status", "version": "v.version_no"}
	if columns[sortField] == "" || !slices.Contains([]string{"asc", "desc"}, sortOrder) {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid sort", nil, nil)
	}
	enabledFilter := int32(-1)
	if input.Filters.Enabled != nil {
		if *input.Filters.Enabled {
			enabledFilter = 1
		} else {
			enabledFilter = 0
		}
	}
	keyword := strings.TrimSpace(input.Filters.Keyword)
	total, err := s.queries.CountBobOperatingEntities(ctx, dbsqlc.CountBobOperatingEntitiesParams{
		Statuses: statuses, Keyword: keyword, EnabledFilter: enabledFilter,
	})
	if err != nil {
		return Page[QueryItem]{}, s.internal("count operating entities", err)
	}
	statement := fmt.Sprintf(`SELECT o.id,o.code,o.revision,o.enabled,o.effective_version_id,o.updated_at,
		v.id,v.version_no,v.status,v.revision,v.submitted_by,
		d.legal_name,d.short_name,d.tax_number,d.address,d.phone,d.remark
		FROM bob_objects o JOIN bob_versions v ON v.id=o.current_version_id
		JOIN bob_operating_entity_versions d ON d.version_id=v.id
		WHERE o.entity='operating-entity' AND ($1::text[]='{}' OR v.status=ANY($1))
		AND ($2='' OR o.code ILIKE '%%'||$2||'%%' OR d.legal_name ILIKE '%%'||$2||'%%')
		AND ($3=-1 OR o.enabled=($3=1)) ORDER BY %s %s,o.id %s OFFSET $4 LIMIT $5`, columns[sortField], sortOrder, sortOrder)
	rows, err := s.pool.Query(ctx, statement, statuses, keyword, enabledFilter, offset, input.PageSize)
	if err != nil {
		return Page[QueryItem]{}, s.internal("list operating entities", err)
	}
	defer rows.Close()
	items := make([]QueryItem, 0, input.PageSize)
	for rows.Next() {
		var item QueryItem
		var effective, submitted, shortName, taxNumber, address, phone, remark sql.NullString
		if err = rows.Scan(&item.ObjectID, &item.Code, &item.ObjectRevision, &item.Enabled, &effective, &item.UpdatedAt,
			&item.CurrentVersion.VersionID, &item.CurrentVersion.Version, &item.CurrentVersion.Status,
			&item.CurrentVersion.Revision, &submitted, &item.CurrentVersion.Summary.Name, &shortName,
			&taxNumber, &address, &phone, &remark); err != nil {
			return Page[QueryItem]{}, s.internal("scan operating entity", err)
		}
		item.Entity = EntityOperatingEntity
		item.EffectiveVersionID = nullStringPointer(effective)
		item.CurrentVersion.SubmittedBy = nullStringPointer(submitted)
		item.CurrentVersion.Summary.ShortName = shortName.String
		item.CurrentVersion.Summary.TaxNumber = taxNumber.String
		item.CurrentVersion.Summary.Address = address.String
		item.CurrentVersion.Summary.Phone = phone.String
		item.CurrentVersion.Summary.Remark = remark.String
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return Page[QueryItem]{}, s.internal("list operating entities", err)
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) getOperatingEntity(ctx context.Context, input GetInput) (ObjectView, error) {
	if !validID(input.ObjectID) || (input.VersionID != "" && !validID(input.VersionID)) {
		return ObjectView{}, domainError(ErrorValidation, "invalid object or version", nil, nil)
	}
	var result ObjectView
	row, err := s.queries.GetBobOperatingEntity(ctx, dbsqlc.GetBobOperatingEntityParams{ObjectID: input.ObjectID, VersionID: input.VersionID})
	if err == pgx.ErrNoRows {
		return ObjectView{}, domainError(ErrorValidation, "object or version not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get operating entity", err)
	}
	result.ObjectID, result.Code, result.ObjectRevision, result.Enabled, result.CurrentVersionID = row.ID, row.Code, row.Revision, row.Enabled, row.CurrentVersionID
	result.EffectiveVersionID, result.UpdatedAt = row.EffectiveVersionID, row.UpdatedAt.Time
	result.Version.VersionID, result.Version.Version, result.Version.Status, result.Version.Revision = row.ID_2, row.VersionNo, row.Status, row.Revision_2
	result.Version.CreatedAt, result.Version.CreatedBy, result.Version.UpdatedAt, result.Version.UpdatedBy = row.CreatedAt.Time, row.CreatedBy, row.UpdatedAt_2.Time, row.UpdatedBy
	result.Version.SubmittedAt, result.Version.SubmittedBy = timePointer(row.SubmittedAt), row.SubmittedBy
	result.Version.ReviewedAt, result.Version.ReviewedBy, result.Version.ReviewComment = timePointer(row.ReviewedAt), row.ReviewedBy, row.ReviewComment
	result.Data.Name, result.Data.ShortName, result.Data.TaxNumber, result.Data.Address, result.Data.Phone, result.Data.Remark = row.LegalName, deref(row.ShortName), deref(row.TaxNumber), deref(row.Address), deref(row.Phone), deref(row.Remark)
	result.Entity = EntityOperatingEntity
	return result, nil
}

func nullStringPointer(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}
