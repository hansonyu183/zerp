//go:build integration

package acc

import (
	"encoding/json"
	"errors"
	"testing"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/oklog/ulid/v2"
)

func TestZZPeriodCostingUsesMovingAverageAndUnlockRollsBackIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := defaultIntegrationACCService(pool)
	productID, warehouseID := ulid.Make().String(), ulid.Make().String()
	product := createAccountingProductSnapshot(t, pool, productID, "成本测试产品 V1")
	account := createAccountingCustomerAccountSnapshot(t, pool, "成本结转客户账户")
	book, err := service.CreateBook(t.Context(), CreateBookInput{Name: "成本账", StartMonth: "2026-07", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	inventory, err := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "1405", Name: "库存商品", BalanceDirection: BalanceDirectionDebit, Enabled: true, InventoryQuantity: true, RequiredDimensions: []string{DimensionProduct, DimensionWarehouse}, SettlementPurpose: SettlementPurposeNone}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	equity, err := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "4001", Name: "期初权益", BalanceDirection: BalanceDirectionCredit, Enabled: true, RequiredDimensions: []string{}, SettlementPurpose: SettlementPurposeNone}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	cost, err := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "6401", Name: "主营业务成本", BalanceDirection: BalanceDirectionDebit, Enabled: true, RequiredDimensions: []string{DimensionProduct, DimensionCustomerAccount}, SettlementPurpose: SettlementPurposeNone}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	quantity := "5"
	draft, err := service.SaveOpening(t.Context(), SaveOpeningInput{BookID: book.ID, Lines: []OpeningLineInput{
		{SubjectID: inventory.ID, Currency: "CNY", DebitAmount: "50.00", CreditAmount: "0", Quantity: &quantity, Dimensions: map[string]string{DimensionProduct: productID, DimensionWarehouse: warehouseID}},
		{SubjectID: equity.ID, Currency: "CNY", DebitAmount: "0", CreditAmount: "50.00", Dimensions: map[string]string{}},
	}}, integrationACCActor(t, adminID, "acc-costing-opening-save"))
	if err != nil {
		t.Fatal(err)
	}
	approveIntegrationOpening(t, service, book.ID, draft)

	templateID, quantityField := "sale-cost", "baseQuantity"
	costSubjectID := cost.ID
	mapping, err := createDCLIntegrationMapping(t, service, dclMappingFixtureInput{BookID: book.ID, VouEntity: voudomain.EntitySaleOrder, DefaultResult: MappingResultPost, Definition: MappingDefinition{DefaultTemplateID: &templateID, Templates: []PostingTemplate{{ID: templateID, Collection: stringPointer("productLines"), Lines: []PostingLineTemplate{
		{SubjectSource: "FIXED", SubjectValue: inventory.ID, Direction: BalanceDirectionCredit, AmountField: "amount", CurrencyField: "currency", QuantityField: &quantityField, Dimensions: map[string]string{DimensionProduct: "product.objectId", DimensionWarehouse: "warehouse.objectId"}, CostCounterpartSubjectID: &costSubjectID, CostCounterpartDimensions: map[string]string{DimensionProduct: "product.objectId", DimensionCustomerAccount: "customer.objectId"}},
		{SubjectSource: "FIXED", SubjectValue: equity.ID, Direction: BalanceDirectionDebit, AmountField: "amount", CurrencyField: "currency", Dimensions: map[string]string{}},
	}}}}}, integrationACCActor(t, adminID, "acc-costing-mapping-create"))
	if err != nil {
		t.Fatal(err)
	}
	approveIntegrationMapping(t, service, book.ID, voudomain.EntitySaleOrder, mapping)
	event := approvedVOUEvent(voudomain.DocumentView{
		DocumentID: ulid.Make().String(), Entity: voudomain.EntitySaleOrder, DocumentNo: "SO-COST-SNAPSHOT",
		Approval: approval.Meta{Status: approval.StatusApproved, Revision: 3}, Amount: "0",
		Data: voudomain.DocumentDataView{
			BusinessDate: "2026-07-25", Currency: "CNY",
			Customer:     &voudomain.ReferenceView{Entity: "customer-account", ObjectID: account.ObjectID, CustomerID: account.CustomerID, ApprovalEntryID: account.ApprovalEntryID, Code: account.Code, Name: account.Name},
			Warehouse:    &voudomain.ReferenceView{ObjectID: warehouseID},
			ProductLines: []voudomain.ProductLineView{{LineID: ulid.Make().String(), Product: voudomain.ReferenceView{ObjectID: product.ObjectID, ApprovalEntryID: product.ApprovalEntryID, Code: product.Code, Name: product.Name}, BaseQuantity: "2"}},
		},
	})
	deliverApprovalEvent(t, pool, service, event, false)

	locked, err := service.LockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2026-07", Revision: 0}, adminID)
	if err != nil {
		t.Fatalf("lock costing: %v cause=%v", err, errors.Unwrap(err))
	}
	var allocations int
	var allocated, debit, credit int64
	if err = pool.QueryRow(t.Context(), `SELECT count(*),sum(cost_minor) FROM acc_inventory_cost_allocations WHERE book_id=$1 AND period_month='2026-07-01'`, book.ID).Scan(&allocations, &allocated); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT sum(line.debit_minor),sum(line.credit_minor) FROM acc_voucher_lines line JOIN acc_vouchers voucher ON voucher.id=line.voucher_id WHERE voucher.book_id=$1 AND voucher.source_type='COST_SETTLEMENT'`, book.ID).Scan(&debit, &credit); err != nil {
		t.Fatal(err)
	}
	if allocations != 2 || allocated != 7000 || debit != 2000 || credit != 2000 {
		t.Fatalf("cost facts allocations=%d allocated=%d voucher=%d/%d", allocations, allocated, debit, credit)
	}
	var encodedReferences []byte
	if err = pool.QueryRow(t.Context(), `SELECT line.dimension_references FROM acc_voucher_lines line JOIN acc_vouchers voucher ON voucher.id=line.voucher_id WHERE voucher.book_id=$1 AND voucher.source_type='COST_SETTLEMENT' AND line.subject_id=$2`, book.ID, cost.ID).Scan(&encodedReferences); err != nil {
		t.Fatal(err)
	}
	var references map[string]BusinessArchiveDimensionReference
	if err = json.Unmarshal(encodedReferences, &references); err != nil {
		t.Fatal(err)
	}
	if got := references[DimensionCustomerAccount]; got.CustomerID != account.CustomerID || got.ObjectID != account.ObjectID || got.ApprovalEntryID != account.ApprovalEntryID {
		t.Fatalf("cost counterpart reference = %#v, want customer=%s account=%s entry=%s", got, account.CustomerID, account.ObjectID, account.ApprovalEntryID)
	}
	if _, err = service.UnlockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2026-07", Revision: locked.Revision}, adminID); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM acc_inventory_cost_allocations WHERE book_id=$1`, book.ID).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("allocations after unlock=%d err=%v", remaining, err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM acc_vouchers WHERE book_id=$1 AND source_type='COST_SETTLEMENT'`, book.ID).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("cost vouchers after unlock=%d err=%v", remaining, err)
	}
}
