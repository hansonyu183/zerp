package vou

import (
	"context"
	"errors"
	"fmt"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
)

type WorkflowExpensePaymentInitial struct {
	FundAccountObjectID string `json:"fundAccountObjectId"`
}

type WorkflowPurchaseInboundInitial struct {
	WarehouseObjectID string                    `json:"warehouseObjectId,omitempty"`
	BusinessDate      string                    `json:"businessDate,omitempty"`
	Lines             []SourceQuantityLineInput `json:"lines,omitempty"`
}

type WorkflowSaleOutboundInitial struct {
	WarehouseObjectID string                    `json:"warehouseObjectId,omitempty"`
	BusinessDate      string                    `json:"businessDate,omitempty"`
	Lines             []SourceQuantityLineInput `json:"lines,omitempty"`
}

type WorkflowSaleDeliveryInitial struct {
	CarrierOtherUnitObjectID string                    `json:"carrierOtherUnitObjectId,omitempty"`
	VehicleObjectID          string                    `json:"vehicleObjectId"`
	BusinessDate             string                    `json:"businessDate,omitempty"`
	Lines                    []SourceQuantityLineInput `json:"lines,omitempty"`
}

type WorkflowSaleSignoffInitial struct {
	BusinessDate string                     `json:"businessDate,omitempty"`
	Lines        []WorkflowSignoffLineInput `json:"lines,omitempty"`
}

type WorkflowSignoffLineInput struct {
	SourceLineID         string `json:"sourceLineId"`
	SignedBaseQuantity   string `json:"signedBaseQuantity"`
	RejectedBaseQuantity string `json:"rejectedBaseQuantity"`
}

type WorkflowSaleReturnInitial struct {
	BusinessDate string                    `json:"businessDate,omitempty"`
	Reason       string                    `json:"reason"`
	Lines        []SourceQuantityLineInput `json:"lines,omitempty"`
}

func (s *Service) CreateWorkflowExpensePayment(ctx context.Context, tx pgx.Tx, sourceDocumentID string, initial WorkflowExpensePaymentInitial, requestID string) (MutationResult, error) {
	if existing, ok, err := s.findWorkflowChild(ctx, tx, sourceDocumentID, EntityExpensePayment); err != nil || ok {
		return existing, err
	}
	return s.createWorkflowExpensePayment(ctx, tx, sourceDocumentID, initial, requestID)
}

func (s *Service) CreateWorkflowPurchaseInbound(ctx context.Context, tx pgx.Tx, sourceDocumentID string, initial WorkflowPurchaseInboundInitial, requestID string) (MutationResult, error) {
	return s.createWorkflowPurchaseInbound(ctx, tx, sourceDocumentID, initial, requestID)
}

func (s *Service) CreateWorkflowSaleOutbound(ctx context.Context, tx pgx.Tx, sourceDocumentID string, initial WorkflowSaleOutboundInitial, requestID string) (MutationResult, error) {
	actor, err := approval.TrustedSystemActor(requestID)
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	warehouse, err := s.resolveWorkflowDefault(ctx, tx, bobdomain.EntityWarehouse, initial.WarehouseObjectID, "warehouse")
	if err != nil {
		return MutationResult{}, err
	}
	return s.writeSalesChainDraft(ctx, tx, EntitySaleOutbound, "", DraftInput{
		BusinessDate:     initial.BusinessDate,
		SourceDocumentID: sourceDocumentID,
		Warehouse:        &ReferenceInput{ObjectID: warehouse.ObjectID, ApprovalEntryID: warehouse.ApprovalEntryID},
		SourceLines:      initial.Lines,
	}, actor)
}

func (s *Service) CreateWorkflowSaleDelivery(ctx context.Context, tx pgx.Tx, sourceDocumentID string, initial WorkflowSaleDeliveryInitial, requestID string) (MutationResult, error) {
	if existing, ok, err := s.findWorkflowChild(ctx, tx, sourceDocumentID, EntitySaleDelivery); err != nil || ok {
		return existing, err
	}
	actor, err := approval.TrustedSystemActor(requestID)
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	vehicle, err := s.resolveWorkflowDefault(ctx, tx, bobdomain.EntityVehicle, initial.VehicleObjectID, "vehicle")
	if err != nil {
		return MutationResult{}, err
	}
	data := DraftInput{
		BusinessDate:     initial.BusinessDate,
		SourceDocumentID: sourceDocumentID,
		Vehicle:          &ReferenceInput{ObjectID: vehicle.ObjectID, ApprovalEntryID: vehicle.ApprovalEntryID},
	}
	if initial.CarrierOtherUnitObjectID != "" {
		carrier, resolveErr := s.resolveWorkflowDefault(ctx, tx, bobdomain.EntityOtherUnit, initial.CarrierOtherUnitObjectID, "carrier")
		if resolveErr != nil {
			return MutationResult{}, resolveErr
		}
		data.Carrier = &ReferenceInput{ObjectID: carrier.ObjectID, ApprovalEntryID: carrier.ApprovalEntryID}
	}
	return s.writeSalesChainDraft(ctx, tx, EntitySaleDelivery, "", data, actor)
}

