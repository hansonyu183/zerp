package vou

import (
	"context"
	"errors"
	"fmt"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
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
	PlatformObjectID string                    `json:"platformObjectId"`
	VehicleObjectID  string                    `json:"vehicleObjectId"`
	BusinessDate     string                    `json:"businessDate,omitempty"`
	Lines            []SourceQuantityLineInput `json:"lines,omitempty"`
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
	date, err := parseBusinessDate(initial.BusinessDate)
	if err != nil {
		return MutationResult{}, err
	}
	warehouse, err := s.resolveWorkflowDefault(ctx, tx, bobdomain.EntityWarehouse, initial.WarehouseObjectID, "warehouse")
	if err != nil {
		return MutationResult{}, err
	}
	return s.writeSaleOutbound(ctx, tx, "", DraftInput{
		SourceDocumentID: sourceDocumentID,
		Warehouse:        &ReferenceInput{ObjectID: warehouse.ObjectID, VersionID: warehouse.VersionID},
		SourceLines:      initial.Lines,
	}, date, nil, systemidentity.UserID, requestID)
}

func (s *Service) CreateWorkflowSaleDelivery(ctx context.Context, tx pgx.Tx, sourceDocumentID string, initial WorkflowSaleDeliveryInitial, requestID string) (MutationResult, error) {
	if existing, ok, err := s.findWorkflowChild(ctx, tx, sourceDocumentID, EntitySaleDelivery); err != nil || ok {
		return existing, err
	}
	date, err := parseBusinessDate(initial.BusinessDate)
	if err != nil {
		return MutationResult{}, err
	}
	platform, err := s.resolveWorkflowDefault(ctx, tx, bobdomain.EntityOtherUnit, initial.PlatformObjectID, "platform")
	if err != nil {
		return MutationResult{}, err
	}
	vehicle, err := s.resolveWorkflowDefault(ctx, tx, bobdomain.EntityVehicle, initial.VehicleObjectID, "vehicle")
	if err != nil {
		return MutationResult{}, err
	}
	return s.writeSaleDelivery(ctx, tx, "", DraftInput{
		SourceDocumentID: sourceDocumentID,
		Platform:         &ReferenceInput{ObjectID: platform.ObjectID, VersionID: platform.VersionID},
		Vehicle:          &ReferenceInput{ObjectID: vehicle.ObjectID, VersionID: vehicle.VersionID},
	}, date, nil, systemidentity.UserID, requestID)
}

func (s *Service) CreateWorkflowSaleSignoff(ctx context.Context, tx pgx.Tx, sourceDocumentID string, initial WorkflowSaleSignoffInitial, requestID string) (MutationResult, error) {
	if existing, ok, err := s.findWorkflowChild(ctx, tx, sourceDocumentID, EntitySaleSignoff); err != nil || ok {
		return existing, err
	}
	date, err := parseBusinessDate(initial.BusinessDate)
	if err != nil {
		return MutationResult{}, err
	}
	lines := make([]SaleSignoffLineInput, 0, len(initial.Lines))
	for _, line := range initial.Lines {
		lines = append(lines, SaleSignoffLineInput{
			SourceLineID: line.SourceLineID, SignedBaseQuantity: line.SignedBaseQuantity,
			RejectedBaseQuantity: line.RejectedBaseQuantity,
		})
	}
	return s.writeSaleSignoff(ctx, tx, "", DraftInput{
		SourceDocumentID: sourceDocumentID, SignoffLines: lines,
	}, date, nil, systemidentity.UserID, requestID)
}

func (s *Service) CreateWorkflowSaleReturn(ctx context.Context, tx pgx.Tx, sourceDocumentID string, initial WorkflowSaleReturnInitial, requestID string) (MutationResult, error) {
	if err := s.ensureRefusalReturnDraft(ctx, tx, sourceDocumentID, initial, requestID); err != nil {
		return MutationResult{}, err
	}
	documentID, err := s.queries.WithTx(tx).FindVouRefusalReturnDocument(ctx, stringPtr(sourceDocumentID))
	if err != nil {
		return MutationResult{}, err
	}
	document, err := s.queries.WithTx(tx).GetVouDocument(ctx, dbsqlc.GetVouDocumentParams{
		ID: documentID, Entity: EntitySaleReturn,
	})
	if err != nil {
		return MutationResult{}, err
	}
	return MutationResult{
		DocumentID: document.ID,
		DocumentNo: document.DocumentNo,
		Status:     document.Status,
		Revision:   document.Revision,
	}, nil
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
	return MutationResult{
		DocumentID: child.ID,
		DocumentNo: child.DocumentNo,
		Status:     child.Status,
		Revision:   child.Revision,
	}, true, nil
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
	err = q.InsertVouDocument(ctx, dbsqlc.InsertVouDocumentParams{
		ID: id, Entity: EntityPurchaseInbound, DocumentNo: number,
		BusinessDate: dateValue(date), Currency: order.Currency, DueDate: dateValue(dueDate),
		TotalAmountCents: total, ParentEntity: stringPtr(EntityPurchaseOrder),
		ParentDocumentID: stringPtr(orderID), ActorID: systemidentity.UserID,
	})
	if err != nil {
		return MutationResult{}, err
	}
	if err = q.InsertVouPurchaseInboundDetail(ctx, dbsqlc.InsertVouPurchaseInboundDetailParams{DocumentID: id, SourceOrderID: orderID, SupplierObjectID: detail.SupplierObjectID, SupplierVersionID: detail.SupplierVersionID, SupplierCode: detail.SupplierCode, SupplierName: detail.SupplierName, WarehouseObjectID: warehouseRef.ObjectID, WarehouseVersionID: warehouseRef.VersionID, WarehouseCode: warehouseRef.Code, WarehouseName: warehouseRef.Data.Name}); err != nil {
		return MutationResult{}, err
	}
	if err = s.insertPurchaseInboundLines(ctx, q, id, lines); err != nil {
		return MutationResult{}, err
	}
	if err = insertAudit(ctx, q, auditInput{DocumentID: id, Entity: EntityPurchaseInbound, Event: "CREATED", To: StatusDraft, ActorID: systemidentity.UserID, RequestID: requestID, Summary: map[string]any{"sourceOrderId": orderID}}); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentCreatedEvent{Entity: EntityPurchaseInbound, DocumentID: id, DocumentNo: number, Revision: 1, ParentEntity: EntityPurchaseOrder, ParentDocumentID: orderID, ActorID: systemidentity.UserID, RequestID: requestID}); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Status: StatusDraft, Revision: 1}, nil
}

