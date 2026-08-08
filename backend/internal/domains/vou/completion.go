package vou

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
)

// RegisterCompletionSubscriptions must run after WFL and LED subscriptions so
// approval first creates downstream documents and posts business facts, then
// the system decides whether the document has completed its lifecycle.
func (s *Service) RegisterCompletionSubscriptions(bus *txevent.Bus) error {
	if bus == nil {
		return errors.New("VOU completion event bus is required")
	}
	completionEntities := entities[:]
	for _, entity := range completionEntities {
		if err := bus.Subscribe(DocumentApprovedTopic(entity), "vou-system-completion", s.handleApprovedCompletion); err != nil {
			return err
		}
		if err := bus.Subscribe(DocumentFinalizedTopic(entity), "vou-parent-completion", s.handleFinalizedCompletion); err != nil {
			return err
		}
		if err := bus.Subscribe(DocumentUnfinalizedTopic(entity), "vou-parent-reopen", s.handleUnfinalizedCompletion); err != nil {
			return err
		}
		if err := bus.Subscribe(DocumentCreatedTopic(entity), "vou-parent-reopen", s.handleCreatedCompletion); err != nil {
			return err
		}
		if err := bus.Subscribe(DocumentDeletedTopic(entity), "vou-parent-completion", s.handleDeletedCompletion); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) handleApprovedCompletion(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
	event, ok := raw.(DocumentApprovedEvent)
	if !ok {
		return nil
	}
	return s.completeDocumentIfReady(ctx, tx, event.Entity, event.DocumentID, event.RequestID, "")
}

func (s *Service) handleFinalizedCompletion(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
	event, ok := raw.(DocumentFinalizedEvent)
	if !ok {
		return nil
	}
	return s.completeParentIfReady(ctx, tx, event.DocumentID, event.RequestID)
}

func (s *Service) handleUnfinalizedCompletion(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
	event, ok := raw.(DocumentUnfinalizedEvent)
	if !ok {
		return nil
	}
	return s.reopenParent(ctx, tx, event.DocumentID, event.RequestID, "后续单据重新打开")
}

func (s *Service) handleCreatedCompletion(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
	event, ok := raw.(DocumentCreatedEvent)
	if !ok || event.ParentDocumentID == "" {
		return nil
	}
	return s.reopenDocumentByID(ctx, tx, event.ParentDocumentID, event.RequestID, "新增后续单据")
}

func (s *Service) handleDeletedCompletion(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
	event, ok := raw.(DocumentDeletedEvent)
	if !ok || event.ParentDocumentID == "" {
		return nil
	}
	return s.completeDocumentIfReady(
		ctx, tx, "", event.ParentDocumentID, event.RequestID, event.DocumentID,
	)
}

func (s *Service) completeParentIfReady(ctx context.Context, tx pgx.Tx, childID, requestID string) error {
	var parentID *string
	if err := tx.QueryRow(ctx, `SELECT parent_document_id FROM vou_documents WHERE id=$1`, childID).Scan(&parentID); err != nil {
		return err
	}
	if parentID == nil {
		return nil
	}
	return s.completeDocumentIfReady(ctx, tx, "", *parentID, requestID, "")
}

func (s *Service) completeDocumentIfReady(
	ctx context.Context,
	tx pgx.Tx,
	entity string,
	documentID string,
	requestID string,
	excludedChildID string,
) error {
	if entity == "" {
		if err := tx.QueryRow(ctx, `SELECT entity FROM vou_documents WHERE id=$1`, documentID).Scan(&entity); err != nil {
			return err
		}
	}
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: documentID, Entity: entity})
	if err != nil {
		return err
	}
	if document.Status != StatusApproved {
		return nil
	}
	ready, err := s.documentCompletionReady(ctx, tx, document, excludedChildID)
	if err != nil || !ready {
		return err
	}
	_, err = s.systemFinalizeDocument(ctx, tx, document, requestID)
	return err
}

