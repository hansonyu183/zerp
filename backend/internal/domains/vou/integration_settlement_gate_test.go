//go:build integration

package vou

import (
	"context"
	"strings"
	"sync"
	"testing"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
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
			'customer',$7,$8,'CUSTOMER','Settlement customer','CNY',$9)`,
			newID(), generationID, newID(), effectiveDate, integrationActorOne,
			"settlement-gate-opening", customer.ObjectID, customer.VersionID, amountCents); err != nil {
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
	if _, err = service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: second.DocumentID, Revision: second.Revision,
	}, integrationActorTwo, "cod-second-after-release"); err != nil {
		t.Fatalf("approve second COD order after release: %v", err)
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
	third := createCheckedSettlementSale(t, service, refs, customer, "cod-debt")
	if _, err = service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: third.DocumentID, Revision: third.Revision,
	}, integrationActorTwo, "cod-debt-approve"); err == nil ||
		!strings.Contains(err.Error(), "outstanding debt") {
		t.Fatalf("COD debt error = %v", err)
	}
}