func (s *Service) CreateWorkflowSaleSignoff(ctx context.Context, tx pgx.Tx, sourceDocumentID string, initial WorkflowSaleSignoffInitial, requestID string) (MutationResult, error) {
	if existing, ok, err := s.findWorkflowChild(ctx, tx, sourceDocumentID, EntitySaleSignoff); err != nil || ok {
		return existing, err
	}
	actor, err := approval.TrustedSystemActor(requestID)
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	lines := make([]SaleSignoffLineInput, 0, len(initial.Lines))
	for _, line := range initial.Lines {
		lines = append(lines, SaleSignoffLineInput{
			SourceLineID: line.SourceLineID, SignedBaseQuantity: line.SignedBaseQuantity,
			RejectedBaseQuantity: line.RejectedBaseQuantity,
		})
	}
	return s.writeSalesChainDraft(ctx, tx, EntitySaleSignoff, "", DraftInput{
		BusinessDate: initial.BusinessDate, SourceDocumentID: sourceDocumentID, SignoffLines: lines,
	}, actor)
}

func (s *Service) CreateWorkflowSaleReturn(ctx context.Context, tx pgx.Tx, sourceDocumentID string, initial WorkflowSaleReturnInitial, requestID string) (MutationResult, error) {
	if err := s.ensureRefusalReturnDraft(ctx, tx, sourceDocumentID, initial, requestID); err != nil {
		return MutationResult{}, err
	}
	documentID, err := s.queries.WithTx(tx).FindVouRefusalReturnDocument(ctx, stringPtr(sourceDocumentID))
	if err != nil {
		return MutationResult{}, err
	}
	document, err := lockDocument(ctx, tx, documentID, EntitySaleReturn)
	if err != nil {
		return MutationResult{}, err
	}
	return mutation(document, document.approvalEntry()), nil
}

