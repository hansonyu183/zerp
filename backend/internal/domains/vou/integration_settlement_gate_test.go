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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func createSettlementCustomer(
	t *testing.T,
	pool *pgxpool.Pool,
	employee ReferenceInput,
	termCode, name string,
) ReferenceInput {
	t.Helper()
	settlement := fixedSettlementReference(t, pool, termCode)
	return createApprovedBOB(t, bobdomain.NewService(pool), bobdomain.EntityCustomer, bobdomain.CreateDetailInput{
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

func TestPrepaidApprovalReservesAtomicallyAndUnapproveReleasesIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	customer := createSettlementCustomer(
		t, pool, refs.employee, bobdomain.SettlementTermPrepaid, "预付并发客户",
	)
	first := createCheckedSettlementSale(t, service, refs, customer, "prepaid-first")
	second := createCheckedSettlementSale(t, service, refs, customer, "prepaid-second")

	var amount int64
	if err := pool.QueryRow(t.Context(), `SELECT total_amount_cents FROM vou_documents WHERE id=$1`, first.DocumentID).Scan(&amount); err != nil {
		t.Fatalf("read prepaid order amount: %v", err)
	}
	activateSettlementLedger(t, pool, customer, -amount, "2026-08-04")

	type approvalResult struct {
		input  MutationResult
		result MutationResult
		err    error
	}
	results := make(chan approvalResult, 2)
	var wait sync.WaitGroup
	for index, input := range []MutationResult{first, second} {
		wait.Add(1)
		go func(index int, input MutationResult) {
			defer wait.Done()
			result, err := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
				DocumentID: input.DocumentID, Revision: input.Revision,
			}, integrationActorTwo, "prepaid-concurrent-"+string(rune('a'+index)))
			results <- approvalResult{input: input, result: result, err: err}
		}(index, input)
	}
	wait.Wait()
	close(results)

	var winner, loser approvalResult
	for result := range results {
		if result.err == nil {
			winner = result
		} else {
			loser = result
		}
	}
	if winner.result.DocumentID == "" || loser.input.DocumentID == "" ||
		loser.err == nil || !strings.Contains(loser.err.Error(), "insufficient prepaid funds") {
		t.Fatalf("unexpected concurrent prepaid results winner=%+v loser=%+v", winner, loser)
	}

	unapproved, err := service.Unapprove(t.Context(), EntitySaleOrder, ReverseInput{
		DocumentID: winner.result.DocumentID, Revision: winner.result.Revision,
		Reason: "release prepaid reservation",
	}, integrationActorOne, "prepaid-unapprove")
	if err != nil {
		t.Fatalf("unapprove prepaid winner: %v", err)
	}
	if unapproved.Status != StatusChecked {
		t.Fatalf("unapproved prepaid status = %s", unapproved.Status)
	}
	if _, err = service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: loser.input.DocumentID, Revision: loser.input.Revision,
	}, integrationActorTwo, "prepaid-after-release"); err != nil {
		t.Fatalf("approve prepaid order after release: %v", err)
	}
}

