package bob

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

// getOperatingEntity adapts the typed legal-invoice projection that is not
// represented in bob_version_views. Lifecycle transitions remain generic.
func (s *Service) getOperatingEntity(ctx context.Context, input GetInput) (ObjectView, error) {
	row, err := s.queries.GetBobOperatingEntity(ctx, dbsqlc.GetBobOperatingEntityParams{ObjectID: input.ObjectID, VersionID: input.VersionID})
	if err == pgx.ErrNoRows {
		return ObjectView{}, domainError(ErrorValidation, "object or version not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get operating entity", err)
	}
	result := ObjectView{
		ObjectID: row.ID, Entity: EntityOperatingEntity, Code: row.Code, ObjectRevision: row.Revision,
		Enabled: row.Enabled, CurrentVersionID: row.CurrentVersionID, EffectiveVersionID: row.EffectiveVersionID,
		UpdatedAt: row.UpdatedAt.Time,
		Version: VersionMeta{VersionID: row.ID_2, Version: row.VersionNo, Status: row.Status, Revision: row.Revision_2,
			CreatedAt: row.CreatedAt.Time, CreatedBy: row.CreatedBy, UpdatedAt: row.UpdatedAt_2.Time, UpdatedBy: row.UpdatedBy,
			SubmittedAt: timePointer(row.SubmittedAt), SubmittedBy: row.SubmittedBy,
			ReviewedAt: timePointer(row.ReviewedAt), ReviewedBy: row.ReviewedBy, ReviewComment: row.ReviewComment},
		Data: DetailView{Name: row.LegalName, ShortName: deref(row.ShortName), TaxNumber: deref(row.TaxNumber),
			Address: deref(row.Address), Phone: deref(row.Phone), Remark: deref(row.Remark)},
	}
	return result, nil
}
