package vou

import (
	"testing"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestValidateAssetDisposalRequiresCurrentMonthDepreciation(t *testing.T) {
	asset := dbsqlc.LedAsset{
		ID: "01J00000000000000000000001", Status: "ACTIVE",
		DepreciationStartMonth: pgtype.Date{Time: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC), Valid: true},
		OriginalValueCents:     120000, ResidualValueCents: 0, UsefulLifeMonths: 12,
		AccumulatedDepreciationCents: 10000,
		LastDepreciationMonth:        pgtype.Date{Time: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC), Valid: true},
	}
	if err := validateAssetDisposal(asset, time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)); err == nil {
		t.Fatal("expected disposal before March depreciation to fail")
	}
	asset.LastDepreciationMonth.Time = time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	if err := validateAssetDisposal(asset, time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("expected disposal after March depreciation to succeed: %v", err)
	}
}

func TestValidateAssetDisposalAllowsFullyDepreciatedAsset(t *testing.T) {
	asset := dbsqlc.LedAsset{
		ID: "01J00000000000000000000001", Status: "ACTIVE",
		DepreciationStartMonth: pgtype.Date{Time: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC), Valid: true},
		OriginalValueCents:     120000, ResidualValueCents: 12000, UsefulLifeMonths: 12,
		AccumulatedDepreciationCents: 108000,
		LastDepreciationMonth:        pgtype.Date{Time: time.Date(2025, 12, 1, 0, 0, 0, 0, time.UTC), Valid: true},
	}
	if err := validateAssetDisposal(asset, time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("fully depreciated asset should remain disposable: %v", err)
	}
}

func TestAssetDepreciationMonthEnd(t *testing.T) {
	month, err := monthStart("2028-02")
	if err != nil {
		t.Fatal(err)
	}
	if got := monthEnd(month).Format(dateLayout); got != "2028-02-29" {
		t.Fatalf("month end = %s", got)
	}
}