func TestPrepaidReopenDoesNotReserveRefusalReturnAmountIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	customer := createSettlementCustomer(
		t, pool, refs.employee, bobdomain.SettlementTermPrepaid, "预付拒收客户",
	)
	order := createCheckedSettlementSale(t, service, refs, customer, "prepaid-refusal")
	var orderAmount int64
	if err := pool.QueryRow(t.Context(), `SELECT total_amount_cents FROM vou_documents WHERE id=$1`, order.DocumentID).
		Scan(&orderAmount); err != nil {
		t.Fatalf("read refusal order amount: %v", err)
	}
	activateSettlementLedger(t, pool, customer, -orderAmount, "2026-08-04")
	approved, err := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: order.Revision,
	}, integrationActorTwo, "prepaid-refusal-approve")
	if err != nil {
		t.Fatalf("approve refusal order: %v", err)
	}
	orderView, err := service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: approved.DocumentID})
	if err != nil {
		t.Fatalf("get refusal order: %v", err)
	}
	outbound, _ := advanceSalesDocument(t, service, EntitySaleOutbound, DraftInput{
		BusinessDate: "2026-08-05", SourceDocumentID: approved.DocumentID,
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
			SignedQuantity: "0.6", RejectedQuantity: "0.4",
		}},
	}, true)

	var refusalID string
	var refusalRevision int64
	if err = pool.QueryRow(t.Context(), `SELECT document.id,document.revision
		FROM vou_documents document
		JOIN vou_sale_return_details detail ON detail.document_id=document.id
		WHERE detail.source_signoff_id=$1 AND detail.return_kind='REFUSAL'`, signoff.DocumentID).
		Scan(&refusalID, &refusalRevision); err != nil {
		t.Fatalf("load refusal return: %v", err)
	}
	saved, err := service.Save(t.Context(), EntitySaleReturn, SaveInput{
		DocumentID: refusalID, Revision: refusalRevision, Data: DraftInput{
			BusinessDate: "2026-08-05", Warehouse: &refs.warehouse, ReturnReason: "客户拒收",
		},
	}, integrationActorOne, "prepaid-refusal-save")
	if err != nil {
		t.Fatalf("save refusal return: %v", err)
	}
	checked, err := service.Check(t.Context(), EntitySaleReturn, DocumentRevisionInput{
		DocumentID: refusalID, Revision: saved.Revision,
	}, integrationActorOne, "prepaid-refusal-check")
	if err != nil {
		t.Fatalf("check refusal return: %v", err)
	}
	if _, err = service.Approve(t.Context(), EntitySaleReturn, DocumentRevisionInput{
		DocumentID: refusalID, Revision: checked.Revision,
	}, integrationActorOne, "prepaid-refusal-return-approve"); err != nil {
		t.Fatalf("approve refusal return: %v", err)
	}

	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin refusal settlement reopen: %v", err)
	}
	if err = service.restoreOrderSettlement(t.Context(), tx, EntitySaleOrder, approved.DocumentID); err != nil {
		_ = tx.Rollback(t.Context())
		t.Fatalf("reopen refusal settlement: %v", err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit refusal settlement reopen: %v", err)
	}
	var signoffAmount, reservedAmount int64
	if err = pool.QueryRow(t.Context(), `SELECT total_amount_cents FROM vou_documents WHERE id=$1`, signoff.DocumentID).
		Scan(&signoffAmount); err != nil {
		t.Fatalf("read signoff amount: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT reserved_amount_cents
		FROM vou_settlement_reservations WHERE order_id=$1`, approved.DocumentID).
		Scan(&reservedAmount); err != nil {
		t.Fatalf("read refusal reservation: %v", err)
	}
	if want := orderAmount - signoffAmount; reservedAmount != want {
		t.Fatalf("refusal reservation = %d, want %d", reservedAmount, want)
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
	if err = service.reserveOrderSettlement(t.Context(), tx, EntitySaleOrder, order.DocumentID); err != nil {
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

func TestCashOnDeliveryBlocksDebtAndSecondOpenOrderIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	customer := createSettlementCustomer(
		t, pool, refs.employee, bobdomain.SettlementTermCashOnDelivery, "现结门槛客户",
	)
	activateSettlementLedger(t, pool, customer, 0, "2026-08-04")
	first := createCheckedSettlementSale(t, service, refs, customer, "cod-first")
	second := createCheckedSettlementSale(t, service, refs, customer, "cod-second")
	approved, err := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: first.DocumentID, Revision: first.Revision,
	}, integrationActorTwo, "cod-first-approve")
	if err != nil {
		t.Fatalf("approve first COD order: %v", err)
	}
	if _, err = service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: second.DocumentID, Revision: second.Revision,
	}, integrationActorTwo, "cod-second-approve"); err == nil ||
		!strings.Contains(err.Error(), "unfinished cash-on-delivery order") {
		t.Fatalf("second COD order error = %v", err)
	}
	if _, err = service.Unapprove(t.Context(), EntitySaleOrder, ReverseInput{
		DocumentID: approved.DocumentID, Revision: approved.Revision, Reason: "release COD order",
	}, integrationActorOne, "cod-first-unapprove"); err != nil {
		t.Fatalf("unapprove first COD order: %v", err)
	}
	secondApproved, err := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: second.DocumentID, Revision: second.Revision,
	}, integrationActorTwo, "cod-second-after-release")
	if err != nil {
		t.Fatalf("approve second COD order after release: %v", err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin COD reopen transaction: %v", err)
	}
	if err = service.reserveOrderSettlement(
		t.Context(), tx, EntitySaleOrder, first.DocumentID,
	); err == nil || !strings.Contains(err.Error(), "unfinished cash-on-delivery order") {
		_ = tx.Rollback(t.Context())
		t.Fatalf("reopened first COD order ignored active second order: %v", err)
	}
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatalf("rollback COD reopen transaction: %v", err)
	}
	if _, err = service.Unapprove(t.Context(), EntitySaleOrder, ReverseInput{
		DocumentID: secondApproved.DocumentID, Revision: secondApproved.Revision,
		Reason: "release second COD order",
	}, integrationActorOne, "cod-second-unapprove"); err != nil {
		t.Fatalf("unapprove second COD order: %v", err)
	}
	if err = insertAccountingPartyEntry(t.Context(), pool, "customer", customer.ObjectID,
		"RECEIVABLE", 1, "2026-08-04", newID()); err != nil {
		t.Fatalf("insert COD debt: %v", err)
	}
	tx, err = pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin COD debt reopen transaction: %v", err)
	}
	if err = service.reserveOrderSettlement(
		t.Context(), tx, EntitySaleOrder, first.DocumentID,
	); err == nil || !strings.Contains(err.Error(), "outstanding debt") {
		_ = tx.Rollback(t.Context())
		t.Fatalf("reopened COD order ignored unrelated debt: %v", err)
	}
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatalf("rollback COD debt reopen transaction: %v", err)
	}
	third := createCheckedSettlementSale(t, service, refs, customer, "cod-debt")
	if _, err = service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: third.DocumentID, Revision: third.Revision,
	}, integrationActorTwo, "cod-debt-approve"); err == nil ||
		!strings.Contains(err.Error(), "outstanding debt") {
		t.Fatalf("COD debt error = %v", err)
	}
}

func TestCashOnDeliveryReopenExcludesOnlyOrderAttributedTradeBalanceIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	customer := createSettlementCustomer(
		t, pool, refs.employee, bobdomain.SettlementTermCashOnDelivery, "现结归因客户",
	)
	activateSettlementLedger(t, pool, customer, 0, "2026-08-04")
	order := createCheckedSettlementSale(t, service, refs, customer, "cod-attributed")
	approved, err := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: order.Revision,
	}, integrationActorTwo, "cod-attributed-approve")
	if err != nil {
		t.Fatalf("approve attributed COD order: %v", err)
	}
	orderView, err := service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: approved.DocumentID})
	if err != nil {
		t.Fatalf("get attributed COD order: %v", err)
	}
	outbound, _ := advanceSalesDocument(t, service, EntitySaleOutbound, DraftInput{
		BusinessDate: "2026-08-05", SourceDocumentID: approved.DocumentID,
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
	}, true)

	if err = insertAccountingPartyEntry(t.Context(), pool, "customer", customer.ObjectID,
		"RECEIVABLE", -200, "2026-08-05", signoff.DocumentID); err != nil {
		t.Fatalf("insert attributed COD credit: %v", err)
	}
	if err = insertAccountingPartyEntry(t.Context(), pool, "customer", customer.ObjectID,
		"RECEIVABLE", 500, "2026-08-05", newID()); err != nil {
		t.Fatalf("insert unrelated COD debt: %v", err)
	}

	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin attributed COD reopen transaction: %v", err)
	}
	if err = service.reserveOrderSettlement(t.Context(), tx, EntitySaleOrder, approved.DocumentID); err == nil ||
		!strings.Contains(err.Error(), "outstanding debt") {
		_ = tx.Rollback(t.Context())
		t.Fatalf("attributed COD credit hid unrelated debt: %v", err)
	}
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatalf("rollback attributed COD reopen transaction: %v", err)
	}
}
