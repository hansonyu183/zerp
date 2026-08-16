package vou

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

type WorkflowAttachmentView struct {
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
	Status      string `json:"status"`
}

type WorkflowDocumentView struct {
	Entity           string                   `json:"entity"`
	DocumentNo       string                   `json:"documentNo"`
	Status           string                   `json:"status"`
	Amount           string                   `json:"amount"`
	Data             DocumentDataView         `json:"data"`
	Attachments      []WorkflowAttachmentView `json:"attachments"`
	ParentEntity     string                   `json:"parentEntity,omitempty"`
	ParentDocumentID string                   `json:"parentDocumentId,omitempty"`
	ParentDocumentNo string                   `json:"parentDocumentNo,omitempty"`
}

// LoadWorkflowSource returns the canonical VOU business snapshot used by WFL.
// A runtime call supplies its write transaction so the source is locked and
// reread at the same boundary as the resulting system draft.
func (s *Service) LoadWorkflowSource(ctx context.Context, tx pgx.Tx, entity, documentID string) (WorkflowDocumentView, error) {
	if !validEntity(entity) || !validID(documentID) {
		return WorkflowDocumentView{}, domainError(ErrorValidation, "invalid document", nil, nil)
	}
	var view DocumentView
	if tx == nil {
		loaded, err := s.Get(ctx, entity, GetInput{DocumentID: documentID})
		if err != nil {
			return WorkflowDocumentView{}, err
		}
		view = loaded
	} else {
		queries := s.queries.WithTx(tx)
		document, err := queries.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: documentID, Entity: entity})
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkflowDocumentView{}, domainError(ErrorValidation, "document not found", nil, nil)
		}
		if err != nil {
			return WorkflowDocumentView{}, s.internal("lock workflow source", err)
		}
		view, err = s.eventSnapshot(ctx, queries, document)
		if err != nil {
			return WorkflowDocumentView{}, err
		}
	}
	return workflowDocumentView(view), nil
}

func workflowDocumentView(view DocumentView) WorkflowDocumentView {
	attachments := make([]WorkflowAttachmentView, 0, len(view.Attachments))
	for _, attachment := range view.Attachments {
		attachments = append(attachments, WorkflowAttachmentView{
			FileName: attachment.FileName, ContentType: attachment.ContentType,
			Size: attachment.Size, Status: attachment.Status,
		})
	}
	return WorkflowDocumentView{
		Entity: view.Entity, DocumentNo: view.DocumentNo, Status: view.Status, Amount: view.Amount,
		Data: view.Data, Attachments: attachments, ParentEntity: view.ParentEntity,
		ParentDocumentID: view.ParentDocumentID, ParentDocumentNo: view.ParentDocumentNo,
	}
}
