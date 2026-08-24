package wfl

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type BusinessObjectReference struct {
	Entity     string `json:"entity"`
	DocumentID string `json:"documentId"`
	DocumentNo string `json:"documentNo"`
}

type QuantityLineInitial struct {
	SourceLineID string `json:"sourceLineId"`
	BaseQuantity string `json:"baseQuantity"`
}

type ExpensePaymentInitial struct {
	FundAccountObjectID string `json:"fundAccountObjectId"`
}

type PurchaseInboundInitial struct {
	WarehouseObjectID string                `json:"warehouseObjectId,omitempty"`
	BusinessDate      string                `json:"businessDate,omitempty"`
	Lines             []QuantityLineInitial `json:"lines,omitempty"`
}

type SaleOutboundInitial struct {
	WarehouseObjectID string                `json:"warehouseObjectId,omitempty"`
	BusinessDate      string                `json:"businessDate,omitempty"`
	Lines             []QuantityLineInitial `json:"lines,omitempty"`
}

type SaleDeliveryInitial struct {
	PlatformObjectID string                `json:"platformObjectId"`
	VehicleObjectID  string                `json:"vehicleObjectId"`
	BusinessDate     string                `json:"businessDate,omitempty"`
	Lines            []QuantityLineInitial `json:"lines,omitempty"`
}

type SaleSignoffInitial struct {
	BusinessDate string                   `json:"businessDate,omitempty"`
	Lines        []SaleSignoffLineInitial `json:"lines,omitempty"`
}

type SaleSignoffLineInitial struct {
	SourceLineID         string `json:"sourceLineId"`
	SignedBaseQuantity   string `json:"signedBaseQuantity"`
	RejectedBaseQuantity string `json:"rejectedBaseQuantity"`
}

type SaleReturnInitial struct {
	BusinessDate string                `json:"businessDate,omitempty"`
	Reason       string                `json:"reason"`
	Lines        []QuantityLineInitial `json:"lines,omitempty"`
}

type WorkflowActionInput[T any] struct {
	SourceDocumentID string `json:"sourceDocumentId"`
	RequestID        string `json:"requestId"`
	Initial          T      `json:"initial"`
}

// WorkflowActions is the complete persistence boundary available to a workflow
// program. Static Starlark host bindings are mapped to these typed methods; the
// script never discovers methods or dispatches an arbitrary action name.
type WorkflowActions interface {
	CreateExpensePayment(context.Context, pgx.Tx, WorkflowActionInput[ExpensePaymentInitial]) (BusinessObjectReference, error)
	CreatePurchaseInbound(context.Context, pgx.Tx, WorkflowActionInput[PurchaseInboundInitial]) (BusinessObjectReference, error)
	CreateSaleOutbound(context.Context, pgx.Tx, WorkflowActionInput[SaleOutboundInitial]) (BusinessObjectReference, error)
	CreateSaleDelivery(context.Context, pgx.Tx, WorkflowActionInput[SaleDeliveryInitial]) (BusinessObjectReference, error)
	CreateSaleSignoff(context.Context, pgx.Tx, WorkflowActionInput[SaleSignoffInitial]) (BusinessObjectReference, error)
	CreateSaleReturn(context.Context, pgx.Tx, WorkflowActionInput[SaleReturnInitial]) (BusinessObjectReference, error)
}

type WorkflowSourceReader interface {
	LoadWorkflowSource(context.Context, pgx.Tx, string, string) (any, error)
}

type WorkflowRuntime interface {
	WorkflowActions
	WorkflowSourceReader
}

type PlannedAction struct {
	Action  string                  `json:"action"`
	Source  string                  `json:"sourceDocumentId"`
	Initial any                     `json:"initial"`
	Result  BusinessObjectReference `json:"result"`
}

type trialActions struct {
	plans []PlannedAction
}

func (a *trialActions) planned(name string, source string, initial any) (BusinessObjectReference, error) {
	result := BusinessObjectReference{Entity: workflowActionEntities[name][1], DocumentID: "TRIAL"}
	a.plans = append(a.plans, PlannedAction{Action: name, Source: source, Initial: initial, Result: result})
	return result, nil
}

func (a *trialActions) CreateExpensePayment(_ context.Context, _ pgx.Tx, input WorkflowActionInput[ExpensePaymentInitial]) (BusinessObjectReference, error) {
	if !validInitialID(input.Initial.FundAccountObjectID) {
		return BusinessObjectReference{}, fmt.Errorf("expense_payment requires fundAccountObjectId")
	}
	return a.planned(ActionExpensePayment, input.SourceDocumentID, input.Initial)
}

