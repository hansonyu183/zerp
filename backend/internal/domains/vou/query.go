package vou

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) Query(ctx context.Context, entity string, input QueryInput) (Page[ListItem], error) {
	if !validEntity(entity) {
		return Page[ListItem]{}, domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	query, err := validateQuery(input)
	if err != nil {
		return Page[ListItem]{}, err
	}
	params := dbsqlc.CountVouDocumentsParams{
		Entity: entity, Statuses: storedStatuses(entity, query.Statuses), Keyword: query.Keyword, PartyObjectID: query.PartyObjectID,
		DateFrom: optionalDate(query.DateFrom), DateTo: optionalDate(query.DateTo),
	}
	total, err := s.queries.CountVouDocuments(ctx, params)
	if err != nil {
		return Page[ListItem]{}, s.internal("count documents", err)
	}
	rows, err := s.queries.ListVouDocuments(ctx, dbsqlc.ListVouDocumentsParams{
		Entity: entity, Statuses: storedStatuses(entity, query.Statuses), Keyword: query.Keyword, PartyObjectID: query.PartyObjectID,
		DateFrom: optionalDate(query.DateFrom), DateTo: optionalDate(query.DateTo),
		SortField: query.SortField, SortOrder: query.SortOrder,
		PageOffset: int32((query.Page - 1) * query.PageSize), PageSize: int32(query.PageSize),
	})
	if err != nil {
		return Page[ListItem]{}, s.internal("list documents", err)
	}
	items := make([]ListItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, ListItem{
			DocumentID: row.ID, Entity: row.Entity, DocumentNo: row.DocumentNo,
			Status: documentStatus(entity, row.Status), Revision: row.Revision, BusinessDate: formatDate(row.BusinessDate),
			PartyName: row.PartyName, Currency: row.Currency, Amount: formatMoney(row.TotalAmountCents),
			UpdatedAt: row.UpdatedAt.Time,
		})
	}
	return Page[ListItem]{Items: items, Total: total, Page: query.Page, PageSize: query.PageSize}, nil
}

func storedStatuses(entity string, statuses []string) []string {
	result := make([]string, 0, len(statuses))
	for _, status := range statuses {
		switch {
		case entity == EntityCustomerOrder && status == StatusChecked:
			result = append(result, "REVIEWED")
		case entity == EntityProcurementOrder && status == "ORDERED":
			result = append(result, StatusApproved)
		case (entity == EntityGoodsReceipt || entity == EntitySignoffNote) && status == "CONFIRMED":
			result = append(result, StatusApproved)
		case entity == EntityDeliveryNote && status == "EXECUTED":
			result = append(result, StatusApproved)
		case (entity == EntityProcurementOrder || entity == EntityGoodsReceipt ||
			entity == EntityDeliveryNote || entity == EntitySignoffNote) && status == StatusChecked:
			result = append(result, "REVIEWED")
		default:
			result = append(result, status)
		}
	}
	return result
}

func documentStatus(entity, status string) string {
	if status == "REVIEWED" {
		return StatusChecked
	}
	if status != StatusApproved {
		return status
	}
	switch entity {
	case EntityProcurementOrder:
		return "ORDERED"
	case EntityGoodsReceipt, EntitySignoffNote:
		return "CONFIRMED"
	case EntityDeliveryNote:
		return "EXECUTED"
	default:
		return status
	}
}

func (s *Service) Get(ctx context.Context, entity string, input GetInput) (DocumentView, error) {
	if !validEntity(entity) || !validID(input.DocumentID) {
		return DocumentView{}, domainError(ErrorValidation, "invalid document", nil, nil)
	}
	document, err := s.queries.GetVouDocument(ctx, dbsqlc.GetVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentView{}, domainError(ErrorValidation, "document not found", nil, nil)
	}
	if err != nil {
		return DocumentView{}, s.internal("get document", err)
	}
	data, err := s.loadData(ctx, s.queries, document)
	if err != nil {
		return DocumentView{}, s.internal("load document detail", err)
	}
	attachments, err := s.queries.ListVouAttachments(ctx, input.DocumentID)
	if err != nil {
		return DocumentView{}, s.internal("list attachments", err)
	}
	view := documentView(document, data, attachmentViews(attachments))
	if document.ParentDocumentID != nil {
		view.ParentDocumentID = *document.ParentDocumentID
		if err = s.pool.QueryRow(ctx, `SELECT document_no FROM vou_documents WHERE id=$1`,
			*document.ParentDocumentID).Scan(&view.SourceDocumentNo); err != nil {
			return DocumentView{}, s.internal("load source document", err)
		}
	}
	return view, nil
}

func (s *Service) AuditHistory(ctx context.Context, entity string, input HistoryInput) (Page[AuditEventView], error) {
	if !validEntity(entity) {
		return Page[AuditEventView]{}, domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	if err := validateHistory(input); err != nil {
		return Page[AuditEventView]{}, err
	}
	total, err := s.queries.CountVouAuditEvents(ctx, dbsqlc.CountVouAuditEventsParams{
		DocumentID: input.DocumentID, Entity: entity,
	})
	if err != nil {
		return Page[AuditEventView]{}, s.internal("count audit events", err)
	}
	rows, err := s.queries.ListVouAuditEvents(ctx, dbsqlc.ListVouAuditEventsParams{
		DocumentID: input.DocumentID, Entity: entity,
		PageOffset: int32((input.Page - 1) * input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[AuditEventView]{}, s.internal("list audit events", err)
	}
	items := make([]AuditEventView, 0, len(rows))
	for _, row := range rows {
		fromStatus := row.FromStatus
		if fromStatus != nil {
			value := documentStatus(entity, *fromStatus)
			fromStatus = &value
		}
		items = append(items, AuditEventView{
			ID: row.ID, EventType: row.EventType, FromStatus: fromStatus, ToStatus: documentStatus(entity, row.ToStatus),
			ActorID: row.ActorID, OccurredAt: row.OccurredAt.Time, Reason: row.Reason,
			RequestID: row.RequestID, Summary: row.Summary,
		})
	}
	return Page[AuditEventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}
