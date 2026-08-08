package wfl

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/jackc/pgx/v5"
)

type purchaseVoucherService interface {
	Query(context.Context, string, voudomain.QueryInput) (voudomain.Page[voudomain.ListItem], error)
	Get(context.Context, string, voudomain.GetInput) (voudomain.DocumentView, error)
	CreateManagedPurchaseOrder(context.Context, voudomain.CreateInput, string, string) (voudomain.MutationResult, error)
	CreatePurchaseInbound(context.Context, voudomain.CreateInput, string, string) (voudomain.MutationResult, error)
	Save(context.Context, string, voudomain.SaveInput, string, string) (voudomain.MutationResult, error)
	SavePurchaseInbound(context.Context, voudomain.SaveInput, string, string) (voudomain.MutationResult, error)
	DeletePurchaseInbound(context.Context, voudomain.ReverseInput, string, string) (voudomain.MutationResult, error)
	Check(context.Context, string, voudomain.DocumentRevisionInput, string, string) (voudomain.MutationResult, error)
	Uncheck(context.Context, string, voudomain.ReverseInput, string, string) (voudomain.MutationResult, error)
	Approve(context.Context, string, voudomain.DocumentRevisionInput, string, string) (voudomain.MutationResult, error)
	Unapprove(context.Context, string, voudomain.ReverseInput, string, string) (voudomain.MutationResult, error)
	PurchaseShortCloseRequest(context.Context, voudomain.ReverseInput, string, string) (voudomain.MutationResult, error)
	PurchaseShortCloseCancel(context.Context, voudomain.ReverseInput, string, string) (voudomain.MutationResult, error)
	PurchaseShortCloseConfirm(context.Context, voudomain.DocumentRevisionInput, string, string) (voudomain.MutationResult, error)
	PurchaseShortCloseUnconfirm(context.Context, voudomain.ReverseInput, string, string) (voudomain.MutationResult, error)
}

func (s *Service) PurchaseCreate(
	ctx context.Context, input SalesCreateInput, actorID, requestID string,
) (MutationResult, error) {
	if s.purchase == nil {
		return MutationResult{}, internal("purchase voucher service is unavailable", nil)
	}
	result, err := s.purchase.CreateManagedPurchaseOrder(
		ctx, voudomain.CreateInput{Data: input.Data}, actorID, requestID,
	)
	if err != nil {
		return MutationResult{}, err
	}
	return s.purchaseMutation(ctx, result)
}

func (s *Service) PurchaseSave(
	ctx context.Context, input SalesSaveInput, actorID, requestID string,
) (MutationResult, error) {
	if err := s.verifyPurchaseDocument(
		ctx, input.ProcessID, input.ProcessRevision, input.DocumentID, StagePurchaseOrder,
	); err != nil {
		return MutationResult{}, err
	}
	result, err := s.purchase.Save(ctx, voudomain.EntityPurchaseOrder, voudomain.SaveInput{
		DocumentID: input.DocumentID, Revision: input.DocumentRevision, Data: input.Data,
	}, actorID, requestID)
	if err != nil {
		return MutationResult{}, err
	}
	return s.purchaseMutation(ctx, result)
}

