package led

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) deleteDocumentEntries(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	generationID string,
	documentID string,
) error {
	inventory, err := q.ListLedInventoryEntriesBySource(
		ctx,
		dbsqlc.ListLedInventoryEntriesBySourceParams{
			GenerationID:     generationID,
			SourceDocumentID: documentID,
		},
	)
	if err != nil {
		return s.internal("list inventory entries for deletion", err)
	}
	for _, row := range inventory {
		if err = lockInventoryDimension(
			ctx,
			tx,
			row.WarehouseObjectID,
			row.ProductObjectID,
		); err != nil {
			return err
		}
	}
	source := dbsqlc.DeleteLedInventoryEntriesBySourceParams{
		GenerationID:     generationID,
		SourceDocumentID: documentID,
	}
	if err = q.DeleteLedInventoryEntriesBySource(ctx, source); err != nil {
		return s.writeError("delete inventory entries", err)
	}
	if err = q.DeleteLedFundEntriesBySource(
		ctx,
		dbsqlc.DeleteLedFundEntriesBySourceParams(source),
	); err != nil {
		return s.writeError("delete fund entries", err)
	}
	if err = q.DeleteLedPartyEntriesBySource(
		ctx,
		dbsqlc.DeleteLedPartyEntriesBySourceParams(source),
	); err != nil {
		return s.writeError("delete party entries", err)
	}
	if err = q.DeleteLedContainerEntriesBySource(
		ctx,
		dbsqlc.DeleteLedContainerEntriesBySourceParams(source),
	); err != nil {
		return s.writeError("delete container entries", err)
	}
	return nil
}