func (a *trialActions) CreatePurchaseInbound(_ context.Context, _ pgx.Tx, input WorkflowActionInput[PurchaseInboundInitial]) (BusinessObjectReference, error) {
	if err := validateQuantityActionInitial(input.Initial.WarehouseObjectID, input.Initial.BusinessDate, input.Initial.Lines); err != nil {
		return BusinessObjectReference{}, fmt.Errorf("purchase_inbound: %w", err)
	}
	return a.planned(ActionPurchaseInbound, input.SourceDocumentID, input.Initial)
}

func (a *trialActions) CreateSaleOutbound(_ context.Context, _ pgx.Tx, input WorkflowActionInput[SaleOutboundInitial]) (BusinessObjectReference, error) {
	if err := validateQuantityActionInitial(input.Initial.WarehouseObjectID, input.Initial.BusinessDate, input.Initial.Lines); err != nil {
		return BusinessObjectReference{}, fmt.Errorf("sale_outbound: %w", err)
	}
	return a.planned(ActionSaleOutbound, input.SourceDocumentID, input.Initial)
}

func (a *trialActions) CreateSaleDelivery(_ context.Context, _ pgx.Tx, input WorkflowActionInput[SaleDeliveryInitial]) (BusinessObjectReference, error) {
	if !validInitialID(input.Initial.PlatformObjectID) || !validInitialID(input.Initial.VehicleObjectID) || !validInitialDate(input.Initial.BusinessDate) {
		return BusinessObjectReference{}, fmt.Errorf("sale_delivery requires platformObjectId, vehicleObjectId, and businessDate")
	}
	return a.planned(ActionSaleDelivery, input.SourceDocumentID, input.Initial)
}

func (a *trialActions) CreateSaleSignoff(_ context.Context, _ pgx.Tx, input WorkflowActionInput[SaleSignoffInitial]) (BusinessObjectReference, error) {
	if !validInitialDate(input.Initial.BusinessDate) || len(input.Initial.Lines) == 0 {
		return BusinessObjectReference{}, fmt.Errorf("sale_signoff requires businessDate and lines")
	}
	for _, line := range input.Initial.Lines {
		if !validInitialID(line.SourceLineID) || !validInitialQuantity(line.SignedBaseQuantity, true) || !validInitialQuantity(line.RejectedBaseQuantity, true) {
			return BusinessObjectReference{}, fmt.Errorf("sale_signoff line is invalid")
		}
	}
	return a.planned(ActionSaleSignoff, input.SourceDocumentID, input.Initial)
}

func (a *trialActions) CreateSaleReturn(_ context.Context, _ pgx.Tx, input WorkflowActionInput[SaleReturnInitial]) (BusinessObjectReference, error) {
	if !validInitialDate(input.Initial.BusinessDate) || strings.TrimSpace(input.Initial.Reason) == "" || len(input.Initial.Lines) == 0 {
		return BusinessObjectReference{}, fmt.Errorf("sale_return requires businessDate, reason, and lines")
	}
	for _, line := range input.Initial.Lines {
		if !validInitialID(line.SourceLineID) || !validInitialQuantity(line.BaseQuantity, false) {
			return BusinessObjectReference{}, fmt.Errorf("sale_return line is invalid")
		}
	}
	return a.planned(ActionSaleReturn, input.SourceDocumentID, input.Initial)
}

func validateQuantityActionInitial(warehouseID, businessDate string, lines []QuantityLineInitial) error {
	if !validInitialID(warehouseID) || !validInitialDate(businessDate) || len(lines) == 0 {
		return fmt.Errorf("warehouseObjectId, businessDate, and lines are required")
	}
	for _, line := range lines {
		if !validInitialID(line.SourceLineID) || !validInitialQuantity(line.BaseQuantity, false) {
			return fmt.Errorf("quantity line is invalid")
		}
	}
	return nil
}

func validInitialID(value string) bool { return len(strings.TrimSpace(value)) == 26 }

func validInitialDate(value string) bool {
	_, err := time.Parse("2006-01-02", strings.TrimSpace(value))
	return err == nil
}

func validInitialQuantity(value string, zeroAllowed bool) bool {
	quantity, ok := new(big.Rat).SetString(strings.TrimSpace(value))
	return ok && (quantity.Sign() > 0 || zeroAllowed && quantity.Sign() == 0)
}