func (s *Service) documentCompletionReady(
	ctx context.Context,
	tx pgx.Tx,
	document dbsqlc.VouDocument,
	excludedChildID string,
) (bool, error) {
	if document.Entity == EntitySaleOrder || document.Entity == EntityPurchaseOrder {
		table := "vou_sale_order_details"
		if document.Entity == EntityPurchaseOrder {
			table = "vou_purchase_order_details"
		}
		var fulfillment string
		if err := tx.QueryRow(ctx, "SELECT fulfillment_status FROM "+table+" WHERE document_id=$1", document.ID).Scan(&fulfillment); err != nil {
			return false, err
		}
		if fulfillment != "FULFILLED" && fulfillment != "SHORT_CLOSED" {
			return false, nil
		}
	}
	var unfinishedChildren bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM vou_documents
		WHERE parent_document_id=$1
			AND ($2='' OR id<>$2)
			AND status<>'FINALIZED'
	)`, document.ID, excludedChildID).Scan(&unfinishedChildren); err != nil {
		return false, err
	}
	return !unfinishedChildren, nil
}

func (s *Service) systemFinalizeDocument(
	ctx context.Context,
	tx pgx.Tx,
	document dbsqlc.VouDocument,
	requestID string,
) (int64, error) {
	q := s.queries.WithTx(tx)
	revision, err := q.FinalizeVouDocument(ctx, dbsqlc.FinalizeVouDocumentParams{
		ActorID: stringPtr(systemidentity.UserID), ID: document.ID,
		Entity: document.Entity, Revision: document.Revision,
	})
	if err != nil {
		return 0, s.writeError("system finalize document", err)
	}
	summary := map[string]any{"completion": "SYSTEM"}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: document.ID, Entity: document.Entity, Event: "FINALIZED",
		From: stringPtr(StatusApproved), To: StatusFinalized,
		ActorID: systemidentity.UserID, RequestID: requestID, Summary: summary,
	}); err != nil {
		return 0, s.writeError("audit system finalize", err)
	}
	if err = s.events.Publish(ctx, tx, DocumentFinalizedEvent{
		Entity: document.Entity, DocumentID: document.ID, DocumentNo: document.DocumentNo,
		Revision: revision, ActorID: systemidentity.UserID, RequestID: requestID,
	}); err != nil {
		return 0, s.eventError("publish system finalized", err)
	}
	if err = s.touchWorkflow(ctx, tx, document, "FINALIZED", StatusFinalized,
		systemidentity.UserID, requestID, summary); err != nil {
		return 0, err
	}
	return revision, nil
}

func (s *Service) systemUnfinalizeDocument(
	ctx context.Context,
	tx pgx.Tx,
	document dbsqlc.VouDocument,
	requestID string,
	reason string,
) (int64, error) {
	q := s.queries.WithTx(tx)
	revision, err := q.UnfinalizeVouDocument(ctx, dbsqlc.UnfinalizeVouDocumentParams{
		ActorID: systemidentity.UserID, ID: document.ID,
		Entity: document.Entity, Revision: document.Revision,
	})
	if err != nil {
		return 0, s.writeError("system unfinalize document", err)
	}
	summary := map[string]any{"completion": "SYSTEM", "reason": reason}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: document.ID, Entity: document.Entity, Event: "UNFINALIZED",
		From: stringPtr(StatusFinalized), To: StatusApproved,
		ActorID: systemidentity.UserID, Reason: stringPtr(reason), RequestID: requestID, Summary: summary,
	}); err != nil {
		return 0, s.writeError("audit system unfinalize", err)
	}
	if err = s.events.Publish(ctx, tx, DocumentUnfinalizedEvent{
		Entity: document.Entity, DocumentID: document.ID, DocumentNo: document.DocumentNo,
		Revision: revision, ActorID: systemidentity.UserID, RequestID: requestID, Reason: reason,
	}); err != nil {
		return 0, s.eventError("publish system unfinalized", err)
	}
	if err = s.touchWorkflow(ctx, tx, document, "UNFINALIZED", StatusApproved,
		systemidentity.UserID, requestID, summary); err != nil {
		return 0, err
	}
	return revision, nil
}

func (s *Service) reopenParent(ctx context.Context, tx pgx.Tx, childID, requestID, reason string) error {
	var parentID *string
	if err := tx.QueryRow(ctx, `SELECT parent_document_id FROM vou_documents WHERE id=$1`, childID).Scan(&parentID); err != nil {
		return err
	}
	if parentID == nil {
		return nil
	}
	return s.reopenDocumentByID(ctx, tx, *parentID, requestID, reason)
}

func (s *Service) reopenDocumentByID(ctx context.Context, tx pgx.Tx, documentID, requestID, reason string) error {
	var entity string
	if err := tx.QueryRow(ctx, `SELECT entity FROM vou_documents WHERE id=$1`, documentID).Scan(&entity); err != nil {
		return err
	}
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: documentID, Entity: entity})
	if err != nil || document.Status != StatusFinalized {
		return err
	}
	closed, err := q.IsVouDocumentInClosedPeriod(ctx, documentID)
	if err != nil {
		return err
	}
	if closed {
		return nil
	}
	_, err = s.systemUnfinalizeDocument(ctx, tx, document, requestID, reason)
	return err
}

func (s *Service) ensureFinalizedLeafCanUnapprove(
	ctx context.Context,
	tx pgx.Tx,
	document dbsqlc.VouDocument,
) error {
	var hasChildren bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM vou_documents WHERE parent_document_id=$1
	)`, document.ID).Scan(&hasChildren); err != nil {
		return err
	}
	if hasChildren {
		return domainError(ErrorConflict, "downstream documents must be reversed first", nil, nil)
	}
	return nil
}

// ReconcileCompletionStatuses applies the new completion meaning after ledger
// rebuild. Closed periods remain untouched; open-period parents are reopened
// when downstream work is unfinished, then every ready approved leaf is closed.
func (s *Service) ReconcileCompletionStatuses(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return s.internal("begin completion reconciliation", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	finalized, err := q.ListOpenPeriodFinalizedVouDocumentsForCompletion(ctx)
	if err != nil {
		return s.internal("list finalized documents for completion reconciliation", err)
	}
	for _, document := range finalized {
		ready, readyErr := s.documentCompletionReady(ctx, tx, document, "")
		if readyErr != nil {
			return readyErr
		}
		if ready {
			continue
		}
		current, lockErr := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: document.ID, Entity: document.Entity})
		if lockErr != nil {
			return lockErr
		}
		if current.Status == StatusFinalized {
			if _, err = s.systemUnfinalizeDocument(ctx, tx, current, "approved-posting-reconcile", "后续流程尚未完成"); err != nil {
				return err
			}
		}
	}
	approved, err := q.ListApprovedVouDocumentsForCompletion(ctx)
	if err != nil {
		return s.internal("list approved documents for completion reconciliation", err)
	}
	for _, document := range approved {
		if err = s.completeDocumentIfReady(
			ctx, tx, document.Entity, document.ID, "approved-posting-reconcile", "",
		); err != nil {
			return err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return s.writeError("commit completion reconciliation", err)
	}
	return nil
}
