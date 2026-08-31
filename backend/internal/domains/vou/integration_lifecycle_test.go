//go:build integration

package vou

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

func TestVOUCreateRejectsExhaustedDocumentNumberIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO vou_number_counters(entity, business_date, last_value)
		VALUES ($1, DATE '2026-07-24', 9999)
	`, EntitySalesReceipt); err != nil {
		t.Fatalf("exhaust document counter: %v", err)
	}

	_, err := newIntegrationService(t, pool).Create(t.Context(), EntitySalesReceipt, CreateInput{
		Data: DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: bobdomain.EntityCustomerAccount,
			Counterparty: &refs.customer, FundAccount: &refs.fundAccount,
			Handler: &refs.employee, Amount: "100.00",
		},
	}, integrationApprovalActor(t, integrationActorOne, "document-number-exhausted"))
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorConflict {
		t.Fatalf("exhausted document counter error = %v", err)
	}
}

func TestVOURejectAndActionAvailabilityIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	permissions := func(entity string, actions ...string) []string {
		paths := make([]string, len(actions))
		for index, action := range actions {
			paths[index] = "/vou/" + entity + "/" + action
		}
		return paths
	}
	actor := func(id, requestID string, paths []string) approval.Actor {
		result, err := approval.UserActor(authorization.Principal{ActorID: id, Permissions: paths}, requestID)
		if err != nil {
			t.Fatalf("create actor: %v", err)
		}
		return result
	}
	allLifecycle := permissions(EntitySalePricing, "submit", "unsubmit", "reject", "approve", "unapprove")
	submitter := func(requestID string) approval.Actor {
		return actor(integrationActorOne, requestID, allLifecycle)
	}
	reviewer := func(requestID string) approval.Actor {
		return actor(integrationActorTwo, requestID, allLifecycle)
	}
	assertKey := func(err error, key string) {
		t.Helper()
		var domainErr *DomainError
		if !errors.As(err, &domainErr) || domainErr.ErrorKey != key {
			t.Fatalf("error = %v, want key %s", err, key)
		}
	}

	created, err := service.Create(t.Context(), EntitySalePricing, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY",
		PriceLines: []PriceLineInput{{
			Product: ProductReferenceInput{ObjectID: refs.product.ObjectID}, UnitPrice: "11.20",
		}},
	}}, submitter("reject-create"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	submitted, err := service.Submit(t.Context(), EntitySalePricing, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Approval.Revision,
	}, submitter("reject-submit"))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}

	submitterView, err := service.Get(t.Context(), EntitySalePricing, GetInput{
		DocumentID: created.DocumentID, actor: submitter("reject-get-self"),
	})
	if err != nil || !slices.Equal(submitterView.AvailableApprovalActions, []approval.LifecycleAction{approval.LifecycleUnsubmit}) {
		t.Fatalf("submitter view actions = %v, err=%v", submitterView.AvailableApprovalActions, err)
	}
	reviewerPage, err := service.Query(t.Context(), EntitySalePricing, QueryInput{
		Page: 1, PageSize: 20, Filters: QueryFilters{Keyword: created.DocumentNo},
		actor: reviewer("reject-query-reviewer"),
	})
	wantReviewerActions := []approval.LifecycleAction{
		approval.LifecycleUnsubmit, approval.LifecycleReject, approval.LifecycleApprove,
	}
	if err != nil || len(reviewerPage.Items) != 1 || !slices.Equal(reviewerPage.Items[0].AvailableApprovalActions, wantReviewerActions) {
		t.Fatalf("reviewer query = %+v, err=%v", reviewerPage, err)
	}

	_, err = service.Reject(t.Context(), EntitySalePricing, ReverseInput{
		DocumentID: created.DocumentID, Revision: submitted.Approval.Revision, Reason: "   ",
	}, reviewer("reject-missing-reason"))
	assertKey(err, "validation_failed")
	_, err = service.Reject(t.Context(), EntitySalePricing, ReverseInput{
		DocumentID: created.DocumentID, Revision: submitted.Approval.Revision, Reason: strings.Repeat("驳", 1001),
	}, reviewer("reject-long-reason"))
	assertKey(err, "validation_failed")
	_, err = service.Reject(t.Context(), EntitySalePricing, ReverseInput{
		DocumentID: created.DocumentID, Revision: submitted.Approval.Revision, Reason: "资料不完整",
	}, submitter("reject-self"))
	assertKey(err, "approval_self_review_forbidden")
	_, err = service.Reject(t.Context(), EntitySalePricing, ReverseInput{
		DocumentID: created.DocumentID, Revision: created.Approval.Revision, Reason: "资料不完整",
	}, reviewer("reject-stale"))
	assertKey(err, "approval_stale_revision")

	rejected, err := service.Reject(t.Context(), EntitySalePricing, ReverseInput{
		DocumentID: created.DocumentID, Revision: submitted.Approval.Revision, Reason: "  资料不完整  ",
	}, reviewer("reject-valid"))
	if err != nil || rejected.Approval.Status != approval.StatusDraft || rejected.Approval.Revision != submitted.Approval.Revision+1 {
		t.Fatalf("reject = %+v, err=%v", rejected, err)
	}
	history, err := service.AuditHistory(t.Context(), EntitySalePricing, HistoryInput{
		DocumentID: created.DocumentID, Page: 1, PageSize: 20,
	})
	if err != nil || len(history.Items) < 1 || history.Items[0].Action != approval.ActionRejected || history.Items[0].Reason == nil || *history.Items[0].Reason != "资料不完整" {
		t.Fatalf("reject audit = %+v, err=%v", history, err)
	}

	saved, err := service.Save(t.Context(), EntitySalePricing, SaveInput{
		DocumentID: created.DocumentID, Revision: rejected.Approval.Revision,
		Data: DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", Remark: "驳回后修改",
			PriceLines: []PriceLineInput{{Product: ProductReferenceInput{ObjectID: refs.product.ObjectID}, UnitPrice: "11.30"}},
		},
	}, submitter("reject-save"))
	if err != nil {
		t.Fatalf("save after reject: %v", err)
	}
	resubmitted, err := service.Submit(t.Context(), EntitySalePricing, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: saved.Approval.Revision,
	}, submitter("reject-resubmit"))
	if err != nil {
		t.Fatalf("resubmit: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntitySalePricing, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: resubmitted.Approval.Revision,
	}, reviewer("reject-approve"))
	if err != nil || approved.Approval.Status != approval.StatusApproved {
		t.Fatalf("approve after resubmit = %+v, err=%v", approved, err)
	}
}

func TestVOUIntegrationAllEntitiesAndReverseLifecycle(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	line := integrationProductLine(t, refs.product, "10.5", "12.34")
	line.Remark = "商品明细备注"
	productLine := []ProductLineInput{line}
	tests := []struct {
		entity string
		draft  DraftInput
	}{
		{EntitySalePricing, DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY",
			PriceLines: []PriceLineInput{{Product: ProductReferenceInput{ObjectID: refs.product.ObjectID}, UnitPrice: "11.20"}},
		}},
		{EntitySaleOrder, DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
			Warehouse: &refs.warehouse, ProductLines: productLine,
		}},
		{EntitySalesReceipt, DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: bobdomain.EntityCustomerAccount,
			Counterparty: &refs.customer, FundAccount: &refs.fundAccount,
			Handler: &refs.employee, Amount: "100.00",
		}},
		{EntityPurchasePayment, DraftInput{
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
			CounterpartyType: bobdomain.EntityCustomerAccount, Counterparty: &refs.customer,
			FundAccount: &refs.fundAccount, Handler: &refs.employee, Amount: "60.00",
		}},
		{EntityPurchaseInquiry, DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", Supplier: &refs.supplier,
			PriceLines: []PriceLineInput{{Product: ProductReferenceInput{ObjectID: refs.product.ObjectID}, UnitPrice: "8.30"}},
		}},
	}

	for _, test := range tests {
		t.Run(test.entity, func(t *testing.T) {
			test.draft.Remark = "单据备注"
			created, err := service.Create(t.Context(), test.entity, CreateInput{Data: test.draft}, integrationApprovalActor(t, integrationActorOne, "vou-create"))
			if err != nil {
				t.Fatalf("create: %v (cause: %v)", err, errors.Unwrap(err))
			}
			reviewed, err := service.Submit(t.Context(), test.entity, DocumentRevisionInput{
				DocumentID: created.DocumentID, Revision: created.Approval.Revision,
			}, integrationApprovalActor(t, integrationActorOne, "vou-review"))
			if err != nil {
				t.Fatalf("review: %v", err)
			}
			if test.entity == EntitySaleOrder {
				if _, staleErr := service.Approve(t.Context(), test.entity, DocumentRevisionInput{
					DocumentID: created.DocumentID, Revision: created.Approval.Revision,
				}, integrationApprovalActor(t, integrationActorOne, "vou-stale-approve")); staleErr == nil {
					t.Fatal("stale revision was accepted")
				}
			}
			approved, err := service.Approve(t.Context(), test.entity, DocumentRevisionInput{
				DocumentID: created.DocumentID, Revision: reviewed.Approval.Revision,
			}, integrationApprovalActor(t, integrationActorOne, "vou-approve"))
			if err != nil {
				t.Fatalf("approve: %v (cause: %v)", err, errors.Unwrap(err))
			}
			expectedStatus := StatusApproved
			if string(approved.Approval.Status) != expectedStatus {
				t.Fatalf("approved status = %s, want %s", approved.Approval.Status, expectedStatus)
			}
			view, err := service.Get(t.Context(), test.entity, GetInput{DocumentID: created.DocumentID})
			if err != nil || string(view.Approval.Status) != expectedStatus || view.Amount == "" {
				t.Fatalf("approved view=%+v err=%v", view, err)
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
					view.Data.SettlementMethod.RuleType != bobdomain.SettlementRuleMonthEnd ||
					view.Data.SettlementMethod.MonthOffset != 1 ||
					view.Data.ProductLines[0].Remark != "商品明细备注" {
					t.Fatalf("sale attribute snapshots = %+v", view.Data)
				}
			case EntitySalesReceipt, EntityPurchasePayment, EntityOtherIncome:
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
					Keyword: created.DocumentNo, Status: []string{expectedStatus},
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
					page.Items[0].SalesSummary.ShortageBaseQuantity != "10.5" ||
					page.Items[0].SalesSummary.OrderedBaseQuantity != "10.5" ||
					page.Items[0].SalesSummary.OutboundBaseQuantity != "0" ||
					page.Items[0].SalesSummary.NetSignedBaseQuantity != "0" {
					t.Fatalf("sale order list summary = %+v", page.Items[0].SalesSummary)
				}
				unapproved, reverseErr := service.Unapprove(t.Context(), test.entity, ReverseInput{
					DocumentID: created.DocumentID, Revision: approved.Approval.Revision, Reason: "修正批准内容",
				}, integrationApprovalActor(t, integrationActorOne, "vou-unapprove"))
				if reverseErr != nil {
					t.Fatalf("unapprove: %v", reverseErr)
				}
				unreviewed, reverseErr := service.Unsubmit(t.Context(), test.entity, DocumentRevisionInput{
					DocumentID: created.DocumentID, Revision: unapproved.Approval.Revision,
				}, integrationApprovalActor(t, integrationActorOne, "vou-unreview"))
				if reverseErr != nil || unreviewed.Approval.Status != StatusDraft {
					t.Fatalf("unreview=%+v err=%v", unreviewed, reverseErr)
				}
				history, historyErr := service.AuditHistory(t.Context(), test.entity, HistoryInput{
					DocumentID: created.DocumentID, Page: 1, PageSize: 20,
				})
				expectedAudits := int64(5)
				if historyErr != nil || history.Total != expectedAudits {
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
	parent, err := service.Create(t.Context(), EntitySalesReceipt, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: bobdomain.EntityCustomerAccount,
		Counterparty: &refs.customer, FundAccount: &refs.fundAccount,
		Handler: &refs.employee, Amount: "100.00",
	}}, integrationApprovalActor(t, integrationActorOne, "parent-create"))
	if err != nil {
		t.Fatal(err)
	}
	child, err := service.Create(t.Context(), EntityPurchasePayment, CreateInput{
		ParentEntity: EntitySalesReceipt, ParentDocumentID: parent.DocumentID,
		Data: DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "supplier",
			Counterparty: &refs.supplier, FundAccount: &refs.fundAccount,
			Handler: &refs.employee, Amount: "80.00",
		},
	}, integrationApprovalActor(t, integrationActorOne, "child-create"))
	if err != nil {
		t.Fatal(err)
	}
	view, err := service.Get(t.Context(), EntityPurchasePayment, GetInput{DocumentID: child.DocumentID})
	if err != nil || view.ParentEntity != EntitySalesReceipt ||
		view.ParentDocumentID != parent.DocumentID ||
		view.ParentDocumentNo != parent.DocumentNo {
		t.Fatalf("parent view=%+v err=%v", view, err)
	}
	if _, err = service.Create(t.Context(), EntityPurchasePayment, CreateInput{
		ParentEntity: EntitySaleOrder, ParentDocumentID: parent.DocumentID,
		Data: DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "supplier",
			Counterparty: &refs.supplier, FundAccount: &refs.fundAccount,
			Handler: &refs.employee, Amount: "10.00",
		},
	}, integrationApprovalActor(t, integrationActorOne, "mismatched-parent")); err == nil {
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
			result, err := service.Create(context.Background(), EntitySalesReceipt, CreateInput{Data: DraftInput{
				BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: bobdomain.EntityCustomerAccount,
				Counterparty: &refs.customer, FundAccount: &refs.fundAccount,
				Handler: &refs.employee, Amount: "1.00",
			}}, integrationApprovalActor(t, integrationActorOne, "concurrent-number"))
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
		if len(number) != 17 || !strings.HasPrefix(number, "SRC-20260724-") {
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
	wantPermissions := 501
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
	var legacyPermissions, purchaseWritePermissions, purchaseInboundCreatePermissions,
		purchaseWorkflowPermissions int
	if err := pool.QueryRow(t.Context(), `SELECT
		count(*) FILTER (WHERE entity='intermediary-sale-order'),
		count(*) FILTER (WHERE domain='vou' AND entity='purchase-order'
			AND action NOT IN ('query','get','audit-history','attachment-download')),
		count(*) FILTER (WHERE path='/vou/purchase-inbound/create'),
		count(*) FILTER (WHERE domain='wfl' AND entity='purchase-fulfillment')
		FROM app_permissions`).Scan(
		&legacyPermissions, &purchaseWritePermissions, &purchaseInboundCreatePermissions,
		&purchaseWorkflowPermissions,
	); err != nil {
		t.Fatalf("check migrated permissions: %v", err)
	}
	if legacyPermissions != 0 || purchaseWritePermissions != 11 ||
		purchaseInboundCreatePermissions != 0 || purchaseWorkflowPermissions != 0 {
		t.Fatalf("migrated permissions = legacy %d, purchase writes %d, inbound create %d, workflow %d",
			legacyPermissions, purchaseWritePermissions, purchaseInboundCreatePermissions,
			purchaseWorkflowPermissions)
	}
}
