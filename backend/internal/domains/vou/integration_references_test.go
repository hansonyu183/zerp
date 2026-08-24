//go:build integration

package vou

import (
	"errors"
	"testing"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
)

func TestVOUIntegrationSnapshotsSettlementGapsAndLegacyRows(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)
	bobService := newBOBIntegrationService(pool)
	customerService := bobdomain.NewService(pool, vouCustomerAuxiliaryResolver{})
	saleLine := integrationProductLine(t, refs.product, "1", "10.00")
	saleLine.Remark = "制单快照"
	saleDraft := DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
		Salesperson: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{saleLine},
	}
	sale, err := service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: saleDraft},
		integrationActorOne, "snapshot-sale-create")
	if err != nil {
		t.Fatalf("create snapshot sale: %v", err)
	}

	var customerRelationshipID string
	if err := pool.QueryRow(t.Context(), `SELECT customer_relationship_id FROM bob_customer_accounts WHERE object_id=$1`, refs.customer.ObjectID).Scan(&customerRelationshipID); err != nil {
		t.Fatalf("find customer relationship: %v", err)
	}
	customerView, err := customerService.CustomerGet(t.Context(), bobdomain.GetInput{ObjectID: customerRelationshipID})
	if err != nil {
		t.Fatalf("get customer before edit: %v", err)
	}
	var customerAccount *bobdomain.CustomerAccountView
	for index := range customerView.Accounts {
		if customerView.Accounts[index].ObjectID == refs.customer.ObjectID {
			customerAccount = &customerView.Accounts[index]
			break
		}
	}
	if customerAccount == nil || customerAccount.Effective == nil {
		t.Fatalf("effective customer account missing: %#v", customerView.Accounts)
	}
	changedCustomer := customerAccount.Effective.Data
	changedCustomer.Name = "VOU 客户更新"
	changedCustomer.ContactName = "新联系人"
	changedCustomer.ContactPhone = "13700000000"
	changedCustomer.Address = "深圳市新地址"
	customerEdit, err := customerService.CustomerSave(t.Context(), bobdomain.CustomerSaveInput{
		ObjectID: refs.customer.ObjectID, VersionID: customerAccount.Effective.Version.VersionID,
		Revision: customerAccount.Effective.Version.Revision, Data: changedCustomer,
	}, integrationActorOne, "snapshot-customer-edit")
	if err != nil {
		t.Fatalf("create customer candidate: %v", err)
	}
	if _, err = service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: saleDraft},
		integrationActorOne, "snapshot-customer-candidate"); err != nil {
		t.Fatalf("effective customer stopped working while candidate existed: %v", err)
	}
	customerSubmitted, err := customerService.Submit(t.Context(), bobdomain.EntityCustomerAccount,
		bobdomain.VersionRevisionInput{
			ObjectID: refs.customer.ObjectID, VersionID: customerEdit.VersionID,
			Revision: customerEdit.Revision,
		}, integrationActorOne, "snapshot-customer-submit")
	if err != nil {
		t.Fatalf("submit customer edit: %v", err)
	}
	customerApproved, err := customerService.Approve(t.Context(), bobdomain.EntityCustomerAccount,
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
	settlementEdit := reverseApprovedBOBToDraft(
		t, bobService, bobdomain.EntitySettlementMethod, settlementView, "snapshot-settlement-edit",
	)
	if _, err = service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: saleDraft},
		integrationActorOne, "snapshot-settlement-gap"); err != nil {
		t.Fatalf("saved customer settlement stopped working after source edit: %v", err)
	}
	updatedSurcharge := "0.25"
	settlementSaved, err := bobService.Save(t.Context(), bobdomain.EntitySettlementMethod, bobdomain.SaveInput{
		ObjectID: refs.settlement.ObjectID, VersionID: settlementEdit.VersionID, Revision: settlementEdit.Revision,
		Data: bobdomain.DetailInput{
			DefaultSalesSurcharge: &updatedSurcharge,
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
		snapshot.Data.SettlementMethod.Name != "月结30天" ||
		snapshot.Data.SettlementMethod.DefaultSalesSurcharge != "0.10" {
		t.Fatalf("historical sale snapshot changed with BOB: %+v", snapshot.Data)
	}

	receiptDraft := DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: bobdomain.EntityCustomerAccount,
		Counterparty: &refs.customer, FundAccount: &refs.fundAccount,
		Handler: &refs.employee, Amount: "10.00",
	}
	receipt, err := service.Create(t.Context(), EntitySalesReceipt, CreateInput{Data: receiptDraft},
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
	legacy, err := service.Get(t.Context(), EntitySalesReceipt, GetInput{DocumentID: receipt.DocumentID})
	if err != nil || legacy.Data.Handler != nil {
		t.Fatalf("read legacy receipt view=%+v err=%v", legacy, err)
	}
	if _, err = service.Check(t.Context(), EntitySalesReceipt, DocumentRevisionInput{
		DocumentID: receipt.DocumentID, Revision: receipt.Revision,
	}, integrationActorOne, "legacy-receipt-review"); err == nil {
		t.Fatal("legacy receipt with missing handler advanced")
	}
	saved, err := service.Save(t.Context(), EntitySalesReceipt, SaveInput{
		DocumentID: receipt.DocumentID, Revision: receipt.Revision, Data: receiptDraft,
	}, integrationActorOne, "legacy-receipt-save")
	if err != nil {
		t.Fatalf("complete legacy receipt: %v", err)
	}
	if _, err = service.Check(t.Context(), EntitySalesReceipt, DocumentRevisionInput{
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
	bobService := newBOBIntegrationService(pool)
	override := createApprovedBOB(t, bobService, bobdomain.EntityEmployee, bobdomain.CreateDetailInput{
		Code: "VOE" + newID(), Name: "显式覆盖员工",
	})
	service := newIntegrationService(t, pool)
	draft := DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Customer: &refs.customer,
		Warehouse:    &refs.warehouse,
		ProductLines: []ProductLineInput{integrationProductLine(t, refs.product, "1", "10.00")},
	}
	created, err := service.Create(t.Context(), EntitySaleOrder, CreateInput{Data: draft},
		integrationActorOne, "personnel-default-create")
	if err != nil {
		t.Fatalf("create with default salesperson: %v (cause: %v)", err, errors.Unwrap(err))
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

	purchaseDraft := DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Supplier: &refs.supplier,
		Warehouse:    &refs.warehouse,
		ProductLines: []ProductLineInput{integrationProductLine(t, refs.product, "1", "12.00")},
	}
	purchase, err := service.Create(t.Context(), EntityPurchaseOrder, CreateInput{Data: purchaseDraft},
		integrationActorOne, "purchase-default-create")
	if err != nil {
		t.Fatalf("create with default purchaser: %v", err)
	}
	purchaseView, err := service.Get(t.Context(), EntityPurchaseOrder, GetInput{DocumentID: purchase.DocumentID})
	if err != nil || purchaseView.Data.Purchaser == nil ||
		purchaseView.Data.Purchaser.ObjectID != refs.employee.ObjectID ||
		purchaseView.Data.SettlementMethod == nil ||
		purchaseView.Data.SettlementMethod.VersionID != "" ||
		purchaseView.Data.SettlementMethod.DefaultSalesSurcharge != "" {
		t.Fatalf("purchase defaults or settlement snapshot=%+v err=%v", purchaseView.Data, err)
	}
	purchaseDraft.Purchaser = &override
	purchaseSaved, err := service.Save(t.Context(), EntityPurchaseOrder, SaveInput{
		DocumentID: purchase.DocumentID, Revision: purchase.Revision, Data: purchaseDraft,
	}, integrationActorOne, "purchase-override-save")
	if err != nil {
		t.Fatalf("save explicit purchaser override: %v", err)
	}
	purchaseDraft.Purchaser = nil
	purchaseSaved, err = service.Save(t.Context(), EntityPurchaseOrder, SaveInput{
		DocumentID: purchase.DocumentID, Revision: purchaseSaved.Revision, Data: purchaseDraft,
	}, integrationActorOne, "purchase-preserve-save")
	if err != nil {
		t.Fatalf("save omitted purchaser: %v", err)
	}
	purchaseView, err = service.Get(t.Context(), EntityPurchaseOrder, GetInput{DocumentID: purchaseSaved.DocumentID})
	if err != nil || purchaseView.Data.Purchaser == nil || purchaseView.Data.Purchaser.ObjectID != override.ObjectID ||
		purchaseView.Data.SettlementMethod == nil || purchaseView.Data.SettlementMethod.VersionID != "" {
		t.Fatalf("preserved purchase defaults=%+v err=%v", purchaseView.Data, err)
	}
}

func TestVOUIntegrationRejectsInvalidReferencesAndDatabaseContracts(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	service := newIntegrationService(t, pool)

	_, err := service.Create(t.Context(), EntityPurchaseOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Supplier: &refs.carrier,
		Purchaser: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{integrationProductLine(t, refs.product, "1", "1.00")},
	}}, integrationActorOne, "logistics-as-supplier")
	if err == nil {
		t.Fatal("purchase accepted logistics platform as supplier")
	}

	usdAccount := createApprovedBOB(t, newBOBIntegrationService(pool), bobdomain.EntityFundAccount,
		bobdomain.CreateDetailInput{Code: "USD" + newID(), Name: "美元账户", Currency: "USD"})
	_, err = service.Create(t.Context(), EntitySalesReceipt, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: bobdomain.EntityCustomerAccount,
		Counterparty: &refs.customer, FundAccount: &usdAccount,
		Handler: &refs.employee, Amount: "1.00",
	}}, integrationActorOne, "currency-mismatch")
	if err == nil {
		t.Fatal("receipt accepted mismatched fund account currency")
	}

	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin invalid document: %v", err)
	}
	_, err = tx.Exec(t.Context(), `
		INSERT INTO vou_documents (
			id, entity, document_no, business_date, currency, total_amount_cents, created_by, updated_by
		) VALUES ($1, 'sales-receipt', $2, DATE '2026-07-24', 'CNY', 100, $3, $3)`,
		newID(), "SRC-20260724-9999", integrationActorOne)
	if err != nil {
		t.Fatalf("insert invalid document: %v", err)
	}
	if err = tx.Commit(t.Context()); err == nil {
		t.Fatal("database accepted document without typed detail")
	}
}
