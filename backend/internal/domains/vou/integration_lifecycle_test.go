//go:build integration

package vou

import (
	"context"
	"sync"
	"testing"

	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
)

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
		{EntitySaleOrder, DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer, ProductLines: productLine,
			Warehouse: &refs.warehouse,
		}},
		{EntityPurchaseOrder, DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", Supplier: &refs.supplier, ProductLines: productLine,
			Warehouse: &refs.warehouse,
		}},
		{EntityIntermediarySaleOrder, DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
			Supplier: &refs.supplier, ProductLines: []ProductLineInput{{
				Product: refs.product, OrderedQuantity: "10.5", UnitPrice: "12.34",
				PurchaseUnitPrice: "10.00", Remark: "商品明细备注",
			}},
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
	}

	for _, test := range tests {
		t.Run(test.entity, func(t *testing.T) {
			test.draft.Remark = "单据备注"
			created, err := service.Create(t.Context(), test.entity, CreateInput{Data: test.draft},
				integrationActorOne, "vou-create")
			if err != nil {
				t.Fatalf("create: %v", err)
			}
			reviewed, err := service.Review(t.Context(), test.entity, DocumentRevisionInput{
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
			execute := ExecuteInput{DocumentID: created.DocumentID, Revision: approved.Revision}
			if test.entity == EntitySaleOrder || test.entity == EntityIntermediarySaleOrder {
				view, getErr := service.Get(t.Context(), test.entity, GetInput{DocumentID: created.DocumentID})
				if getErr != nil {
					t.Fatalf("get lines: %v", getErr)
				}
				execute.OutboundDate, execute.SignoffDate = "2026-07-25", "2026-07-26"
				execute.Platform, execute.Vehicle = &refs.platform, &refs.vehicle
				execute.SaleLines = []SaleExecutionLineInput{{
					LineID: view.Data.ProductLines[0].LineID, OutboundQuantity: "10",
					SignedQuantity: "8", RejectedQuantity: "1", LossQuantity: "1",
				}}
				execute.DifferenceReason = "少交 0.5"
			} else if test.entity == EntityPurchaseOrder {
				view, getErr := service.Get(t.Context(), test.entity, GetInput{DocumentID: created.DocumentID})
				if getErr != nil {
					t.Fatalf("get lines: %v", getErr)
				}
				execute.InboundDate = "2026-07-25"
				execute.PurchaseLines = []PurchaseExecutionLineInput{{
					LineID: view.Data.ProductLines[0].LineID, InboundQuantity: "10",
				}}
				execute.DifferenceReason = "少收 0.5"
			}
			executed, err := service.Execute(t.Context(), test.entity, execute,
				integrationActorOne, "vou-execute")
			if err != nil {
				t.Fatalf("execute: %v", err)
			}
			view, err := service.Get(t.Context(), test.entity, GetInput{DocumentID: created.DocumentID})
			if err != nil || view.Status != StatusExecuted || view.Amount == "" {
				t.Fatalf("executed view=%+v err=%v", view, err)
			}
			if view.Data.Remark != "单据备注" {
				t.Fatalf("header remark = %q", view.Data.Remark)
			}
			switch test.entity {
			case EntitySaleOrder:
				if view.Data.Salesperson == nil || view.Data.Warehouse == nil ||
					view.Data.Salesperson.ObjectID != refs.employee.ObjectID ||
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
			case EntityPurchaseOrder:
				if view.Data.Purchaser == nil || view.Data.Warehouse == nil ||
					view.Data.Purchaser.ObjectID != refs.employee.ObjectID ||
					view.Data.ContactName != "供应商联系人" ||
					view.Data.ContactPhone != "13900000000" ||
					view.Data.SettlementMethod == nil ||
					view.Data.ProductLines[0].Remark != "商品明细备注" {
					t.Fatalf("purchase attribute snapshots = %+v", view.Data)
				}
			case EntityIntermediarySaleOrder:
				if view.Data.Salesperson == nil || view.Data.Purchaser == nil ||
					view.Data.Salesperson.ObjectID != refs.employee.ObjectID ||
					view.Data.Purchaser.ObjectID != refs.employee.ObjectID ||
					view.Data.Warehouse != nil ||
					view.Data.CustomerSettlementMethod == nil ||
					view.Data.SupplierSettlementMethod == nil ||
					view.Data.ProductLines[0].Remark != "商品明细备注" {
					t.Fatalf("intermediary attribute snapshots = %+v", view.Data)
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
					Keyword: created.DocumentNo, Status: []string{StatusExecuted},
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
				unexecuted, reverseErr := service.Unexecute(t.Context(), test.entity, ReverseInput{
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
				unreviewed, reverseErr := service.Unreview(t.Context(), test.entity, ReverseInput{
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
	wantPermissions := len(entities) * len(actionRoutes)
	if permissionCount != wantPermissions {
		t.Fatalf("VOU permissions = %d, want %d", permissionCount, wantPermissions)
	}
}
