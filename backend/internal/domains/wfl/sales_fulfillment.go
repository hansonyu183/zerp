package wfl

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/jackc/pgx/v5"
)

type salesVoucherService interface {
	Query(context.Context, string, voudomain.QueryInput) (voudomain.Page[voudomain.ListItem], error)
	Get(context.Context, string, voudomain.GetInput) (voudomain.DocumentView, error)
	CreateManagedSalesOrder(context.Context, voudomain.CreateInput, string, string) (voudomain.MutationResult, error)
	Save(context.Context, string, voudomain.SaveInput, string, string) (voudomain.MutationResult, error)
	Check(context.Context, string, voudomain.DocumentRevisionInput, string, string) (voudomain.MutationResult, error)
	Uncheck(context.Context, string, voudomain.ReverseInput, string, string) (voudomain.MutationResult, error)
	Approve(context.Context, string, voudomain.DocumentRevisionInput, string, string) (voudomain.MutationResult, error)
	Unapprove(context.Context, string, voudomain.ReverseInput, string, string) (voudomain.MutationResult, error)
	Finalize(context.Context, string, voudomain.FinalizeInput, string, string) (voudomain.MutationResult, error)
	Unfinalize(context.Context, string, voudomain.ReverseInput, string, string) (voudomain.MutationResult, error)
	ShortCloseRequest(context.Context, voudomain.ReverseInput, string, string) (voudomain.MutationResult, error)
	ShortCloseCancel(context.Context, voudomain.ReverseInput, string, string) (voudomain.MutationResult, error)
	ShortCloseConfirm(context.Context, voudomain.DocumentRevisionInput, string, string) (voudomain.MutationResult, error)
	ShortCloseUnconfirm(context.Context, voudomain.ReverseInput, string, string) (voudomain.MutationResult, error)
}

func (s *Service) SalesCreate(
	ctx context.Context, input SalesCreateInput, actorID, requestID string,
) (MutationResult, error) {
	if s.sales == nil {
		return MutationResult{}, internal("sales voucher service is unavailable", nil)
	}
	result, err := s.sales.CreateManagedSalesOrder(
		ctx, voudomain.CreateInput{Data: input.Data}, actorID, requestID,
	)
	if err != nil {
		return MutationResult{}, err
	}
	return s.salesMutation(ctx, result)
}

func (s *Service) SalesSave(
	ctx context.Context, input SalesSaveInput, actorID, requestID string,
) (MutationResult, error) {
	if s.sales == nil || !validID(input.ProcessID) || input.ProcessRevision < 1 ||
		!validID(input.DocumentID) || input.DocumentRevision < 1 {
		return MutationResult{}, validation("invalid sales workflow save", nil)
	}
	if err := s.verifySalesWorkflowDocument(
		ctx, input.ProcessID, input.ProcessRevision, input.DocumentID, StageSaleOrder,
	); err != nil {
		return MutationResult{}, err
	}
	result, err := s.sales.Save(ctx, voudomain.EntitySaleOrder, voudomain.SaveInput{
		DocumentID: input.DocumentID, Revision: input.DocumentRevision, Data: input.Data,
	}, actorID, requestID)
	if err != nil {
		return MutationResult{}, err
	}
	return s.salesMutation(ctx, result)
}

