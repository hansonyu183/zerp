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
	if err = lockAccountingPeriodMonth(ctx, q, month); err != nil {
		return PeriodView{}, databaseError("lock accounting period month", err)
	}
	if err = s.requireAccess(ctx, q, input.BookID, actorID, true); err != nil {
		return PeriodView{}, err
	}
	book, err := q.GetAccountingBook(ctx, input.BookID)
	if err != nil {
		return PeriodView{}, databaseError("get accounting period book", err)
	}
	openingApproved, err := q.IsAccountingBookReadyForPosting(ctx, input.BookID)
	if err != nil || !openingApproved {
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
	if err = validatePeriodReady(ctx, q, input.BookID, month); err != nil {
		return PeriodView{}, err
	}
	if err = settleInventoryCosts(ctx, q, input.BookID, month); err != nil {
		return PeriodView{}, err
	}
	if err = settleDepreciation(ctx, q, input.BookID, month); err != nil {
		return PeriodView{}, err
	}
	if err = buildPeriodBalances(ctx, q, input.BookID, month); err != nil {
		return PeriodView{}, err
	}
	if err = validateAccountingTrialBalance(ctx, q, input.BookID, month.AddDate(0, 1, 0)); err != nil {
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

func validatePeriodReady(ctx context.Context, q *dbsqlc.Queries, bookID string, month time.Time) error {
	next := month.AddDate(0, 1, 0)
	exists, err := q.AccountingPeriodHasUnfinishedVOU(ctx, dbsqlc.AccountingPeriodHasUnfinishedVOUParams{
		PeriodStart: pgtype.Date{Time: month, Valid: true}, PeriodEnd: pgtype.Date{Time: next, Valid: true},
	})
	if err != nil {
		return databaseError("check unfinished VOU documents", err)
	}
	if exists {
		return domainError(ErrorConflict, "accounting period has unfinished VOU documents", nil)
	}
	exists, err = q.AccountingPeriodHasMissingMappings(ctx, dbsqlc.AccountingPeriodHasMissingMappingsParams{
		PeriodStart: pgtype.Date{Time: month, Valid: true}, PeriodEnd: pgtype.Date{Time: next, Valid: true}, BookID: bookID,
	})
	if err != nil {
		return databaseError("check accounting period mappings", err)
	}
	if exists {
		return domainError(ErrorConflict, "accounting period has missing VOU mappings", nil)
	}
	exists, err = q.AccountingPeriodHasNegativeInventory(ctx, dbsqlc.AccountingPeriodHasNegativeInventoryParams{
		BookID: bookID, PeriodEnd: pgtype.Date{Time: next, Valid: true},
	})
	if err != nil {
		return databaseError("check accounting period inventory", err)
	}
	if exists {
		return domainError(ErrorConflict, "accounting period inventory is negative", nil)
	}
	return validateAccountingTrialBalance(ctx, q, bookID, next)
}

func validateAccountingTrialBalance(ctx context.Context, q *dbsqlc.Queries, bookID string, before time.Time) error {
	exists, err := q.AccountingTrialBalanceFails(ctx, dbsqlc.AccountingTrialBalanceFailsParams{
		BookID: bookID, BeforeDate: pgtype.Date{Time: before, Valid: true},
	})
	if err != nil {
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
	if err = lockAccountingPeriodMonth(ctx, q, month); err != nil {
		return PeriodView{}, databaseError("lock accounting period month", err)
	}
	if err = s.requireAccess(ctx, q, input.BookID, actorID, true); err != nil {
		return PeriodView{}, err
	}
	latest, err := q.GetLatestLockedAccountingPeriod(ctx, input.BookID)
	if err != nil || !latest.PeriodMonth.Time.Equal(month) || latest.Revision != input.Revision {
		return PeriodView{}, domainError(ErrorConflict, "only the latest accounting period can be unlocked", err)
	}
	if err = reversePeriodDerivedFacts(ctx, q, input.BookID, month); err != nil {
		return PeriodView{}, err
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
