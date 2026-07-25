package vou

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	"github.com/hansonyu183/zerp-back/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type effectiveReferenceResolver interface {
	ResolveEffectiveReference(context.Context, pgx.Tx, string, string, string) (bobdomain.EffectiveReference, error)
	ResolveCurrentEffectiveReference(context.Context, pgx.Tx, string, string) (bobdomain.EffectiveReference, error)
}

type eventPublisher interface {
	Publish(context.Context, pgx.Tx, txevent.Event) error
}

type Service struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	resolver    effectiveReferenceResolver
	events      eventPublisher
	storage     *localStorage
	uploadTTL   time.Duration
	downloadTTL time.Duration
	logger      *slog.Logger
}

type AttachmentOptions struct {
	Root        string
	UploadTTL   time.Duration
	DownloadTTL time.Duration
}

func NewService(
	pool *pgxpool.Pool,
	resolver effectiveReferenceResolver,
	events eventPublisher,
	options AttachmentOptions,
	logger *slog.Logger,
) (*Service, error) {
	if pool == nil || resolver == nil || events == nil {
		return nil, errors.New("VOU pool, BOB resolver, and event publisher are required")
	}
	storage, err := newLocalStorage(options.Root)
	if err != nil {
		return nil, err
	}
	if options.UploadTTL <= 0 {
		options.UploadTTL = 15 * time.Minute
	}
	if options.DownloadTTL <= 0 {
		options.DownloadTTL = 5 * time.Minute
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		pool: pool, queries: dbsqlc.New(pool), resolver: resolver, events: events, storage: storage,
		uploadTTL: options.UploadTTL, downloadTTL: options.DownloadTTL, logger: logger,
	}, nil
}

type resolvedDraft struct {
	Customer, Supplier, Counterparty, Employee, FundAccount *bobdomain.EffectiveReference
	Salesperson, Purchaser, Handler, Warehouse              *bobdomain.EffectiveReference
	CustomerSettlement, SupplierSettlement                  *bobdomain.EffectiveReference
	Products                                                []bobdomain.EffectiveReference
}

func (s *Service) Create(
	ctx context.Context,
	entity string,
	input CreateInput,
	actorID, requestID string,
) (MutationResult, error) {
	draft, err := validateDraft(entity, input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	if !validID(actorID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid actor", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)

	counter, err := q.NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{
		Entity: entity, BusinessDate: dateValue(draft.BusinessDate),
	})
	if err != nil {
		return MutationResult{}, s.writeError("allocate document number", err)
	}
	documentID := newID()
	documentNo := fmt.Sprintf("%s-%s-%06d", entityPrefix(entity), draft.BusinessDate.Format("20060102"), counter)
	if err = q.InsertVouDocument(ctx, dbsqlc.InsertVouDocumentParams{
		ID: documentID, Entity: entity, DocumentNo: documentNo,
		BusinessDate: dateValue(draft.BusinessDate), Currency: draft.Currency,
		TotalAmountCents: draft.TotalAmount, Remark: draft.Remark, ActorID: actorID,
	}); err != nil {
		return MutationResult{}, s.writeError("insert document", err)
	}
	resolved, err := s.resolveDraft(ctx, tx, entity, draft, resolvedDraft{}, true)
	if err != nil {
		return MutationResult{}, err
	}
	if err = s.insertDetail(ctx, q, entity, documentID, draft, resolved); err != nil {
		return MutationResult{}, s.writeError("insert document detail", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: documentID, Entity: entity, Event: "CREATED", To: StatusDraft,
		ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"documentNo": documentNo},
	}); err != nil {
		return MutationResult{}, s.writeError("audit create", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit create", err)
	}
	return MutationResult{DocumentID: documentID, DocumentNo: documentNo, Status: StatusDraft, Revision: 1}, nil
}

func (s *Service) Save(
	ctx context.Context,
	entity string,
	input SaveInput,
	actorID, requestID string,
) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	draft, err := validateDraft(entity, input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	preserved, err := s.loadPreservedPersonnel(ctx, q, entity, input.DocumentID)
	if err != nil {
		return MutationResult{}, err
	}
	resolved, err := s.resolveDraft(ctx, tx, entity, draft, preserved, false)
	if err != nil {
		return MutationResult{}, err
	}
	if err = s.updateDetail(ctx, q, entity, input.DocumentID, draft, resolved); err != nil {
		return MutationResult{}, s.writeError("update document detail", err)
	}
	revision, err := q.UpdateVouDraft(ctx, dbsqlc.UpdateVouDraftParams{
		BusinessDate: dateValue(draft.BusinessDate), Currency: draft.Currency,
		TotalAmountCents: draft.TotalAmount, Remark: draft.Remark, ActorID: actorID,
		ID: input.DocumentID, Entity: entity, Revision: input.Revision,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorConflict, "document changed", nil, err)
	}
	if err != nil {
		return MutationResult{}, s.writeError("update draft", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: "SAVED",
		From: stringPtr(StatusDraft), To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"revision": revision},
	}); err != nil {
		return MutationResult{}, s.writeError("audit save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit save", err)
	}
	return MutationResult{
		DocumentID: input.DocumentID, DocumentNo: document.DocumentNo, Status: StatusDraft, Revision: revision,
	}, nil
}

