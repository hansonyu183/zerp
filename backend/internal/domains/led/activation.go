package led

import (
	"context"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) preflightActivation(
	ctx context.Context,
	q *dbsqlc.Queries,
	documents []dbsqlc.VouDocument,
	cutoverDate time.Time,
) error {
	_ = q
	_ = cutoverDate
	_ = documents
	return nil
}

func (s *Service) createOpeningGeneration(
	ctx context.Context,
	q *dbsqlc.Queries,
	generationID string,
	cutoverDate pgtype.Date,
	actorID string,
	requestID string,
) error {
	if err := q.InsertLedGeneration(ctx, dbsqlc.InsertLedGenerationParams{
		ID: generationID, CutoverDate: cutoverDate, ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return s.writeError("insert ledger generation", err)
	}
	if err := q.InsertLedOpeningInventoryFromDraft(ctx, generationID); err != nil {
		return s.writeError("copy inventory opening", err)
	}
	if err := q.InsertLedOpeningFundFromDraft(ctx, generationID); err != nil {
		return s.writeError("copy fund opening", err)
	}
	if err := q.InsertLedOpeningPartyFromDraft(ctx, generationID); err != nil {
		return s.writeError("copy party opening", err)
	}
	if err := q.InsertLedOpeningContainerFromDraft(ctx, generationID); err != nil {
		return s.writeError("copy container opening", err)
	}

	openingTime := time.Date(
		cutoverDate.Time.Year(),
		cutoverDate.Time.Month(),
		cutoverDate.Time.Day(),
		0, 0, 0, 0,
		time.UTC,
	)
	occurredAt := pgtype.Timestamptz{Time: openingTime, Valid: true}
	if err := q.InsertLedOpeningInventoryEntries(ctx, dbsqlc.InsertLedOpeningInventoryEntriesParams{
		GenerationID: generationID, CutoverDate: cutoverDate, OccurredAt: occurredAt,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return s.writeError("post inventory opening", err)
	}
	if err := q.InsertLedOpeningFundEntries(ctx, dbsqlc.InsertLedOpeningFundEntriesParams{
		GenerationID: generationID, CutoverDate: cutoverDate, OccurredAt: occurredAt,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return s.writeError("post fund opening", err)
	}
	if err := q.InsertLedOpeningPartyEntries(ctx, dbsqlc.InsertLedOpeningPartyEntriesParams{
		GenerationID: generationID, CutoverDate: cutoverDate, OccurredAt: occurredAt,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return s.writeError("post party opening", err)
	}
	if err := q.InsertLedOpeningContainerEntries(ctx, dbsqlc.InsertLedOpeningContainerEntriesParams{
		GenerationID: generationID, CutoverDate: cutoverDate, OccurredAt: occurredAt,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return s.writeError("post container opening", err)
	}
	return nil
}

func (s *Service) replayVouDocuments(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	generationID string,
	cutoverDate time.Time,
	documents []dbsqlc.VouDocument,
	actorID string,
	requestID string,
) error {
	for _, document := range documents {
		postedBy := actorID
		if document.ExecutedBy != nil {
			postedBy = *document.ExecutedBy
		}
		occurredAt := document.ExecutedAt
		if !occurredAt.Valid {
			occurredAt = document.UpdatedAt
		}
		if err := s.postDocument(ctx, tx, q, postingContext{
			GenerationID:   generationID,
			CutoverDate:    cutoverDate,
			Document:       document,
			EntryType:      "POSTING",
			SourceRevision: document.Revision,
			OccurredAt:     occurredAt,
			ActorID:        postedBy,
			RequestID:      "led-rebuild/" + requestID,
			Live:           false,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) finalizeActivation(
	ctx context.Context,
	q *dbsqlc.Queries,
	control dbsqlc.LedControl,
	expectedRevision int64,
	generationID string,
	actorID string,
	requestID string,
	documentCount int,
) (int64, error) {
	negative, err := q.HasNegativeLedInventoryTimeline(ctx, generationID)
	if err != nil {
		return 0, s.internal("validate rebuilt inventory", err)
	}
	if negative {
		return 0, domainError(ErrorConflict, "inventory timeline would become negative", nil, nil)
	}
	if control.ActiveGenerationID != nil {
		if err = q.ArchiveActiveLedGeneration(ctx, *control.ActiveGenerationID); err != nil {
			return 0, s.writeError("archive ledger generation", err)
		}
	}
	revision, err := q.ActivateLedControl(ctx, dbsqlc.ActivateLedControlParams{
		CutoverDate:  control.CutoverDate,
		GenerationID: &generationID,
		ActorID:      &actorID,
		Revision:     expectedRevision,
	})
	if err != nil {
		return 0, s.writeError("activate ledger control", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		Event:        "ACTIVATED",
		From:         &control.Status,
		To:           StatusActive,
		GenerationID: &generationID,
		Revision:     revision,
		ActorID:      actorID,
		RequestID:    requestID,
		Summary: map[string]any{
			"documentCount": documentCount,
			"cutoverDate":   formatDate(control.CutoverDate),
		},
	}); err != nil {
		return 0, s.writeError("audit activation", err)
	}
	if err = clearDraft(ctx, q); err != nil {
		return 0, s.writeError("clear activated draft", err)
	}
	return revision, nil
}
