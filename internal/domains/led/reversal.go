package led

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	voudomain "github.com/hansonyu183/zerp-back/internal/domains/vou"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type sourceEntries struct {
	Inventory []dbsqlc.LedInventoryEntry
	Fund      []dbsqlc.LedFundEntry
	Party     []dbsqlc.LedPartyEntry
}

func loadSourceEntries(
	ctx context.Context,
	q *dbsqlc.Queries,
	generationID string,
	documentID string,
) (sourceEntries, error) {
	inventory, err := q.ListLedInventoryEntriesBySource(ctx, dbsqlc.ListLedInventoryEntriesBySourceParams{
		GenerationID: generationID, SourceDocumentID: documentID,
	})
	if err != nil {
		return sourceEntries{}, err
	}
	fund, err := q.ListLedFundEntriesBySource(ctx, dbsqlc.ListLedFundEntriesBySourceParams{
		GenerationID: generationID, SourceDocumentID: documentID,
	})
	if err != nil {
		return sourceEntries{}, err
	}
	party, err := q.ListLedPartyEntriesBySource(ctx, dbsqlc.ListLedPartyEntriesBySourceParams{
		GenerationID: generationID, SourceDocumentID: documentID,
	})
	if err != nil {
		return sourceEntries{}, err
	}
	return sourceEntries{Inventory: inventory, Fund: fund, Party: party}, nil
}

func maxSourceRevision(entries sourceEntries) int64 {
	maxRevision := int64(0)
	for _, row := range entries.Inventory {
		if row.SourceRevision > maxRevision {
			maxRevision = row.SourceRevision
		}
	}
	for _, row := range entries.Fund {
		if row.SourceRevision > maxRevision {
			maxRevision = row.SourceRevision
		}
	}
	for _, row := range entries.Party {
		if row.SourceRevision > maxRevision {
			maxRevision = row.SourceRevision
		}
	}
	return maxRevision
}

func (s *Service) reverseDocumentEntries(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	generationID string,
	event voudomain.DocumentUnexecutedEvent,
	occurredAt pgtype.Timestamptz,
) error {
	entries, err := loadSourceEntries(ctx, q, generationID, event.DocumentID)
	if err != nil {
		return err
	}
	revision := maxSourceRevision(entries)
	if err = s.reverseInventoryEntries(ctx, tx, q, generationID, revision, event, occurredAt, entries.Inventory); err != nil {
		return err
	}
	if err = s.reverseFundEntries(ctx, q, generationID, revision, event, occurredAt, entries.Fund); err != nil {
		return err
	}
	return s.reversePartyEntries(ctx, q, generationID, revision, event, occurredAt, entries.Party)
}

func (s *Service) reverseInventoryEntries(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	generationID string,
	revision int64,
	event voudomain.DocumentUnexecutedEvent,
	occurredAt pgtype.Timestamptz,
	entries []dbsqlc.LedInventoryEntry,
) error {
	for _, row := range entries {
		if row.SourceRevision != revision {
			continue
		}
		if err := lockInventoryDimension(ctx, tx, row.WarehouseObjectID, row.ProductObjectID); err != nil {
			return err
		}
		if err := q.InsertLedInventoryEntry(ctx, dbsqlc.InsertLedInventoryEntryParams{
			ID: newID(), GenerationID: generationID, EntryType: "REVERSAL",
			SourceEntity: row.SourceEntity, SourceDocumentID: row.SourceDocumentID,
			SourceDocumentNo: row.SourceDocumentNo, SourceLineID: row.SourceLineID,
			SourceRevision: event.Revision, EffectiveDate: row.EffectiveDate, OccurredAt: occurredAt,
			ActorID: event.ActorID, RequestID: event.RequestID, Reason: &event.Reason,
			WarehouseObjectID: row.WarehouseObjectID, WarehouseVersionID: row.WarehouseVersionID,
			WarehouseCode: row.WarehouseCode, WarehouseName: row.WarehouseName,
			ProductObjectID: row.ProductObjectID, ProductVersionID: row.ProductVersionID,
			ProductCode: row.ProductCode, ProductName: row.ProductName, ProductUnit: row.ProductUnit,
			QuantityDeltaMicros: -row.QuantityDeltaMicros,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) reverseFundEntries(
	ctx context.Context,
	q *dbsqlc.Queries,
	generationID string,
	revision int64,
	event voudomain.DocumentUnexecutedEvent,
	occurredAt pgtype.Timestamptz,
	entries []dbsqlc.LedFundEntry,
) error {
	for _, row := range entries {
		if row.SourceRevision != revision {
			continue
		}
		if err := q.InsertLedFundEntry(ctx, dbsqlc.InsertLedFundEntryParams{
			ID: newID(), GenerationID: generationID, EntryType: "REVERSAL",
			SourceEntity: row.SourceEntity, SourceDocumentID: row.SourceDocumentID,
			SourceDocumentNo: row.SourceDocumentNo, SourceLineID: row.SourceLineID,
			SourceRevision: event.Revision, EffectiveDate: row.EffectiveDate, OccurredAt: occurredAt,
			ActorID: event.ActorID, RequestID: event.RequestID, Reason: &event.Reason,
			FundAccountObjectID: row.FundAccountObjectID, FundAccountVersionID: row.FundAccountVersionID,
			FundAccountCode: row.FundAccountCode, FundAccountName: row.FundAccountName,
			Currency: row.Currency, AmountDeltaCents: -row.AmountDeltaCents,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) reversePartyEntries(
	ctx context.Context,
	q *dbsqlc.Queries,
	generationID string,
	revision int64,
	event voudomain.DocumentUnexecutedEvent,
	occurredAt pgtype.Timestamptz,
	entries []dbsqlc.LedPartyEntry,
) error {
	for _, row := range entries {
		if row.SourceRevision != revision {
			continue
		}
		if err := q.InsertLedPartyEntry(ctx, dbsqlc.InsertLedPartyEntryParams{
			ID: newID(), GenerationID: generationID, EntryType: "REVERSAL",
			SourceEntity: row.SourceEntity, SourceDocumentID: row.SourceDocumentID,
			SourceDocumentNo: row.SourceDocumentNo, SourceLineID: row.SourceLineID,
			SourceRevision: event.Revision, EffectiveDate: row.EffectiveDate, OccurredAt: occurredAt,
			ActorID: event.ActorID, RequestID: event.RequestID, Reason: &event.Reason,
			CounterpartyEntity: row.CounterpartyEntity, CounterpartyObjectID: row.CounterpartyObjectID,
			CounterpartyVersionID: row.CounterpartyVersionID, CounterpartyCode: row.CounterpartyCode,
			CounterpartyName: row.CounterpartyName, Currency: row.Currency,
			AmountDeltaCents: -row.AmountDeltaCents,
		}); err != nil {
			return err
		}
	}
	return nil
}
