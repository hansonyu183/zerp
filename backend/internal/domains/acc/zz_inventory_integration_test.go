//go:build integration

package acc

import (
	"errors"
	"testing"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func TestZZInventoryQuantityLedgerAndControlBookGateIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := NewService(pool)
	productID, warehouseID := ulid.Make().String(), ulid.Make().String()

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
			}}, adminID)
			if saveErr != nil {
				t.Fatalf("save inventory opening: %v", saveErr)
			}
			if _, err = service.ApproveOpening(t.Context(), book.ID, opening.Revision, adminID); err != nil {
				t.Fatalf("approve inventory opening: %v", err)
			}
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
		}}, adminID)
		if err != nil {
			t.Fatalf("create inventory mapping: %v", err)
		}
		if _, err = service.ApproveMapping(t.Context(), book.ID, mapping.ID, mapping.Revision, adminID); err != nil {
			t.Fatalf("approve inventory mapping: %v", err)
		}
		return book, inventory
	}

	controlBook, controlSubject := createInventoryBook("库存控制账", "5")
	event := inventoryApprovalEvent(productID, warehouseID, "4")
	deliverApprovalEvent(t, pool, service, event, false)
	assertInventoryQuantity(t, pool, controlBook.ID, controlSubject.ID, productID, warehouseID, 1_000_000)
	deliverApprovalEvent(t, pool, service, event, false)
	assertInventoryQuantity(t, pool, controlBook.ID, controlSubject.ID, productID, warehouseID, 1_000_000)

	unapproval := voudomain.DocumentUnapprovedEvent{Entity: event.Entity, DocumentID: event.DocumentID, DocumentNo: event.DocumentNo, Revision: event.Revision + 1, Snapshot: event.Snapshot}
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

	event = inventoryApprovalEvent(productID, warehouseID, "6")
	deliverApprovalEvent(t, pool, service, event, true)
	assertInventoryQuantity(t, pool, controlBook.ID, controlSubject.ID, productID, warehouseID, 5_000_000)

	nonControlBook, nonControlSubject := createInventoryBook("管理库存账", "0")
	event = inventoryApprovalEvent(productID, warehouseID, "6")
	// The control book would reject this source, so use a business date before its start month;
	// only the non-control book is applicable and may temporarily become negative.
	event.Snapshot.Data.BusinessDate = "2026-06-30"
	nonControlStart := "2026-06"
	if _, err = pool.Exec(t.Context(), `UPDATE acc_books SET start_month=to_date($1,'YYYY-MM') WHERE id=$2`, nonControlStart, nonControlBook.ID); err != nil {
		t.Fatal(err)
	}
	deliverApprovalEvent(t, pool, service, event, false)
	assertInventoryQuantity(t, pool, nonControlBook.ID, nonControlSubject.ID, productID, warehouseID, -6_000_000)
}

func stringPointer(value string) *string { return &value }

func inventoryApprovalEvent(productID, warehouseID, quantity string) voudomain.DocumentApprovedEvent {
	documentID := ulid.Make().String()
	snapshot := voudomain.DocumentView{
		DocumentID: documentID, Entity: voudomain.EntitySaleOrder, DocumentNo: "SO-TEST", Status: voudomain.StatusApproved, Revision: 3, Amount: "0",
		Data: voudomain.DocumentDataView{BusinessDate: "2026-07-25", Currency: "CNY", Warehouse: &voudomain.ReferenceView{ObjectID: warehouseID}, ProductLines: []voudomain.ProductLineView{{LineID: ulid.Make().String(), Product: voudomain.ReferenceView{ObjectID: productID}, BaseQuantity: quantity}}},
	}
	return voudomain.DocumentApprovedEvent{Entity: snapshot.Entity, DocumentID: documentID, DocumentNo: snapshot.DocumentNo, Revision: snapshot.Revision, Snapshot: snapshot}
}

func deliverApprovalEvent(t *testing.T, pool *pgxpool.Pool, service *Service, event voudomain.DocumentApprovedEvent, wantConflict bool) {
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
