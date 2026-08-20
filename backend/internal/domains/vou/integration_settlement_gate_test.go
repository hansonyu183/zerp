//go:build integration

package vou

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/businessdate"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func absInt64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}

func createSettlementCustomer(
	t *testing.T,
	pool *pgxpool.Pool,
	employee ReferenceInput,
	termCode, name string,
) ReferenceInput {
	t.Helper()
	settlement := fixedSettlementReference(t, pool, termCode)
	return createApprovedCustomer(t, pool, bobdomain.CreateDetailInput{
		Name: name, SettlementMethodID: settlement.ObjectID,
		SalespersonEmployeeID: employee.ObjectID,
	})
}

func createCheckedSettlementSale(
	t *testing.T,
	service *Service,
	refs integrationReferences,
	customer ReferenceInput,
	requestID string,
) MutationResult {
	t.Helper()
	created, err := service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-08-04", Currency: "CNY", Customer: &customer,
		Salesperson: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{{
			Product: refs.product, OrderedQuantity: "1", UnitPrice: "10.00",
		}},
	}}, integrationActorOne, requestID+"-create")
	if err != nil {
		t.Fatalf("create settlement order: %v", err)
	}
	checked, err := service.Check(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Revision,
	}, integrationActorOne, requestID+"-check")
	if err != nil {
		t.Fatalf("check settlement order: %v", err)
	}
	return checked
}

func settlementAmountCents(t *testing.T, service *Service, entity, documentID string) int64 {
	t.Helper()
	view, err := service.Get(t.Context(), entity, GetInput{DocumentID: documentID})
	if err != nil {
		t.Fatalf("read settlement document: %v", err)
	}
	amount, err := moneyCents(view.Amount)
	if err != nil {
		t.Fatalf("parse settlement document amount %q: %v", view.Amount, err)
	}
	return amount
}

func activateSettlementLedger(
	t *testing.T,
	pool *pgxpool.Pool,
	customer ReferenceInput,
	amountCents int64,
	effectiveDate string,
) {
	activateSettlementLedgerForParty(t, pool, "customer", customer, amountCents, effectiveDate)
}

func activateSettlementLedgerForParty(
	t *testing.T,
	pool *pgxpool.Pool,
	partyEntity string,
	party ReferenceInput,
	amountCents int64,
	effectiveDate string,
) {
	t.Helper()
	bookID, openingVoucherID := newID(), newID()
	if _, err := pool.Exec(t.Context(), `INSERT INTO acc_books(
		id,code,name,start_month,base_currency,control_book,subject_template,created_by,updated_by
	) VALUES($1,$2,'VOU settlement control','2020-01-01','CNY',true,'EMPTY',$3,$3)`,
		bookID, "VOU-"+bookID, integrationActorOne); err != nil {
		t.Fatalf("insert accounting control book: %v", err)
	}
	for index, definition := range []struct{ purpose, dimension, direction string }{
		{"RECEIVABLE", "CUSTOMER", "DEBIT"}, {"ADVANCE_RECEIPT", "CUSTOMER", "CREDIT"},
		{"PAYABLE", "SUPPLIER", "CREDIT"}, {"PREPAID", "SUPPLIER", "DEBIT"},
		{"OTHER", "CUSTOMER", "DEBIT"},
	} {
		subjectID := newID()
		if _, err := pool.Exec(t.Context(), `INSERT INTO acc_subjects(
			id,book_id,code,name,balance_direction,settlement_purpose,created_by,updated_by
		) VALUES($1,$2,$3,$4,$5,$6,$7,$7)`, subjectID, bookID,
			fmt.Sprintf("S%02d", index+1), definition.purpose, definition.direction,
			definition.purpose, integrationActorOne); err != nil {
			t.Fatalf("insert accounting settlement subject: %v", err)
		}
		if _, err := pool.Exec(t.Context(), `INSERT INTO acc_subject_dimensions(subject_id,dimension) VALUES($1,$2)`,
			subjectID, definition.dimension); err != nil {
			t.Fatalf("insert accounting subject dimension: %v", err)
		}
	}
	if _, err := pool.Exec(t.Context(), `WITH inserted_voucher AS (INSERT INTO acc_vouchers(
		id,book_id,source_type,source_id,business_date,created_by
	) VALUES($1,$2,'OPENING','OPENING','2020-01-01',$3) RETURNING id)
	INSERT INTO acc_openings(book_id,state,voucher_id,approved_at,approved_by,created_by,updated_by)
	VALUES($2,'APPROVED',$1,now(),$3,$3,$3)`, openingVoucherID, bookID, integrationActorOne); err != nil {
		t.Fatalf("approve accounting control opening: %v", err)
	}
	if amountCents != 0 {
		purpose := "ADVANCE_RECEIPT"
		if partyEntity == "supplier" {
			purpose = "PREPAID"
		}
		if err := insertAccountingPartyEntry(t.Context(), pool, partyEntity, party.ObjectID,
			purpose, absInt64(amountCents), effectiveDate, newID()); err != nil {
			t.Fatalf("insert accounting settlement balance: %v", err)
		}
	}
}

type accountingEntryExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func insertAccountingPartyEntry(
	ctx context.Context, executor accountingEntryExecutor, partyEntity, partyObjectID,
	purpose string, naturalAmount int64, effectiveDate, sourceID string,
) error {
	dimension := "CUSTOMER"
	if partyEntity == "supplier" {
		dimension = "SUPPLIER"
	}
	var bookID, subjectID, direction string
	if err := executor.QueryRow(ctx, `SELECT subject.book_id,subject.id,subject.balance_direction
		FROM acc_subjects subject JOIN acc_books book ON book.id=subject.book_id AND book.control_book
		WHERE subject.settlement_purpose=$1 LIMIT 1`, purpose).Scan(&bookID, &subjectID, &direction); err != nil {
		return err
	}
	debit, credit := int64(0), int64(0)
	if (direction == "DEBIT" && naturalAmount >= 0) || (direction == "CREDIT" && naturalAmount < 0) {
		debit = absInt64(naturalAmount)
	} else {
		credit = absInt64(naturalAmount)
	}
	voucherID := newID()
	_, err := executor.Exec(ctx, `WITH inserted_voucher AS (INSERT INTO acc_vouchers(id,book_id,source_type,source_id,business_date,created_by)
		VALUES($1,$2,'OPENING',$3,$4::date,$5) RETURNING id)
	INSERT INTO acc_voucher_lines(id,book_id,voucher_id,subject_id,currency,debit_minor,credit_minor,dimensions,source_line_id,line_order)
		VALUES($6,$2,$1,$7,'CNY',$8,$9,jsonb_build_object($10::text,$11::text),$6,0)`,
		voucherID, bookID, sourceID, effectiveDate, integrationActorOne, newID(), subjectID,
		debit, credit, dimension, partyObjectID)
	return err
}

func TestPrepaidOrderApprovalChecksCurrentBalanceWithoutReservationIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	customer := createSettlementCustomer(
		t, pool, refs.employee, bobdomain.SettlementTermPrepaid, "预付实时结算客户",
	)
	first := createCheckedSettlementSale(t, service, refs, customer, "prepaid-first")
	second := createCheckedSettlementSale(t, service, refs, customer, "prepaid-second")

	var amount int64
	if err := pool.QueryRow(t.Context(), `SELECT total_amount_cents FROM vou_documents WHERE id=$1`, first.DocumentID).Scan(&amount); err != nil {
		t.Fatalf("read prepaid order amount: %v", err)
	}
	activateSettlementLedger(t, pool, customer, -amount, businessdate.Today().Format(businessdate.Layout))

	if _, err := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: first.DocumentID, Revision: first.Revision,
	}, integrationActorTwo, "prepaid-first-approve"); err != nil {
		t.Fatalf("approve first prepaid order: %v", err)
	}
	if _, err := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: second.DocumentID, Revision: second.Revision,
	}, integrationActorTwo, "prepaid-second-approve"); err != nil {
		t.Fatalf("approve second prepaid order without an order-level balance claim: %v", err)
	}
}

