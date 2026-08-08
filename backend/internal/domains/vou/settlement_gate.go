package vou

import (
	"context"
	"strings"

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

func (s *Service) reserveOrderSettlement(
	ctx context.Context,
	tx pgx.Tx,
	entity, orderID string,
) error {
	return s.reserveOrderSettlementAmount(ctx, tx, entity, orderID, 0)
}

func (s *Service) reserveOrderSettlementAmount(
	ctx context.Context,
	tx pgx.Tx,
	entity, orderID string,
	reservedAmount int64,
) error {
	if entity != EntitySaleOrder && entity != EntityPurchaseOrder {
		return nil
	}
	gate, err := loadOrderSettlementGate(ctx, tx, entity, orderID)
	if err != nil {
		return err
	}
	if gate.TermCode != bobSettlementPrepaid && gate.TermCode != bobSettlementCOD {
		return nil
	}
	if reservedAmount <= 0 || reservedAmount > gate.AmountCents {
		reservedAmount = gate.AmountCents
	}
	lockKey := gate.CounterpartyEntity + ":" + gate.CounterpartyObjectID + ":" + gate.Currency
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, lockKey); err != nil {
		return s.internal("lock settlement balance", err)
	}
	var reservationExists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM vou_settlement_reservations WHERE order_id=$1
	)`, gate.OrderID).Scan(&reservationExists); err != nil {
		return s.internal("read order settlement reservation", err)
	}
	var activeGenerationID string
	if err = tx.QueryRow(ctx, `SELECT active_generation_id
		FROM led_control
		WHERE singleton=true AND status='ACTIVE' AND active_generation_id IS NOT NULL
		FOR SHARE`).Scan(&activeGenerationID); err == pgx.ErrNoRows {
		return domainError(ErrorConflict, "settlement ledger is not active", nil, nil)
	} else if err != nil {
		return s.internal("read settlement ledger state", err)
	}
	var balance int64
	if err = tx.QueryRow(ctx, `SELECT COALESCE(sum(entry.amount_delta_cents),0)::bigint
		FROM led_party_entries entry
		WHERE entry.generation_id=$1
		  AND entry.account_type='TRADE'
		  AND entry.counterparty_entity=$2 AND entry.counterparty_object_id=$3
		  AND entry.currency=$4 AND entry.effective_date<=$5::date`,
		activeGenerationID, gate.CounterpartyEntity, gate.CounterpartyObjectID, gate.Currency,
		businessdate.Today()).Scan(&balance); err != nil {
		return s.internal("read settlement balance", err)
	}
	if gate.TermCode == bobSettlementPrepaid {
		available := balance
		if gate.CounterpartyEntity == "customer" {
			available = -balance
		}
		if available < 0 {
			available = 0
		}
		var alreadyReserved int64
		if err = tx.QueryRow(ctx, `SELECT COALESCE(sum(reserved_amount_cents),0)::bigint
			FROM vou_settlement_reservations
			WHERE active AND term_code='PREPAID'
			  AND counterparty_entity=$1 AND counterparty_object_id=$2 AND currency=$3
			  AND order_id<>$4`, gate.CounterpartyEntity, gate.CounterpartyObjectID,
			gate.Currency, gate.OrderID).Scan(&alreadyReserved); err != nil {
			return s.internal("read prepaid reservations", err)
		}
		available -= alreadyReserved
		if available < reservedAmount {
			return domainError(ErrorConflict, "insufficient prepaid funds", map[string]any{
				"currency":         gate.Currency,
				"orderAmount":      formatMoney(reservedAmount),
				"availableBalance": formatMoney(maxInt64(available, 0)),
			}, nil)
		}
	} else if !reservationExists {
		outstandingDebt := (gate.CounterpartyEntity == "customer" && balance > 0) ||
			(gate.CounterpartyEntity == "supplier" && balance < 0)
		if outstandingDebt {
			return domainError(ErrorConflict, "counterparty has outstanding debt", map[string]any{
				"currency":           gate.Currency,
				"orderAmount":        formatMoney(reservedAmount),
				"outstandingBalance": formatMoney(absInt64(balance)),
			}, nil)
		}
		var existingOrderID string
		err = tx.QueryRow(ctx, `SELECT order_id FROM vou_settlement_reservations
			WHERE active AND term_code='CASH_ON_DELIVERY'
			  AND counterparty_entity=$1 AND counterparty_object_id=$2 AND currency=$3
			  AND order_id<>$4 LIMIT 1`, gate.CounterpartyEntity, gate.CounterpartyObjectID,
			gate.Currency, gate.OrderID).Scan(&existingOrderID)
		if err == nil {
			return domainError(ErrorConflict, "counterparty already has an unfinished cash-on-delivery order", map[string]any{
				"currency": gate.Currency, "orderAmount": formatMoney(reservedAmount),
				"existingOrderId": existingOrderID,
			}, nil)
		}
		if err != nil && err != pgx.ErrNoRows {
			return s.internal("read cash-on-delivery reservation", err)
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO vou_settlement_reservations(
		order_id,order_entity,term_code,counterparty_entity,counterparty_object_id,
		currency,original_amount_cents,reserved_amount_cents,active
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)
	ON CONFLICT(order_id) DO UPDATE SET
		order_entity=EXCLUDED.order_entity,term_code=EXCLUDED.term_code,
		counterparty_entity=EXCLUDED.counterparty_entity,
		counterparty_object_id=EXCLUDED.counterparty_object_id,currency=EXCLUDED.currency,
		original_amount_cents=EXCLUDED.original_amount_cents,
		reserved_amount_cents=EXCLUDED.reserved_amount_cents,active=true,updated_at=now()`,
		gate.OrderID, gate.OrderEntity, gate.TermCode, gate.CounterpartyEntity,
		gate.CounterpartyObjectID, gate.Currency, gate.AmountCents, reservedAmount)
	if err != nil {
		return s.writeError("reserve settlement funds", err)
	}
	return nil
}