func (s *Service) findWorkflowChild(ctx context.Context, tx pgx.Tx, sourceID, entity string) (MutationResult, bool, error) {
	child, err := s.queries.WithTx(tx).FindWorkflowVouChild(ctx, dbsqlc.FindWorkflowVouChildParams{
		SourceDocumentID: &sourceID,
		Entity:           entity,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, false, nil
	}
	if err != nil {
		return MutationResult{}, false, err
	}
	document, err := lockDocument(ctx, tx, child.ID, entity)
	if err != nil {
		return MutationResult{}, false, err
	}
	return mutation(document, document.approvalEntry()), true, nil
}

func (s *Service) createWorkflowPurchaseInbound(ctx context.Context, tx pgx.Tx, orderID string, initial WorkflowPurchaseInboundInitial, requestID string) (MutationResult, error) {
	order, detail, err := s.lockPurchaseOrderForInbound(ctx, tx, orderID)
	if err != nil {
		return MutationResult{}, err
	}
	date, err := parseBusinessDate(initial.BusinessDate)
	if err != nil {
		return MutationResult{}, err
	}
	warehouseRef, err := s.resolveWorkflowDefault(ctx, tx, bobdomain.EntityWarehouse, initial.WarehouseObjectID, "warehouse")
	if err != nil {
		return MutationResult{}, err
	}
	if detail.WarehouseObjectID != nil && *detail.WarehouseObjectID != warehouseRef.ObjectID {
		return MutationResult{}, domainError(ErrorConflict, "inbound warehouse must match purchase order warehouse", nil, nil)
	}
	if date.Before(order.BusinessDate.Time) {
		return MutationResult{}, domainError(ErrorValidation, "inbound date precedes order date", nil, nil)
	}
	lines, total, err := s.validateAndReserveInboundLines(ctx, tx, orderID, "", initial.Lines)
	if err != nil {
		return MutationResult{}, err
	}
	q := s.queries.WithTx(tx)
	counter, err := q.NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{Entity: EntityPurchaseInbound, BusinessDate: order.BusinessDate})
	if err != nil {
		return MutationResult{}, err
	}
	id := newID()
	dueDate, err := s.orderSettlementDueDate(ctx, tx, EntityPurchaseOrder, orderID, date)
	if err != nil {
		return MutationResult{}, err
	}
	number := fmt.Sprintf("%s-%s-%04d", entityPrefix(EntityPurchaseInbound), date.Format("20060102"), counter)
	actor, err := approval.TrustedSystemActor(requestID)
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	entry, err := s.createDocumentApproval(ctx, tx, EntityPurchaseInbound, id, actor)
	if err != nil {
		return MutationResult{}, err
	}
	err = q.InsertVouDocument(ctx, dbsqlc.InsertVouDocumentParams{
		ID: id, Entity: EntityPurchaseInbound, DocumentNo: number, ApprovalEntryID: entry.ID,
		BusinessDate: dateValue(date), Currency: order.Currency, DueDate: dateValue(dueDate),
		TotalAmountCents: total, ParentEntity: stringPtr(EntityPurchaseOrder),
		ParentDocumentID: stringPtr(orderID),
	})
	if err != nil {
		return MutationResult{}, err
	}
	if err = q.InsertVouPurchaseInboundDetail(ctx, dbsqlc.InsertVouPurchaseInboundDetailParams{DocumentID: id, SourceOrderID: orderID, SupplierObjectID: detail.SupplierObjectID, SupplierApprovalEntryID: detail.SupplierApprovalEntryID, SupplierCode: detail.SupplierCode, SupplierName: detail.SupplierName, WarehouseObjectID: warehouseRef.ObjectID, WarehouseApprovalEntryID: warehouseRef.ApprovalEntryID, WarehouseCode: warehouseRef.Code, WarehouseName: warehouseRef.Data.Name}); err != nil {
		return MutationResult{}, err
	}
	if err = s.insertPurchaseInboundLines(ctx, q, id, lines); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentCreatedEvent{Entity: EntityPurchaseInbound, DocumentID: id, DocumentNo: number, Revision: 1, ParentEntity: EntityPurchaseOrder, ParentDocumentID: orderID, ActorID: systemidentity.UserID, RequestID: requestID}); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Approval: approval.MetaFromEntry(entry)}, nil
}

func (s *Service) resolveWorkflowDefault(ctx context.Context, tx pgx.Tx, entity, objectID, field string) (bobdomain.EffectiveReference, error) {
	if objectID == "" {
		return bobdomain.EffectiveReference{}, domainError(ErrorConflict, field+" is required by workflow", nil, nil)
	}
	ref, err := s.resolver.ResolveCurrentReference(ctx, tx, entity, objectID)
	if err != nil {
		return ref, domainError(ErrorConflict, field+" is not effective", nil, err)
	}
	return ref, nil
}

