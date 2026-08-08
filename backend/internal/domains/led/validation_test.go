package led

import (
	"strings"
	"testing"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestValidateOpeningRejectsDuplicatesAndInvalidDirections(t *testing.T) {
	t.Parallel()
	refA := ReferenceInput{ObjectID: "01J00000000000000000000010", VersionID: "01J00000000000000000000011"}
	refB := ReferenceInput{ObjectID: "01J00000000000000000000012", VersionID: "01J00000000000000000000013"}
	_, err := validateSave(OpeningSaveInput{
		Revision: 1, CutoverDate: "2026-01-01",
		Inventory: []InventoryOpeningInput{
			{Warehouse: refA, Product: refB, Quantity: "1", UnitPrice: "10.00", Currency: "CNY"},
			{Warehouse: refA, Product: refB, Quantity: "2", UnitPrice: "10.00", Currency: "CNY"},
		},
	})
	if err == nil {
		t.Fatal("duplicate inventory opening was accepted")
	}
	_, err = validateSave(OpeningSaveInput{
		Revision: 1, CutoverDate: "2026-01-01",
		Inventory: []InventoryOpeningInput{{
			Warehouse: refA, Product: refB, Quantity: "1", UnitPrice: "0", Currency: "CNY",
		}},
	})
	if err == nil {
		t.Fatal("zero inventory opening unit price was accepted")
	}
	_, err = validateSave(OpeningSaveInput{
		Revision: 1, CutoverDate: "2026-01-01",
		Fund: []FundOpeningInput{{FundAccount: refA, BalanceType: "INVALID", Amount: "1.00"}},
	})
	if err == nil {
		t.Fatal("invalid fund balance type was accepted")
	}
}

func TestValidateQueryAndReopenBoundaries(t *testing.T) {
	t.Parallel()
	_, err := validateQuery(EntityParty, QueryInput{
		Page: 1, PageSize: 20,
		Filters: QueryFilters{DateFrom: "2026-01-01", DateTo: "2026-01-31", Direction: []string{"IN"}},
	})
	if err == nil {
		t.Fatal("party query accepted inventory direction")
	}
	_, err = validateQuery(EntityInventory, QueryInput{
		Page: 1, PageSize: 20,
		Filters: QueryFilters{
			DateFrom: "2026-01-01", DateTo: "2026-01-31",
			SourceEntity: "not-a-vou-entity",
		},
	})
	if err == nil {
		t.Fatal("query accepted unknown sourceEntity")
	}
	if _, err = validateReopen(ReopenInput{Revision: 1, Reason: strings.Repeat("理", 1001)}); err == nil {
		t.Fatal("overlong reopen reason was accepted")
	}
}

func TestFixedPointFormattingAndRounding(t *testing.T) {
	t.Parallel()
	amount, err := lineAmountCents(1_500_000, 101)
	if err != nil || amount != 152 {
		t.Fatalf("amount = %d, err=%v; want 152", amount, err)
	}
	if got := formatMoney(-123); got != "-1.23" {
		t.Fatalf("formatMoney = %q", got)
	}
	if got := formatAbsoluteQuantity(-1_500_000); got != "1.5" {
		t.Fatalf("formatAbsoluteQuantity = %q", got)
	}
}

func TestRequireEffectiveDateRejectsLiveAndSkipsRebuildBeforeCutover(t *testing.T) {
	t.Parallel()
	cutover := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	posting := postingContext{
		CutoverDate: cutover,
		Document: dbsqlc.VouDocument{
			DocumentNo:   "ICL-20260630-0001",
			BusinessDate: pgtype.Date{Time: time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC), Valid: true},
		},
		Live: true,
	}
	if include, err := requireEffectiveDate(posting, posting.Document.BusinessDate); err == nil || include {
		t.Fatalf("live pre-cutover posting include=%t, err=%v", include, err)
	}
	posting.Live = false
	if include, err := requireEffectiveDate(posting, posting.Document.BusinessDate); err != nil || include {
		t.Fatalf("rebuild pre-cutover posting include=%t, err=%v", include, err)
	}
}
