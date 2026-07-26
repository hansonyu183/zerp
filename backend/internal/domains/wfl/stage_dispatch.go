package wfl

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (s *Service) applyStageAction(
	ctx context.Context,
	tx pgx.Tx,
	process processRow,
	stage string,
	action string,
	input ActionInput,
	actorID string,
	requestID string,
) (documentRow, error) {
	if action == "create" {
		return s.createStage(ctx, tx, process, stage, input.Data, actorID, "")
	}
	if !validID(input.DocumentID) || input.DocumentRevision < 1 {
		return documentRow{}, validation("invalid stage document", nil)
	}
	document, err := lockDocument(ctx, tx, input.DocumentID)
	if err = documentConflict(err, document, input.DocumentRevision, ""); err != nil {
		return documentRow{}, err
	}
	var linked bool
	if err = tx.QueryRow(
		ctx,
		`SELECT true FROM wfl_process_documents WHERE process_id=$1 AND document_id=$2 AND stage=$3`,
		process.id,
		document.id,
		stage,
	).Scan(&linked); err != nil {
		return documentRow{}, err
	}
	switch action {
	case "save":
		err = s.saveStage(ctx, tx, process, stage, &document, input.Data, actorID)
	case "delete":
		err = s.deleteStage(ctx, tx, process, stage, document, input.Reason, actorID, requestID)
	case "check":
		err = checkDocument(ctx, tx, &document, actorID)
	case "uncheck":
		err = uncheckDocument(ctx, tx, &document, input.Reason, actorID)
	case "place", "confirm", "execute":
		err = s.finalizeDocument(ctx, tx, process, stage, &document, action, actorID, requestID)
	case "unplace", "unconfirm", "unexecute":
		err = s.reverseDocument(
			ctx, tx, process, stage, &document, action, input.Reason, actorID, requestID,
		)
	default:
		err = validation("invalid stage action", nil)
	}
	return document, err
}

func insertStageDocumentAudit(
	ctx context.Context,
	tx pgx.Tx,
	stage string,
	action string,
	reasonValue string,
	actorID string,
	requestID string,
	document documentRow,
) error {
	if action == "delete" {
		return nil
	}
	from, to := stageDocumentTransition(action, document.status)
	event := map[string]string{"create": "CREATED", "save": "SAVED"}[action]
	if event == "" {
		event = strings.ToUpper(action)
	}
	return insertVouAudit(
		ctx,
		tx,
		document.id,
		document.entity,
		event,
		from,
		to,
		actorID,
		requestID,
		optional(strings.TrimSpace(reasonValue)),
		map[string]any{"revision": document.revision, "stage": stage},
	)
}

func stageDocumentTransition(action string, currentStatus string) (*string, string) {
	switch action {
	case "save":
		return stringPtr("DRAFT"), "DRAFT"
	case "check":
		return stringPtr("DRAFT"), "REVIEWED"
	case "uncheck":
		return stringPtr("REVIEWED"), "DRAFT"
	case "place", "confirm", "execute":
		return stringPtr("REVIEWED"), "APPROVED"
	case "unplace", "unconfirm", "unexecute":
		return stringPtr("APPROVED"), "REVIEWED"
	default:
		return nil, currentStatus
	}
}

func insertStageWorkflowAudit(
	ctx context.Context,
	tx pgx.Tx,
	process processRow,
	stage string,
	action string,
	reasonValue string,
	actorID string,
	requestID string,
	document documentRow,
) error {
	if action == "delete" {
		return nil
	}
	return insertWFLAudit(
		ctx,
		tx,
		process.id,
		stage+"_"+strings.ToUpper(action),
		nil,
		process.status,
		stage,
		document.id,
		document.number,
		semanticStatus(stage, document.status),
		actorID,
		requestID,
		optional(strings.TrimSpace(reasonValue)),
		map[string]any{"documentRevision": document.revision},
	)
}
