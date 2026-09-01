package vou

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
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
		Entity: entity, Statuses: storedStatuses(entity, query.Statuses), Keyword: query.Keyword, CounterpartyObjectID: query.CounterpartyObjectID,
		DateFrom: optionalDate(query.DateFrom), DateTo: optionalDate(query.DateTo),
	}
	total, err := s.queries.CountVouDocuments(ctx, params)
	if err != nil {
		return Page[ListItem]{}, s.internal("count documents", err)
	}
	rows, err := s.queries.ListVouDocuments(ctx, dbsqlc.ListVouDocumentsParams{
		Entity: entity, Statuses: storedStatuses(entity, query.Statuses), Keyword: query.Keyword, CounterpartyObjectID: query.CounterpartyObjectID,
		DateFrom: optionalDate(query.DateFrom), DateTo: optionalDate(query.DateTo),
		SortField: query.SortField, SortOrder: query.SortOrder,
		PageOffset: int32((query.Page - 1) * query.PageSize), PageSize: int32(query.PageSize),
	})
	if err != nil {
		return Page[ListItem]{}, s.internal("list documents", err)
	}
	items := make([]ListItem, 0, len(rows))
	coordinator, err := s.coordinator(entity)
	if err != nil {
		return Page[ListItem]{}, err
	}
	for _, row := range rows {
		entry := approval.Entry{
			EntryRef: approval.EntryRef{ID: row.ApprovalEntryID, Domain: "vou", Entity: row.Entity, SubjectID: row.ID},
			Status:   approval.Status(row.Status), Revision: row.Revision, SubmittedBy: row.SubmittedBy,
		}
		items = append(items, ListItem{
			DocumentID: row.ID, Entity: row.Entity, DocumentNo: row.DocumentNo,
			Status: documentStatus(entity, row.Status), Revision: row.Revision, BusinessDate: formatDate(row.BusinessDate),
			CounterpartyName: row.CounterpartyName, Currency: deref(row.Currency), Amount: documentAmount(row.Entity, row.TotalAmountCents),
			UpdatedAt:                row.UpdatedAt.Time,
			AvailableApprovalActions: coordinator.LifecycleActions(entry, input.actor),
		})
	}
	if len(items) > 0 && (entity == EntitySaleOrder || entity == EntityPurchaseOrder) {
		orderIDs := make([]string, len(items))
		indexByID := make(map[string]int, len(items))
		for index := range items {
			orderIDs[index] = items[index].DocumentID
			indexByID[items[index].DocumentID] = index
		}
		if entity == EntitySaleOrder {
			summaries, summaryErr := s.queries.ListSalesOrderBaseQuantitySummaries(ctx, orderIDs)
			if summaryErr != nil {
				return Page[ListItem]{}, s.internal("summarize sales order list", summaryErr)
			}
			for _, row := range summaries {
				index := indexByID[row.OrderID]
				summary := &SalesBaseQuantitySummary{
					WarehouseAvailable:    row.WarehouseAvailable,
					OrderedBaseQuantity:   compactQuantity(row.OrderedBaseQuantityMicros),
					OutboundBaseQuantity:  compactQuantity(row.OutboundBaseQuantityMicros),
					InTransitBaseQuantity: compactQuantity(row.InTransitBaseQuantityMicros),
					SignedBaseQuantity:    compactQuantity(row.SignedBaseQuantityMicros),
					NetSignedBaseQuantity: compactQuantity(row.NetSignedBaseQuantityMicros),
				}
				if row.WarehouseAvailable {
					summary.ShortageBaseQuantity = compactQuantity(row.ShortageBaseQuantityMicros)
				}
				items[index].SalesSummary = summary
			}
		} else {
			summaries, summaryErr := s.queries.ListPurchaseOrderBaseQuantitySummaries(ctx, orderIDs)
			if summaryErr != nil {
				return Page[ListItem]{}, s.internal("summarize purchase order list", summaryErr)
			}
			for _, row := range summaries {
				index := indexByID[row.OrderID]
				items[index].PurchaseSummary = &PurchaseBaseQuantitySummary{
					OrderedBaseQuantity:          compactQuantity(row.OrderedBaseQuantityMicros),
					InboundBaseQuantity:          compactQuantity(row.InboundBaseQuantityMicros),
					ReturnProcessingBaseQuantity: compactQuantity(row.ReturnProcessingBaseQuantityMicros),
					NetInboundBaseQuantity:       compactQuantity(row.NetInboundBaseQuantityMicros),
				}
			}
		}
	}
	return Page[ListItem]{Items: items, Total: total, Page: query.Page, PageSize: query.PageSize}, nil
}

func compactQuantity(value int64) string {
	return strings.TrimRight(strings.TrimRight(formatQuantity(value), "0"), ".")
}

func storedStatuses(entity string, statuses []string) []string {
	return statuses
}

func documentStatus(_ string, status string) string {
	return status
}

func (s *Service) Get(ctx context.Context, entity string, input GetInput) (DocumentView, error) {
	if !validEntity(entity) || !validID(input.DocumentID) {
		return DocumentView{}, domainError(ErrorValidation, "invalid document", nil, nil)
	}
	document, err := s.getDocument(ctx, input.DocumentID, entity)
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
	coordinator, err := s.coordinator(entity)
	if err != nil {
		return DocumentView{}, err
	}
	view.AvailableApprovalActions = coordinator.LifecycleActions(document.approvalEntry(), input.actor)
	if document.ParentDocumentID != nil {
		view.ParentDocumentID = *document.ParentDocumentID
		if document.ParentEntity != nil {
			view.ParentEntity = *document.ParentEntity
		}
		if err = s.pool.QueryRow(ctx, `SELECT document_no FROM vou_documents WHERE id=$1 AND entity=$2`,
			*document.ParentDocumentID, view.ParentEntity).Scan(&view.ParentDocumentNo); err != nil {
			return DocumentView{}, s.internal("load parent document", err)
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
	var total int64
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM approval_events
		WHERE domain='vou' AND entity=$1 AND subject_id=$2`, entity, input.DocumentID).Scan(&total)
	if err != nil {
		return Page[AuditEventView]{}, s.internal("count audit events", err)
	}
	rows, err := s.pool.Query(ctx, `SELECT id,entry_id,action,from_status,to_status,
		from_revision,to_revision,actor_id,reason,request_id,created_at
		FROM approval_events WHERE domain='vou' AND entity=$1 AND subject_id=$2
		ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`,
		entity, input.DocumentID, input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return Page[AuditEventView]{}, s.internal("list audit events", err)
	}
	items := make([]AuditEventView, 0, input.PageSize)
	defer rows.Close()
	for rows.Next() {
		var item approval.EventView
		var action string
		var fromStatus, toStatus *string
		var createdAt pgtype.Timestamptz
		if err = rows.Scan(&item.ID, &item.ApprovalEntryID, &action, &fromStatus, &toStatus,
			&item.FromRevision, &item.ToRevision, &item.ActorID, &item.Reason, &item.RequestID, &createdAt); err != nil {
			return Page[AuditEventView]{}, s.internal("scan audit events", err)
		}
		item.Action = approval.Action(action)
		if fromStatus != nil {
			value := approval.Status(*fromStatus)
			item.FromStatus = &value
		}
		if toStatus != nil {
			value := approval.Status(*toStatus)
			item.ToStatus = &value
		}
		item.CreatedAt = createdAt.Time
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return Page[AuditEventView]{}, s.internal("iterate audit events", err)
	}
	return Page[AuditEventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}
