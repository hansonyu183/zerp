package vou

import (
	"testing"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestValidateAssetDisposalUsesAccountingRegisterTimeline(t *testing.T) {
	asset := dbsqlc.GetActiveAccountingAssetForVouRow{
		ID: "01J00000000000000000000001", State: "ACTIVE",
		AcquiredOn: pgtype.Date{Time: time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC), Valid: true},
	}
	if err := validateAssetDisposal(asset, time.Date(2026, 5, 31, 0, 0, 0, 0, time.UTC)); err == nil {
		t.Fatal("expected disposal before acquisition to fail")
	}
	if err := validateAssetDisposal(asset, time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("expected disposal after acquisition to succeed: %v", err)
	}
}
