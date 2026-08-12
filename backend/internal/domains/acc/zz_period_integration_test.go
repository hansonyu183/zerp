//go:build integration

package acc

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/oklog/ulid/v2"
)

func TestZZAccountingPeriodLockUnlockAndVOUDatabaseBoundaryIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := NewService(pool)
	book, err := service.CreateBook(t.Context(), CreateBookInput{Name: "期间测试账", StartMonth: "2025-07", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	createApprovedZeroOpening(t, service, book)

	locked, err := service.LockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2025-07", Revision: 0}, adminID)
	if err != nil || locked.State != PeriodStateLocked || locked.Revision != 1 {
		t.Fatalf("lock period = %+v, err=%v", locked, err)
	}
	periods, err := service.QueryPeriods(t.Context(), book.ID, adminID)
	if err != nil || len(periods) != 1 || periods[0].Month != "2025-07" {
		t.Fatalf("periods = %+v, err=%v", periods, err)
	}

	_, err = pool.Exec(t.Context(), `INSERT INTO vou_documents (
		id, entity, document_no, business_date, currency, total_amount_cents, created_by, updated_by
	) VALUES ($1, 'other-income', $2, DATE '2025-07-20', 'CNY', 100, $3, $3)`, ulid.Make().String(), "OIN-20250720-0001", adminID)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Message != "accounting period is locked" {
		t.Fatalf("locked VOU write error = %#v", err)
	}

	unlocked, err := service.UnlockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2025-07", Revision: locked.Revision}, adminID)
	if err != nil || unlocked.State != PeriodStateUnlocked || unlocked.Revision != 2 {
		t.Fatalf("unlock period = %+v, err=%v", unlocked, err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(t.Context(), `INSERT INTO vou_documents (
		id, entity, document_no, business_date, currency, total_amount_cents, created_by, updated_by
	) VALUES ($1, 'other-income', $2, DATE '2025-07-20', 'CNY', 100, $3, $3)`, ulid.Make().String(), "OIN-20250720-0002", adminID)
	_ = tx.Rollback(t.Context())
	if err != nil {
		t.Fatalf("unlocked VOU write rejected: %v", err)
	}

	relocked, err := service.LockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2025-07", Revision: unlocked.Revision}, adminID)
	if err != nil || relocked.Revision != 3 {
		t.Fatalf("relock period = %+v, err=%v", relocked, err)
	}
	if _, err = service.LockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2026-09", Revision: 0}, adminID); !IsKind(err, ErrorConflict) {
		t.Fatalf("non-continuous lock error = %v", err)
	}
}