func (s *Service) reopenOrderSettlement(
	ctx context.Context,
	tx pgx.Tx,
	orderEntity, orderID string,
) error {
	gate, err := loadOrderSettlementGate(ctx, tx, orderEntity, orderID)
	if err != nil {
		return err
	}
	if gate.TermCode != bobSettlementPrepaid && gate.TermCode != bobSettlementCOD {
		return nil
	}
	var fulfilledAmount, returnedAmount int64
	switch orderEntity {
	case EntitySaleOrder:
		err = tx.QueryRow(ctx, `SELECT
			COALESCE((SELECT sum(document.total_amount_cents)
				FROM vou_sale_signoff_details detail
				JOIN vou_documents document ON document.id=detail.document_id
				WHERE detail.source_order_id=$1 AND document.status IN ('APPROVED','FINALIZED')),0)::bigint,
			COALESCE((SELECT sum(document.total_amount_cents)
				FROM vou_sale_return_details detail
				JOIN vou_documents document ON document.id=detail.document_id
				WHERE detail.source_order_id=$1 AND document.status IN ('APPROVED','FINALIZED')),0)::bigint`, orderID).
			Scan(&fulfilledAmount, &returnedAmount)
	case EntityPurchaseOrder:
		err = tx.QueryRow(ctx, `SELECT
			COALESCE((SELECT sum(document.total_amount_cents)
				FROM vou_purchase_inbound_details detail
				JOIN vou_documents document ON document.id=detail.document_id
				WHERE detail.source_order_id=$1 AND document.status IN ('APPROVED','FINALIZED')),0)::bigint,
			COALESCE((SELECT sum(document.total_amount_cents)
				FROM vou_purchase_return_details detail
				JOIN vou_documents document ON document.id=detail.document_id
				WHERE detail.source_order_id=$1 AND document.status IN ('APPROVED','FINALIZED')),0)::bigint`, orderID).
			Scan(&fulfilledAmount, &returnedAmount)
	default:
		return nil
	}
	if err != nil {
		return err
	}
	remaining := gate.AmountCents - fulfilledAmount + returnedAmount
	if remaining <= 0 {
		return s.releaseOrderSettlement(ctx, tx, orderID)
	}
	if remaining > gate.AmountCents {
		remaining = gate.AmountCents
	}
	return s.reserveOrderSettlementAmount(ctx, tx, orderEntity, orderID, remaining)
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
	switch entity {
	case EntitySaleOrder:
		gate.CounterpartyEntity = "customer"
		err = tx.QueryRow(ctx, `SELECT detail.settlement_term_code,
			COALESCE(detail.settlement_method_name,''),
			COALESCE(detail.settlement_rule_type,''),COALESCE(detail.settlement_month_offset,0),
			COALESCE(detail.settlement_day_offset,0),detail.customer_object_id,
			COALESCE(document.currency,''),document.total_amount_cents
			FROM vou_documents document JOIN vou_sale_order_details detail ON detail.document_id=document.id
			WHERE document.id=$1`, orderID).Scan(
			&gate.TermCode, &settlementName, &ruleType, &monthOffset, &dayOffset,
			&gate.CounterpartyObjectID, &gate.Currency, &gate.AmountCents)
	case EntityPurchaseOrder:
		gate.CounterpartyEntity = "supplier"
		err = tx.QueryRow(ctx, `SELECT detail.settlement_term_code,
			COALESCE(detail.settlement_method_name,''),
			COALESCE(detail.settlement_rule_type,''),COALESCE(detail.settlement_month_offset,0),
			COALESCE(detail.settlement_day_offset,0),detail.supplier_object_id,
			COALESCE(document.currency,''),document.total_amount_cents
			FROM vou_documents document JOIN vou_purchase_order_details detail ON detail.document_id=document.id
			WHERE document.id=$1`, orderID).Scan(
			&gate.TermCode, &settlementName, &ruleType, &monthOffset, &dayOffset,
			&gate.CounterpartyObjectID, &gate.Currency, &gate.AmountCents)
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

func (s *Service) releaseOrderSettlement(ctx context.Context, tx pgx.Tx, orderID string) error {
	_, err := tx.Exec(ctx, `UPDATE vou_settlement_reservations
		SET active=false,reserved_amount_cents=0,updated_at=now()
		WHERE order_id=$1 AND active`, orderID)
	return err
}

func (s *Service) adjustFulfillmentSettlement(
	ctx context.Context,
	tx pgx.Tx,
	entity, documentID string,
	reverse bool,
) error {
	var orderID string
	var amount int64
	var orderEntity string
	var err error
	switch entity {
	case EntitySaleSignoff:
		orderEntity = EntitySaleOrder
		err = tx.QueryRow(ctx, `SELECT detail.source_order_id,document.total_amount_cents
			FROM vou_sale_signoff_details detail JOIN vou_documents document ON document.id=detail.document_id
			WHERE detail.document_id=$1`, documentID).Scan(&orderID, &amount)
	case EntityPurchaseInbound:
		orderEntity = EntityPurchaseOrder
		err = tx.QueryRow(ctx, `SELECT detail.source_order_id,document.total_amount_cents
			FROM vou_purchase_inbound_details detail JOIN vou_documents document ON document.id=detail.document_id
			WHERE detail.document_id=$1`, documentID).Scan(&orderID, &amount)
	default:
		return nil
	}
	if err != nil {
		return err
	}
	if reverse {
		var currentlyReserved int64
		err = tx.QueryRow(ctx, `SELECT reserved_amount_cents
			FROM vou_settlement_reservations WHERE order_id=$1`, orderID).
			Scan(&currentlyReserved)
		if err == pgx.ErrNoRows {
			return nil
		}
		if err != nil {
			return err
		}
		return s.reserveOrderSettlementAmount(
			ctx, tx, orderEntity, orderID, currentlyReserved+amount,
		)
	} else {
		_, err = tx.Exec(ctx, `UPDATE vou_settlement_reservations SET
			reserved_amount_cents=GREATEST(reserved_amount_cents-$1,0),updated_at=now()
			WHERE order_id=$2 AND active AND term_code='PREPAID'`, amount, orderID)
	}
	return err
}

func (s *Service) closeSettlementReservationIfFulfilled(
	ctx context.Context,
	tx pgx.Tx,
	orderEntity, orderID string,
) error {
	var status string
	var err error
	if orderEntity == EntitySaleOrder {
		err = tx.QueryRow(ctx, `SELECT fulfillment_status FROM vou_sale_order_details WHERE document_id=$1`, orderID).Scan(&status)
	} else {
		err = tx.QueryRow(ctx, `SELECT fulfillment_status FROM vou_purchase_order_details WHERE document_id=$1`, orderID).Scan(&status)
	}
	if err != nil {
		return err
	}
	if status == "FULFILLED" || status == "SHORT_CLOSED" {
		return s.releaseOrderSettlement(ctx, tx, orderID)
	}
	return nil
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

func absInt64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}