func (s *Service) createWorkflowExpensePayment(ctx context.Context, tx pgx.Tx, reimbursementID string, defaults WorkflowExpensePaymentInitial, requestID string) (MutationResult, error) {
	q := s.queries.WithTx(tx)
	locked, err := q.LockWorkflowExpenseReimbursement(ctx, reimbursementID)
	if err != nil {
		return MutationResult{}, err
	}
	source := documentRecord{
		ID: locked.ID, Entity: locked.Entity, DocumentNo: locked.DocumentNo, Status: locked.Status,
		Revision: locked.Revision, BusinessDate: locked.BusinessDate, Currency: locked.Currency,
		TotalAmountCents: locked.TotalAmountCents, Remark: locked.Remark, CreatedAt: locked.CreatedAt,
		CreatedBy: locked.CreatedBy, UpdatedAt: locked.UpdatedAt, UpdatedBy: locked.UpdatedBy,
	}
	if source.Status != StatusApproved {
		return MutationResult{}, domainError(ErrorConflict, "expense reimbursement is not approved", nil, nil)
	}
	fund, err := s.resolveWorkflowDefault(ctx, tx, bobdomain.EntityFundAccount, defaults.FundAccountObjectID, "fundAccount")
	if err != nil {
		return MutationResult{}, err
	}
	if fund.Data.Currency != deref(source.Currency) {
		return MutationResult{}, domainError(ErrorConflict, "fund account currency does not match reimbursement", nil, nil)
	}
	counter, err := q.NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{Entity: EntityExpensePayment, BusinessDate: source.BusinessDate})
	if err != nil {
		return MutationResult{}, err
	}
	id := newID()
	date := source.BusinessDate.Time
	number := fmt.Sprintf("%s-%s-%04d", entityPrefix(EntityExpensePayment), date.Format("20060102"), counter)
	actor, err := approval.TrustedSystemActor(requestID)
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	entry, err := s.createDocumentApproval(ctx, tx, EntityExpensePayment, id, actor)
	if err != nil {
		return MutationResult{}, err
	}
	err = q.InsertVouDocument(ctx, dbsqlc.InsertVouDocumentParams{
		ID: id, Entity: EntityExpensePayment, DocumentNo: number, ApprovalEntryID: entry.ID,
		BusinessDate: source.BusinessDate, Currency: source.Currency,
		TotalAmountCents: source.TotalAmountCents, Remark: source.Remark,
		ParentEntity: stringPtr(EntityExpenseReimbursement), ParentDocumentID: stringPtr(reimbursementID),
	})
	if err != nil {
		return MutationResult{}, err
	}
	err = q.InsertVouExpensePaymentDetail(ctx, dbsqlc.InsertVouExpensePaymentDetailParams{DocumentID: id, SourceReimbursementID: reimbursementID, EmployeeObjectID: locked.EmployeeObjectID, EmployeeApprovalEntryID: locked.EmployeeApprovalEntryID, EmployeeCode: locked.EmployeeCode, EmployeeName: locked.EmployeeName, FundAccountObjectID: fund.ObjectID, FundAccountApprovalEntryID: fund.ApprovalEntryID, FundAccountCode: fund.Code, FundAccountName: fund.Data.Name})
	if err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentCreatedEvent{Entity: EntityExpensePayment, DocumentID: id, DocumentNo: number, Revision: 1, ParentEntity: EntityExpenseReimbursement, ParentDocumentID: reimbursementID, ActorID: systemidentity.UserID, RequestID: requestID}); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Approval: approval.MetaFromEntry(entry)}, nil
}

func (s *Service) SaveExpensePayment(ctx context.Context, input SaveInput, actor approval.Actor) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	date, err := parseBusinessDate(input.Data.BusinessDate)
	if err != nil {
		return MutationResult{}, err
	}
	if err = validateReference(input.Data.FundAccount, "fundAccount", true); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := lockDocument(ctx, tx, input.DocumentID, EntityExpensePayment)
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	coordinator, prepared, err := s.prepareDraftSave(ctx, tx, document, input.Revision, actor)
	if err != nil {
		return MutationResult{}, err
	}
	savedDetail, err := q.GetVouExpensePaymentDetail(ctx, input.DocumentID)
	if err != nil {
		return MutationResult{}, err
	}
	selectedFund, err := s.resolveSelectedReference(ctx, tx, bobdomain.EntityFundAccount, input.Data.FundAccount,
		&bobdomain.EffectiveReference{ObjectID: savedDetail.FundAccountObjectID, ApprovalEntryID: savedDetail.FundAccountApprovalEntryID}, false)
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "fund account is not effective", nil, err)
	}
	fund := *selectedFund
	if fund.Data.Currency != deref(document.Currency) {
		return MutationResult{}, domainError(ErrorConflict, "fund account currency does not match document currency", nil, nil)
	}
	_, err = q.UpdateVouDraft(ctx, dbsqlc.UpdateVouDraftParams{BusinessDate: dateValue(date), Currency: document.Currency, DueDate: document.DueDate, TotalAmountCents: document.TotalAmountCents, Remark: optionalText(input.Data.Remark), ID: input.DocumentID, Entity: EntityExpensePayment})
	if err != nil {
		return MutationResult{}, err
	}
	rows, err := q.UpdateVouExpensePaymentFundAccount(ctx, dbsqlc.UpdateVouExpensePaymentFundAccountParams{FundAccountObjectID: fund.ObjectID, FundAccountApprovalEntryID: fund.ApprovalEntryID, FundAccountCode: fund.Code, FundAccountName: fund.Data.Name, DocumentID: input.DocumentID})
	if err != nil || rows != 1 {
		return MutationResult{}, s.writeError("update expense payment", err)
	}
	entry, err := s.commitDraftSave(ctx, tx, q, document, coordinator, prepared)
	if err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return mutation(document, entry), nil
}
