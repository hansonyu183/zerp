//go:build integration

package vou

import (
	"context"
	"sync"
	"testing"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/businessdate"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
)

func TestFulfilledPurchaseOrderAllowsReturnDraftInOpenPeriodIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	activateSettlementLedgerForParty(t, pool, "supplier", refs.supplier, 0, "2026-07-01")
	service := newIntegrationService(t, pool)
	order, err := service.Create(t.Context(), EntityPurchaseOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28", Currency: "CNY",
		Supplier: &refs.supplier, Purchaser: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{integrationProductLine(t, refs.product, "3", "12.00")},
	}}, integrationApprovalActor(t, integrationActorOne, "closed-purchase-create"))
	if err != nil {
		t.Fatalf("create purchase order: %v", err)
	}
	checkedOrder, err := service.Submit(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: order.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "closed-purchase-check"))
	if err != nil {
		t.Fatalf("check purchase order: %v", err)
	}
	_, err = service.Approve(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: checkedOrder.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "closed-purchase-approve"))
	if err != nil {
		t.Fatalf("approve purchase order: %v", err)
	}
	orderView, err := service.Get(t.Context(), EntityPurchaseOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil {
		t.Fatalf("get purchase order: %v", err)
	}
	orderLineID := orderView.Data.ProductLines[0].LineID
	inbound, err := service.CreatePurchaseInbound(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-29", SourceDocumentID: order.DocumentID,
		Warehouse:   &refs.warehouse,
		SourceLines: []SourceQuantityLineInput{{SourceLineID: orderLineID, BaseQuantity: "3"}},
	}}, integrationApprovalActor(t, integrationActorOne, "closed-purchase-inbound-create"))
	if err != nil {
		t.Fatalf("create purchase inbound: %v", err)
	}
	checkedInbound, err := service.Submit(t.Context(), EntityPurchaseInbound, DocumentRevisionInput{
		DocumentID: inbound.DocumentID, Revision: inbound.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "closed-purchase-inbound-check"))
	if err != nil {
		t.Fatalf("check purchase inbound: %v", err)
	}
	approvedInbound, err := service.Approve(t.Context(), EntityPurchaseInbound, DocumentRevisionInput{
		DocumentID: inbound.DocumentID, Revision: checkedInbound.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "closed-purchase-inbound-approve"))
	if err != nil {
		t.Fatalf("approve purchase inbound: %v", err)
	}
	inboundView, err := service.Get(t.Context(), EntityPurchaseInbound, GetInput{DocumentID: approvedInbound.DocumentID})
	if err != nil {
		t.Fatalf("get purchase inbound: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO acc_periods(
		book_id,period_month,state,locked_at,locked_by,updated_by
	) SELECT id,'2026-07-01','LOCKED',now(),$1,$1 FROM acc_books WHERE control_book`,
		integrationActorOne); err != nil {
		t.Fatalf("lock accounting period: %v", err)
	}
	returnDraft, err := service.CreatePurchaseReturn(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-08-01", Warehouse: &refs.warehouse,
		ReturnReason: "开放期间采购退货",
		ReturnLines: []ReturnLineInput{{
			SourceLineID: inboundView.Data.ProductLines[0].LineID, BaseQuantity: "1",
		}},
	}}, integrationApprovalActor(t, integrationActorOne, "fulfilled-purchase-return-create"))
	if err != nil || returnDraft.Approval.Status != StatusDraft {
		t.Fatalf("create return draft = %+v, err=%v", returnDraft, err)
	}
	var orderStatus, fulfillment string
	var childCount int
	if err = pool.QueryRow(t.Context(), `SELECT approval.status,o.fulfillment_status
		FROM vou_documents d
		JOIN approval_entries approval ON approval.id=d.approval_entry_id
		JOIN vou_purchase_order_details o ON o.document_id=d.id
		WHERE d.id=$1`, order.DocumentID).Scan(&orderStatus, &fulfillment); err != nil {
		t.Fatalf("read closed purchase order: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM vou_documents
		WHERE parent_document_id=$1`, order.DocumentID).Scan(&childCount); err != nil {
		t.Fatalf("count rolled back purchase children: %v", err)
	}
	if orderStatus != StatusApproved || fulfillment != "FULFILLED" || childCount != 2 {
		t.Fatalf("fulfilled purchase order changed = status:%s fulfillment:%s children:%d", orderStatus, fulfillment, childCount)
	}
}

func TestPurchaseFulfillmentQuantitiesIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	prepaid := fixedSettlementReference(t, pool, bobdomain.SettlementTermPrepaid)
	refs.supplier = createApprovedBOB(t, newBOBIntegrationService(pool), bobdomain.EntitySupplier, bobdomain.CreateDetailInput{
		Code: "VSP" + newID(), Name: "VOU 预付供应商",
		SettlementMethodID: prepaid.ObjectID, DefaultPurchaserEmployeeID: refs.employee.ObjectID,
	})
	var pieceUnitID string
	if err := pool.QueryRow(t.Context(), `SELECT id FROM aux_objects WHERE entity='measurement-unit' AND code='UNT-0004'`).Scan(&pieceUnitID); err != nil {
		t.Fatalf("find packaging measurement unit: %v", err)
	}
	refs.product = createApprovedBOB(t, newBOBIntegrationService(pool), bobdomain.EntityProduct, bobdomain.CreateDetailInput{
		Code: "VPP" + newID(), Name: "VOU 预付采购包装物", ProductTypeID: "01JPTP00000000000000000007",
		DefaultInputUnitID: pieceUnitID, PricingUnitID: pieceUnitID,
		UnitConversions: []bobdomain.ProductUnitConversion{{
			Unit: bobdomain.MeasurementUnitSnapshot{ObjectID: pieceUnitID}, Factor: "1",
		}},
	})
	activateSettlementLedgerForParty(
		t, pool, "supplier", refs.supplier, 12000,
		businessdate.Today().Format(businessdate.Layout),
	)
	bus := txevent.NewBus()
	registerSettlementPosting := func(entity string, sign int64) {
		t.Helper()
		if err := ApprovalTopic(entity).Subscribe(bus, "test-acc-posting",
			func(ctx context.Context, tx pgx.Tx, event approval.Event[DocumentView]) error {
				if event.Action != approval.ActionApproved {
					return nil
				}
				var amount int64
				if err := tx.QueryRow(ctx, `SELECT total_amount_cents FROM vou_documents WHERE id=$1`, event.Entry.SubjectID).Scan(&amount); err != nil {
					return err
				}
				return insertAccountingPartyEntry(ctx, tx, "supplier", refs.supplier.ObjectID,
					"PREPAID", sign*amount, businessdate.Today().Format(businessdate.Layout), event.Entry.SubjectID)
			}); err != nil {
			t.Fatalf("register %s settlement posting: %v", entity, err)
		}
		if err := ApprovalTopic(entity).Subscribe(bus, "test-acc-reversal",
			func(ctx context.Context, tx pgx.Tx, event approval.Event[DocumentView]) error {
				if event.Action != approval.ActionUnapproved {
					return nil
				}
				_, err := tx.Exec(ctx, `DELETE FROM acc_vouchers
					WHERE source_id=$1`, event.Entry.SubjectID)
				return err
			}); err != nil {
			t.Fatalf("register %s settlement reversal: %v", entity, err)
		}
	}
	registerSettlementPosting(EntityPurchaseInbound, -1)
	registerSettlementPosting(EntityPurchaseReturn, 1)
	service := newIntegrationServiceWithBus(t, pool, bus)

	order, err := service.Create(t.Context(), EntityPurchaseOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28", Currency: "CNY",
		Supplier: &refs.supplier, Purchaser: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{{
			Product: ProductReferenceInput{ObjectID: refs.product.ObjectID}, EnteredQuantity: "10",
			EnteredUnit: UnitReferenceInput{ObjectID: pieceUnitID}, BaseQuantity: "10", UnitPrice: "12.00",
		}},
	}}, integrationApprovalActor(t, integrationActorOne, "purchase-create"))
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	checked, err := service.Submit(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: order.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "purchase-check"))
	if err != nil {
		domainErr, _ := err.(*DomainError)
		t.Fatalf("check order: %#v cause=%v", err, domainErr.Cause)
	}
	var orderAmount, prepaidBalance int64
	if err = pool.QueryRow(t.Context(), `SELECT document.total_amount_cents,
		COALESCE(sum(line.debit_minor-line.credit_minor),0)::bigint
		FROM vou_documents document
		JOIN vou_purchase_order_details detail ON detail.document_id=document.id
		LEFT JOIN acc_books book ON book.control_book
		LEFT JOIN acc_subjects subject ON subject.book_id=book.id AND subject.settlement_purpose='PREPAID'
		LEFT JOIN acc_voucher_lines line ON line.book_id=book.id AND line.subject_id=subject.id
		 AND line.dimensions->>'SUPPLIER_RELATIONSHIP'=detail.supplier_object_id AND line.currency=document.currency
		WHERE document.id=$1 GROUP BY document.total_amount_cents`, order.DocumentID).
		Scan(&orderAmount, &prepaidBalance); err != nil || orderAmount != 12000 || prepaidBalance != 12000 {
		t.Fatalf("prepaid purchase setup = amount:%d balance:%d err=%v", orderAmount, prepaidBalance, err)
	}
	approved, err := service.Approve(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: checked.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "purchase-approve"))
	if err != nil {
		t.Fatalf("approve order: %v", err)
	}
	view, err := service.Get(t.Context(), EntityPurchaseOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	sourceLineID := view.Data.ProductLines[0].LineID
	createInbound := func(quantity, requestID string) MutationResult {
		t.Helper()
		tx, createErr := pool.Begin(t.Context())
		if createErr != nil {
			t.Fatalf("begin workflow inbound %s: %v", quantity, createErr)
		}
		result, createErr := service.CreateWorkflowPurchaseInbound(t.Context(), tx, order.DocumentID, WorkflowPurchaseInboundInitial{
			BusinessDate: "2026-07-28", WarehouseObjectID: refs.warehouse.ObjectID,
			Lines: []SourceQuantityLineInput{{
				SourceLineID: sourceLineID, BaseQuantity: quantity,
			}},
		}, requestID)
		if createErr == nil {
			createErr = tx.Commit(t.Context())
		} else {
			_ = tx.Rollback(t.Context())
		}
		if createErr != nil {
			t.Fatalf("create inbound %s: %v", quantity, createErr)
		}
		return result
	}
	approveInbound := func(inbound MutationResult, requestID string) MutationResult {
		t.Helper()
		checkedInbound, checkErr := service.Submit(
			t.Context(), EntityPurchaseInbound, DocumentRevisionInput{
				DocumentID: inbound.DocumentID, Revision: inbound.Approval.Revision,
			}, integrationApprovalActor(t, integrationActorOne, requestID+"-submit"))
		if checkErr != nil {
			t.Fatalf("check inbound: %v", checkErr)
		}
		approvedInbound, approveErr := service.Approve(
			t.Context(), EntityPurchaseInbound, DocumentRevisionInput{
				DocumentID: inbound.DocumentID, Revision: checkedInbound.Approval.Revision,
			}, integrationApprovalActor(t, integrationActorTwo, requestID+"-approve"))
		if approveErr != nil {
			t.Fatalf("approve inbound: %v", approveErr)
		}
		if approvedInbound.Approval.Status != StatusApproved {
			t.Fatalf("approved inbound status = %s", approvedInbound.Approval.Status)
		}
		return approvedInbound
	}

	first := createInbound("4", "inbound-one")
	if _, err = service.CreatePurchaseInbound(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28", SourceDocumentID: order.DocumentID,
		Warehouse: &refs.warehouse,
		SourceLines: []SourceQuantityLineInput{{
			SourceLineID: sourceLineID, BaseQuantity: "7",
		}},
	}}, integrationApprovalActor(t, integrationActorOne, "inbound-over")); err == nil {
		t.Fatal("cumulative inbound overage was accepted")
	}
	approvedFirst := approveInbound(first, "inbound-one")
	firstView, err := service.Get(t.Context(), EntityPurchaseInbound, GetInput{
		DocumentID: first.DocumentID,
	})
	if err != nil {
		t.Fatalf("get first inbound: %v", err)
	}
	partialReturn, err := service.CreatePurchaseReturn(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-29", Warehouse: &refs.warehouse,
		ReturnReason: "部分入库退货",
		ReturnLines: []ReturnLineInput{{
			SourceLineID: firstView.Data.ProductLines[0].LineID, BaseQuantity: "1",
		}},
	}}, integrationApprovalActor(t, integrationActorOne, "partial-purchase-return-create"))
	if err != nil {
		t.Fatalf("create partial purchase return: %v", err)
	}
	partialChecked, err := service.Submit(t.Context(), EntityPurchaseReturn, DocumentRevisionInput{
		DocumentID: partialReturn.DocumentID, Revision: partialReturn.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "partial-purchase-return-check"))
	if err != nil {
		t.Fatalf("check partial purchase return: %v", err)
	}
	partialApproved, err := service.Approve(t.Context(), EntityPurchaseReturn, DocumentRevisionInput{
		DocumentID: partialReturn.DocumentID, Revision: partialChecked.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "partial-purchase-return-approve"))
	if err != nil {
		t.Fatalf("approve partial purchase return: %v", err)
	}
	partialReversed, err := service.Unapprove(t.Context(), EntityPurchaseReturn, ReverseInput{
		DocumentID: partialReturn.DocumentID, Revision: partialApproved.Approval.Revision,
		Reason: "清理部分退货测试",
	}, integrationApprovalActor(t, integrationActorOne, "partial-purchase-return-unapprove"))
	if err != nil {
		t.Fatalf("unapprove partial purchase return: %v", err)
	}
	partialDraft, err := service.Unsubmit(t.Context(), EntityPurchaseReturn, DocumentRevisionInput{
		DocumentID: partialReturn.DocumentID, Revision: partialReversed.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "partial-purchase-return-uncheck"))
	if err != nil {
		t.Fatalf("uncheck partial purchase return: %v", err)
	}
	if _, err = service.Delete(t.Context(), EntityPurchaseReturn, DeleteInput{
		DocumentID: partialReturn.DocumentID, Revision: partialDraft.Approval.Revision,
		Reason: "清理部分退货测试",
	}, integrationApprovalActor(t, integrationActorOne, "partial-purchase-return-delete")); err != nil {
		t.Fatalf("delete partial purchase return: %v", err)
	}

	draft := createInbound("6", "inbound-draft")
	if _, err = service.DeletePurchaseInbound(t.Context(), ReverseInput{
		DocumentID: draft.DocumentID, Revision: draft.Approval.Revision, Reason: "重新拆分",
	}, integrationApprovalActor(t, integrationActorOne, "inbound-delete")); err != nil {
		t.Fatalf("delete inbound draft: %v", err)
	}
	second := createInbound("6", "inbound-two")
	approvedSecond := approveInbound(second, "inbound-two")

	var fulfillment string
	if err = pool.QueryRow(t.Context(), `SELECT fulfillment_status
		FROM vou_purchase_order_details
		WHERE document_id=$1`, order.DocumentID).Scan(&fulfillment); err != nil {
		t.Fatalf("read fulfillment: %v", err)
	}
	if fulfillment != "FULFILLED" {
		t.Fatalf("fulfillment = %s", fulfillment)
	}
	temporaryReturn, err := service.CreatePurchaseReturn(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-29", Warehouse: &refs.warehouse,
		ReturnReason: "临时采购退货",
		ReturnLines: []ReturnLineInput{{
			SourceLineID: firstView.Data.ProductLines[0].LineID, BaseQuantity: "1",
		}},
	}}, integrationApprovalActor(t, integrationActorOne, "temporary-purchase-return-create"))
	if err != nil {
		t.Fatalf("create temporary purchase return: %v", err)
	}
	orderWithDraftReturn, err := service.Get(t.Context(), EntityPurchaseOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil || orderWithDraftReturn.Approval.Status != StatusApproved {
		t.Fatalf("draft return changed order lifecycle: status=%s err=%v", orderWithDraftReturn.Approval.Status, err)
	}
	if _, err = service.Delete(t.Context(), EntityPurchaseReturn, DeleteInput{
		DocumentID: temporaryReturn.DocumentID, Revision: temporaryReturn.Approval.Revision,
		Reason: "取消临时采购退货",
	}, integrationApprovalActor(t, integrationActorOne, "temporary-purchase-return-delete")); err != nil {
		t.Fatalf("delete temporary purchase return: %v", err)
	}
	orderWithoutDraftReturn, err := service.Get(t.Context(), EntityPurchaseOrder, GetInput{DocumentID: order.DocumentID})
	if err != nil || orderWithoutDraftReturn.Approval.Status != StatusApproved {
		t.Fatalf("deleting draft return changed order lifecycle: status=%s err=%v", orderWithoutDraftReturn.Approval.Status, err)
	}
	purchaseReturn, err := service.CreatePurchaseReturn(t.Context(), CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-29", Warehouse: &refs.warehouse,
		ReturnReason: "供应商质量退货",
		ReturnLines: []ReturnLineInput{{
			SourceLineID: firstView.Data.ProductLines[0].LineID, BaseQuantity: "2",
		}},
	}}, integrationApprovalActor(t, integrationActorOne, "purchase-return-create"))
	if err != nil {
		t.Fatalf("create purchase return: %v", err)
	}
	returnChecked, err := service.Submit(t.Context(), EntityPurchaseReturn, DocumentRevisionInput{
		DocumentID: purchaseReturn.DocumentID, Revision: purchaseReturn.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "purchase-return-check"))
	if err != nil {
		t.Fatalf("check purchase return: %v", err)
	}
	returnApproved, err := service.Approve(t.Context(), EntityPurchaseReturn, DocumentRevisionInput{
		DocumentID: purchaseReturn.DocumentID, Revision: returnChecked.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "purchase-return-approve"))
	if err != nil {
		t.Fatalf("approve purchase return: %v", err)
	}
	if returnApproved.Approval.Status != StatusApproved {
		t.Fatalf("approved purchase return status = %s", returnApproved.Approval.Status)
	}
	if err = pool.QueryRow(t.Context(), `SELECT fulfillment_status
		FROM vou_purchase_order_details WHERE document_id=$1`, order.DocumentID).
		Scan(&fulfillment); err != nil || fulfillment != "OPEN" {
		t.Fatalf("purchase return did not restore available quantity: %s, err=%v", fulfillment, err)
	}
	replacement := createInbound("2", "replacement-inbound")
	if _, err = service.Unapprove(t.Context(), EntityPurchaseReturn, ReverseInput{
		DocumentID: purchaseReturn.DocumentID, Revision: returnApproved.Approval.Revision,
		Reason: "尝试撤销",
	}, integrationApprovalActor(t, integrationActorOne, "purchase-return-unapprove-blocked")); err == nil {
		t.Fatal("purchase return reversal ignored replacement inbound")
	}
	if _, err = service.DeletePurchaseInbound(t.Context(), ReverseInput{
		DocumentID: replacement.DocumentID, Revision: replacement.Approval.Revision, Reason: "释放替代入库",
	}, integrationApprovalActor(t, integrationActorOne, "replacement-delete")); err != nil {
		t.Fatalf("delete replacement inbound: %v", err)
	}
	if _, err = service.Unapprove(t.Context(), EntityPurchaseInbound, ReverseInput{
		DocumentID: first.DocumentID, Revision: approvedFirst.Approval.Revision, Reason: "来源有退货",
	}, integrationApprovalActor(t, integrationActorOne, "source-inbound-unapprove-blocked")); err == nil {
		t.Fatal("source inbound with purchase return was unapproved")
	}
	if _, err = service.Unapprove(t.Context(), EntityPurchaseReturn, ReverseInput{
		DocumentID: purchaseReturn.DocumentID, Revision: returnApproved.Approval.Revision,
		Reason: "撤销采购退货",
	}, integrationApprovalActor(t, integrationActorOne, "purchase-return-unapprove")); err != nil {
		t.Fatalf("unapprove purchase return: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT fulfillment_status
		FROM vou_purchase_order_details WHERE document_id=$1`, order.DocumentID).
		Scan(&fulfillment); err != nil || fulfillment != "FULFILLED" {
		t.Fatalf("purchase return reversal did not restore fulfilled quantity: %s, err=%v", fulfillment, err)
	}
	if _, err = service.Unapprove(t.Context(), EntityPurchaseInbound, ReverseInput{
		DocumentID: second.DocumentID, Revision: approvedSecond.Approval.Revision, Reason: "验收撤回",
	}, integrationApprovalActor(t, integrationActorOne, "inbound-unapprove")); err != nil {
		t.Fatalf("unapprove inbound: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT fulfillment_status
		FROM vou_purchase_order_details WHERE document_id=$1`, order.DocumentID).
		Scan(&fulfillment); err != nil || fulfillment != "OPEN" {
		t.Fatalf("fulfillment after inbound unapproval = %s, err=%v", fulfillment, err)
	}

	_ = approved
}

