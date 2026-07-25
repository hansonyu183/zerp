//go:build integration

package vou

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/hansonyu183/zerp-back/internal/api/authorization"
	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	"github.com/hansonyu183/zerp-back/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	integrationActorOne = "01J00000000000000000000000"
	integrationActorTwo = "01J00000000000000000000001"
)

type integrationReferences struct {
	customer, supplier, employee, product, warehouse, fundAccount ReferenceInput
	settlement, platform, vehicle                                 ReferenceInput
}

func vouIntegrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	expectedName := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if databaseURL == "" || expectedName == "" || !strings.HasSuffix(expectedName, "_test") {
		t.Fatal("safe TEST_DATABASE_URL and TEST_POSTGRES_DB ending in _test are required")
	}
	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect integration database: %v", err)
	}
	t.Cleanup(pool.Close)
	var actual string
	if err = pool.QueryRow(t.Context(), "select current_database()").Scan(&actual); err != nil || actual != expectedName {
		t.Fatalf("integration database = %q, want %q, err=%v", actual, expectedName, err)
	}
	var table *string
	if err = pool.QueryRow(t.Context(), "select to_regclass('vou_documents')::text").Scan(&table); err != nil ||
		table == nil || *table != "vou_documents" {
		t.Fatalf("VOU migrations are not applied: table=%v err=%v", table, err)
	}
	return pool
}

