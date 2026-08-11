//go:build integration

package vou

import (
	"context"
	"strings"
	"sync"
	"testing"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/businessdate"
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
	generationID := newID()
	if _, err := pool.Exec(t.Context(), `INSERT INTO led_generations(
		id,cutover_date,status,activated_by,request_id
	) VALUES($1,CURRENT_DATE,'ACTIVE',$2,$3)`, generationID, integrationActorOne, "settlement-gate-ledger"); err != nil {
		t.Fatalf("insert settlement ledger generation: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE led_control SET
		status='ACTIVE',cutover_date=CURRENT_DATE,active_generation_id=$1,
		revision=revision+1,updated_by=$2`, generationID, integrationActorOne); err != nil {
		t.Fatalf("activate settlement ledger: %v", err)
	}
	if amountCents != 0 {
		if _, err := pool.Exec(t.Context(), `INSERT INTO led_party_entries(
			id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
			source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,
			counterparty_entity,counterparty_object_id,counterparty_version_id,
			counterparty_code,counterparty_name,currency,amount_delta_cents
		) VALUES($1,$2,'OPENING','opening',$3,'OPENING','',0,$4::date,now(),$5,$6,
			$7,$8,$9,'PARTY','Settlement party','CNY',$10)`,
			newID(), generationID, newID(), effectiveDate, integrationActorOne,
			"settlement-gate-opening", partyEntity, party.ObjectID, party.VersionID, amountCents); err != nil {
			t.Fatalf("insert settlement ledger balance: %v", err)
		}
	}
	t.Cleanup(func() {
		cleanupContext := context.Background()
		if _, err := pool.Exec(cleanupContext, `UPDATE led_control SET
			status='DRAFT',cutover_date=NULL,active_generation_id=NULL,
			revision=revision+1,updated_by=$1`, integrationActorOne); err != nil {
			t.Errorf("reset settlement ledger control: %v", err)
			return
		}
		if _, err := pool.Exec(cleanupContext, `DELETE FROM led_party_entries WHERE generation_id=$1`, generationID); err != nil {
			t.Errorf("delete settlement ledger entries: %v", err)
		}
		if _, err := pool.Exec(cleanupContext, `DELETE FROM led_generations WHERE id=$1`, generationID); err != nil {
			t.Errorf("delete settlement ledger generation: %v", err)
		}
	})
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
	if _, err := pool.Exec(t.Context(), `INSERT INTO led_party_entries(
		id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
		source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,
		counterparty_entity,counterparty_object_id,counterparty_version_id,
		counterparty_code,counterparty_name,currency,amount_delta_cents,
		account_type,other_category
	) SELECT $1,active_generation_id,'POSTING','intermediary-calculation',$2,'ICL-REBATE','',1,
		CURRENT_DATE,now(),$3,'prepaid-other-entry','customer',$4,$5,'CUSTOMER',
		'Rebate customer','CNY',$6,'OTHER','REBATE'
		FROM led_control WHERE singleton AND status='ACTIVE'`, newID(), newID(),
		integrationActorOne, customer.ObjectID, customer.VersionID, -amount); err != nil {
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
		!strings.Contains(err.Error(), "settlement ledger is not active") {
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
	if _, err = pool.Exec(t.Context(), `INSERT INTO led_party_entries(
		id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
		source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,
		counterparty_entity,counterparty_object_id,counterparty_version_id,
		counterparty_code,counterparty_name,currency,amount_delta_cents
	) SELECT $1,active_generation_id,'POSTING','receipt',$2,'DEBT','',1,CURRENT_DATE,
		now(),$3,$4,'customer',$5,$6,'CUSTOMER','COD customer','CNY',1
		FROM led_control WHERE singleton AND status='ACTIVE'`, newID(), newID(),
		integrationActorOne, "cod-debt-entry", customer.ObjectID, customer.VersionID); err != nil {
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

	var attributedBalance int64
	if err = pool.QueryRow(t.Context(), `SELECT COALESCE(sum(amount_delta_cents),0)::bigint
		FROM led_party_entries
		WHERE generation_id=(SELECT active_generation_id FROM led_control WHERE singleton)
		  AND counterparty_entity='customer' AND counterparty_object_id=$1
		  AND source_document_id=$2 AND account_type='TRADE'`,
		customer.ObjectID, signoff.DocumentID).Scan(&attributedBalance); err != nil {
		t.Fatalf("read attributed COD balance: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO led_party_entries(
		id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
		source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,
		counterparty_entity,counterparty_object_id,counterparty_version_id,
		counterparty_code,counterparty_name,currency,amount_delta_cents
	) SELECT $1,active_generation_id,'POSTING','sale-signoff',$2,'ATTRIBUTED',$3,99,
		CURRENT_DATE,now(),$4,'cod-attributed-credit','customer',$5,$6,'CUSTOMER',
		'COD customer','CNY',$7
		FROM led_control WHERE singleton AND status='ACTIVE'`, newID(), signoff.DocumentID,
		newID(), integrationActorOne, customer.ObjectID, customer.VersionID,
		-200-attributedBalance); err != nil {
		t.Fatalf("insert attributed COD credit: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO led_party_entries(
		id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
		source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,
		counterparty_entity,counterparty_object_id,counterparty_version_id,
		counterparty_code,counterparty_name,currency,amount_delta_cents
	) SELECT $1,active_generation_id,'POSTING','receipt',$2,'UNRELATED',$3,1,
		CURRENT_DATE,now(),$4,'cod-unrelated-debt','customer',$5,$6,'CUSTOMER',
		'COD customer','CNY',500
		FROM led_control WHERE singleton AND status='ACTIVE'`, newID(), newID(), newID(),
		integrationActorOne, customer.ObjectID, customer.VersionID); err != nil {
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
