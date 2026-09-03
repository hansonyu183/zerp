package acc

import (
	"context"
	"sort"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// GuardVOUWrite acquires every affected natural-month lock and reports whether
// a VOU write may continue. It uses the caller transaction, so the write and a
// concurrent lock or unlock of the same month serialize at one boundary.
func (s *Service) GuardVOUWrite(ctx context.Context, tx pgx.Tx, businessDates ...time.Time) (bool, error) {
	months := accountingPeriodMonths(businessDates)
	q := s.queries.WithTx(tx)
	for _, month := range months {
		if err := lockAccountingPeriodMonth(ctx, q, month); err != nil {
			return false, databaseError("lock accounting period month", err)
		}
	}
	for _, month := range months {
		locked, err := q.IsAccountingPeriodLocked(ctx, pgtype.Date{Time: month, Valid: true})
		if err != nil {
			return false, databaseError("check accounting period lock", err)
		}
		if locked {
			return false, nil
		}
	}
	return true, nil
}

func accountingPeriodMonths(dates []time.Time) []time.Time {
	months := make([]time.Time, 0, len(dates))
	seen := make(map[time.Time]struct{}, len(dates))
	for _, date := range dates {
		if date.IsZero() {
			continue
		}
		month := time.Date(date.Year(), date.Month(), 1, 0, 0, 0, 0, time.UTC)
		if _, ok := seen[month]; ok {
			continue
		}
		seen[month] = struct{}{}
		months = append(months, month)
	}
	sort.Slice(months, func(i, j int) bool { return months[i].Before(months[j]) })
	return months
}

func lockAccountingPeriodMonth(ctx context.Context, q *dbsqlc.Queries, month time.Time) error {
	return q.LockAccountingPeriodMonth(ctx, pgtype.Date{Time: month, Valid: true})
}