func (s *Service) Review(
	ctx context.Context, entity string, input DocumentRevisionInput, actorID, requestID string,
) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin review", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	if err = s.validateStoredAttributes(ctx, q, entity, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	pending, err := q.CountPendingVouAttachments(ctx, input.DocumentID)
	if err != nil {
		return MutationResult{}, s.internal("count pending attachments", err)
	}
	if pending != 0 {
		return MutationResult{}, domainError(ErrorConflict, "attachments are still uploading", nil, nil)
	}
	revision, err := q.ReviewVouDocument(ctx, dbsqlc.ReviewVouDocumentParams{
		ActorID: stringPtr(actorID), ID: input.DocumentID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("review document", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: "REVIEWED",
		From: stringPtr(StatusDraft), To: StatusReviewed, ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("audit review", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit review", err)
	}
	return mutation(document, StatusReviewed, revision), nil
}

func (s *Service) Approve(
	ctx context.Context, entity string, input DocumentRevisionInput, actorID, requestID string,
) (MutationResult, error) {
	return s.forwardTransition(ctx, entity, input, actorID, requestID, StatusReviewed, StatusApproved)
}

func (s *Service) Unreview(
	ctx context.Context, entity string, input ReverseInput, actorID, requestID string,
) (MutationResult, error) {
	return s.reverseTransition(ctx, entity, input, actorID, requestID, StatusReviewed, StatusDraft)
}

func (s *Service) Unapprove(
	ctx context.Context, entity string, input ReverseInput, actorID, requestID string,
) (MutationResult, error) {
	return s.reverseTransition(ctx, entity, input, actorID, requestID, StatusApproved, StatusReviewed)
}

func (s *Service) forwardTransition(
	ctx context.Context,
	entity string,
	input DocumentRevisionInput,
	actorID, requestID, from, to string,
) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin transition", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, from); err != nil {
		return MutationResult{}, err
	}
	if err = s.validateStoredAttributes(ctx, q, entity, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	var revision int64
	switch to {
	case StatusApproved:
		revision, err = q.ApproveVouDocument(ctx, dbsqlc.ApproveVouDocumentParams{
			ActorID: stringPtr(actorID), ID: input.DocumentID, Entity: entity, Revision: input.Revision,
		})
	default:
		return MutationResult{}, domainError(ErrorInternal, "unsupported transition", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.writeError("transition document", err)
	}
	event := map[string]string{StatusApproved: "APPROVED"}[to]
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: event,
		From: &from, To: to, ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("audit transition", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit transition", err)
	}
	return mutation(document, to, revision), nil
}

func (s *Service) reverseTransition(
	ctx context.Context,
	entity string,
	input ReverseInput,
	actorID, requestID, from, to string,
) (MutationResult, error) {
	reason, err := validateReverse(input)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin reverse transition", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, from); err != nil {
		return MutationResult{}, err
	}
	var revision int64
	var event string
	switch {
	case from == StatusReviewed && to == StatusDraft:
		revision, err = q.UnreviewVouDocument(ctx, dbsqlc.UnreviewVouDocumentParams{
			ActorID: actorID, ID: input.DocumentID, Entity: entity, Revision: input.Revision,
		})
		event = "UNREVIEWED"
	case from == StatusApproved && to == StatusReviewed:
		revision, err = q.UnapproveVouDocument(ctx, dbsqlc.UnapproveVouDocumentParams{
			ActorID: actorID, ID: input.DocumentID, Entity: entity, Revision: input.Revision,
		})
		event = "UNAPPROVED"
	default:
		return MutationResult{}, domainError(ErrorInternal, "unsupported reverse transition", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.writeError("reverse transition", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: event,
		From: &from, To: to, ActorID: actorID, Reason: reason, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("audit reverse transition", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit reverse transition", err)
	}
	return mutation(document, to, revision), nil
}

func (s *Service) Execute(
	ctx context.Context, entity string, input ExecuteInput, actorID, requestID string,
) (MutationResult, error) {
	if !validEntity(entity) {
		return MutationResult{}, domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin execute", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusApproved); err != nil {
		return MutationResult{}, err
	}
	if err = s.validateStoredAttributes(ctx, q, entity, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	var summary map[string]any
	switch entity {
	case EntitySaleOrder, EntityIntermediarySaleOrder:
		execution, validationErr := validateSaleExecution(input)
		if validationErr != nil {
			return MutationResult{}, validationErr
		}
		if execution.OutboundDate.Before(document.BusinessDate.Time) {
			return MutationResult{}, domainError(ErrorValidation, "outboundDate precedes businessDate", nil, nil)
		}
		summary, err = s.applySaleExecution(ctx, tx, q, entity, document, execution)
	case EntityPurchaseOrder:
		execution, validationErr := validatePurchaseExecution(input)
		if validationErr != nil {
			return MutationResult{}, validationErr
		}
		if execution.InboundDate.Before(document.BusinessDate.Time) {
			return MutationResult{}, domainError(ErrorValidation, "inboundDate precedes businessDate", nil, nil)
		}
		summary, err = s.applyPurchaseExecution(ctx, q, document, execution)
	default:
		if err = validateFinancialExecution(input); err == nil {
			summary = map[string]any{"confirmed": true}
		}
	}
	if err != nil {
		return MutationResult{}, err
	}
	revision, err := q.ExecuteVouDocument(ctx, dbsqlc.ExecuteVouDocumentParams{
		ActorID: stringPtr(actorID), ID: input.DocumentID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("execute document", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: "EXECUTED",
		From: stringPtr(StatusApproved), To: StatusExecuted, ActorID: actorID,
		RequestID: requestID, Summary: summary,
	}); err != nil {
		return MutationResult{}, s.writeError("audit execute", err)
	}
	if err = s.events.Publish(ctx, tx, DocumentExecutedEvent{
		Entity: entity, DocumentID: input.DocumentID, DocumentNo: document.DocumentNo,
		Revision: revision, ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.eventError("publish document executed", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit execute", err)
	}
	return mutation(document, StatusExecuted, revision), nil
}

func (s *Service) Unexecute(
	ctx context.Context, entity string, input ReverseInput, actorID, requestID string,
) (MutationResult, error) {
	reason, err := validateReverse(input)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin unexecute", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusExecuted); err != nil {
		return MutationResult{}, err
	}
	summary, err := s.executionSummary(ctx, q, entity, input.DocumentID)
	if err != nil {
		return MutationResult{}, s.internal("read execution for reversal", err)
	}
	switch entity {
	case EntitySaleOrder:
		if _, err = q.ClearVouSaleOrderExecution(ctx, input.DocumentID); err == nil {
			err = q.ClearVouProductLineExecution(ctx, input.DocumentID)
		}
	case EntityIntermediarySaleOrder:
		if _, err = q.ClearVouIntermediarySaleOrderExecution(ctx, input.DocumentID); err == nil {
			err = q.ClearVouProductLineExecution(ctx, input.DocumentID)
		}
	case EntityPurchaseOrder:
		if _, err = q.ClearVouPurchaseOrderExecution(ctx, input.DocumentID); err == nil {
			err = q.ClearVouProductLineExecution(ctx, input.DocumentID)
		}
	}
	if err != nil {
		return MutationResult{}, s.writeError("clear execution", err)
	}
	revision, err := q.UnexecuteVouDocument(ctx, dbsqlc.UnexecuteVouDocumentParams{
		ActorID: actorID, ID: input.DocumentID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("unexecute document", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: "UNEXECUTED",
		From: stringPtr(StatusExecuted), To: StatusApproved, ActorID: actorID,
		Reason: reason, RequestID: requestID, Summary: summary,
	}); err != nil {
		return MutationResult{}, s.writeError("audit unexecute", err)
	}
	if err = s.events.Publish(ctx, tx, DocumentUnexecutedEvent{
		Entity: entity, DocumentID: input.DocumentID, DocumentNo: document.DocumentNo,
		Revision: revision, ActorID: actorID, RequestID: requestID, Reason: *reason,
	}); err != nil {
		return MutationResult{}, s.eventError("publish document unexecuted", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit unexecute", err)
	}
	return mutation(document, StatusApproved, revision), nil
}

func (s *Service) Query(ctx context.Context, entity string, input QueryInput) (Page[ListItem], error) {
	if !validEntity(entity) {
		return Page[ListItem]{}, domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	query, err := validateQuery(input)
	if err != nil {
		return Page[ListItem]{}, err
	}
	params := dbsqlc.CountVouDocumentsParams{
		Entity: entity, Statuses: query.Statuses, Keyword: query.Keyword, PartyObjectID: query.PartyObjectID,
		DateFrom: optionalDate(query.DateFrom), DateTo: optionalDate(query.DateTo),
	}
	total, err := s.queries.CountVouDocuments(ctx, params)
	if err != nil {
		return Page[ListItem]{}, s.internal("count documents", err)
	}
	rows, err := s.queries.ListVouDocuments(ctx, dbsqlc.ListVouDocumentsParams{
		Entity: entity, Statuses: query.Statuses, Keyword: query.Keyword, PartyObjectID: query.PartyObjectID,
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
			Status: row.Status, Revision: row.Revision, BusinessDate: formatDate(row.BusinessDate),
			PartyName: row.PartyName, Currency: row.Currency, Amount: formatMoney(row.TotalAmountCents),
			UpdatedAt: row.UpdatedAt.Time,
		})
	}
	return Page[ListItem]{Items: items, Total: total, Page: query.Page, PageSize: query.PageSize}, nil
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
	return documentView(document, data, attachmentViews(attachments)), nil
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
		items = append(items, AuditEventView{
			ID: row.ID, EventType: row.EventType, FromStatus: row.FromStatus, ToStatus: row.ToStatus,
			ActorID: row.ActorID, OccurredAt: row.OccurredAt.Time, Reason: row.Reason,
			RequestID: row.RequestID, Summary: row.Summary,
		})
	}
	return Page[AuditEventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) loadPreservedPersonnel(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string,
) (resolvedDraft, error) {
	var result resolvedDraft
	makeReference := func(
		objectID, versionID, code, name *string,
	) *bobdomain.EffectiveReference {
		if objectID == nil || versionID == nil || code == nil || name == nil {
			return nil
		}
		return &bobdomain.EffectiveReference{
			ObjectID: *objectID, Entity: bobdomain.EntityEmployee, Code: *code, VersionID: *versionID,
			Data: bobdomain.DetailView{Name: *name},
		}
	}
	switch entity {
	case EntitySaleOrder:
		detail, err := q.GetVouSaleOrderDetail(ctx, documentID)
		if err != nil {
			return result, s.internal("read sale order salesperson", err)
		}
		result.Salesperson = makeReference(
			detail.SalespersonObjectID, detail.SalespersonVersionID,
			detail.SalespersonCode, detail.SalespersonName,
		)
	case EntityPurchaseOrder:
		detail, err := q.GetVouPurchaseOrderDetail(ctx, documentID)
		if err != nil {
			return result, s.internal("read purchase order purchaser", err)
		}
		result.Purchaser = makeReference(
			detail.PurchaserObjectID, detail.PurchaserVersionID,
			detail.PurchaserCode, detail.PurchaserName,
		)
	case EntityIntermediarySaleOrder:
		detail, err := q.GetVouIntermediarySaleOrderDetail(ctx, documentID)
		if err != nil {
			return result, s.internal("read intermediary order personnel", err)
		}
		result.Salesperson = makeReference(
			detail.SalespersonObjectID, detail.SalespersonVersionID,
			detail.SalespersonCode, detail.SalespersonName,
		)
		result.Purchaser = makeReference(
			detail.PurchaserObjectID, detail.PurchaserVersionID,
			detail.PurchaserCode, detail.PurchaserName,
		)
	}
	return result, nil
}

func (s *Service) resolveDraft(
	ctx context.Context,
	tx pgx.Tx,
	entity string,
	draft validatedDraft,
	preserved resolvedDraft,
	allowPersonnelDefaults bool,
) (resolvedDraft, error) {
	var result resolvedDraft
	var err error
	resolve := func(kind string, input *ReferenceInput) (*bobdomain.EffectiveReference, error) {
		if input == nil {
			return nil, nil
		}
		ref, resolveErr := s.resolver.ResolveEffectiveReference(ctx, tx, kind, input.ObjectID, input.VersionID)
		if resolveErr != nil {
			return nil, domainError(ErrorConflict, kind+" reference is not effective", nil, resolveErr)
		}
		return &ref, nil
	}
	if result.Customer, err = resolve(bobdomain.EntityCustomer, draft.Customer); err != nil {
		return result, err
	}
	if result.Supplier, err = resolve(bobdomain.EntitySupplier, draft.Supplier); err != nil {
		return result, err
	}
	if result.Supplier != nil && result.Supplier.Data.SupplierType != bobdomain.SupplierTypeGeneral {
		return result, domainError(ErrorConflict, "supplier must be a general supplier", nil, nil)
	}
	if result.Counterparty, err = resolve(draft.CounterpartyType, draft.Counterparty); err != nil {
		return result, err
	}
	if result.Employee, err = resolve(bobdomain.EntityEmployee, draft.Employee); err != nil {
		return result, err
	}
	resolveCurrentEmployee := func(objectID, field string) (*bobdomain.EffectiveReference, error) {
		ref, resolveErr := s.resolver.ResolveCurrentEffectiveReference(
			ctx, tx, bobdomain.EntityEmployee, objectID,
		)
		if resolveErr != nil {
			return nil, domainError(ErrorConflict, field+" is not an effective employee", nil, resolveErr)
		}
		return &ref, nil
	}
	if draft.Salesperson != nil {
		result.Salesperson, err = resolve(bobdomain.EntityEmployee, draft.Salesperson)
	} else if preserved.Salesperson != nil {
		result.Salesperson = preserved.Salesperson
	} else if allowPersonnelDefaults && result.Customer != nil {
		result.Salesperson, err = resolveCurrentEmployee(
			result.Customer.Data.SalespersonEmployeeID, "customer salesperson",
		)
	} else if entity == EntitySaleOrder || entity == EntityIntermediarySaleOrder {
		err = domainError(ErrorConflict, "salesperson is required", nil, nil)
	}
	if err != nil {
		return result, err
	}
	if draft.Purchaser != nil {
		result.Purchaser, err = resolve(bobdomain.EntityEmployee, draft.Purchaser)
	} else if preserved.Purchaser != nil {
		result.Purchaser = preserved.Purchaser
	} else if allowPersonnelDefaults && result.Supplier != nil {
		result.Purchaser, err = resolveCurrentEmployee(
			result.Supplier.Data.SalespersonEmployeeID, "supplier salesperson",
		)
	} else if entity == EntityPurchaseOrder || entity == EntityIntermediarySaleOrder {
		err = domainError(ErrorConflict, "purchaser is required", nil, nil)
	}
	if err != nil {
		return result, err
	}
	if result.Handler, err = resolve(bobdomain.EntityEmployee, draft.Handler); err != nil {
		return result, err
	}
	if result.Warehouse, err = resolve(bobdomain.EntityWarehouse, draft.Warehouse); err != nil {
		return result, err
	}
	if result.FundAccount, err = resolve(bobdomain.EntityFundAccount, draft.FundAccount); err != nil {
		return result, err
	}
	if result.FundAccount != nil && result.FundAccount.Data.Currency != draft.Currency {
		return result, domainError(ErrorConflict, "fund account currency does not match document currency", nil, nil)
	}
	resolveSettlement := func(
		party *bobdomain.EffectiveReference, label string,
	) (*bobdomain.EffectiveReference, error) {
		if party == nil || party.Data.SettlementMethodID == "" ||
			party.Data.SettlementMethodVersionID == "" {
			return nil, domainError(ErrorConflict, label+" settlement method is not configured", nil, nil)
		}
		return resolve(bobdomain.EntitySettlementMethod, &ReferenceInput{
			ObjectID: party.Data.SettlementMethodID, VersionID: party.Data.SettlementMethodVersionID,
		})
	}
	switch entity {
	case EntitySaleOrder:
		result.CustomerSettlement, err = resolveSettlement(result.Customer, "customer")
	case EntityPurchaseOrder:
		result.SupplierSettlement, err = resolveSettlement(result.Supplier, "supplier")
	case EntityIntermediarySaleOrder:
		if result.CustomerSettlement, err = resolveSettlement(result.Customer, "customer"); err == nil {
			result.SupplierSettlement, err = resolveSettlement(result.Supplier, "supplier")
		}
	}
	if err != nil {
		return result, err
	}
	for _, line := range draft.ProductLines {
		product, resolveErr := resolve(bobdomain.EntityProduct, &line.Product)
		if resolveErr != nil {
			return result, resolveErr
		}
		result.Products = append(result.Products, *product)
	}
	return result, nil
}

func (s *Service) insertDetail(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string, draft validatedDraft, refs resolvedDraft,
) error {
	if err := s.writeDetail(ctx, q, entity, documentID, draft, refs, false); err != nil {
		return err
	}
	return s.replaceLines(ctx, q, entity, documentID, draft, refs)
}

func (s *Service) updateDetail(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string, draft validatedDraft, refs resolvedDraft,
) error {
	if err := s.writeDetail(ctx, q, entity, documentID, draft, refs, true); err != nil {
		return err
	}
	return s.replaceLines(ctx, q, entity, documentID, draft, refs)
}

func (s *Service) writeDetail(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string, draft validatedDraft, refs resolvedDraft, update bool,
) error {
	switch entity {
	case EntitySaleOrder:
		settlement := settlementSnapshot(refs.CustomerSettlement)
		params := dbsqlc.InsertVouSaleOrderDetailParams{
			DocumentID: documentID, CustomerObjectID: refs.Customer.ObjectID,
			CustomerVersionID: refs.Customer.VersionID, CustomerCode: refs.Customer.Code, CustomerName: refs.Customer.Data.Name,
			SalespersonObjectID:  stringPtr(refs.Salesperson.ObjectID),
			SalespersonVersionID: stringPtr(refs.Salesperson.VersionID),
			SalespersonCode:      stringPtr(refs.Salesperson.Code), SalespersonName: stringPtr(refs.Salesperson.Data.Name),
			WarehouseObjectID:  stringPtr(refs.Warehouse.ObjectID),
			WarehouseVersionID: stringPtr(refs.Warehouse.VersionID),
			WarehouseCode:      stringPtr(refs.Warehouse.Code), WarehouseName: stringPtr(refs.Warehouse.Data.Name),
			ContactName:              optionalText(refs.Customer.Data.ContactName),
			ContactPhone:             optionalText(refs.Customer.Data.ContactPhone),
			DeliveryAddress:          optionalText(refs.Customer.Data.Address),
			SettlementMethodObjectID: settlement.ObjectID, SettlementMethodVersionID: settlement.VersionID,
			SettlementMethodCode: settlement.Code, SettlementMethodName: settlement.Name,
			SettlementRuleType: settlement.RuleType, SettlementMonthOffset: settlement.MonthOffset,
			SettlementDayOfMonth: settlement.DayOfMonth, SettlementDayOffset: settlement.DayOffset,
			SettlementDescription: settlement.Description,
		}
		if update {
			rows, err := q.UpdateVouSaleOrderDetail(ctx, dbsqlc.UpdateVouSaleOrderDetailParams{
				CustomerObjectID: params.CustomerObjectID, CustomerVersionID: params.CustomerVersionID,
				CustomerCode: params.CustomerCode, CustomerName: params.CustomerName,
				SalespersonObjectID: params.SalespersonObjectID, SalespersonVersionID: params.SalespersonVersionID,
				SalespersonCode: params.SalespersonCode, SalespersonName: params.SalespersonName,
				WarehouseObjectID: params.WarehouseObjectID, WarehouseVersionID: params.WarehouseVersionID,
				WarehouseCode: params.WarehouseCode, WarehouseName: params.WarehouseName,
				ContactName: params.ContactName, ContactPhone: params.ContactPhone,
				DeliveryAddress:           params.DeliveryAddress,
				SettlementMethodObjectID:  params.SettlementMethodObjectID,
				SettlementMethodVersionID: params.SettlementMethodVersionID,
				SettlementMethodCode:      params.SettlementMethodCode, SettlementMethodName: params.SettlementMethodName,
				SettlementRuleType: params.SettlementRuleType, SettlementMonthOffset: params.SettlementMonthOffset,
				SettlementDayOfMonth: params.SettlementDayOfMonth, SettlementDayOffset: params.SettlementDayOffset,
				SettlementDescription: params.SettlementDescription, DocumentID: documentID,
			})
			return oneRow(rows, err)
		}
		return q.InsertVouSaleOrderDetail(ctx, params)
	case EntityPurchaseOrder:
		settlement := settlementSnapshot(refs.SupplierSettlement)
		params := dbsqlc.InsertVouPurchaseOrderDetailParams{
			DocumentID: documentID, SupplierObjectID: refs.Supplier.ObjectID,
			SupplierVersionID: refs.Supplier.VersionID, SupplierCode: refs.Supplier.Code, SupplierName: refs.Supplier.Data.Name,
			PurchaserObjectID:  stringPtr(refs.Purchaser.ObjectID),
			PurchaserVersionID: stringPtr(refs.Purchaser.VersionID),
			PurchaserCode:      stringPtr(refs.Purchaser.Code), PurchaserName: stringPtr(refs.Purchaser.Data.Name),
			WarehouseObjectID:  stringPtr(refs.Warehouse.ObjectID),
			WarehouseVersionID: stringPtr(refs.Warehouse.VersionID),
			WarehouseCode:      stringPtr(refs.Warehouse.Code), WarehouseName: stringPtr(refs.Warehouse.Data.Name),
			ContactName:              optionalText(refs.Supplier.Data.ContactName),
			ContactPhone:             optionalText(refs.Supplier.Data.ContactPhone),
			SettlementMethodObjectID: settlement.ObjectID, SettlementMethodVersionID: settlement.VersionID,
			SettlementMethodCode: settlement.Code, SettlementMethodName: settlement.Name,
			SettlementRuleType: settlement.RuleType, SettlementMonthOffset: settlement.MonthOffset,
			SettlementDayOfMonth: settlement.DayOfMonth, SettlementDayOffset: settlement.DayOffset,
			SettlementDescription: settlement.Description,
		}
		if update {
			rows, err := q.UpdateVouPurchaseOrderDetail(ctx, dbsqlc.UpdateVouPurchaseOrderDetailParams{
				SupplierObjectID: params.SupplierObjectID, SupplierVersionID: params.SupplierVersionID,
				SupplierCode: params.SupplierCode, SupplierName: params.SupplierName,
				PurchaserObjectID: params.PurchaserObjectID, PurchaserVersionID: params.PurchaserVersionID,
				PurchaserCode: params.PurchaserCode, PurchaserName: params.PurchaserName,
				WarehouseObjectID: params.WarehouseObjectID, WarehouseVersionID: params.WarehouseVersionID,
				WarehouseCode: params.WarehouseCode, WarehouseName: params.WarehouseName,
				ContactName: params.ContactName, ContactPhone: params.ContactPhone,
				SettlementMethodObjectID:  params.SettlementMethodObjectID,
				SettlementMethodVersionID: params.SettlementMethodVersionID,
				SettlementMethodCode:      params.SettlementMethodCode, SettlementMethodName: params.SettlementMethodName,
				SettlementRuleType: params.SettlementRuleType, SettlementMonthOffset: params.SettlementMonthOffset,
				SettlementDayOfMonth: params.SettlementDayOfMonth, SettlementDayOffset: params.SettlementDayOffset,
				SettlementDescription: params.SettlementDescription, DocumentID: documentID,
			})
			return oneRow(rows, err)
		}
		return q.InsertVouPurchaseOrderDetail(ctx, params)
	case EntityIntermediarySaleOrder:
		customerSettlement := settlementSnapshot(refs.CustomerSettlement)
		supplierSettlement := settlementSnapshot(refs.SupplierSettlement)
		params := dbsqlc.InsertVouIntermediarySaleOrderDetailParams{
			DocumentID: documentID, CustomerObjectID: refs.Customer.ObjectID,
			CustomerVersionID: refs.Customer.VersionID, CustomerCode: refs.Customer.Code, CustomerName: refs.Customer.Data.Name,
			SupplierObjectID: refs.Supplier.ObjectID, SupplierVersionID: refs.Supplier.VersionID,
			SupplierCode: refs.Supplier.Code, SupplierName: refs.Supplier.Data.Name,
			SalespersonObjectID:  stringPtr(refs.Salesperson.ObjectID),
			SalespersonVersionID: stringPtr(refs.Salesperson.VersionID),
			SalespersonCode:      stringPtr(refs.Salesperson.Code), SalespersonName: stringPtr(refs.Salesperson.Data.Name),
			PurchaserObjectID:  stringPtr(refs.Purchaser.ObjectID),
			PurchaserVersionID: stringPtr(refs.Purchaser.VersionID),
			PurchaserCode:      stringPtr(refs.Purchaser.Code), PurchaserName: stringPtr(refs.Purchaser.Data.Name),
			ContactName:                       optionalText(refs.Customer.Data.ContactName),
			ContactPhone:                      optionalText(refs.Customer.Data.ContactPhone),
			DeliveryAddress:                   optionalText(refs.Customer.Data.Address),
			CustomerSettlementMethodObjectID:  customerSettlement.ObjectID,
			CustomerSettlementMethodVersionID: customerSettlement.VersionID,
			CustomerSettlementMethodCode:      customerSettlement.Code,
			CustomerSettlementMethodName:      customerSettlement.Name,
			CustomerSettlementRuleType:        customerSettlement.RuleType,
			CustomerSettlementMonthOffset:     customerSettlement.MonthOffset,
			CustomerSettlementDayOfMonth:      customerSettlement.DayOfMonth,
			CustomerSettlementDayOffset:       customerSettlement.DayOffset,
			CustomerSettlementDescription:     customerSettlement.Description,
			SupplierSettlementMethodObjectID:  supplierSettlement.ObjectID,
			SupplierSettlementMethodVersionID: supplierSettlement.VersionID,
			SupplierSettlementMethodCode:      supplierSettlement.Code,
			SupplierSettlementMethodName:      supplierSettlement.Name,
			SupplierSettlementRuleType:        supplierSettlement.RuleType,
			SupplierSettlementMonthOffset:     supplierSettlement.MonthOffset,
			SupplierSettlementDayOfMonth:      supplierSettlement.DayOfMonth,
			SupplierSettlementDayOffset:       supplierSettlement.DayOffset,
			SupplierSettlementDescription:     supplierSettlement.Description,
		}
		if update {
			rows, err := q.UpdateVouIntermediarySaleOrderDetail(ctx, dbsqlc.UpdateVouIntermediarySaleOrderDetailParams{
				CustomerObjectID: params.CustomerObjectID, CustomerVersionID: params.CustomerVersionID,
				CustomerCode: params.CustomerCode, CustomerName: params.CustomerName,
				SupplierObjectID: params.SupplierObjectID, SupplierVersionID: params.SupplierVersionID,
				SupplierCode: params.SupplierCode, SupplierName: params.SupplierName,
				SalespersonObjectID: params.SalespersonObjectID, SalespersonVersionID: params.SalespersonVersionID,
				SalespersonCode: params.SalespersonCode, SalespersonName: params.SalespersonName,
				PurchaserObjectID: params.PurchaserObjectID, PurchaserVersionID: params.PurchaserVersionID,
				PurchaserCode: params.PurchaserCode, PurchaserName: params.PurchaserName,
				ContactName: params.ContactName, ContactPhone: params.ContactPhone,
				DeliveryAddress:                   params.DeliveryAddress,
				CustomerSettlementMethodObjectID:  params.CustomerSettlementMethodObjectID,
				CustomerSettlementMethodVersionID: params.CustomerSettlementMethodVersionID,
				CustomerSettlementMethodCode:      params.CustomerSettlementMethodCode,
				CustomerSettlementMethodName:      params.CustomerSettlementMethodName,
				CustomerSettlementRuleType:        params.CustomerSettlementRuleType,
				CustomerSettlementMonthOffset:     params.CustomerSettlementMonthOffset,
				CustomerSettlementDayOfMonth:      params.CustomerSettlementDayOfMonth,
				CustomerSettlementDayOffset:       params.CustomerSettlementDayOffset,
				CustomerSettlementDescription:     params.CustomerSettlementDescription,
				SupplierSettlementMethodObjectID:  params.SupplierSettlementMethodObjectID,
				SupplierSettlementMethodVersionID: params.SupplierSettlementMethodVersionID,
				SupplierSettlementMethodCode:      params.SupplierSettlementMethodCode,
				SupplierSettlementMethodName:      params.SupplierSettlementMethodName,
				SupplierSettlementRuleType:        params.SupplierSettlementRuleType,
				SupplierSettlementMonthOffset:     params.SupplierSettlementMonthOffset,
				SupplierSettlementDayOfMonth:      params.SupplierSettlementDayOfMonth,
				SupplierSettlementDayOffset:       params.SupplierSettlementDayOffset,
				SupplierSettlementDescription:     params.SupplierSettlementDescription,
				DocumentID:                        documentID,
			})
			return oneRow(rows, err)
		}
		return q.InsertVouIntermediarySaleOrderDetail(ctx, params)
	case EntityReceipt, EntityPayment:
		counterparty := refs.Counterparty
		if entity == EntityReceipt {
			params := dbsqlc.InsertVouReceiptDetailParams{
				DocumentID: documentID, CounterpartyEntity: draft.CounterpartyType,
				CounterpartyObjectID: counterparty.ObjectID, CounterpartyVersionID: counterparty.VersionID,
				CounterpartyCode: counterparty.Code, CounterpartyName: counterparty.Data.Name,
				FundAccountObjectID: refs.FundAccount.ObjectID, FundAccountVersionID: refs.FundAccount.VersionID,
				FundAccountCode: refs.FundAccount.Code, FundAccountName: refs.FundAccount.Data.Name,
				HandlerObjectID: stringPtr(refs.Handler.ObjectID), HandlerVersionID: stringPtr(refs.Handler.VersionID),
				HandlerCode: stringPtr(refs.Handler.Code), HandlerName: stringPtr(refs.Handler.Data.Name),
			}
			if update {
				rows, err := q.UpdateVouReceiptDetail(ctx, dbsqlc.UpdateVouReceiptDetailParams{
					CounterpartyEntity: params.CounterpartyEntity, CounterpartyObjectID: params.CounterpartyObjectID,
					CounterpartyVersionID: params.CounterpartyVersionID, CounterpartyCode: params.CounterpartyCode,
					CounterpartyName: params.CounterpartyName, FundAccountObjectID: params.FundAccountObjectID,
					FundAccountVersionID: params.FundAccountVersionID, FundAccountCode: params.FundAccountCode,
					FundAccountName: params.FundAccountName,
					HandlerObjectID: params.HandlerObjectID, HandlerVersionID: params.HandlerVersionID,
					HandlerCode: params.HandlerCode, HandlerName: params.HandlerName, DocumentID: documentID,
				})
				return oneRow(rows, err)
			}
			return q.InsertVouReceiptDetail(ctx, params)
		}
		params := dbsqlc.InsertVouPaymentDetailParams{
			DocumentID: documentID, CounterpartyEntity: draft.CounterpartyType,
			CounterpartyObjectID: counterparty.ObjectID, CounterpartyVersionID: counterparty.VersionID,
			CounterpartyCode: counterparty.Code, CounterpartyName: counterparty.Data.Name,
			FundAccountObjectID: refs.FundAccount.ObjectID, FundAccountVersionID: refs.FundAccount.VersionID,
			FundAccountCode: refs.FundAccount.Code, FundAccountName: refs.FundAccount.Data.Name,
			HandlerObjectID: stringPtr(refs.Handler.ObjectID), HandlerVersionID: stringPtr(refs.Handler.VersionID),
			HandlerCode: stringPtr(refs.Handler.Code), HandlerName: stringPtr(refs.Handler.Data.Name),
		}
		if update {
			rows, err := q.UpdateVouPaymentDetail(ctx, dbsqlc.UpdateVouPaymentDetailParams{
				CounterpartyEntity: params.CounterpartyEntity, CounterpartyObjectID: params.CounterpartyObjectID,
				CounterpartyVersionID: params.CounterpartyVersionID, CounterpartyCode: params.CounterpartyCode,
				CounterpartyName: params.CounterpartyName, FundAccountObjectID: params.FundAccountObjectID,
				FundAccountVersionID: params.FundAccountVersionID, FundAccountCode: params.FundAccountCode,
				FundAccountName: params.FundAccountName,
				HandlerObjectID: params.HandlerObjectID, HandlerVersionID: params.HandlerVersionID,
				HandlerCode: params.HandlerCode, HandlerName: params.HandlerName, DocumentID: documentID,
			})
			return oneRow(rows, err)
		}
		return q.InsertVouPaymentDetail(ctx, params)
	case EntityExpenseReimbursement:
		params := dbsqlc.InsertVouExpenseReimbursementDetailParams{
			DocumentID: documentID, EmployeeObjectID: refs.Employee.ObjectID,
			EmployeeVersionID: refs.Employee.VersionID, EmployeeCode: refs.Employee.Code,
			EmployeeName: refs.Employee.Data.Name, FundAccountObjectID: refs.FundAccount.ObjectID,
			FundAccountVersionID: refs.FundAccount.VersionID, FundAccountCode: refs.FundAccount.Code,
			FundAccountName: refs.FundAccount.Data.Name,
		}
		if update {
			rows, err := q.UpdateVouExpenseReimbursementDetail(ctx, dbsqlc.UpdateVouExpenseReimbursementDetailParams{
				EmployeeObjectID: params.EmployeeObjectID, EmployeeVersionID: params.EmployeeVersionID,
				EmployeeCode: params.EmployeeCode, EmployeeName: params.EmployeeName,
				FundAccountObjectID: params.FundAccountObjectID, FundAccountVersionID: params.FundAccountVersionID,
				FundAccountCode: params.FundAccountCode, FundAccountName: params.FundAccountName, DocumentID: documentID,
			})
			return oneRow(rows, err)
		}
		return q.InsertVouExpenseReimbursementDetail(ctx, params)
	case EntityOtherIncome:
		var ce, co, cv, cc, cn *string
		if refs.Counterparty != nil {
			ce, co, cv, cc, cn = stringPtr(draft.CounterpartyType), stringPtr(refs.Counterparty.ObjectID),
				stringPtr(refs.Counterparty.VersionID), stringPtr(refs.Counterparty.Code), stringPtr(refs.Counterparty.Data.Name)
		}
		params := dbsqlc.InsertVouOtherIncomeDetailParams{
			DocumentID: documentID, SourceName: draft.SourceName, CounterpartyEntity: ce,
			CounterpartyObjectID: co, CounterpartyVersionID: cv, CounterpartyCode: cc, CounterpartyName: cn,
			FundAccountObjectID: refs.FundAccount.ObjectID, FundAccountVersionID: refs.FundAccount.VersionID,
			FundAccountCode: refs.FundAccount.Code, FundAccountName: refs.FundAccount.Data.Name,
			HandlerObjectID: stringPtr(refs.Handler.ObjectID), HandlerVersionID: stringPtr(refs.Handler.VersionID),
			HandlerCode: stringPtr(refs.Handler.Code), HandlerName: stringPtr(refs.Handler.Data.Name),
		}
		if update {
			rows, err := q.UpdateVouOtherIncomeDetail(ctx, dbsqlc.UpdateVouOtherIncomeDetailParams{
				SourceName: params.SourceName, CounterpartyEntity: ce, CounterpartyObjectID: co,
				CounterpartyVersionID: cv, CounterpartyCode: cc, CounterpartyName: cn,
				FundAccountObjectID: params.FundAccountObjectID, FundAccountVersionID: params.FundAccountVersionID,
				FundAccountCode: params.FundAccountCode, FundAccountName: params.FundAccountName,
				HandlerObjectID: params.HandlerObjectID, HandlerVersionID: params.HandlerVersionID,
				HandlerCode: params.HandlerCode, HandlerName: params.HandlerName, DocumentID: documentID,
			})
			return oneRow(rows, err)
		}
		return q.InsertVouOtherIncomeDetail(ctx, params)
	}
	return domainError(ErrorValidation, "invalid entity", nil, nil)
}

func (s *Service) replaceLines(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string, draft validatedDraft, refs resolvedDraft,
) error {
	if len(draft.ProductLines) > 0 {
		if err := q.DeleteVouProductLines(ctx, documentID); err != nil {
			return err
		}
		for index, line := range draft.ProductLines {
			ref := refs.Products[index]
			if err := q.InsertVouProductLine(ctx, dbsqlc.InsertVouProductLineParams{
				ID: newID(), DocumentID: documentID, DocumentEntity: entity, LineNo: int32(index + 1),
				ProductObjectID: ref.ObjectID, ProductVersionID: ref.VersionID,
				ProductCode: ref.Code, ProductName: ref.Data.Name, ProductUnit: ref.Data.Unit,
				OrderedQtyMicros: line.Quantity, UnitPriceCents: line.UnitPrice, LineAmountCents: line.LineAmount,
				PurchaseUnitPriceCents: line.PurchaseUnitPrice, Remark: line.Remark,
			}); err != nil {
				return err
			}
		}
	}
	if entity == EntityExpenseReimbursement {
		if err := q.DeleteVouExpenseLines(ctx, documentID); err != nil {
			return err
		}
		for index, line := range draft.ExpenseLines {
			if err := q.InsertVouExpenseLine(ctx, dbsqlc.InsertVouExpenseLineParams{
				ID: newID(), DocumentID: documentID, LineNo: int32(index + 1),
				Category: line.Category, Description: line.Description, AmountCents: line.Amount,
				Remark: line.Remark,
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) validateStoredAttributes(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string,
) error {
	missing := false
	switch entity {
	case EntitySaleOrder:
		detail, err := q.GetVouSaleOrderDetail(ctx, documentID)
		if err != nil {
			return s.internal("read sale order attributes", err)
		}
		missing = detail.SalespersonObjectID == nil || detail.WarehouseObjectID == nil ||
			detail.SettlementMethodObjectID == nil
	case EntityPurchaseOrder:
		detail, err := q.GetVouPurchaseOrderDetail(ctx, documentID)
		if err != nil {
			return s.internal("read purchase order attributes", err)
		}
		missing = detail.PurchaserObjectID == nil || detail.WarehouseObjectID == nil ||
			detail.SettlementMethodObjectID == nil
	case EntityIntermediarySaleOrder:
		detail, err := q.GetVouIntermediarySaleOrderDetail(ctx, documentID)
		if err != nil {
			return s.internal("read intermediary order attributes", err)
		}
		missing = detail.SalespersonObjectID == nil || detail.PurchaserObjectID == nil ||
			detail.CustomerSettlementMethodObjectID == nil ||
			detail.SupplierSettlementMethodObjectID == nil
		if !missing {
			lines, lineErr := q.ListVouProductLines(ctx, documentID)
			if lineErr != nil {
				return s.internal("read intermediary purchase prices", lineErr)
			}
			for _, line := range lines {
				if line.PurchaseUnitPriceCents == nil {
					missing = true
					break
				}
			}
		}
	case EntityReceipt:
		detail, err := q.GetVouReceiptDetail(ctx, documentID)
		if err != nil {
			return s.internal("read receipt attributes", err)
		}
		missing = detail.HandlerObjectID == nil
	case EntityPayment:
		detail, err := q.GetVouPaymentDetail(ctx, documentID)
		if err != nil {
			return s.internal("read payment attributes", err)
		}
		missing = detail.HandlerObjectID == nil
	case EntityOtherIncome:
		detail, err := q.GetVouOtherIncomeDetail(ctx, documentID)
		if err != nil {
			return s.internal("read other income attributes", err)
		}
		missing = detail.HandlerObjectID == nil
	case EntityExpenseReimbursement:
		return nil
	default:
		return domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	if missing {
		return domainError(
			ErrorConflict,
			"document attributes are incomplete; return to draft and save before continuing",
			nil,
			nil,
		)
	}
	return nil
}

func (s *Service) applySaleExecution(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	entity string,
	document dbsqlc.VouDocument,
	execution validatedSaleExecution,
) (map[string]any, error) {
	platform, err := s.resolver.ResolveEffectiveReference(
		ctx, tx, bobdomain.EntitySupplier, execution.Platform.ObjectID, execution.Platform.VersionID,
	)
	if err != nil || platform.Data.SupplierType != bobdomain.SupplierTypeLogisticsPlatform {
		return nil, domainError(ErrorConflict, "platform is not an effective logistics platform", nil, err)
	}
	vehicle, err := s.resolver.ResolveEffectiveReference(
		ctx, tx, bobdomain.EntityVehicle, execution.Vehicle.ObjectID, execution.Vehicle.VersionID,
	)
	if err != nil {
		return nil, domainError(ErrorConflict, "vehicle is not effective", nil, err)
	}
	if vehicle.Data.PlatformObjectID != platform.ObjectID {
		return nil, domainError(ErrorConflict, "vehicle does not belong to platform", nil, nil)
	}
	lines, err := q.ListVouProductLines(ctx, document.ID)
	if err != nil {
		return nil, s.internal("list sale lines", err)
	}
	if len(lines) != len(execution.Lines) {
		return nil, domainError(ErrorValidation, "execution lines do not match document", nil, nil)
	}
	byID := make(map[string]fixedSaleExecutionLine, len(execution.Lines))
	for _, line := range execution.Lines {
		byID[line.LineID] = line
	}
	hasDifference := false
	for _, line := range lines {
		actual, ok := byID[line.ID]
		if !ok || actual.Outbound > line.OrderedQtyMicros {
			return nil, domainError(ErrorValidation, "execution lines do not match ordered quantities", nil, nil)
		}
		if actual.Outbound < line.OrderedQtyMicros {
			hasDifference = true
		}
		rows, updateErr := q.SetVouSaleLineExecution(ctx, dbsqlc.SetVouSaleLineExecutionParams{
			OutboundQtyMicros: int64Ptr(actual.Outbound), SignedQtyMicros: int64Ptr(actual.Signed),
			RejectedQtyMicros: int64Ptr(actual.Rejected), LossQtyMicros: int64Ptr(actual.Loss),
			ID: line.ID, DocumentID: document.ID,
		})
		if updateErr != nil || rows != 1 {
			return nil, s.writeError("set sale line execution", updateErr)
		}
	}
	if hasDifference && execution.DifferenceReason == nil {
		return nil, domainError(ErrorValidation, "differenceReason is required", nil, nil)
	}
	if !hasDifference {
		execution.DifferenceReason = nil
	}
	switch entity {
	case EntitySaleOrder:
		rows, updateErr := q.SetVouSaleOrderExecution(ctx, dbsqlc.SetVouSaleOrderExecutionParams{
			OutboundDate: dateValue(execution.OutboundDate), SignoffDate: dateValue(execution.SignoffDate),
			PlatformObjectID: stringPtr(platform.ObjectID), PlatformVersionID: stringPtr(platform.VersionID),
			PlatformCode: stringPtr(platform.Code), PlatformName: stringPtr(platform.Data.Name),
			VehicleObjectID: stringPtr(vehicle.ObjectID), VehicleVersionID: stringPtr(vehicle.VersionID),
			VehicleCode: stringPtr(vehicle.Code), VehicleName: stringPtr(vehicle.Data.Name), VehiclePlateNumber: stringPtr(vehicle.Data.PlateNumber),
			DifferenceReason: execution.DifferenceReason, DocumentID: document.ID,
		})
		if updateErr != nil || rows != 1 {
			return nil, s.writeError("set sale execution", updateErr)
		}
	case EntityIntermediarySaleOrder:
		rows, updateErr := q.SetVouIntermediarySaleOrderExecution(ctx, dbsqlc.SetVouIntermediarySaleOrderExecutionParams{
			OutboundDate: dateValue(execution.OutboundDate), SignoffDate: dateValue(execution.SignoffDate),
			PlatformObjectID: stringPtr(platform.ObjectID), PlatformVersionID: stringPtr(platform.VersionID),
			PlatformCode: stringPtr(platform.Code), PlatformName: stringPtr(platform.Data.Name),
			VehicleObjectID: stringPtr(vehicle.ObjectID), VehicleVersionID: stringPtr(vehicle.VersionID),
			VehicleCode: stringPtr(vehicle.Code), VehicleName: stringPtr(vehicle.Data.Name), VehiclePlateNumber: stringPtr(vehicle.Data.PlateNumber),
			DifferenceReason: execution.DifferenceReason, DocumentID: document.ID,
		})
		if updateErr != nil || rows != 1 {
			return nil, s.writeError("set intermediary execution", updateErr)
		}
	}
	return map[string]any{
		"outboundDate": execution.OutboundDate.Format(dateLayout),
		"signoffDate":  execution.SignoffDate.Format(dateLayout), "lineCount": len(lines),
	}, nil
}

func (s *Service) applyPurchaseExecution(
	ctx context.Context,
	q *dbsqlc.Queries,
	document dbsqlc.VouDocument,
	execution validatedPurchaseExecution,
) (map[string]any, error) {
	lines, err := q.ListVouProductLines(ctx, document.ID)
	if err != nil {
		return nil, s.internal("list purchase lines", err)
	}
	if len(lines) != len(execution.Lines) {
		return nil, domainError(ErrorValidation, "execution lines do not match document", nil, nil)
	}
	byID := make(map[string]fixedPurchaseExecutionLine, len(execution.Lines))
	for _, line := range execution.Lines {
		byID[line.LineID] = line
	}
	hasDifference := false
	for _, line := range lines {
		actual, ok := byID[line.ID]
		if !ok || actual.Inbound > line.OrderedQtyMicros {
			return nil, domainError(ErrorValidation, "execution lines do not match ordered quantities", nil, nil)
		}
		if actual.Inbound < line.OrderedQtyMicros {
			hasDifference = true
		}
		rows, updateErr := q.SetVouPurchaseLineExecution(ctx, dbsqlc.SetVouPurchaseLineExecutionParams{
			InboundQtyMicros: int64Ptr(actual.Inbound), ID: line.ID, DocumentID: document.ID,
		})
		if updateErr != nil || rows != 1 {
			return nil, s.writeError("set purchase line execution", updateErr)
		}
	}
	if hasDifference && execution.DifferenceReason == nil {
		return nil, domainError(ErrorValidation, "differenceReason is required", nil, nil)
	}
	if !hasDifference {
		execution.DifferenceReason = nil
	}
	rows, err := q.SetVouPurchaseOrderExecution(ctx, dbsqlc.SetVouPurchaseOrderExecutionParams{
		InboundDate: dateValue(execution.InboundDate), DifferenceReason: execution.DifferenceReason,
		DocumentID: document.ID,
	})
	if err != nil || rows != 1 {
		return nil, s.writeError("set purchase execution", err)
	}
	return map[string]any{"inboundDate": execution.InboundDate.Format(dateLayout), "lineCount": len(lines)}, nil
}

func (s *Service) executionSummary(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string,
) (map[string]any, error) {
	data, err := s.loadData(ctx, q, dbsqlc.VouDocument{ID: documentID, Entity: entity})
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	var summary map[string]any
	if err = json.Unmarshal(encoded, &summary); err != nil {
		return nil, err
	}
	return summary, nil
}

type auditInput struct {
	DocumentID, Entity, Event, To, ActorID, RequestID string
	From, Reason                                      *string
	Summary                                           map[string]any
}

func insertAudit(ctx context.Context, q *dbsqlc.Queries, input auditInput) error {
	if input.Summary == nil {
		input.Summary = map[string]any{}
	}
	encoded, err := json.Marshal(input.Summary)
	if err != nil {
		return err
	}
	return q.InsertVouAuditEvent(ctx, dbsqlc.InsertVouAuditEventParams{
		ID: newID(), DocumentID: input.DocumentID, Entity: input.Entity, EventType: input.Event,
		FromStatus: input.From, ToStatus: input.To, ActorID: input.ActorID, Reason: input.Reason,
		RequestID: input.RequestID, Summary: encoded,
	})
}

func documentWriteConflict(err error, actualRevision, expectedRevision int64, actualStatus, expectedStatus string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorValidation, "document not found", nil, nil)
	}
	if err != nil {
		return err
	}
	if actualRevision != expectedRevision || actualStatus != expectedStatus {
		return domainError(ErrorConflict, "document changed", map[string]any{
			"revision": actualRevision, "status": actualStatus,
		}, nil)
	}
	return nil
}

func mutation(document dbsqlc.VouDocument, status string, revision int64) MutationResult {
	return MutationResult{
		DocumentID: document.ID, DocumentNo: document.DocumentNo, Status: status, Revision: revision,
	}
}

func entityPrefix(entity string) string {
	return map[string]string{
		EntitySaleOrder: "SO", EntityPurchaseOrder: "PO", EntityIntermediarySaleOrder: "ISO",
		EntityReceipt: "REC", EntityPayment: "PAY", EntityExpenseReimbursement: "ER", EntityOtherIncome: "OI",
	}[entity]
}

func dateValue(value time.Time) pgtype.Date {
	return pgtype.Date{Time: value, Valid: true}
}

func optionalDate(value *time.Time) pgtype.Date {
	if value == nil {
		return pgtype.Date{}
	}
	return dateValue(*value)
}

func formatDate(value pgtype.Date) string {
	if !value.Valid {
		return ""
	}
	return value.Time.Format(dateLayout)
}

func stringPtr(value string) *string { return &value }
func int64Ptr(value int64) *int64    { return &value }

type settlementSnapshotFields struct {
	ObjectID, VersionID, Code, Name, RuleType, Description *string
	MonthOffset, DayOfMonth, DayOffset                     *int32
}

func settlementSnapshot(reference *bobdomain.EffectiveReference) settlementSnapshotFields {
	if reference == nil {
		return settlementSnapshotFields{}
	}
	return settlementSnapshotFields{
		ObjectID: stringPtr(reference.ObjectID), VersionID: stringPtr(reference.VersionID),
		Code: stringPtr(reference.Code), Name: stringPtr(reference.Data.Name),
		RuleType:    stringPtr(reference.Data.RuleType),
		MonthOffset: int32Ptr(reference.Data.MonthOffset),
		DayOfMonth:  reference.Data.DayOfMonth,
		DayOffset:   int32Ptr(reference.Data.DayOffset),
		Description: optionalText(reference.Data.Description),
	}
}

func int32Ptr(value int32) *int32 { return &value }
func newID() string               { return ulid.Make().String() }

func oneRow(rows int64, err error) error {
	if err != nil {
		return err
	}
	if rows != 1 {
		return domainError(ErrorConflict, "document detail changed", nil, nil)
	}
	return nil
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