func (s *Service) SalesQuery(ctx context.Context, input QueryInput) (Page[ProcessView], error) {
	query, err := validateQuery(input)
	if err != nil {
		return Page[ProcessView]{}, err
	}
	rows, err := s.pool.Query(ctx, `SELECT p.id
		FROM wfl_process_instances p
		JOIN vou_documents d ON d.id=p.root_document_id
		WHERE p.process_type=$1
		  AND ($2='' OR d.document_no ILIKE '%'||$2||'%')
		  AND (COALESCE(cardinality($3::text[]),0)=0 OR p.status=ANY($3::text[]))
		ORDER BY p.updated_at DESC,p.id DESC LIMIT $4 OFFSET $5`,
		ProcessTypeSales, query.keyword, query.statuses, query.pageSize, query.offset)
	if err != nil {
		return Page[ProcessView]{}, internal("query sales workflows", err)
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return Page[ProcessView]{}, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	items := make([]ProcessView, 0, len(ids))
	for _, id := range ids {
		item, getErr := s.SalesGet(ctx, GetInput{ProcessID: id})
		if getErr != nil {
			return Page[ProcessView]{}, getErr
		}
		items = append(items, item)
	}
	var total int64
	err = s.pool.QueryRow(ctx, `SELECT count(*)
		FROM wfl_process_instances p
		JOIN vou_documents d ON d.id=p.root_document_id
		WHERE p.process_type=$1
		  AND ($2='' OR d.document_no ILIKE '%'||$2||'%')
		  AND (COALESCE(cardinality($3::text[]),0)=0 OR p.status=ANY($3::text[]))`,
		ProcessTypeSales, query.keyword, query.statuses).Scan(&total)
	if err != nil {
		return Page[ProcessView]{}, internal("count sales workflows", err)
	}
	return Page[ProcessView]{
		Items: items, Total: total, Page: query.page, PageSize: query.pageSize,
	}, nil
}

func (s *Service) SalesGet(ctx context.Context, input GetInput) (ProcessView, error) {
	if s.sales == nil || !validID(input.ProcessID) {
		return ProcessView{}, validation("invalid sales workflow", nil)
	}
	var view ProcessView
	err := s.pool.QueryRow(ctx, `SELECT p.id,p.process_type,p.definition_version,p.status,p.revision,
		p.root_document_id,d.document_no,p.created_at,p.created_by,p.updated_at,p.updated_by
		FROM wfl_process_instances p
		JOIN vou_documents d ON d.id=p.root_document_id
		WHERE p.id=$1 AND p.process_type=$2`, input.ProcessID, ProcessTypeSales).
		Scan(&view.ProcessID, &view.ProcessType, &view.DefinitionVersion, &view.Status,
			&view.Revision, &view.RootDocumentID, &view.RootDocumentNo,
			&view.CreatedAt, &view.CreatedBy, &view.UpdatedAt, &view.UpdatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return view, validation("sales workflow not found", nil)
	}
	if err != nil {
		return view, internal("get sales workflow", err)
	}
	rows, err := s.pool.Query(ctx, `SELECT x.document_id,d.document_no,d.entity,x.stage,
		d.status,d.revision,d.business_date,d.currency,d.total_amount_cents,
		d.created_at,d.created_by,d.reviewed_at,d.reviewed_by,d.approved_at,d.approved_by,
		COALESCE(d.parent_entity,''),COALESCE(d.parent_document_id,''),COALESCE(parent.document_no,'')
		FROM wfl_process_documents x
		JOIN vou_documents d ON d.id=x.document_id
		LEFT JOIN vou_documents parent ON parent.id=d.parent_document_id
		WHERE x.process_id=$1
		ORDER BY CASE x.stage
			WHEN 'SALE_ORDER' THEN 1 WHEN 'OUTBOUND' THEN 2
			WHEN 'DELIVERY' THEN 3 ELSE 4 END,x.sequence_no`, input.ProcessID)
	if err != nil {
		return view, internal("list sales workflow documents", err)
	}
	view.Documents = make([]DocumentSummary, 0)
	for rows.Next() {
		var item DocumentSummary
		var businessDate time.Time
		var amount int64
		if err = rows.Scan(
			&item.DocumentID, &item.DocumentNo, &item.Entity, &item.Stage,
			&item.Status, &item.Revision, &businessDate, &item.Currency, &amount,
			&item.CreatedAt, &item.CreatedBy, &item.ReviewedAt, &item.ReviewedBy,
			&item.ApprovedAt, &item.ApprovedBy,
			&item.ParentEntity, &item.ParentDocumentID, &item.ParentDocumentNo,
		); err != nil {
			rows.Close()
			return view, err
		}
		item.BusinessDate = documentLinkDate(businessDate)
		item.Amount = documentLinkAmount(amount)
		view.Documents = append(view.Documents, item)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return view, err
	}
	view.CurrentStage = salesCurrentStage(view)
	return view, nil
}

func (s *Service) SalesAction(
	ctx context.Context, action string, input ActionInput, actorID, requestID string,
) (any, error) {
	if s.sales == nil || !validID(input.ProcessID) || input.ProcessRevision < 1 {
		return nil, validation("invalid sales workflow action", nil)
	}
	if strings.HasSuffix(action, "-get") {
		entity, stage, err := salesActionEntity(action)
		if err != nil {
			return nil, err
		}
		if err = s.verifySalesWorkflowDocument(
			ctx, input.ProcessID, 0, input.DocumentID, stage,
		); err != nil {
			return nil, err
		}
		return s.sales.Get(ctx, entity, voudomain.GetInput{DocumentID: input.DocumentID})
	}
	entity, operation, stage, err := salesActionParts(action)
	if err != nil {
		return nil, err
	}
	documentID := input.DocumentID
	if stage == StageSaleOrder {
		var rootID string
		err = s.pool.QueryRow(ctx, `SELECT root_document_id FROM wfl_process_instances
			WHERE id=$1 AND process_type=$2`, input.ProcessID, ProcessTypeSales).Scan(&rootID)
		if err != nil {
			return nil, validation("sales workflow not found", nil)
		}
		if documentID == "" {
			documentID = rootID
		}
	}
	if err = s.verifySalesWorkflowDocument(
		ctx, input.ProcessID, input.ProcessRevision, documentID, stage,
	); err != nil {
		return nil, err
	}
	var result voudomain.MutationResult
	switch operation {
	case "save":
		if len(input.Data) == 0 {
			return nil, validation("sales draft data is required", nil)
		}
		var data voudomain.DraftInput
		if err = json.Unmarshal(input.Data, &data); err != nil ||
			strings.TrimSpace(data.SourceDocumentID) != "" {
			return nil, validation("sourceDocumentId is managed by workflow", nil)
		}
		if err = s.pool.QueryRow(ctx, `SELECT COALESCE(parent_document_id,'')
			FROM vou_documents WHERE id=$1`, documentID).Scan(&data.SourceDocumentID); err != nil {
			return nil, validation("sales workflow document not found", nil)
		}
		result, err = s.sales.Save(ctx, entity, voudomain.SaveInput{
			DocumentID: documentID, Revision: input.DocumentRevision, Data: data,
		}, actorID, requestID)
	case "check":
		result, err = s.sales.Check(ctx, entity, voudomain.DocumentRevisionInput{
			DocumentID: documentID, Revision: input.DocumentRevision,
		}, actorID, requestID)
	case "uncheck":
		result, err = s.sales.Uncheck(ctx, entity, voudomain.ReverseInput{
			DocumentID: documentID, Revision: input.DocumentRevision, Reason: input.Reason,
		}, actorID, requestID)
	case "approve":
		result, err = s.sales.Approve(ctx, entity, voudomain.DocumentRevisionInput{
			DocumentID: documentID, Revision: input.DocumentRevision,
		}, actorID, requestID)
	case "unapprove":
		result, err = s.sales.Unapprove(ctx, entity, voudomain.ReverseInput{
			DocumentID: documentID, Revision: input.DocumentRevision, Reason: input.Reason,
		}, actorID, requestID)
	case "finalize":
		result, err = s.sales.Finalize(ctx, entity, voudomain.FinalizeInput{
			DocumentID: documentID, Revision: input.DocumentRevision,
		}, actorID, requestID)
	case "unfinalize":
		result, err = s.sales.Unfinalize(ctx, entity, voudomain.ReverseInput{
			DocumentID: documentID, Revision: input.DocumentRevision, Reason: input.Reason,
		}, actorID, requestID)
	case "short-close-request":
		result, err = s.sales.ShortCloseRequest(ctx, voudomain.ReverseInput{
			DocumentID: documentID, Revision: input.DocumentRevision, Reason: input.Reason,
		}, actorID, requestID)
	case "short-close-cancel":
		result, err = s.sales.ShortCloseCancel(ctx, voudomain.ReverseInput{
			DocumentID: documentID, Revision: input.DocumentRevision, Reason: input.Reason,
		}, actorID, requestID)
	case "short-close-confirm":
		result, err = s.sales.ShortCloseConfirm(ctx, voudomain.DocumentRevisionInput{
			DocumentID: documentID, Revision: input.DocumentRevision,
		}, actorID, requestID)
	case "short-close-unconfirm":
		result, err = s.sales.ShortCloseUnconfirm(ctx, voudomain.ReverseInput{
			DocumentID: documentID, Revision: input.DocumentRevision, Reason: input.Reason,
		}, actorID, requestID)
	default:
		return nil, validation("invalid sales workflow action", nil)
	}
	if err != nil {
		return nil, err
	}
	return s.salesMutation(ctx, result)
}

func salesActionEntity(action string) (string, string, error) {
	prefix := strings.TrimSuffix(action, "-get")
	entity := map[string]string{
		"outbound": voudomain.EntitySaleOutbound,
		"delivery": voudomain.EntitySaleDelivery,
		"signoff":  voudomain.EntitySaleSignoff,
	}[prefix]
	stage := map[string]string{
		"outbound": StageOutbound, "delivery": StageDelivery, "signoff": StageSignoff,
	}[prefix]
	if entity == "" {
		return "", "", validation("invalid sales workflow stage", nil)
	}
	return entity, stage, nil
}

func salesActionParts(action string) (string, string, string, error) {
	rootActions := map[string]bool{
		"check": true, "uncheck": true, "approve": true, "unapprove": true,
		"finalize": true, "unfinalize": true,
		"short-close-request": true, "short-close-cancel": true,
		"short-close-confirm": true, "short-close-unconfirm": true,
	}
	if rootActions[action] {
		return voudomain.EntitySaleOrder, action, StageSaleOrder, nil
	}
	parts := strings.SplitN(action, "-", 2)
	if len(parts) != 2 {
		return "", "", "", validation("invalid sales workflow action", nil)
	}
	entity := map[string]string{
		"outbound": voudomain.EntitySaleOutbound,
		"delivery": voudomain.EntitySaleDelivery,
		"signoff":  voudomain.EntitySaleSignoff,
	}[parts[0]]
	stage := map[string]string{
		"outbound": StageOutbound, "delivery": StageDelivery, "signoff": StageSignoff,
	}[parts[0]]
	if entity == "" {
		return "", "", "", validation("invalid sales workflow stage", nil)
	}
	return entity, parts[1], stage, nil
}

func (s *Service) verifySalesWorkflowDocument(
	ctx context.Context,
	processID string,
	processRevision int64,
	documentID, stage string,
) error {
	if !validID(documentID) {
		return validation("invalid sales workflow document", nil)
	}
	var actualRevision int64
	err := s.pool.QueryRow(ctx, `SELECT p.revision
		FROM wfl_process_instances p
		JOIN wfl_process_documents x ON x.process_id=p.id
		WHERE p.id=$1 AND p.process_type=$2 AND x.document_id=$3 AND x.stage=$4`,
		processID, ProcessTypeSales, documentID, stage).Scan(&actualRevision)
	if errors.Is(err, pgx.ErrNoRows) {
		return validation("sales workflow document not found", nil)
	}
	if err != nil {
		return internal("verify sales workflow document", err)
	}
	if processRevision > 0 && processRevision != actualRevision {
		return conflict("sales workflow changed", map[string]any{"revision": actualRevision})
	}
	return nil
}

func (s *Service) salesMutation(
	ctx context.Context, result voudomain.MutationResult,
) (MutationResult, error) {
	var value MutationResult
	err := s.pool.QueryRow(ctx, `SELECT p.id,p.revision,p.status,
		COALESCE(d.parent_document_id,'')
		FROM wfl_process_instances p
		JOIN wfl_process_documents x ON x.process_id=p.id
		JOIN vou_documents d ON d.id=x.document_id
		WHERE x.document_id=$1 AND p.process_type=$2`, result.DocumentID, ProcessTypeSales).
		Scan(&value.ProcessID, &value.ProcessRevision, &value.WorkflowStatus, &value.ParentDocumentID)
	if err != nil {
		return value, internal("read sales workflow mutation", err)
	}
	value.DocumentID = result.DocumentID
	value.DocumentNo = result.DocumentNo
	value.DocumentRevision = result.Revision
	value.DocumentStatus = result.Status
	return value, nil
}

func salesCurrentStage(view ProcessView) string {
	if view.Status == StatusCompleted || view.Status == StatusShortClosed {
		return ""
	}
	for index := len(view.Documents) - 1; index >= 0; index-- {
		document := view.Documents[index]
		if document.Status != voudomain.StatusFinalized {
			return document.Stage
		}
	}
	return StageSaleOrder
}