func (s *Service) PurchaseQuery(ctx context.Context, input QueryInput) (Page[PurchaseProcessListItem], error) {
	query, err := validateQuery(input)
	if err != nil {
		return Page[PurchaseProcessListItem]{}, err
	}
	rows, err := s.queries.ListPurchaseWorkflowSummaries(ctx, sqlc.ListPurchaseWorkflowSummariesParams{
		Keyword: query.keyword, Statuses: query.statuses,
		PageSize: int32(query.pageSize), PageOffset: query.offset,
	})
	if err != nil {
		return Page[PurchaseProcessListItem]{}, internal("query purchase workflows", err)
	}
	items := make([]PurchaseProcessListItem, len(rows))
	ids := make([]string, len(rows))
	orderIDs := make([]string, len(rows))
	indexByID := make(map[string]int, len(rows))
	for index, row := range rows {
		ids[index], orderIDs[index], indexByID[row.ProcessID] = row.ProcessID, row.RootDocumentID, index
		items[index] = PurchaseProcessListItem{
			ProcessListItem: ProcessListItem{
				ProcessID: row.ProcessID, ProcessType: row.ProcessType, Status: row.Status,
				Revision: row.Revision, RootDocumentID: row.RootDocumentID,
				RootDocumentNo: row.RootDocumentNo, CurrentStage: row.CurrentStage,
				BusinessDate: documentLinkDate(row.BusinessDate.Time), PartyName: row.PartyName,
				Currency: row.Currency, Amount: documentLinkAmount(row.TotalAmountCents),
				UpdatedAt: row.UpdatedAt.Time,
			},
			ProgressGroups: make([]PurchaseProgressGroup, 0),
			Summary:        voudomain.PurchaseKgSummary{Unit: "KG"},
		}
	}
	if len(ids) > 0 {
		summaryRows, summaryErr := s.queries.ListPurchaseOrderKgSummaries(ctx, orderIDs)
		if summaryErr != nil {
			return Page[PurchaseProcessListItem]{}, internal("summarize purchase workflow kg progress", summaryErr)
		}
		indexByOrderID := make(map[string]int, len(rows))
		for index, row := range rows {
			indexByOrderID[row.RootDocumentID] = index
		}
		for _, row := range summaryRows {
			index, ok := indexByOrderID[row.OrderID]
			if !ok {
				continue
			}
			items[index].Summary = voudomain.PurchaseKgSummary{
				Unit: "KG", ExcludedPackaging: row.ExcludedPackaging,
				OrderedQuantity:          workflowQuantity(row.OrderedQuantityMicros),
				InboundQuantity:          workflowQuantity(row.InboundQuantityMicros),
				ReturnProcessingQuantity: workflowQuantity(row.ReturnProcessingQuantityMicros),
				NetInboundQuantity:       workflowQuantity(row.NetInboundQuantityMicros),
			}
		}
		progressRows, progressErr := s.queries.ListPurchaseWorkflowProgress(ctx, ids)
		if progressErr != nil {
			return Page[PurchaseProcessListItem]{}, internal("summarize purchase workflow progress", progressErr)
		}
		for _, row := range progressRows {
			index, ok := indexByID[row.ProcessID]
			if !ok {
				continue
			}
			items[index].ProgressGroups = append(items[index].ProgressGroups, PurchaseProgressGroup{
				Unit: row.ProductUnit, ProductCount: row.ProductCount,
				OrderedQuantity:           workflowQuantity(row.OrderedQuantity),
				InboundProcessingQuantity: workflowQuantity(row.InboundProcessingQuantity),
				FinalizedInboundQuantity:  workflowQuantity(row.FinalizedInboundQuantity),
				ReturnProcessingQuantity:  workflowQuantity(row.ReturnProcessingQuantity),
				ReturnedQuantity:          workflowQuantity(row.ReturnedQuantity),
				NetInboundQuantity:        workflowQuantity(row.NetInboundQuantity),
				RemainingQuantity:         workflowQuantity(row.RemainingQuantity),
			})
		}
	}
	total, err := s.queries.CountPurchaseWorkflowSummaries(ctx, sqlc.CountPurchaseWorkflowSummariesParams{
		Keyword: query.keyword, Statuses: query.statuses,
	})
	if err != nil {
		return Page[PurchaseProcessListItem]{}, internal("count purchase workflows", err)
	}
	return Page[PurchaseProcessListItem]{
		Items: items, Total: total, Page: query.page, PageSize: query.pageSize,
	}, nil
}