func truncateVOU(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		TRUNCATE vou_audit_events, vou_download_tokens, vou_document_attachments,
			vou_intermediary_child_attachments, vou_files,
			vou_intermediary_signoff_lines, vou_intermediary_signoffs,
			vou_intermediary_delivery_lines, vou_intermediary_deliveries,
			vou_intermediary_receipt_lines, vou_intermediary_receipts,
			vou_intermediary_procurement_lines, vou_intermediary_procurements,
			vou_intermediary_child_counters, vou_intermediary_children,
			vou_intermediary_v2_lines, vou_intermediary_v2_details,
			vou_expense_lines, vou_product_lines, vou_other_income_details,
			vou_expense_reimbursement_details, vou_payment_details, vou_receipt_details,
			vou_intermediary_sale_order_details, vou_purchase_order_details,
			vou_sale_order_details, vou_documents, vou_number_counters`)
	if err != nil {
		t.Fatalf("truncate VOU: %v", err)
	}
}

func createApprovedBOB(
	t *testing.T, service *bobdomain.Service, entity string, data bobdomain.CreateDetailInput,
) ReferenceInput {
	t.Helper()
	created, err := service.Create(t.Context(), entity, bobdomain.CreateInput{Data: data},
		integrationActorOne, "vou-ref-create")
	if err != nil {
		t.Fatalf("create %s reference: %v", entity, err)
	}
	submitted, err := service.Submit(t.Context(), entity, bobdomain.VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, integrationActorOne, "vou-ref-submit")
	if err != nil {
		t.Fatalf("submit %s reference: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, bobdomain.ReviewInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, "vou-ref-approve")
	if err != nil {
		t.Fatalf("approve %s reference: %v", entity, err)
	}
	return ReferenceInput{ObjectID: approved.ObjectID, VersionID: approved.VersionID}
}

func int32IntegrationPointer(value int32) *int32 { return &value }

func prepareReferences(t *testing.T, pool *pgxpool.Pool) integrationReferences {
	t.Helper()
	service := bobdomain.NewService(pool)
	suffix := newID()
	general := bobdomain.SupplierTypeGeneral
	logistics := bobdomain.SupplierTypeLogisticsPlatform
	settlement := createApprovedBOB(t, service, bobdomain.EntitySettlementMethod, bobdomain.CreateDetailInput{
		Code: "VSM" + suffix, Name: "次月十五日", RuleType: bobdomain.SettlementRuleFixedDay,
		MonthOffset: 1, DayOfMonth: int32IntegrationPointer(15), DayOffset: 0,
		Description: "按自然日计算",
	})
	employee := createApprovedBOB(t, service, bobdomain.EntityEmployee, bobdomain.CreateDetailInput{
		Code: "VE" + suffix, Name: "VOU 员工",
	})
	platform := createApprovedBOB(t, service, bobdomain.EntitySupplier, bobdomain.CreateDetailInput{
		Code: "VLP" + suffix, Name: "VOU 物流平台", SupplierType: &logistics,
		SalespersonEmployeeID: employee.ObjectID,
	})
	return integrationReferences{
		customer: createApprovedBOB(t, service, bobdomain.EntityCustomer, bobdomain.CreateDetailInput{
			Code: "VC" + suffix, Name: "VOU 客户", ContactName: "客户联系人",
			ContactPhone: "13800000000", Address: "深圳市测试路 1 号",
			SettlementMethodID:    settlement.ObjectID,
			SalespersonEmployeeID: employee.ObjectID,
		}),
		supplier: createApprovedBOB(t, service, bobdomain.EntitySupplier, bobdomain.CreateDetailInput{
			Code: "VS" + suffix, Name: "VOU 供应商", SupplierType: &general,
			ContactName: "供应商联系人", ContactPhone: "13900000000",
			SettlementMethodID:    settlement.ObjectID,
			SalespersonEmployeeID: employee.ObjectID,
		}),
		employee: employee,
		product: createApprovedBOB(t, service, bobdomain.EntityProduct, bobdomain.CreateDetailInput{
			Code: "VP" + suffix, Name: "VOU 产品", Unit: "吨",
		}),
		warehouse: createApprovedBOB(t, service, bobdomain.EntityWarehouse, bobdomain.CreateDetailInput{
			Code: "VW" + suffix, Name: "VOU 仓库",
		}),
		fundAccount: createApprovedBOB(t, service, bobdomain.EntityFundAccount, bobdomain.CreateDetailInput{
			Code: "VF" + suffix, Name: "VOU 资金账户", Currency: "CNY",
		}),
		settlement: settlement, platform: platform,
		vehicle: createApprovedBOB(t, service, bobdomain.EntityVehicle, bobdomain.CreateDetailInput{
			Code: "VV" + suffix, Name: "VOU 车辆", PlateNumber: "粤V" + suffix[len(suffix)-6:],
			VehicleType: "厢式货车", PlatformObjectID: platform.ObjectID,
		}),
	}
}

func newIntegrationService(t *testing.T, pool *pgxpool.Pool) *Service {
	t.Helper()
	service, err := NewService(pool, bobdomain.NewService(pool), txevent.NewBus(), AttachmentOptions{Root: t.TempDir()},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("new VOU service: %v", err)
	}
	return service
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

func TestVOUIntegrationSnapshotsSettlementGapsAndLegacyRows(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	bobService := bobdomain.NewService(pool)
	saleDraft := DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
		Salesperson: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{{
			Product: refs.product, OrderedQuantity: "1", UnitPrice: "10.00", Remark: "制单快照",
		}},
	}
	sale, err := service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: saleDraft},
		integrationActorOne, "snapshot-sale-create")
	if err != nil {
		t.Fatalf("create snapshot sale: %v", err)
	}

	customerView, err := bobService.Get(t.Context(), bobdomain.EntityCustomer,
		bobdomain.GetInput{ObjectID: refs.customer.ObjectID})
	if err != nil {
		t.Fatalf("get customer before edit: %v", err)
	}
	customerEdit, err := bobService.Edit(t.Context(), bobdomain.EntityCustomer,
		bobdomain.ObjectRevisionInput{
			ObjectID: refs.customer.ObjectID, ObjectRevision: customerView.ObjectRevision,
		}, integrationActorOne, "snapshot-customer-edit")
	if err != nil {
		t.Fatalf("edit customer: %v", err)
	}
	if _, err = service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: saleDraft},
		integrationActorOne, "snapshot-customer-gap"); err == nil {
		t.Fatal("sale was created while customer had no effective version")
	}
	customerSaved, err := bobService.Save(t.Context(), bobdomain.EntityCustomer, bobdomain.SaveInput{
		ObjectID: refs.customer.ObjectID, VersionID: customerEdit.VersionID, Revision: customerEdit.Revision,
		Data: bobdomain.DetailInput{
			Name: "VOU 客户更新", ContactName: bobdomain.Optional("新联系人"),
			ContactPhone: bobdomain.Optional("13700000000"),
			Address:      bobdomain.Optional("深圳市新地址"),
		},
	}, integrationActorOne, "snapshot-customer-save")
	if err != nil {
		t.Fatalf("save customer edit: %v", err)
	}
	customerSubmitted, err := bobService.Submit(t.Context(), bobdomain.EntityCustomer,
		bobdomain.VersionRevisionInput{
			ObjectID: refs.customer.ObjectID, VersionID: customerEdit.VersionID,
			Revision: customerSaved.Revision,
		}, integrationActorOne, "snapshot-customer-submit")
	if err != nil {
		t.Fatalf("submit customer edit: %v", err)
	}
	customerApproved, err := bobService.Approve(t.Context(), bobdomain.EntityCustomer,
		bobdomain.ReviewInput{
			ObjectID: refs.customer.ObjectID, VersionID: customerEdit.VersionID,
			Revision: customerSubmitted.Revision,
		}, integrationActorTwo, "snapshot-customer-approve")
	if err != nil {
		t.Fatalf("approve customer edit: %v", err)
	}
	refs.customer.VersionID = customerApproved.VersionID
	saleDraft.Customer = &refs.customer

	settlementView, err := bobService.Get(t.Context(), bobdomain.EntitySettlementMethod,
		bobdomain.GetInput{ObjectID: refs.settlement.ObjectID})
	if err != nil {
		t.Fatalf("get settlement before edit: %v", err)
	}
	settlementEdit, err := bobService.Edit(t.Context(), bobdomain.EntitySettlementMethod,
		bobdomain.ObjectRevisionInput{
			ObjectID: refs.settlement.ObjectID, ObjectRevision: settlementView.ObjectRevision,
		}, integrationActorOne, "snapshot-settlement-edit")
	if err != nil {
		t.Fatalf("edit settlement: %v", err)
	}
	if _, err = service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: saleDraft},
		integrationActorOne, "snapshot-settlement-gap"); err == nil {
		t.Fatal("sale was created while settlement method had no effective version")
	}
	day20 := int32(20)
	settlementSaved, err := bobService.Save(t.Context(), bobdomain.EntitySettlementMethod, bobdomain.SaveInput{
		ObjectID: refs.settlement.ObjectID, VersionID: settlementEdit.VersionID, Revision: settlementEdit.Revision,
		Data: bobdomain.DetailInput{
			Name: "次月二十日", RuleType: bobdomain.SettlementRuleFixedDay,
			MonthOffset: 1, DayOfMonth: &day20, DayOffset: 0,
		},
	}, integrationActorOne, "snapshot-settlement-save")
	if err != nil {
		t.Fatalf("save settlement edit: %v", err)
	}
	settlementSubmitted, err := bobService.Submit(t.Context(), bobdomain.EntitySettlementMethod,
		bobdomain.VersionRevisionInput{
			ObjectID: refs.settlement.ObjectID, VersionID: settlementEdit.VersionID,
			Revision: settlementSaved.Revision,
		}, integrationActorOne, "snapshot-settlement-submit")
	if err != nil {
		t.Fatalf("submit settlement edit: %v", err)
	}
	if _, err = bobService.Approve(t.Context(), bobdomain.EntitySettlementMethod,
		bobdomain.ReviewInput{
			ObjectID: refs.settlement.ObjectID, VersionID: settlementEdit.VersionID,
			Revision: settlementSubmitted.Revision,
		}, integrationActorTwo, "snapshot-settlement-approve"); err != nil {
		t.Fatalf("approve settlement edit: %v", err)
	}

	snapshot, err := service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: sale.DocumentID})
	if err != nil {
		t.Fatalf("get historical sale snapshot: %v", err)
	}
	if snapshot.Data.ContactName != "客户联系人" ||
		snapshot.Data.ContactPhone != "13800000000" ||
		snapshot.Data.DeliveryAddress != "深圳市测试路 1 号" ||
		snapshot.Data.SettlementMethod == nil ||
		snapshot.Data.SettlementMethod.Name != "次月十五日" ||
		snapshot.Data.SettlementMethod.DayOfMonth == nil ||
		*snapshot.Data.SettlementMethod.DayOfMonth != 15 {
		t.Fatalf("historical sale snapshot changed with BOB: %+v", snapshot.Data)
	}

	withoutSettlement := createApprovedBOB(t, bobService, bobdomain.EntityCustomer,
		bobdomain.CreateDetailInput{
			Code: "NS" + newID(), Name: "未配置结算客户",
			SalespersonEmployeeID: refs.employee.ObjectID,
		})
	missingSettlementDraft := saleDraft
	missingSettlementDraft.Customer = &withoutSettlement
	if _, err = service.Create(t.Context(), EntitySaleOrder,
		CreateInput{Data: missingSettlementDraft}, integrationActorOne,
		"missing-settlement-create"); err == nil {
		t.Fatal("sale accepted a customer without settlement method")
	}

	receiptDraft := DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "customer",
		Counterparty: &refs.customer, FundAccount: &refs.fundAccount,
		Handler: &refs.employee, Amount: "10.00",
	}
	receipt, err := service.Create(t.Context(), EntityReceipt, CreateInput{Data: receiptDraft},
		integrationActorOne, "legacy-receipt-create")
	if err != nil {
		t.Fatalf("create receipt for legacy compatibility: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `
		UPDATE vou_receipt_details
		SET handler_object_id = NULL, handler_version_id = NULL,
		    handler_code = NULL, handler_name = NULL
		WHERE document_id = $1
	`, receipt.DocumentID); err != nil {
		t.Fatalf("simulate legacy receipt: %v", err)
	}
	legacy, err := service.Get(t.Context(), EntityReceipt, GetInput{DocumentID: receipt.DocumentID})
	if err != nil || legacy.Data.Handler != nil {
		t.Fatalf("read legacy receipt view=%+v err=%v", legacy, err)
	}
	if _, err = service.Review(t.Context(), EntityReceipt, DocumentRevisionInput{
		DocumentID: receipt.DocumentID, Revision: receipt.Revision,
	}, integrationActorOne, "legacy-receipt-review"); err == nil {
		t.Fatal("legacy receipt with missing handler advanced")
	}
	saved, err := service.Save(t.Context(), EntityReceipt, SaveInput{
		DocumentID: receipt.DocumentID, Revision: receipt.Revision, Data: receiptDraft,
	}, integrationActorOne, "legacy-receipt-save")
	if err != nil {
		t.Fatalf("complete legacy receipt: %v", err)
	}
	if _, err = service.Review(t.Context(), EntityReceipt, DocumentRevisionInput{
		DocumentID: receipt.DocumentID, Revision: saved.Revision,
	}, integrationActorOne, "legacy-receipt-reviewed"); err != nil {
		t.Fatalf("review completed legacy receipt: %v", err)
	}
}

func TestVOUIntegrationPersonnelDefaultsOverridesAndSavePreservesSnapshot(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	bobService := bobdomain.NewService(pool)
	override := createApprovedBOB(t, bobService, bobdomain.EntityEmployee, bobdomain.CreateDetailInput{
		Code: "VOE" + newID(), Name: "显式覆盖员工",
	})
	service := newIntegrationService(t, pool)
	draft := DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
		Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{{
			Product: refs.product, OrderedQuantity: "1", UnitPrice: "10.00",
		}},
	}
	created, err := service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: draft},
		integrationActorOne, "personnel-default-create")
	if err != nil {
		t.Fatalf("create with default salesperson: %v", err)
	}
	view, err := service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: created.DocumentID})
	if err != nil || view.Data.Salesperson == nil ||
		view.Data.Salesperson.ObjectID != refs.employee.ObjectID {
		t.Fatalf("default salesperson view=%+v err=%v", view.Data.Salesperson, err)
	}

	draft.Salesperson = &override
	saved, err := service.Save(t.Context(), EntitySaleOrder, SaveInput{
		DocumentID: created.DocumentID, Revision: created.Revision, Data: draft,
	}, integrationActorOne, "personnel-override-save")
	if err != nil {
		t.Fatalf("save explicit salesperson override: %v", err)
	}
	draft.Salesperson = nil
	saved, err = service.Save(t.Context(), EntitySaleOrder, SaveInput{
		DocumentID: created.DocumentID, Revision: saved.Revision, Data: draft,
	}, integrationActorOne, "personnel-preserve-save")
	if err != nil {
		t.Fatalf("save omitted salesperson: %v", err)
	}
	view, err = service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: saved.DocumentID})
	if err != nil || view.Data.Salesperson == nil ||
		view.Data.Salesperson.ObjectID != override.ObjectID ||
		view.Data.Salesperson.VersionID != override.VersionID {
		t.Fatalf("preserved salesperson view=%+v err=%v", view.Data.Salesperson, err)
	}
}

func TestVOUIntegrationAttachmentRoundTrip(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	created, err := service.Create(t.Context(), EntityReceipt, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "customer",
		Counterparty: &refs.customer, FundAccount: &refs.fundAccount,
		Handler: &refs.employee, Amount: "10.00",
	}}, integrationActorOne, "attachment-create")
	if err != nil {
		t.Fatalf("create receipt: %v", err)
	}
	content := []byte("%PDF-1.7\nintegration")
	sum := sha256.Sum256(content)
	initiated, err := service.InitiateAttachment(t.Context(), EntityReceipt, AttachmentInitiateInput{
		DocumentID: created.DocumentID, Revision: created.Revision, FileName: "invoice.pdf",
		ContentType: "application/pdf", Size: int64(len(content)), SHA256: hex.EncodeToString(sum[:]),
	}, integrationActorOne, "attachment-initiate")
	if err != nil {
		t.Fatalf("initiate attachment: %v", err)
	}
	token := strings.TrimPrefix(initiated.UploadURL, "/files/attachments/upload/")
	if token == "" {
		t.Fatal("upload token is empty")
	}
	router := newVOUTestRouter(service, authorization.Func(
		func(context.Context, *http.Request, string, string) (authorization.Principal, error) {
			return authorization.Principal{ActorID: integrationActorOne}, nil
		},
	))
	uploadRequest := httptest.NewRequest(http.MethodPut, initiated.UploadURL, bytes.NewReader(content))
	uploadRequest.Header.Set("Content-Type", "application/pdf")
	uploadRecorder := httptest.NewRecorder()
	router.ServeHTTP(uploadRecorder, uploadRequest)
	if uploadRecorder.Code != http.StatusNoContent {
		t.Fatalf("upload status=%d body=%s", uploadRecorder.Code, uploadRecorder.Body.String())
	}
	replayRequest := httptest.NewRequest(http.MethodPut, initiated.UploadURL, bytes.NewReader(content))
	replayRequest.Header.Set("Content-Type", "application/pdf")
	replayRecorder := httptest.NewRecorder()
	router.ServeHTTP(replayRecorder, replayRequest)
	if replayRecorder.Code != http.StatusBadRequest {
		t.Fatalf("replay status=%d", replayRecorder.Code)
	}
	download, err := service.CreateDownload(t.Context(), EntityReceipt, AttachmentDownloadInput{
		DocumentID: created.DocumentID, FileID: initiated.FileID,
	}, integrationActorOne)
	if err != nil {
		t.Fatalf("create download: %v", err)
	}
	downloadRequest := httptest.NewRequest(http.MethodGet, download.DownloadURL, nil)
	downloadRecorder := httptest.NewRecorder()
	router.ServeHTTP(downloadRecorder, downloadRequest)
	if downloadRecorder.Code != http.StatusOK || !bytes.Equal(downloadRecorder.Body.Bytes(), content) {
		t.Fatalf("download status=%d body=%q", downloadRecorder.Code, downloadRecorder.Body.Bytes())
	}
	if downloadRecorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("download security headers = %#v", downloadRecorder.Header())
	}
	if _, err = service.RemoveAttachment(t.Context(), EntityReceipt, AttachmentRemoveInput{
		DocumentID: created.DocumentID, Revision: initiated.Revision, FileID: initiated.FileID,
	}, integrationActorOne, "attachment-remove"); err != nil {
		t.Fatalf("remove attachment: %v", err)
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
	const intermediaryV2PermissionCount = 50
	wantPermissions := len(entities)*len(actionRoutes) + intermediaryV2PermissionCount
	if permissionCount != wantPermissions {
		t.Fatalf("VOU permissions = %d, want %d", permissionCount, wantPermissions)
	}
}

func TestIntermediaryV2LongWorkflowIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	containerType, quantityPerContainer := "SOLVENT", "2"
	created, err := service.Create(t.Context(), EntityIntermediarySaleOrder, CreateInput{
		WorkflowVersion: 2,
		Data: DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
			Salesperson: &refs.employee,
			ProductLines: []ProductLineInput{{
				Product: refs.product, OrderedQuantity: "4", UnitPrice: "10.00",
				ContainerType: &containerType, QuantityPerContainer: &quantityPerContainer,
			}},
		},
	}, integrationActorOne, "v2-create")
	if err != nil {
		t.Fatalf("create V2 root: %v", err)
	}
	checkedAny, err := service.IntermediaryV2Action(t.Context(), "check", IntermediaryActionInput{
		DocumentID: created.DocumentID, RootRevision: created.RootRevision,
	}, integrationActorOne, "v2-check")
	if err != nil {
		t.Fatalf("check V2 root: %v", err)
	}
	checked := checkedAny.(MutationResult)
	approved, err := service.Approve(t.Context(), EntityIntermediarySaleOrder, DocumentRevisionInput{
		DocumentID: created.DocumentID, RootRevision: checked.RootRevision,
	}, integrationActorTwo, "v2-approve")
	if err != nil {
		t.Fatalf("approve V2 root: %v", err)
	}
	view, err := service.Get(t.Context(), EntityIntermediarySaleOrder, GetInput{
		DocumentID: created.DocumentID,
		permissions: []string{
			"/vou/intermediary-sale-order/procurement-get",
		},
	})
	if err != nil {
		t.Fatalf("get V2 root: %v", err)
	}
	if view.WorkflowVersion != 2 || len(view.Data.ProductLines) != 1 {
		t.Fatalf("unexpected V2 root view: %#v", view)
	}
	rootLineID := view.Data.ProductLines[0].LineID
	run := func(action string, rootRevision int64, childID string, childRevision int64, data any, actor, reason string) MutationResult {
		t.Helper()
		var raw json.RawMessage
		if data != nil {
			raw, err = json.Marshal(data)
			if err != nil {
				t.Fatalf("marshal %s: %v", action, err)
			}
		}
		result, actionErr := service.IntermediaryV2Action(t.Context(), action, IntermediaryActionInput{
			DocumentID: created.DocumentID, RootRevision: rootRevision,
			ChildID: childID, ChildRevision: childRevision, Data: raw, Reason: reason,
		}, actor, "v2-"+action)
		if actionErr != nil {
			t.Fatalf("%s: %v", action, actionErr)
		}
		return result.(MutationResult)
	}
	procurement := run("procurement-create", approved.RootRevision, "", 0,
		IntermediaryProcurementInput{
			Supplier: refs.supplier, Purchaser: &refs.employee, PurchaseDate: "2026-07-24",
			Lines: []IntermediaryProcurementLineInput{{
				RootLineID: rootLineID, Quantity: "4", UnitPrice: "8.00",
			}},
		}, integrationActorOne, "")
	content := []byte("%PDF-1.7\nV2 procurement attachment")
	sum := sha256.Sum256(content)
	initiated, err := service.InitiateIntermediaryAttachment(t.Context(), stageProcurement,
		IntermediaryAttachmentInitiateInput{
			DocumentID: created.DocumentID, RootRevision: procurement.RootRevision,
			ChildID: procurement.ChildID, ChildRevision: procurement.ChildRevision,
			FileName: "procurement.pdf", ContentType: "application/pdf",
			Size: int64(len(content)), SHA256: hex.EncodeToString(sum[:]),
		}, integrationActorOne, "v2-procurement-attachment-initiate")
	if err != nil {
		t.Fatalf("initiate V2 procurement attachment: %v", err)
	}
	router := newVOUTestRouter(service, authorization.Func(
		func(context.Context, *http.Request, string, string) (authorization.Principal, error) {
			return authorization.Principal{ActorID: integrationActorOne}, nil
		},
	))
	uploadRequest := httptest.NewRequest(http.MethodPut, initiated.UploadURL, bytes.NewReader(content))
	uploadRequest.Header.Set("Content-Type", "application/pdf")
	uploadRecorder := httptest.NewRecorder()
	router.ServeHTTP(uploadRecorder, uploadRequest)
	if uploadRecorder.Code != http.StatusNoContent {
		t.Fatalf("V2 attachment upload status=%d body=%s",
			uploadRecorder.Code, uploadRecorder.Body.String())
	}
	download, err := service.DownloadIntermediaryAttachment(t.Context(), stageProcurement,
		IntermediaryAttachmentDownloadInput{
			DocumentID: created.DocumentID, ChildID: procurement.ChildID, FileID: initiated.FileID,
		}, integrationActorOne)
	if err != nil {
		t.Fatalf("create V2 attachment download: %v", err)
	}
	downloadRequest := httptest.NewRequest(http.MethodGet, download.DownloadURL, nil)
	downloadRecorder := httptest.NewRecorder()
	router.ServeHTTP(downloadRecorder, downloadRequest)
	if downloadRecorder.Code != http.StatusOK || !bytes.Equal(downloadRecorder.Body.Bytes(), content) {
		t.Fatalf("V2 attachment download status=%d", downloadRecorder.Code)
	}
	removed, err := service.RemoveIntermediaryAttachment(t.Context(), stageProcurement,
		IntermediaryAttachmentRemoveInput{
			DocumentID: created.DocumentID, RootRevision: initiated.RootRevision,
			ChildID: procurement.ChildID, ChildRevision: initiated.ChildRevision, FileID: initiated.FileID,
		}, integrationActorOne, "v2-procurement-attachment-remove")
	if err != nil {
		t.Fatalf("remove V2 procurement attachment: %v", err)
	}
	procurement.RootRevision, procurement.ChildRevision =
		removed.RootRevision, removed.ChildRevision
	procurement = run("procurement-check", procurement.RootRevision, procurement.ChildID,
		procurement.ChildRevision, nil, integrationActorOne, "")
	procurement = run("procurement-place", procurement.RootRevision, procurement.ChildID,
		procurement.ChildRevision, nil, integrationActorTwo, "")
	receipt := run("receipt-create", procurement.RootRevision, "", 0,
		IntermediaryReceiptInput{
			ReceiptDate: "2026-07-25",
			Lines:       []IntermediaryLineQuantityInput{{RootLineID: rootLineID, Quantity: "4"}},
		}, integrationActorOne, "")
	receipt = run("receipt-check", receipt.RootRevision, receipt.ChildID,
		receipt.ChildRevision, nil, integrationActorOne, "")
	receipt = run("receipt-confirm", receipt.RootRevision, receipt.ChildID,
		receipt.ChildRevision, nil, integrationActorTwo, "")
	delivery := run("delivery-create", receipt.RootRevision, "", 0,
		IntermediaryDeliveryInput{
			DeliveryDate: "2026-07-25", Platform: refs.platform, Vehicle: refs.vehicle,
			Lines: []IntermediaryLineQuantityInput{{RootLineID: rootLineID, Quantity: "4"}},
		}, integrationActorOne, "")
	delivery = run("delivery-check", delivery.RootRevision, delivery.ChildID,
		delivery.ChildRevision, nil, integrationActorOne, "")
	delivery = run("delivery-execute", delivery.RootRevision, delivery.ChildID,
		delivery.ChildRevision, nil, integrationActorTwo, "")
	signoff := run("signoff-create", delivery.RootRevision, "", 0,
		IntermediarySignoffInput{
			DeliveryChildID: delivery.ChildID, SignoffDate: "2026-07-26",
			Lines: []IntermediarySignoffLineInput{{
				RootLineID: rootLineID, SignedQuantity: "4", RejectedQuantity: "0",
			}},
			ReturnedSolventContainers: 1, ContainerDifferenceReason: "客户暂欠一只溶剂桶",
		}, integrationActorOne, "")
	signoff = run("signoff-check", signoff.RootRevision, signoff.ChildID,
		signoff.ChildRevision, nil, integrationActorOne, "")
	signoff = run("signoff-confirm", signoff.RootRevision, signoff.ChildID,
		signoff.ChildRevision, nil, integrationActorTwo, "")
	if signoff.WorkflowStatus != StatusCompleted {
		t.Fatalf("workflow status = %s, want %s", signoff.WorkflowStatus, StatusCompleted)
	}
	history, err := service.AuditHistory(t.Context(), EntityIntermediarySaleOrder, HistoryInput{
		DocumentID: created.DocumentID, Page: 1, PageSize: 100,
	})
	if err != nil {
		t.Fatalf("get V2 audit history: %v", err)
	}
	foundSignoff := false
	for _, event := range history.Items {
		if event.Stage == stageSignoff && event.ChildID == signoff.ChildID {
			foundSignoff = true
		}
	}
	if !foundSignoff {
		t.Fatal("V2 signoff audit metadata is missing")
	}
}

func TestVOUIntegrationRejectsInvalidReferencesAndDatabaseContracts(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)

	_, err := service.Create(t.Context(), EntityPurchaseOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Supplier: &refs.platform,
		Purchaser: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{{
			Product: refs.product, OrderedQuantity: "1", UnitPrice: "1.00",
		}},
	}}, integrationActorOne, "logistics-as-supplier")
	if err == nil {
		t.Fatal("purchase accepted logistics platform as supplier")
	}

	usdAccount := createApprovedBOB(t, bobdomain.NewService(pool), bobdomain.EntityFundAccount,
		bobdomain.CreateDetailInput{Code: "USD" + newID(), Name: "美元账户", Currency: "USD"})
	_, err = service.Create(t.Context(), EntityReceipt, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "customer",
		Counterparty: &refs.customer, FundAccount: &usdAccount,
		Handler: &refs.employee, Amount: "1.00",
	}}, integrationActorOne, "currency-mismatch")
	if err == nil {
		t.Fatal("receipt accepted mismatched fund account currency")
	}

	created, err := service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
		Salesperson: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{{
			Product: refs.product, OrderedQuantity: "1", UnitPrice: "1.00",
		}},
	}}, integrationActorOne, "platform-mismatch-create")
	if err != nil {
		t.Fatalf("create sale: %v", err)
	}
	reviewed, _ := service.Review(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Revision,
	}, integrationActorOne, "platform-mismatch-review")
	approved, _ := service.Approve(t.Context(), EntitySaleOrder, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: reviewed.Revision,
	}, integrationActorOne, "platform-mismatch-approve")
	view, _ := service.Get(t.Context(), EntitySaleOrder, GetInput{DocumentID: created.DocumentID})
	logistics := bobdomain.SupplierTypeLogisticsPlatform
	otherPlatform := createApprovedBOB(t, bobdomain.NewService(pool), bobdomain.EntitySupplier,
		bobdomain.CreateDetailInput{
			Code: "OLP" + newID(), Name: "其它物流", SupplierType: &logistics,
			SalespersonEmployeeID: refs.employee.ObjectID,
		})
	_, err = service.Execute(t.Context(), EntitySaleOrder, ExecuteInput{
		DocumentID: created.DocumentID, Revision: approved.Revision,
		OutboundDate: "2026-07-24", SignoffDate: "2026-07-24",
		Platform: &otherPlatform, Vehicle: &refs.vehicle,
		SaleLines: []SaleExecutionLineInput{{
			LineID: view.Data.ProductLines[0].LineID, OutboundQuantity: "1",
			SignedQuantity: "1", RejectedQuantity: "0", LossQuantity: "0",
		}},
	}, integrationActorOne, "platform-mismatch-execute")
	if err == nil {
		t.Fatal("sale accepted vehicle from another platform")
	}

	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin invalid document: %v", err)
	}
	_, err = tx.Exec(t.Context(), `
		INSERT INTO vou_documents (
			id, entity, document_no, business_date, currency, total_amount_cents, created_by, updated_by
		) VALUES ($1, 'receipt', $2, DATE '2026-07-24', 'CNY', 100, $3, $3)`,
		newID(), "REC-20260724-999999", integrationActorOne)
	if err != nil {
		t.Fatalf("insert invalid document: %v", err)
	}
	if err = tx.Commit(t.Context()); err == nil {
		t.Fatal("database accepted document without typed detail")
	}
}
