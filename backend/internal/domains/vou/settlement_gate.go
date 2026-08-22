package vou

import (
	"context"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/businessdate"
	"github.com/jackc/pgx/v5"
)

type orderSettlementGate struct {
	OrderID              string
	OrderEntity          string
	TermCode             string
	CounterpartyEntity   string
	CounterpartyObjectID string
	Currency             string
	AmountCents          int64
}

// validateOrderSettlement checks the control-ledger facts visible at order
// approval. It never records an order-level claim over those facts: fulfillment
// validates and consumes the then-current balance in its own transaction.
func (s *Service) validateOrderSettlement(
	ctx context.Context,
	tx pgx.Tx,
	entity, orderID string,
) error {
	if entity != EntitySaleOrder && entity != EntityPurchaseOrder {
		return nil
	}
	gate, err := loadOrderSettlementGate(ctx, tx, entity, orderID)
	if err != nil {
		return err
	}
	return s.validateSettlementAmount(ctx, tx, gate, gate.AmountCents)
}

// validateFulfillmentSettlement locks the counterparty and currency before
// rereading ACC. The lock remains held until ACC posts the same batch, so two
// batches cannot both pass against the same balance.
func (s *Service) validateFulfillmentSettlement(
	ctx context.Context,
	tx pgx.Tx,
	entity, documentID string,
) error {
	var orderEntity, orderID string
	var amount int64
	var err error
	q := dbsqlc.New(tx)
	switch entity {
	case EntitySaleSignoff:
		orderEntity = EntitySaleOrder
		var source dbsqlc.GetSaleSignoffSettlementSourceRow
		source, err = q.GetSaleSignoffSettlementSource(ctx, documentID)
		orderID, amount = source.SourceOrderID, source.TotalAmountCents
	case EntityPurchaseInbound:
		orderEntity = EntityPurchaseOrder
		var source dbsqlc.GetPurchaseInboundSettlementSourceRow
		source, err = q.GetPurchaseInboundSettlementSource(ctx, documentID)
		orderID, amount = source.SourceOrderID, source.TotalAmountCents
	default:
		return nil
	}
	if err != nil {
		return s.internal("read fulfillment settlement", err)
	}
	gate, err := loadOrderSettlementGate(ctx, tx, orderEntity, orderID)
	if err != nil {
		return err
	}
	return s.validateSettlementAmount(ctx, tx, gate, amount)
}

func (s *Service) validateSettlementAmount(
	ctx context.Context,
	tx pgx.Tx,
	gate orderSettlementGate,
	amount int64,
) error {
	if gate.TermCode != bobSettlementPrepaid && gate.TermCode != bobSettlementCOD {
		return nil
	}
	if err := s.queries.WithTx(tx).LockVouSettlementBalance(ctx,
		gate.CounterpartyEntity+":"+gate.CounterpartyObjectID+":"+gate.Currency); err != nil {
		return s.internal("lock settlement balance", err)
	}
	if s.accounting == nil {
		return domainError(ErrorConflict, "accounting control is not configured", nil, nil)
	}
	dimension := "CUSTOMER_ACCOUNT"
	prepaidPurpose, tradePurpose := "ADVANCE_RECEIPT", "RECEIVABLE"
	if gate.CounterpartyEntity == "supplier" {
		dimension, prepaidPurpose, tradePurpose = "SUPPLIER_RELATIONSHIP", "PREPAID", "PAYABLE"
	}
	purpose := tradePurpose
	if gate.TermCode == bobSettlementPrepaid {
		purpose = prepaidPurpose
	}
	balance, err := s.accounting.PartyBalance(ctx, tx, PartyBalanceQuery{
		CounterpartyDimension: dimension, CounterpartyObjectID: gate.CounterpartyObjectID,
		Currency: gate.Currency, SettlementPurpose: purpose, AsOfDate: businessdate.Today(),
	})
	if err != nil {
		return domainError(ErrorConflict, "accounting settlement balance is unavailable", nil, err)
	}
	if gate.TermCode == bobSettlementPrepaid {
		available := maxInt64(balance, 0)
		if available < amount {
			return domainError(ErrorConflict, "insufficient prepaid funds", map[string]any{
				"currency": gate.Currency, "orderAmount": formatMoney(amount),
				"availableBalance": formatMoney(available),
			}, nil)
		}
		return nil
	}
	if balance > 0 {
		return domainError(ErrorConflict, "counterparty has outstanding debt", map[string]any{
			"currency": gate.Currency, "orderAmount": formatMoney(amount),
			"outstandingBalance": formatMoney(balance),
		}, nil)
	}
	return nil
}

func loadOrderSettlementGate(
	ctx context.Context,
	tx pgx.Tx,
	entity, orderID string,
) (orderSettlementGate, error) {
	gate := orderSettlementGate{OrderID: orderID, OrderEntity: entity}
	var settlementName, ruleType string
	var monthOffset, dayOffset int32
	var err error
	q := dbsqlc.New(tx)
	switch entity {
	case EntitySaleOrder:
		gate.CounterpartyEntity = bobdomain.EntityCustomerAccount
		var row dbsqlc.GetSaleOrderSettlementGateRow
		row, err = q.GetSaleOrderSettlementGate(ctx, orderID)
		gate.TermCode, settlementName, ruleType = row.SettlementTermCode, row.SettlementMethodName, row.SettlementRuleType
		monthOffset, dayOffset = row.SettlementMonthOffset, row.SettlementDayOffset
		gate.CounterpartyObjectID, gate.Currency, gate.AmountCents = row.CustomerObjectID, row.Currency, row.TotalAmountCents
	case EntityPurchaseOrder:
		gate.CounterpartyEntity = "supplier"
		var row dbsqlc.GetPurchaseOrderSettlementGateRow
		row, err = q.GetPurchaseOrderSettlementGate(ctx, orderID)
		gate.TermCode, settlementName, ruleType = row.SettlementTermCode, row.SettlementMethodName, row.SettlementRuleType
		monthOffset, dayOffset = row.SettlementMonthOffset, row.SettlementDayOffset
		gate.CounterpartyObjectID, gate.Currency, gate.AmountCents = row.SupplierObjectID, row.Currency, row.TotalAmountCents
	default:
		return gate, domainError(ErrorValidation, "invalid settlement order", nil, nil)
	}
	if err != nil {
		return gate, domainError(ErrorConflict, "order settlement snapshot is unavailable", nil, err)
	}
	gate.TermCode = settlementTermFromSnapshot(
		gate.TermCode, settlementName, ruleType, monthOffset, dayOffset,
	)
	if gate.Currency == "" {
		return gate, domainError(ErrorConflict, "order currency is required for settlement approval", nil, nil)
	}
	return gate, nil
}

const (
	bobSettlementPrepaid = "PREPAID"
	bobSettlementCOD     = "CASH_ON_DELIVERY"
)

func settlementTermFromSnapshot(
	termCode, name, ruleType string,
	monthOffset, dayOffset int32,
) string {
	if termCode != "" {
		return termCode
	}
	if strings.Contains(name, "预付") {
		return bobSettlementPrepaid
	}
	return legacySettlementTerm(ruleType, monthOffset, dayOffset)
}

func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