func (s *Service) PurchaseGet(ctx context.Context, input GetInput) (ProcessView, error) {
	if s.purchase == nil || !validID(input.ProcessID) {
		return ProcessView{}, validation("invalid purchase workflow", nil)
	}
	var view ProcessView
	err := s.pool.QueryRow(ctx, `SELECT p.id,p.process_type,p.definition_version,p.status,p.revision,
		p.root_document_id,d.document_no,p.created_at,p.created_by,p.updated_at,p.updated_by
		FROM wfl_process_instances p JOIN vou_documents d ON d.id=p.root_document_id
		WHERE p.id=$1 AND p.process_type=$2`, input.ProcessID, ProcessTypePurchase).
		Scan(&view.ProcessID, &view.ProcessType, &view.DefinitionVersion, &view.Status,
			&view.Revision, &view.RootDocumentID, &view.RootDocumentNo,
			&view.CreatedAt, &view.CreatedBy, &view.UpdatedAt, &view.UpdatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return view, validation("purchase workflow not found", nil)
	}
	if err != nil {
		return view, internal("get purchase workflow", err)
	}
	rows, err := s.pool.Query(ctx, `SELECT x.document_id,d.document_no,d.entity,x.stage,
		d.status,d.revision,d.business_date,d.currency,d.total_amount_cents,
		d.created_at,d.created_by,d.reviewed_at,d.reviewed_by,d.approved_at,d.approved_by,
		COALESCE(d.parent_entity,''),COALESCE(d.parent_document_id,''),COALESCE(parent.document_no,'')
		FROM wfl_process_documents x
		JOIN vou_documents d ON d.id=x.document_id
		LEFT JOIN vou_documents parent ON parent.id=d.parent_document_id
		WHERE x.process_id=$1
		ORDER BY CASE x.stage WHEN 'PURCHASE_ORDER' THEN 1 ELSE 2 END,x.sequence_no`,
		input.ProcessID)
	if err != nil {
		return view, err
	}
	defer rows.Close()
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
			return view, err
		}
		item.BusinessDate = documentLinkDate(businessDate)
		item.Amount = documentLinkAmount(amount)
		view.Documents = append(view.Documents, item)
	}
	view.CurrentStage = StagePurchaseOrder
	if view.Status == StatusApproved {
		view.CurrentStage = StagePurchaseInbound
	}
	if view.Status == StatusCompleted || view.Status == StatusShortClosed {
		view.CurrentStage = ""
	}
	return view, rows.Err()
}

func (s *Service) PurchaseAction(
	ctx context.Context, action string, input ActionInput, actorID, requestID string,
) (any, error) {
	if s.purchase == nil || !validID(input.ProcessID) || input.ProcessRevision < 1 {
		return nil, validation("invalid purchase workflow action", nil)
	}
	if action == "inbound-create" {
		if err := s.verifyPurchaseProcess(ctx, input.ProcessID, input.ProcessRevision); err != nil {
			return nil, err
		}
		var data voudomain.DraftInput
		if err := json.Unmarshal(input.Data, &data); err != nil {
			return nil, validation("invalid purchase inbound data", nil)
		}
		data.SourceDocumentID = input.ProcessID
		result, err := s.purchase.CreatePurchaseInbound(
			ctx, voudomain.CreateInput{Data: data}, actorID, requestID,
		)
		if err != nil {
			return nil, err
		}
		return s.purchaseMutation(ctx, result)
	}
	root := !strings.HasPrefix(action, "inbound-")
	entity, stage, operation := voudomain.EntityPurchaseOrder, StagePurchaseOrder, action
	documentID := input.DocumentID
	if root {
		documentID = input.ProcessID
	} else {
		entity, stage = voudomain.EntityPurchaseInbound, StagePurchaseInbound
		operation = strings.TrimPrefix(action, "inbound-")
	}
	if operation == "get" {
		if err := s.verifyPurchaseDocument(ctx, input.ProcessID, 0, documentID, stage); err != nil {
			return nil, err
		}
		return s.purchase.Get(ctx, entity, voudomain.GetInput{DocumentID: documentID})
	}
	if err := s.verifyPurchaseDocument(
		ctx, input.ProcessID, input.ProcessRevision, documentID, stage,
	); err != nil {
		return nil, err
	}
	var result voudomain.MutationResult
	var err error
	switch operation {
	case "save":
		var data voudomain.DraftInput
		if err = json.Unmarshal(input.Data, &data); err != nil {
			return nil, validation("invalid purchase data", nil)
		}
		save := voudomain.SaveInput{
			DocumentID: documentID, Revision: input.DocumentRevision, Data: data,
		}
		if entity == voudomain.EntityPurchaseInbound {
			result, err = s.purchase.SavePurchaseInbound(ctx, save, actorID, requestID)
		} else {
			result, err = s.purchase.Save(ctx, entity, save, actorID, requestID)
		}
	case "delete":
		result, err = s.purchase.DeletePurchaseInbound(ctx, voudomain.ReverseInput{
			DocumentID: documentID, Revision: input.DocumentRevision, Reason: input.Reason,
		}, actorID, requestID)
	case "check":
		result, err = s.purchase.Check(ctx, entity, voudomain.DocumentRevisionInput{
			DocumentID: documentID, Revision: input.DocumentRevision,
		}, actorID, requestID)
	case "uncheck":
		result, err = s.purchase.Uncheck(ctx, entity, voudomain.ReverseInput{
			DocumentID: documentID, Revision: input.DocumentRevision, Reason: input.Reason,
		}, actorID, requestID)
	case "approve":
		result, err = s.purchase.Approve(ctx, entity, voudomain.DocumentRevisionInput{
			DocumentID: documentID, Revision: input.DocumentRevision,
		}, actorID, requestID)
	case "unapprove":
		result, err = s.purchase.Unapprove(ctx, entity, voudomain.ReverseInput{
			DocumentID: documentID, Revision: input.DocumentRevision, Reason: input.Reason,
		}, actorID, requestID)
	case "short-close-request":
		result, err = s.purchase.PurchaseShortCloseRequest(ctx, voudomain.ReverseInput{
			DocumentID: documentID, Revision: input.DocumentRevision, Reason: input.Reason,
		}, actorID, requestID)
	case "short-close-cancel":
		result, err = s.purchase.PurchaseShortCloseCancel(ctx, voudomain.ReverseInput{
			DocumentID: documentID, Revision: input.DocumentRevision, Reason: input.Reason,
		}, actorID, requestID)
	case "short-close-confirm":
		result, err = s.purchase.PurchaseShortCloseConfirm(ctx, voudomain.DocumentRevisionInput{
			DocumentID: documentID, Revision: input.DocumentRevision,
		}, actorID, requestID)
	case "short-close-unconfirm":
		result, err = s.purchase.PurchaseShortCloseUnconfirm(ctx, voudomain.ReverseInput{
			DocumentID: documentID, Revision: input.DocumentRevision, Reason: input.Reason,
		}, actorID, requestID)
	default:
		return nil, validation("invalid purchase workflow action", nil)
	}
	if err != nil {
		return nil, err
	}
	if operation == "delete" {
		var value MutationResult
		err = s.pool.QueryRow(ctx, `SELECT id,revision,status FROM wfl_process_instances
			WHERE id=$1 AND process_type=$2`, input.ProcessID, ProcessTypePurchase).
			Scan(&value.ProcessID, &value.ProcessRevision, &value.WorkflowStatus)
		if err != nil {
			return nil, internal("read purchase workflow after delete", err)
		}
		value.DocumentID, value.DocumentNo = result.DocumentID, result.DocumentNo
		value.DocumentRevision, value.DocumentStatus = result.Revision, result.Status
		return value, nil
	}
	return s.purchaseMutation(ctx, result)
}

