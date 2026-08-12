package vou

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
)

func (s *Service) eventSnapshot(ctx context.Context, q *dbsqlc.Queries, document dbsqlc.VouDocument) (DocumentView, error) {
	data, err := s.loadData(ctx, q, document)
	if err != nil {
		return DocumentView{}, s.internal("load event document detail", err)
	}
	attachments, err := q.ListVouAttachments(ctx, document.ID)
	if err != nil {
		return DocumentView{}, s.internal("load event document attachments", err)
	}
	result := documentView(document, data, attachmentViews(attachments))
	if document.ParentDocumentID != nil && document.ParentEntity != nil {
		result.ParentDocumentID = *document.ParentDocumentID
		result.ParentEntity = *document.ParentEntity
		parent, parentErr := q.GetVouDocument(ctx, dbsqlc.GetVouDocumentParams{ID: *document.ParentDocumentID, Entity: *document.ParentEntity})
		if parentErr != nil {
			return DocumentView{}, s.internal("load event parent document", parentErr)
		}
		result.ParentDocumentNo = parent.DocumentNo
	}
	return result, nil
}
