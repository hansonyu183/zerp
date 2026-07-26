package led

import (
	"context"
	"time"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	voudomain "github.com/hansonyu183/zerp-back/internal/domains/vou"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) preflightActivation(
	ctx context.Context,
	q *dbsqlc.Queries,
	documents []dbsqlc.VouDocument,
	cutoverDate time.Time,
) error {
	missingPrices := make([]string, 0)
	for _, document := range documents {
		if document.Entity != voudomain.EntityIntermediarySaleOrder ||
			document.BusinessDate.Time.Before(cutoverDate) {
			continue
		}
		lines, err := q.ListVouProductLines(ctx, document.ID)
		if err != nil {
			return s.internal("preflight intermediary prices", err)
		}
		for _, line := range lines {
			if line.PurchaseUnitPriceCents == nil {
				missingPrices = append(missingPrices, document.DocumentNo)
				break
			}
		}
	}
	if len(missingPrices) > 0 {
		return domainError(
			ErrorConflict,
			"executed intermediary documents are missing purchaseUnitPrice",
			map[string]any{"documentNos": missingPrices},
			nil,
		)
	}
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

func (s *Service) replayManagedDocuments(
	ctx context.Context,
	tx pgx.Tx,
	generationID string,
	cutoverDate time.Time,
	requestID string,
) error {
	rows, err := tx.Query(ctx, `SELECT d.entity,d.id,d.document_no,d.revision,
		COALESCE(d.approved_by,d.updated_by),d.approved_at
		FROM vou_documents d WHERE d.control_domain='WFL' AND d.status='APPROVED'
		AND d.entity IN ('goods-receipt','signoff-note') ORDER BY d.approved_at,d.id`)
	if err != nil {
		return s.internal("list WFL documents", err)
	}
	defer rows.Close()
	for rows.Next() {
		var event voudomain.ManagedDocumentEvent
		var occurredAt pgtype.Timestamptz
		if err = rows.Scan(
			&event.Entity,
			&event.DocumentID,
			&event.DocumentNo,
			&event.Revision,
			&event.ActorID,
			&occurredAt,
		); err != nil {
			return err
		}
		event.Action = "FINALIZED"
		event.RequestID = "led-rebuild/" + requestID
		if err = s.postManagedDocument(ctx, tx, generationID, cutoverDate, event, false); err != nil {
			return err
		}
	}
	return rows.Err()
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
