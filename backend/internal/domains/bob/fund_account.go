package bob

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) getFundAccount(ctx context.Context, input GetInput) (ObjectView, error) {
	result, err := s.getObject(ctx, EntityFundAccount, input)
	if err != nil {
		return ObjectView{}, err
	}
	if err = loadFundAccountOperating(ctx, s.queries, result.Version.VersionID, &result.Data); err != nil {
		return ObjectView{}, s.internal("read fund account operating entity", err)
	}
	return result, nil
}

func loadFundAccountOperating(ctx context.Context, q *dbsqlc.Queries, versionID string, data *DetailView) error {
	row, err := q.GetFundAccountOperatingDetail(ctx, versionID)
	if err != nil {
		return err
	}
	data.OperatingEntityID = row.OperatingEntityID
	data.OperatingEntityVersionID = row.OperatingEntityVersionID
	data.OperatingEntityCode = row.OperatingEntityCode
	data.OperatingEntityName = row.OperatingEntityName
	return nil
}

func (s *Service) resolveFundAccountOperating(
	ctx context.Context, tx pgx.Tx, data DetailView,
) (DetailView, error) {
	row, err := s.queries.WithTx(tx).ResolveFundAccountOperatingEntity(ctx, data.OperatingEntityID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DetailView{}, domainError(ErrorConflict, "operating-entity reference is unavailable", nil, nil)
	}
	if err != nil {
		return DetailView{}, s.internal("resolve fund account operating entity", err)
	}
	data.OperatingEntityID = row.ID
	data.OperatingEntityVersionID = row.ID_2
	data.OperatingEntityCode = row.Code
	data.OperatingEntityName = row.LegalName
	return data, nil
}
