package workflowactions

import (
	"context"

	"github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/domains/wfl"
	"github.com/jackc/pgx/v5"
)

type Adapter struct {
	documents *vou.Service
}

func New(documents *vou.Service) *Adapter {
	return &Adapter{documents: documents}
}

func (a *Adapter) LoadWorkflowSource(ctx context.Context, tx pgx.Tx, entity, documentID string) (any, error) {
	return a.documents.LoadWorkflowSource(ctx, tx, entity, documentID)
}

func reference(entity string, result vou.MutationResult) wfl.BusinessObjectReference {
	return wfl.BusinessObjectReference{Entity: entity, DocumentID: result.DocumentID, DocumentNo: result.DocumentNo}
}

func quantityLines(lines []wfl.QuantityLineInitial) []vou.SourceQuantityLineInput {
	result := make([]vou.SourceQuantityLineInput, 0, len(lines))
	for _, line := range lines {
		result = append(result, vou.SourceQuantityLineInput{SourceLineID: line.SourceLineID, BaseQuantity: line.BaseQuantity})
	}
	return result
}

func (a *Adapter) CreateExpensePayment(ctx context.Context, tx pgx.Tx, input wfl.WorkflowActionInput[wfl.ExpensePaymentInitial]) (wfl.BusinessObjectReference, error) {
	result, err := a.documents.CreateWorkflowExpensePayment(ctx, tx, input.SourceDocumentID, vou.WorkflowExpensePaymentInitial{
		FundAccountObjectID: input.Initial.FundAccountObjectID,
	}, input.RequestID)
	return reference(vou.EntityExpensePayment, result), err
}

func (a *Adapter) CreatePurchaseInbound(ctx context.Context, tx pgx.Tx, input wfl.WorkflowActionInput[wfl.PurchaseInboundInitial]) (wfl.BusinessObjectReference, error) {
	result, err := a.documents.CreateWorkflowPurchaseInbound(ctx, tx, input.SourceDocumentID, vou.WorkflowPurchaseInboundInitial{
		WarehouseObjectID: input.Initial.WarehouseObjectID, BusinessDate: input.Initial.BusinessDate,
		Lines: quantityLines(input.Initial.Lines),
	}, input.RequestID)
	return reference(vou.EntityPurchaseInbound, result), err
}

func (a *Adapter) CreateSaleOutbound(ctx context.Context, tx pgx.Tx, input wfl.WorkflowActionInput[wfl.SaleOutboundInitial]) (wfl.BusinessObjectReference, error) {
	result, err := a.documents.CreateWorkflowSaleOutbound(ctx, tx, input.SourceDocumentID, vou.WorkflowSaleOutboundInitial{
		WarehouseObjectID: input.Initial.WarehouseObjectID, BusinessDate: input.Initial.BusinessDate,
		Lines: quantityLines(input.Initial.Lines),
	}, input.RequestID)
	return reference(vou.EntitySaleOutbound, result), err
}

func (a *Adapter) CreateSaleDelivery(ctx context.Context, tx pgx.Tx, input wfl.WorkflowActionInput[wfl.SaleDeliveryInitial]) (wfl.BusinessObjectReference, error) {
	result, err := a.documents.CreateWorkflowSaleDelivery(ctx, tx, input.SourceDocumentID, vou.WorkflowSaleDeliveryInitial{
		CarrierServiceRelationshipObjectID: input.Initial.CarrierServiceRelationshipObjectID,
		VehicleObjectID:                    input.Initial.VehicleObjectID,
		BusinessDate:                       input.Initial.BusinessDate, Lines: quantityLines(input.Initial.Lines),
	}, input.RequestID)
	return reference(vou.EntitySaleDelivery, result), err
}

func (a *Adapter) CreateSaleSignoff(ctx context.Context, tx pgx.Tx, input wfl.WorkflowActionInput[wfl.SaleSignoffInitial]) (wfl.BusinessObjectReference, error) {
	lines := make([]vou.WorkflowSignoffLineInput, 0, len(input.Initial.Lines))
	for _, line := range input.Initial.Lines {
		lines = append(lines, vou.WorkflowSignoffLineInput{
			SourceLineID: line.SourceLineID, SignedBaseQuantity: line.SignedBaseQuantity,
			RejectedBaseQuantity: line.RejectedBaseQuantity,
		})
	}
	result, err := a.documents.CreateWorkflowSaleSignoff(ctx, tx, input.SourceDocumentID, vou.WorkflowSaleSignoffInitial{
		BusinessDate: input.Initial.BusinessDate, Lines: lines,
	}, input.RequestID)
	return reference(vou.EntitySaleSignoff, result), err
}

func (a *Adapter) CreateSaleReturn(ctx context.Context, tx pgx.Tx, input wfl.WorkflowActionInput[wfl.SaleReturnInitial]) (wfl.BusinessObjectReference, error) {
	result, err := a.documents.CreateWorkflowSaleReturn(ctx, tx, input.SourceDocumentID, vou.WorkflowSaleReturnInitial{
		BusinessDate: input.Initial.BusinessDate, Reason: input.Initial.Reason,
		Lines: quantityLines(input.Initial.Lines),
	}, input.RequestID)
	return reference(vou.EntitySaleReturn, result), err
}

var _ wfl.WorkflowRuntime = (*Adapter)(nil)