func TestPrepaidApprovalExcludesFutureDatedFundsIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	customer := createSettlementCustomer(
		t, pool, refs.employee, bobdomain.SettlementTermPrepaid, "未来预付款客户",
	)
	order := createCheckedSettlementSale(t, service, refs, customer, "prepaid-future")
	var amount int64
	if err := pool.QueryRow(t.Context(), `SELECT total_amount_cents FROM vou_documents WHERE id=$1`, order.DocumentID).Scan(&amount); err != nil {
		t.Fatalf("read future prepaid order amount: %v", err)
	}
	activateSettlementLedger(t, pool, customer, -amount, "2999-01-01")
	if _, err := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: order.Revision,
	}, integrationActorTwo, "prepaid-future-approve"); err == nil ||
		!strings.Contains(err.Error(), "insufficient prepaid funds") {
		t.Fatalf("future prepaid funds error = %v", err)
	}
}

func TestPrepaidApprovalUsesBusinessDateInsteadOfDatabaseSessionDateIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	customer := createSettlementCustomer(
		t, pool, refs.employee, bobdomain.SettlementTermPrepaid, "业务日期预付客户",
	)
	order := createCheckedSettlementSale(t, service, refs, customer, "prepaid-business-date")
	var amount int64
	if err := pool.QueryRow(t.Context(), `SELECT total_amount_cents FROM vou_documents WHERE id=$1`, order.DocumentID).Scan(&amount); err != nil {
		t.Fatalf("read prepaid order amount: %v", err)
	}
	activateSettlementLedger(t, pool, customer, -amount, businessdate.Today().Format(businessdate.Layout))
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin business-date settlement transaction: %v", err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	if _, err = tx.Exec(t.Context(), `SET LOCAL TIME ZONE 'Etc/GMT+12'`); err != nil {
		t.Fatalf("set database session timezone: %v", err)
	}
	if err = service.validateOrderSettlement(t.Context(), tx, EntitySaleOrder, order.DocumentID); err != nil {
		t.Fatalf("business-local same-day funds were excluded: %v", err)
	}
}

func TestPrepaidApprovalExcludesCustomerOtherBalanceIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	customer := createSettlementCustomer(
		t, pool, refs.employee, bobdomain.SettlementTermPrepaid, "返点不抵预付款客户",
	)
	order := createCheckedSettlementSale(t, service, refs, customer, "prepaid-other")
	var amount int64
	if err := pool.QueryRow(t.Context(), `SELECT total_amount_cents FROM vou_documents WHERE id=$1`, order.DocumentID).Scan(&amount); err != nil {
		t.Fatalf("read other prepaid order amount: %v", err)
	}
	activateSettlementLedger(t, pool, customer, 0, "2026-08-04")
	if err := insertAccountingPartyEntry(t.Context(), pool, "customer", customer.ObjectID,
		"OTHER", amount, "2026-08-04", newID()); err != nil {
		t.Fatalf("insert customer rebate other balance: %v", err)
	}
	if _, err := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: order.Revision,
	}, integrationActorTwo, "prepaid-other-approve"); err == nil ||
		!strings.Contains(err.Error(), "insufficient prepaid funds") {
		t.Fatalf("customer other balance used as prepaid funds: %v", err)
	}
}

func TestSettlementApprovalRequiresActiveLedgerIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	customer := createSettlementCustomer(
		t, pool, refs.employee, bobdomain.SettlementTermCashOnDelivery, "无有效账簿客户",
	)
	order := createCheckedSettlementSale(t, service, refs, customer, "inactive-ledger")

	if _, err := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: order.Revision,
	}, integrationActorTwo, "inactive-ledger-approve"); err == nil ||
		!strings.Contains(err.Error(), "accounting settlement balance is unavailable") {
		t.Fatalf("inactive settlement ledger error = %v", err)
	}
}

func TestCashOnDeliveryBlocksCurrentDebtIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	customer := createSettlementCustomer(
		t, pool, refs.employee, bobdomain.SettlementTermCashOnDelivery, "现结门槛客户",
	)
	activateSettlementLedger(t, pool, customer, 0, businessdate.Today().Format(businessdate.Layout))
	if err := insertAccountingPartyEntry(t.Context(), pool, "customer", customer.ObjectID,
		"RECEIVABLE", 1, businessdate.Today().Format(businessdate.Layout), newID()); err != nil {
		t.Fatalf("insert COD debt: %v", err)
	}
	order := createCheckedSettlementSale(t, service, refs, customer, "cod-debt")
	if _, err := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: order.Revision,
	}, integrationActorTwo, "cod-debt-approve"); err == nil ||
		!strings.Contains(err.Error(), "outstanding debt") {
		t.Fatalf("COD debt error = %v", err)
	}
}

func TestPrepaidConcurrentSignoffConsumesCurrentBalanceAtomicallyIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	customer := createSettlementCustomer(
		t, pool, refs.employee, bobdomain.SettlementTermPrepaid, "预付签收并发客户",
	)
	bus := txevent.NewBus()
	if err := bus.Subscribe(DocumentApprovedTopic(EntitySaleSignoff), "test-prepaid-signoff-posting",
		func(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
			event := raw.(DocumentApprovedEvent)
			var amount int64
			if err := tx.QueryRow(ctx, `SELECT total_amount_cents FROM vou_documents WHERE id=$1`, event.DocumentID).Scan(&amount); err != nil {
				return err
			}
			return insertAccountingPartyEntry(ctx, tx, "customer", customer.ObjectID,
				"ADVANCE_RECEIPT", -amount, businessdate.Today().Format(businessdate.Layout), event.DocumentID)
		}); err != nil {
		t.Fatalf("subscribe prepaid signoff posting: %v", err)
	}
	if err := bus.Subscribe(DocumentUnapprovedTopic(EntitySaleSignoff), "test-prepaid-signoff-reversal",
		func(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
			event := raw.(DocumentUnapprovedEvent)
			_, err := tx.Exec(ctx, `DELETE FROM acc_vouchers WHERE source_id=$1`, event.DocumentID)
			return err
		}); err != nil {
		t.Fatalf("subscribe prepaid signoff reversal: %v", err)
	}
	service := newIntegrationServiceWithBus(t, pool, bus)

	createCheckedSignoff := func(order MutationResult, requestID string) MutationResult {
		t.Helper()
		approvedOrder, err := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
			DocumentID: order.DocumentID, Revision: order.Revision,
		}, integrationActorOne, requestID+"-order-approve")
		if err != nil {
			t.Fatalf("approve settlement order: %v", err)
		}
		orderView, err := service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: approvedOrder.DocumentID})
		if err != nil {
			t.Fatalf("get settlement order: %v", err)
		}
		outbound, _ := advanceSalesDocument(t, service, EntitySaleOutbound, DraftInput{
			BusinessDate: "2026-08-05", SourceDocumentID: approvedOrder.DocumentID,
			Warehouse: &refs.warehouse,
			SourceLines: []SourceQuantityLineInput{{
				SourceLineID: orderView.Data.ProductLines[0].LineID, Quantity: "1",
			}},
		}, true)
		delivery, deliveryView := advanceSalesDocument(t, service, EntitySaleDelivery, DraftInput{
			BusinessDate: "2026-08-05", SourceDocumentID: outbound.DocumentID,
			Platform: &refs.platform, Vehicle: &refs.vehicle,
		}, true)
		signoff, _ := advanceSalesDocument(t, service, EntitySaleSignoff, DraftInput{
			BusinessDate: "2026-08-05", SourceDocumentID: delivery.DocumentID,
			SignoffLines: []SaleSignoffLineInput{{
				SourceLineID:   deliveryView.Data.ProductLines[0].LineID,
				SignedQuantity: "1", RejectedQuantity: "0",
			}},
		}, false)
		return signoff
	}

	firstOrder := createCheckedSettlementSale(t, service, refs, customer, "prepaid-batch-first-order")
	secondOrder := createCheckedSettlementSale(t, service, refs, customer, "prepaid-batch-second-order")
	var firstOrderAmount, secondOrderAmount int64
	firstOrderAmount = settlementAmountCents(t, service, EntitySaleOrder, firstOrder.DocumentID)
	secondOrderAmount = settlementAmountCents(t, service, EntitySaleOrder, secondOrder.DocumentID)
	bootstrapBalance := maxInt64(firstOrderAmount, secondOrderAmount)
	if bootstrapBalance <= 0 {
		t.Fatalf("settlement order amounts must be positive: first=%d second=%d", firstOrderAmount, secondOrderAmount)
	}
	// Order approval validates its own current balance. It does not reserve it, so
	// seed only enough for that setup and reset to one actual batch below.
	activateSettlementLedger(t, pool, customer, -bootstrapBalance, businessdate.Today().Format(businessdate.Layout))
	first := createCheckedSignoff(firstOrder, "prepaid-batch-first")
	second := createCheckedSignoff(secondOrder, "prepaid-batch-second")
	var firstSignoffAmount, secondSignoffAmount int64
	firstSignoffAmount = settlementAmountCents(t, service, EntitySaleSignoff, first.DocumentID)
	secondSignoffAmount = settlementAmountCents(t, service, EntitySaleSignoff, second.DocumentID)
	if firstSignoffAmount <= 0 || firstSignoffAmount != secondSignoffAmount {
		t.Fatalf("concurrent signoff amounts must match and be positive: first=%d second=%d order-first=%d order-second=%d",
			firstSignoffAmount, secondSignoffAmount, firstOrderAmount, secondOrderAmount)
	}
	if adjustment := firstSignoffAmount - bootstrapBalance; adjustment != 0 {
		if err := insertAccountingPartyEntry(t.Context(), pool, "customer", customer.ObjectID,
			"ADVANCE_RECEIPT", adjustment, businessdate.Today().Format(businessdate.Layout), newID()); err != nil {
			t.Fatalf("set prepaid balance for one signoff: %v", err)
		}
	}

	type result struct {
		input  MutationResult
		result MutationResult
		err    error
	}
	results := make(chan result, 2)
	var workers sync.WaitGroup
	for index, input := range []MutationResult{first, second} {
		workers.Add(1)
		go func(index int, input MutationResult) {
			defer workers.Done()
			approved, err := service.Approve(t.Context(), EntitySaleSignoff, DocumentRevisionInput{
				DocumentID: input.DocumentID, Revision: input.Revision,
			}, integrationActorTwo, "prepaid-batch-concurrent-"+string(rune('a'+index)))
			results <- result{input: input, result: approved, err: err}
		}(index, input)
	}
	workers.Wait()
	close(results)

	var winner, loser result
	for outcome := range results {
		if outcome.err == nil {
			winner = outcome
		} else {
			loser = outcome
		}
	}
	if winner.result.DocumentID == "" || loser.input.DocumentID == "" || loser.err == nil ||
		!strings.Contains(loser.err.Error(), "insufficient prepaid funds") {
		t.Fatalf("concurrent prepaid signoffs = winner:%+v loser:%+v", winner, loser)
	}
	if _, err := service.Unapprove(t.Context(), EntitySaleSignoff, ReverseInput{
		DocumentID: winner.result.DocumentID, Revision: winner.result.Revision, Reason: "验证反批准流水撤销",
	}, integrationActorOne, "prepaid-batch-unapprove"); err != nil {
		t.Fatalf("unapprove winning signoff: %v", err)
	}
	var remaining int64
	if err := pool.QueryRow(t.Context(), `SELECT COALESCE(sum(credit_minor-debit_minor),0)::bigint
		FROM acc_voucher_lines line
		JOIN acc_subjects subject ON subject.id=line.subject_id AND subject.settlement_purpose='ADVANCE_RECEIPT'
		JOIN acc_vouchers voucher ON voucher.id=line.voucher_id
		WHERE voucher.business_date <= $1::date`, businessdate.Today().Format(businessdate.Layout)).Scan(&remaining); err != nil {
		t.Fatalf("read prepaid balance after unapproval: %v", err)
	}
	if remaining != firstSignoffAmount {
		t.Fatalf("prepaid balance after signoff unapproval = %d, want %d", remaining, firstSignoffAmount)
	}
}