func (s *Service) verifyPurchaseProcess(
	ctx context.Context, processID string, revision int64,
) error {
	var actual int64
	err := s.pool.QueryRow(ctx, `SELECT revision FROM wfl_process_instances
		WHERE id=$1 AND process_type=$2`, processID, ProcessTypePurchase).Scan(&actual)
	if err != nil || actual != revision {
		return conflict("purchase workflow changed", map[string]any{"revision": actual})
	}
	return nil
}

func (s *Service) verifyPurchaseDocument(
	ctx context.Context, processID string, revision int64, documentID, stage string,
) error {
	if revision > 0 {
		if err := s.verifyPurchaseProcess(ctx, processID, revision); err != nil {
			return err
		}
	}
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM wfl_process_documents
		WHERE process_id=$1 AND document_id=$2 AND stage=$3
	)`, processID, documentID, stage).Scan(&exists)
	if err != nil || !exists {
		return validation("purchase workflow document not found", nil)
	}
	return nil
}

func (s *Service) purchaseMutation(
	ctx context.Context, result voudomain.MutationResult,
) (MutationResult, error) {
	var value MutationResult
	err := s.pool.QueryRow(ctx, `SELECT p.id,p.revision,p.status,
		COALESCE(d.parent_document_id,'')
		FROM wfl_process_instances p
		JOIN wfl_process_documents x ON x.process_id=p.id
		JOIN vou_documents d ON d.id=x.document_id
		WHERE x.document_id=$1 AND p.process_type=$2`,
		result.DocumentID, ProcessTypePurchase).
		Scan(&value.ProcessID, &value.ProcessRevision, &value.WorkflowStatus,
			&value.ParentDocumentID)
	if err != nil {
		return value, internal("read purchase workflow mutation", err)
	}
	value.DocumentID, value.DocumentNo = result.DocumentID, result.DocumentNo
	value.DocumentRevision, value.DocumentStatus = result.Revision, result.Status
	return value, nil
}
