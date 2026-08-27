//go:build integration

package acc

import (
	"errors"
	"testing"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func TestZZInventoryQuantityLedgerAndControlBookGateIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := defaultIntegrationACCService(pool)
	productID, warehouseID := ulid.Make().String(), ulid.Make().String()
	product := createAccountingProductSnapshot(t, pool, productID, "库存测试产品 V1")

	createInventoryBook := func(name string, openingQuantity string) (BookView, SubjectView) {
		book, err := service.CreateBook(t.Context(), CreateBookInput{Name: name, StartMonth: "2026-07", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty}, adminID)
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		inventory, err := service.CreateSubject(t.Context(), CreateSubjectInput{
			BookID: book.ID, Code: "1405", Name: "库存商品", BalanceDirection: BalanceDirectionDebit,
			Enabled: true, InventoryQuantity: true, RequiredDimensions: []string{DimensionProduct, DimensionWarehouse}, SettlementPurpose: SettlementPurposeNone,
		}, adminID)
		if err != nil {
			t.Fatalf("create inventory subject: %v", err)
		}
		equity, err := service.CreateSubject(t.Context(), CreateSubjectInput{BookID: book.ID, Code: "4001", Name: "期初权益", BalanceDirection: BalanceDirectionCredit, Enabled: true, RequiredDimensions: []string{}, SettlementPurpose: SettlementPurposeNone}, adminID)
		if err != nil {
			t.Fatalf("create equity subject: %v", err)
		}
		if openingQuantity != "0" {
			quantity := openingQuantity
			opening, saveErr := service.SaveOpening(t.Context(), SaveOpeningInput{BookID: book.ID, Revision: 0, Lines: []OpeningLineInput{
				{SubjectID: inventory.ID, Currency: "CNY", DebitAmount: "50.00", CreditAmount: "0", Quantity: &quantity, Dimensions: map[string]string{DimensionProduct: productID, DimensionWarehouse: warehouseID}},
				{SubjectID: equity.ID, Currency: "CNY", DebitAmount: "0", CreditAmount: "50.00", Dimensions: map[string]string{}},
			}}, integrationACCActor(t, adminID, "acc-inventory-opening-save-"+book.ID))
			if saveErr != nil {
				t.Fatalf("save inventory opening: %v", saveErr)
			}
			approveIntegrationOpening(t, service, book.ID, opening)
		} else {
			createApprovedZeroOpening(t, service, book)
		}
		templateID := "inventory-out"
		quantityField := "baseQuantity"
		mapping, err := service.CreateMapping(t.Context(), CreateMappingInput{BookID: book.ID, VouEntity: voudomain.EntitySaleOrder, DefaultResult: MappingResultPost, Definition: MappingDefinition{
			DefaultTemplateID: &templateID, Templates: []PostingTemplate{{ID: templateID, Collection: stringPointer("productLines"), Lines: []PostingLineTemplate{
				{SubjectSource: "FIXED", SubjectValue: inventory.ID, Direction: BalanceDirectionCredit, AmountField: "totalAmount", CurrencyField: "currency", QuantityField: &quantityField, Dimensions: map[string]string{DimensionProduct: "product.objectId", DimensionWarehouse: "warehouse.objectId"}},
				{SubjectSource: "FIXED", SubjectValue: equity.ID, Direction: BalanceDirectionDebit, AmountField: "totalAmount", CurrencyField: "currency", Dimensions: map[string]string{}},
			}}},
		}}, integrationACCActor(t, adminID, "acc-inventory-mapping-create-"+book.ID))
		if err != nil {
			t.Fatalf("create inventory mapping: %v", err)
		}
		approveIntegrationMapping(t, service, book.ID, voudomain.EntitySaleOrder, mapping)
		return book, inventory
	}

	controlBook, controlSubject := createInventoryBook("库存控制账", "5")
	event := inventoryApprovalEvent(product, warehouseID, "4")
	deliverApprovalEvent(t, pool, service, event, false)
	assertInventoryQuantity(t, pool, controlBook.ID, controlSubject.ID, productID, warehouseID, 1_000_000)
	_ = createAccountingProductVersion(t, pool, product, "库存测试产品 V2")
	var storedEntryID, storedName string
	if err := pool.QueryRow(t.Context(), `
		SELECT product_approval_entry_id,product_name
		FROM acc_inventory_entries
		WHERE book_id=$1 AND product_id=$2
		ORDER BY business_date,id LIMIT 1
	`, controlBook.ID, productID).Scan(&storedEntryID, &storedName); err != nil || storedEntryID != product.ApprovalEntryID || storedName != product.Name {
		t.Fatalf("inventory product snapshot=%s/%s want=%s/%s err=%v", storedEntryID, storedName, product.ApprovalEntryID, product.Name, err)
	}
	deliverApprovalEvent(t, pool, service, event, false)
	assertInventoryQuantity(t, pool, controlBook.ID, controlSubject.ID, productID, warehouseID, 1_000_000)

	unapproval := unapprovedVOUEvent(event.Payload.DocumentView(approval.Meta{
		Status: approval.StatusApproved, Revision: event.Entry.Revision,
	}))
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if err = service.HandleDocumentUnapproved(t.Context(), tx, unapproval); err != nil {
		_ = tx.Rollback(t.Context())
		t.Fatalf("unpost inventory: %v", err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	assertInventoryQuantity(t, pool, controlBook.ID, controlSubject.ID, productID, warehouseID, 5_000_000)

	event = inventoryApprovalEvent(product, warehouseID, "6")
	deliverApprovalEvent(t, pool, service, event, true)
	assertInventoryQuantity(t, pool, controlBook.ID, controlSubject.ID, productID, warehouseID, 5_000_000)

	nonControlBook, nonControlSubject := createInventoryBook("管理库存账", "0")
	event = inventoryApprovalEvent(product, warehouseID, "6")
	// The control book would reject this source, so use a business date before its start month;
	// only the non-control book is applicable and may temporarily become negative.
	event.Payload.Data.BusinessDate = "2026-06-30"
	nonControlStart := "2026-06"
	if _, err = pool.Exec(t.Context(), `UPDATE acc_books SET start_month=to_date($1,'YYYY-MM') WHERE id=$2`, nonControlStart, nonControlBook.ID); err != nil {
		t.Fatal(err)
	}
	deliverApprovalEvent(t, pool, service, event, false)
	assertInventoryQuantity(t, pool, nonControlBook.ID, nonControlSubject.ID, productID, warehouseID, -6_000_000)
}

func stringPointer(value string) *string { return &value }

func inventoryApprovalEvent(product accountingProductSnapshot, warehouseID, quantity string) approval.Event[voudomain.ApprovalPayload] {
	documentID := ulid.Make().String()
	snapshot := voudomain.DocumentView{
		DocumentID: documentID, Entity: voudomain.EntitySaleOrder, DocumentNo: "SO-TEST",
		Approval: approval.Meta{Status: approval.StatusApproved, Revision: 3}, Amount: "0",
		Data: voudomain.DocumentDataView{BusinessDate: "2026-07-25", Currency: "CNY", Warehouse: &voudomain.ReferenceView{ObjectID: warehouseID}, ProductLines: []voudomain.ProductLineView{{LineID: ulid.Make().String(), Product: voudomain.ReferenceView{ObjectID: product.ObjectID, ApprovalEntryID: product.ApprovalEntryID, Code: product.Code, Name: product.Name}, BaseQuantity: quantity}}},
	}
	return approvedVOUEvent(snapshot)
}

func deliverApprovalEvent(t *testing.T, pool *pgxpool.Pool, service *Service, event approval.Event[voudomain.ApprovalPayload], wantConflict bool) {
	t.Helper()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	err = service.HandleDocumentApproved(t.Context(), tx, event)
	if wantConflict {
		_ = tx.Rollback(t.Context())
		var rejected *txevent.RejectionError
		if !errors.As(err, &rejected) || rejected.Error() != "insufficient control book inventory" {
			t.Fatalf("negative inventory error = %#v", err)
		}
		return
	}
	if err != nil {
		_ = tx.Rollback(t.Context())
		t.Fatalf("deliver inventory approval: %v", err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
}

func assertInventoryQuantity(t *testing.T, pool *pgxpool.Pool, bookID, subjectID, productID, warehouseID string, want int64) {
	t.Helper()
	var got int64
	if err := pool.QueryRow(t.Context(), `SELECT COALESCE(sum(quantity_delta_micros),0)::bigint FROM acc_inventory_entries WHERE book_id=$1 AND subject_id=$2 AND product_id=$3 AND warehouse_id=$4`, bookID, subjectID, productID, warehouseID).Scan(&got); err != nil || got != want {
		t.Fatalf("inventory quantity = %d, want %d, err=%v", got, want, err)
	}
}
