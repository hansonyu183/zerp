//go:build integration

package vou

import (
	"testing"

	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
)

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