func TestPurchaseFulfillmentConcurrentInboundCreationAllowsOneWinnerIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)

	order, err := service.Create(t.Context(), EntityPurchaseOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-28", Currency: "CNY",
		Supplier: &refs.supplier, Purchaser: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{integrationProductLine(t, refs.product, "10", "12.00")},
	}}, integrationApprovalActor(t, integrationActorOne, "concurrent-purchase-create"))
	if err != nil {
		t.Fatal(err)
	}
	checked, err := service.Submit(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: order.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "concurrent-purchase-check"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Approve(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: order.DocumentID, Revision: checked.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "concurrent-purchase-approve")); err != nil {
		t.Fatal(err)
	}
	view, err := service.Get(t.Context(), EntityPurchaseOrder, GetInput{
		DocumentID: order.DocumentID,
	})
	if err != nil {
		t.Fatal(err)
	}
	sourceLineID := view.Data.ProductLines[0].LineID

	start := make(chan struct{})
	results := make(chan error, 2)
	var workers sync.WaitGroup
	for _, requestID := range []string{"concurrent-inbound-one", "concurrent-inbound-two"} {
		workers.Add(1)
		go func(requestID string) {
			defer workers.Done()
			<-start
			_, createErr := service.CreatePurchaseInbound(t.Context(), CreateInput{Data: DraftInput{
				BusinessDate: "2026-07-28", SourceDocumentID: order.DocumentID,
				Warehouse: &refs.warehouse,
				SourceLines: []SourceQuantityLineInput{{
					SourceLineID: sourceLineID, BaseQuantity: "6",
				}},
			}}, integrationApprovalActor(t, integrationActorOne, requestID))
			results <- createErr
		}(requestID)
	}
	close(start)
	workers.Wait()
	close(results)

	successes := 0
	failures := 0
	for createErr := range results {
		if createErr == nil {
			successes++
		} else {
			failures++
		}
	}
	if successes != 1 || failures != 1 {
		t.Fatalf("concurrent inbound drafts = %d success/%d failure, want 1/1", successes, failures)
	}
	var reserved int64
	if err = pool.QueryRow(t.Context(), `
		SELECT COALESCE(sum(base_quantity_micros), 0)
		FROM vou_purchase_inbound_lines
		WHERE source_order_line_id = $1`, sourceLineID).Scan(&reserved); err != nil {
		t.Fatal(err)
	}
	if reserved != 6_000_000 {
		t.Fatalf("reserved quantity = %d, want 6000000", reserved)
	}
}
