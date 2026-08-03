//go:build integration

package vou

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
)

func TestVOUCreateRejectsExhaustedDocumentNumberIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO vou_number_counters(entity, business_date, last_value)
		VALUES ($1, DATE '2026-07-24', 9999)
	`, EntityReceipt); err != nil {
		t.Fatalf("exhaust document counter: %v", err)
	}

	_, err := newIntegrationService(t, pool).Create(t.Context(), EntityReceipt, CreateInput{
		Data: DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "customer",
			Counterparty: &refs.customer, FundAccount: &refs.fundAccount,
			Handler: &refs.employee, Amount: "100.00",
		},
	}, integrationActorOne, "document-number-exhausted")
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorConflict {
		t.Fatalf("exhausted document counter error = %v", err)
	}
}

func TestVOUIntegrationAllEntitiesAndReverseLifecycle(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	productLine := []ProductLineInput{{
		Product: refs.product, OrderedQuantity: "10.5", UnitPrice: "12.34",
		Remark: "商品明细备注",
	}}
	tests := []struct {
		entity string
		draft  DraftInput
	}{
		{EntitySalePricing, DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY",
			PriceLines: []PriceLineInput{{Product: refs.product, UnitPrice: "11.20"}},
		}},
		{EntitySaleOrder, DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
			Warehouse: &refs.warehouse, ProductLines: productLine,
		}},
		{EntityReceipt, DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "customer",
			Counterparty: &refs.customer, FundAccount: &refs.fundAccount,
			Handler: &refs.employee, Amount: "100.00",
		}},
		{EntityPayment, DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "supplier",
			Counterparty: &refs.supplier, FundAccount: &refs.fundAccount,
			Handler: &refs.employee, Amount: "80.00",
		}},
		{EntityExpenseReimbursement, DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", Employee: &refs.employee, FundAccount: &refs.fundAccount,
			ExpenseLines: []ExpenseLineInput{
				{Category: "交通", Description: "出租车", Amount: "20.00", Remark: "费用明细备注"},
				{Category: "住宿", Description: "酒店", Amount: "200.00"},
			},
		}},
		{EntityOtherIncome, DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", SourceName: "废料收入",
			CounterpartyType: "customer", Counterparty: &refs.customer,
			FundAccount: &refs.fundAccount, Handler: &refs.employee, Amount: "60.00",
		}},
		{EntityPurchaseInquiry, DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", Supplier: &refs.supplier,
			PriceLines: []PriceLineInput{{Product: refs.product, UnitPrice: "8.30"}},
		}},
	}

	for _, test := range tests {
		t.Run(test.entity, func(t *testing.T) {
			test.draft.Remark = "单据备注"
			created, err := service.Create(t.Context(), test.entity, CreateInput{Data: test.draft},
				integrationActorOne, "vou-create")
			if err != nil {
				t.Fatalf("create: %v", err)
			}
			reviewed, err := service.Check(t.Context(), test.entity, DocumentRevisionInput{
				DocumentID: created.DocumentID, Revision: created.Revision,
			}, integrationActorOne, "vou-review")
			if err != nil {
				t.Fatalf("review: %v", err)
			}
			if test.entity == EntitySaleOrder {
				if _, staleErr := service.Approve(t.Context(), test.entity, DocumentRevisionInput{
					DocumentID: created.DocumentID, Revision: created.Revision,
				}, integrationActorOne, "vou-stale-approve"); staleErr == nil {
					t.Fatal("stale revision was accepted")
				}
			}
			approved, err := service.Approve(t.Context(), test.entity, DocumentRevisionInput{
				DocumentID: created.DocumentID, Revision: reviewed.Revision,
			}, integrationActorOne, "vou-approve")
			if err != nil {
				t.Fatalf("approve: %v", err)
			}
			execute := FinalizeInput{DocumentID: created.DocumentID, Revision: approved.Revision}
			executed, err := service.Finalize(t.Context(), test.entity, execute,
				integrationActorOne, "vou-execute")
			if err != nil {
				t.Fatalf("execute: %v", err)
			}
			view, err := service.Get(t.Context(), test.entity, GetInput{DocumentID: created.DocumentID})
			if err != nil || view.Status != StatusFinalized || view.Amount == "" {
				t.Fatalf("executed view=%+v err=%v", view, err)
			}
			if view.Data.Remark != "单据备注" {
				t.Fatalf("header remark = %q", view.Data.Remark)
			}
			switch test.entity {
			case EntitySaleOrder:
				if view.Data.Salesperson == nil || view.Data.Warehouse == nil ||
					view.Data.Salesperson.ObjectID != refs.employee.ObjectID ||
					view.Data.Warehouse.ObjectID != refs.warehouse.ObjectID ||
					view.Data.ContactName != "客户联系人" ||
					view.Data.ContactPhone != "13800000000" ||
					view.Data.DeliveryAddress != "深圳市测试路 1 号" ||
					view.Data.SettlementMethod == nil ||
					view.Data.SettlementMethod.RuleType != bobdomain.SettlementRuleFixedDay ||
					view.Data.SettlementMethod.DayOfMonth == nil ||
					*view.Data.SettlementMethod.DayOfMonth != 15 ||
					view.Data.ProductLines[0].Remark != "商品明细备注" {
					t.Fatalf("sale attribute snapshots = %+v", view.Data)
				}
			case EntityReceipt, EntityPayment, EntityOtherIncome:
				if view.Data.Handler == nil {
					t.Fatalf("handler snapshot = %+v", view.Data)
				}
			case EntityExpenseReimbursement:
				if view.Data.Employee == nil || view.Data.Handler != nil ||
					view.Data.ExpenseLines[0].Remark != "费用明细备注" {
					t.Fatalf("expense attributes = %+v", view.Data)
				}
			}
			page, queryErr := service.Query(t.Context(), test.entity, QueryInput{
				Page: 1, PageSize: 20,
				Filters: QueryFilters{
					Keyword: created.DocumentNo, Status: []string{StatusFinalized},
					DateFrom: "2026-07-24", DateTo: "2026-07-24",
				},
				Sort: []SortInput{{Field: "documentNo", Order: "asc"}},
			})
			if queryErr != nil || page.Total != 1 || len(page.Items) != 1 {
				t.Fatalf("query page=%+v err=%v", page, queryErr)
			}
			unfiltered, queryErr := service.Query(t.Context(), test.entity, QueryInput{
				Page: 1, PageSize: 20, Filters: QueryFilters{},
			})
			if queryErr != nil || unfiltered.Total != 1 || len(unfiltered.Items) != 1 {
				t.Fatalf("unfiltered query page=%+v err=%v", unfiltered, queryErr)
			}
			if test.entity == EntitySaleOrder {
				if page.Items[0].SalesSummary == nil ||
					page.Items[0].SalesSummary.ShortageQuantity != "10500" ||
					page.Items[0].SalesSummary.OrderedQuantity != "10500" ||
					page.Items[0].SalesSummary.OutboundQuantity != "0" ||
					page.Items[0].SalesSummary.NetSignedQuantity != "0" {
					t.Fatalf("sale order list summary = %+v", page.Items[0].SalesSummary)
				}
				unexecuted, reverseErr := service.Unfinalize(t.Context(), test.entity, ReverseInput{
					DocumentID: created.DocumentID, Revision: executed.Revision, Reason: "修正执行结果",
				}, integrationActorOne, "vou-unexecute")
				if reverseErr != nil {
					t.Fatalf("unexecute: %v", reverseErr)
				}
				unapproved, reverseErr := service.Unapprove(t.Context(), test.entity, ReverseInput{
					DocumentID: created.DocumentID, Revision: unexecuted.Revision, Reason: "修正批准内容",
				}, integrationActorOne, "vou-unapprove")
				if reverseErr != nil {
					t.Fatalf("unapprove: %v", reverseErr)
				}
				unreviewed, reverseErr := service.Uncheck(t.Context(), test.entity, ReverseInput{
					DocumentID: created.DocumentID, Revision: unapproved.Revision, Reason: "退回制单",
				}, integrationActorOne, "vou-unreview")
				if reverseErr != nil || unreviewed.Status != StatusDraft {
					t.Fatalf("unreview=%+v err=%v", unreviewed, reverseErr)
				}
				history, historyErr := service.AuditHistory(t.Context(), test.entity, HistoryInput{
					DocumentID: created.DocumentID, Page: 1, PageSize: 20,
				})
				if historyErr != nil || history.Total != 7 {
					t.Fatalf("history total=%d err=%v", history.Total, historyErr)
				}
			}
		})
	}
}

func TestVOUIntegrationGenericParentValidationAndImmutability(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	parent, err := service.Create(t.Context(), EntityReceipt, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "customer",
		Counterparty: &refs.customer, FundAccount: &refs.fundAccount,
		Handler: &refs.employee, Amount: "100.00",
	}}, integrationActorOne, "parent-create")
	if err != nil {
		t.Fatal(err)
	}
	child, err := service.Create(t.Context(), EntityPayment, CreateInput{
		ParentEntity: EntityReceipt, ParentDocumentID: parent.DocumentID,
		Data: DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "supplier",
			Counterparty: &refs.supplier, FundAccount: &refs.fundAccount,
			Handler: &refs.employee, Amount: "80.00",
		},
	}, integrationActorOne, "child-create")
	if err != nil {
		t.Fatal(err)
	}
	view, err := service.Get(t.Context(), EntityPayment, GetInput{DocumentID: child.DocumentID})
	if err != nil || view.ParentEntity != EntityReceipt ||
		view.ParentDocumentID != parent.DocumentID ||
		view.ParentDocumentNo != parent.DocumentNo {
		t.Fatalf("parent view=%+v err=%v", view, err)
	}
	if _, err = service.Create(t.Context(), EntityPayment, CreateInput{
		ParentEntity: EntitySaleOrder, ParentDocumentID: parent.DocumentID,
		Data: DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "supplier",
			Counterparty: &refs.supplier, FundAccount: &refs.fundAccount,
			Handler: &refs.employee, Amount: "10.00",
		},
	}, integrationActorOne, "mismatched-parent"); err == nil {
		t.Fatal("mismatched parent entity was accepted")
	}
	if _, err = pool.Exec(t.Context(), `UPDATE vou_documents
		SET parent_entity=NULL,parent_document_id=NULL WHERE id=$1`, child.DocumentID); err == nil {
		t.Fatal("parent relation was mutable")
	}
}

func TestVOUIntegrationConcurrentNumberingAndPermissions(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	const count = 8
	numbers := make(chan string, count)
	errorsChannel := make(chan error, count)
	var group sync.WaitGroup
	for range count {
		group.Add(1)
		go func() {
			defer group.Done()
			result, err := service.Create(context.Background(), EntityReceipt, CreateInput{Data: DraftInput{
				BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "customer",
				Counterparty: &refs.customer, FundAccount: &refs.fundAccount,
				Handler: &refs.employee, Amount: "1.00",
			}}, integrationActorOne, "concurrent-number")
			if err != nil {
				errorsChannel <- err
				return
			}
			numbers <- result.DocumentNo
		}()
	}
	group.Wait()
	close(numbers)
	close(errorsChannel)
	for err := range errorsChannel {
		t.Fatalf("concurrent create: %v", err)
	}
	seen := map[string]bool{}
	for number := range numbers {
		if len(number) != 17 || !strings.HasPrefix(number, "REC-20260724-") {
			t.Fatalf("unexpected document number %s", number)
		}
		if seen[number] {
			t.Fatalf("duplicate document number %s", number)
		}
		seen[number] = true
	}
	if len(seen) != count {
		t.Fatalf("numbers = %d, want %d", len(seen), count)
	}
	var permissionCount int
	if err := pool.QueryRow(t.Context(), "select count(*) from app_permissions where domain = 'vou'").Scan(&permissionCount); err != nil {
		t.Fatalf("count VOU permissions: %v", err)
	}
	wantPermissions := 255
	if permissionCount != wantPermissions {
		t.Fatalf("VOU permissions = %d, want %d", permissionCount, wantPermissions)
	}
	var legacyTable *string
	if err := pool.QueryRow(t.Context(),
		"select to_regclass('public.vou_intermediary_sale_order_details')::text",
	).Scan(&legacyTable); err != nil {
		t.Fatalf("check legacy intermediary table: %v", err)
	}
	if legacyTable != nil {
		t.Fatalf("legacy intermediary table still exists: %s", *legacyTable)
	}
	var legacyPermissions, purchaseWritePermissions, purchaseWorkflowPermissions int
	if err := pool.QueryRow(t.Context(), `SELECT
		count(*) FILTER (WHERE entity='intermediary-sale-order'),
		count(*) FILTER (WHERE domain='vou' AND entity='purchase-order'
			AND action NOT IN ('query','get','audit-history','attachment-download')),
		count(*) FILTER (WHERE domain='wfl' AND entity='purchase-fulfillment')
		FROM app_permissions`).Scan(
		&legacyPermissions, &purchaseWritePermissions, &purchaseWorkflowPermissions,
	); err != nil {
		t.Fatalf("check migrated permissions: %v", err)
	}
	if legacyPermissions != 0 || purchaseWritePermissions != 12 ||
		purchaseWorkflowPermissions != 7 {
		t.Fatalf("migrated permissions = legacy %d, purchase writes %d, workflow %d",
			legacyPermissions, purchaseWritePermissions, purchaseWorkflowPermissions)
	}
}