func (s *Service) resolveWorkflowDefault(ctx context.Context, tx pgx.Tx, entity, objectID, field string) (bobdomain.EffectiveReference, error) {
	if objectID == "" {
		return bobdomain.EffectiveReference{}, domainError(ErrorConflict, field+" is required by workflow", nil, nil)
	}
	ref, err := s.resolver.ResolveCurrentEffectiveReference(ctx, tx, entity, objectID)
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
	source := dbsqlc.VouDocument{
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
	err = q.InsertVouDocument(ctx, dbsqlc.InsertVouDocumentParams{
		ID: id, Entity: EntityExpensePayment, DocumentNo: number,
		BusinessDate: source.BusinessDate, Currency: source.Currency,
		TotalAmountCents: source.TotalAmountCents, Remark: source.Remark,
		ParentEntity: stringPtr(EntityExpenseReimbursement), ParentDocumentID: stringPtr(reimbursementID),
		ActorID: systemidentity.UserID,
	})
	if err != nil {
		return MutationResult{}, err
	}
	err = q.InsertVouExpensePaymentDetail(ctx, dbsqlc.InsertVouExpensePaymentDetailParams{DocumentID: id, SourceReimbursementID: reimbursementID, EmployeeObjectID: locked.EmployeeObjectID, EmployeeVersionID: locked.EmployeeVersionID, EmployeeCode: locked.EmployeeCode, EmployeeName: locked.EmployeeName, FundAccountObjectID: fund.ObjectID, FundAccountVersionID: fund.VersionID, FundAccountCode: fund.Code, FundAccountName: fund.Data.Name})
	if err != nil {
		return MutationResult{}, err
	}
	if err = insertAudit(ctx, q, auditInput{DocumentID: id, Entity: EntityExpensePayment, Event: "CREATED", To: StatusDraft, ActorID: systemidentity.UserID, RequestID: requestID, Summary: map[string]any{"sourceReimbursementId": reimbursementID}}); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentCreatedEvent{Entity: EntityExpensePayment, DocumentID: id, DocumentNo: number, Revision: 1, ParentEntity: EntityExpenseReimbursement, ParentDocumentID: reimbursementID, ActorID: systemidentity.UserID, RequestID: requestID}); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Status: StatusDraft, Revision: 1}, nil
}

func (s *Service) SaveExpensePayment(ctx context.Context, input SaveInput, actorID, requestID string) (MutationResult, error) {
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
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: EntityExpensePayment})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	fund, err := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntityFundAccount, input.Data.FundAccount.ObjectID, input.Data.FundAccount.VersionID)
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "fund account is not effective", nil, err)
	}
	if fund.Data.Currency != deref(document.Currency) {
		return MutationResult{}, domainError(ErrorConflict, "fund account currency does not match document currency", nil, nil)
	}
	revision, err := q.UpdateVouDraft(ctx, dbsqlc.UpdateVouDraftParams{BusinessDate: dateValue(date), Currency: document.Currency, DueDate: document.DueDate, TotalAmountCents: document.TotalAmountCents, Remark: optionalText(input.Data.Remark), ActorID: actorID, ID: input.DocumentID, Entity: EntityExpensePayment, Revision: input.Revision})
	if err != nil {
		return MutationResult{}, err
	}
	rows, err := q.UpdateVouExpensePaymentFundAccount(ctx, dbsqlc.UpdateVouExpensePaymentFundAccountParams{FundAccountObjectID: fund.ObjectID, FundAccountVersionID: fund.VersionID, FundAccountCode: fund.Code, FundAccountName: fund.Data.Name, DocumentID: input.DocumentID})
	if err != nil || rows != 1 {
		return MutationResult{}, s.writeError("update expense payment", err)
	}
	if err = insertAudit(ctx, q, auditInput{DocumentID: input.DocumentID, Entity: EntityExpensePayment, Event: "SAVED", From: stringPtr(StatusDraft), To: StatusDraft, ActorID: actorID, RequestID: requestID}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return mutation(document, StatusDraft, revision), nil
}
