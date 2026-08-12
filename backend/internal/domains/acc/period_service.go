package acc

import (
	"context"
	"errors"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/businessdate"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func parsePeriodMonth(value string) (time.Time, error) {
	if !monthPattern.MatchString(value) {
		return time.Time{}, domainError(ErrorValidation, "invalid accounting period month", nil)
	}
	month, err := time.Parse("2006-01", value)
	if err != nil {
		return time.Time{}, domainError(ErrorValidation, "invalid accounting period month", err)
	}
	return month, nil
}

func (s *Service) QueryPeriods(ctx context.Context, bookID, actorID string) ([]PeriodView, error) {
	if err := s.requireAccess(ctx, s.queries, bookID, actorID, false); err != nil {
		return nil, err
	}
	rows, err := s.queries.ListAccountingPeriods(ctx, bookID)
	if err != nil {
		return nil, databaseError("list accounting periods", err)
	}
	result := make([]PeriodView, 0, len(rows))
	for _, row := range rows {
		view := PeriodView{BookID: bookID, Month: row.PeriodMonth, State: row.State, Revision: row.Revision, LockedBy: row.LockedBy}
		if row.LockedAt.Valid {
			value := row.LockedAt.Time.Format(time.RFC3339Nano)
			view.LockedAt = &value
		}
		result = append(result, view)
	}
	return result, nil
}

func (s *Service) LockPeriod(ctx context.Context, input PeriodActionInput, actorID string) (PeriodView, error) {
	month, err := parsePeriodMonth(input.Month)
	if err != nil || input.Revision < 0 {
		return PeriodView{}, domainError(ErrorValidation, "invalid accounting period", err)
	}
	if !month.Before(businessdate.Today().AddDate(0, 0, -businessdate.Today().Day()+1)) {
		return PeriodView{}, domainError(ErrorConflict, "accounting period has not ended", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PeriodView{}, databaseError("begin accounting period lock", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	if err = s.requireAccess(ctx, q, input.BookID, actorID, true); err != nil {
		return PeriodView{}, err
	}
	book, err := q.GetAccountingBook(ctx, input.BookID)
	if err != nil {
		return PeriodView{}, databaseError("get accounting period book", err)
	}
	opening, err := q.GetAccountingOpeningForUpdate(ctx, input.BookID)
	if err != nil || opening.State != OpeningStateApproved {
		return PeriodView{}, domainError(ErrorConflict, "accounting opening is not approved", err)
	}
	expected, _ := time.Parse("2006-01", book.StartMonth)
	latest, latestErr := q.GetLatestLockedAccountingPeriod(ctx, input.BookID)
	if latestErr == nil {
		expected = latest.PeriodMonth.Time.AddDate(0, 1, 0)
	} else if !errors.Is(latestErr, pgx.ErrNoRows) {
		return PeriodView{}, databaseError("get latest accounting period", latestErr)
	}
	if !month.Equal(expected) {
		return PeriodView{}, domainError(ErrorConflict, "accounting periods must be locked continuously", nil)
	}
	if err = validatePeriodReady(ctx, tx, input.BookID, month); err != nil {
		return PeriodView{}, err
	}
	actor := actorID
	locked, err := q.LockAccountingPeriodRow(ctx, dbsqlc.LockAccountingPeriodRowParams{
		BookID: input.BookID, PeriodMonth: pgtype.Date{Time: month, Valid: true}, ActorID: &actor, Revision: input.Revision,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return PeriodView{}, domainError(ErrorConflict, "accounting period changed", err)
	}
	if err != nil {
		return PeriodView{}, databaseError("lock accounting period", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return PeriodView{}, databaseError("commit accounting period lock", err)
	}
	lockedAt := locked.LockedAt.Time.Format(time.RFC3339Nano)
	return PeriodView{BookID: input.BookID, Month: input.Month, State: PeriodStateLocked, Revision: locked.Revision, LockedAt: &lockedAt, LockedBy: &actor}, nil
}

func validatePeriodReady(ctx context.Context, tx pgx.Tx, bookID string, month time.Time) error {
	next := month.AddDate(0, 1, 0)
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM vou_documents WHERE business_date >= $1 AND business_date < $2 AND status <> 'APPROVED'
	)`, month, next).Scan(&exists); err != nil {
		return databaseError("check unfinished VOU documents", err)
	}
	if exists {
		return domainError(ErrorConflict, "accounting period has unfinished VOU documents", nil)
	}
	if err := tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM vou_documents document
		WHERE document.business_date >= $1 AND document.business_date < $2 AND document.status = 'APPROVED'
		  AND NOT EXISTS (
		    SELECT 1 FROM acc_mapping_versions mapping
		    WHERE mapping.book_id=$3 AND mapping.vou_entity=document.entity AND mapping.state='APPROVED'
		  )
	)`, month, next, bookID).Scan(&exists); err != nil {
		return databaseError("check accounting period mappings", err)
	}
	if exists {
		return domainError(ErrorConflict, "accounting period has missing VOU mappings", nil)
	}
	if err := tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM acc_inventory_entries WHERE book_id=$1
		GROUP BY subject_id, product_id, warehouse_id
		HAVING sum(quantity_delta_micros) FILTER (WHERE business_date < $2) < 0
	)`, bookID, next).Scan(&exists); err != nil {
		return databaseError("check accounting period inventory", err)
	}
	if exists {
		return domainError(ErrorConflict, "accounting period inventory is negative", nil)
	}
	if err := tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM acc_voucher_lines line JOIN acc_vouchers voucher ON voucher.id=line.voucher_id
		WHERE voucher.book_id=$1 AND voucher.business_date < $2
		GROUP BY line.currency HAVING sum(line.debit_minor) <> sum(line.credit_minor)
	)`, bookID, next).Scan(&exists); err != nil {
		return databaseError("check accounting period trial balance", err)
	}
	if exists {
		return domainError(ErrorConflict, "accounting period trial balance failed", nil)
	}
	return nil
}

func (s *Service) UnlockPeriod(ctx context.Context, input PeriodActionInput, actorID string) (PeriodView, error) {
	month, err := parsePeriodMonth(input.Month)
	if err != nil || input.Revision < 1 {
		return PeriodView{}, domainError(ErrorValidation, "invalid accounting period", err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PeriodView{}, databaseError("begin accounting period unlock", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	if err = s.requireAccess(ctx, q, input.BookID, actorID, true); err != nil {
		return PeriodView{}, err
	}
	latest, err := q.GetLatestLockedAccountingPeriod(ctx, input.BookID)
	if err != nil || !latest.PeriodMonth.Time.Equal(month) || latest.Revision != input.Revision {
		return PeriodView{}, domainError(ErrorConflict, "only the latest accounting period can be unlocked", err)
	}
	revision, err := q.UnlockAccountingPeriodRow(ctx, dbsqlc.UnlockAccountingPeriodRowParams{
		ActorID: actorID, BookID: input.BookID, PeriodMonth: pgtype.Date{Time: month, Valid: true}, Revision: input.Revision,
	})
	if err != nil {
		return PeriodView{}, databaseError("unlock accounting period", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return PeriodView{}, databaseError("commit accounting period unlock", err)
	}
	return PeriodView{BookID: input.BookID, Month: input.Month, State: PeriodStateUnlocked, Revision: revision}, nil
}
