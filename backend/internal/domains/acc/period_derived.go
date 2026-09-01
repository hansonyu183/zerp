package acc

import (
	"context"
	"math/big"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/oklog/ulid/v2"
)

type depreciationCandidate struct {
	assetID, currency, accumulatedSubjectID, expenseSubjectID string
	accumulatedDimensions, accumulatedDimensionReferences     []byte
	expenseDimensions, expenseDimensionReferences             []byte
	original, accumulated                                     int64
	residualBPS                                               int32
	usefulLife                                                int32
	acquiredOn                                                time.Time
}

func settleDepreciation(ctx context.Context, q *dbsqlc.Queries, bookID string, month time.Time) error {
	rows, err := q.ListAccountingDepreciationCandidates(ctx, dbsqlc.ListAccountingDepreciationCandidatesParams{BookID: bookID, PeriodMonth: pgtype.Date{Time: month, Valid: true}})
	if err != nil {
		return databaseError("list depreciation candidates", err)
	}
	candidates := make([]depreciationCandidate, 0, len(rows))
	for _, row := range rows {
		candidates = append(candidates, depreciationCandidate{
			assetID: row.AssetID, currency: row.Currency, original: row.OriginalMinor,
			accumulated: row.AccumulatedDepreciationMinor, residualBPS: row.ResidualRateBps,
			usefulLife: row.UsefulLifeMonths, acquiredOn: row.AcquiredOn.Time,
			accumulatedSubjectID: row.AccumulatedSubjectID, accumulatedDimensions: row.AccumulatedDimensions,
			accumulatedDimensionReferences: row.AccumulatedDimensionReferences,
			expenseSubjectID:               row.ExpenseSubjectID, expenseDimensions: row.ExpenseDimensions, expenseDimensionReferences: row.ExpenseDimensionReferences,
		})
	}
	type calculated struct {
		depreciationCandidate
		amount int64
	}
	calculatedRows := make([]calculated, 0)
	for _, item := range candidates {
		if item.currency != "CNY" {
			return domainError(ErrorConflict, "depreciation only supports CNY", nil)
		}
		residual := roundedRatio(item.original, int64(item.residualBPS), 10000)
		depreciable := item.original - residual
		first := time.Date(item.acquiredOn.Year(), item.acquiredOn.Month()+1, 1, 0, 0, 0, 0, time.UTC)
		months := int64((month.Year()-first.Year())*12 + int(month.Month()-first.Month()) + 1)
		if months <= 0 {
			continue
		}
		life := int64(item.usefulLife)
		var target int64
		if months >= life {
			target = depreciable
		} else {
			target = roundedRatio(depreciable, 1, life) * months
			if target > depreciable {
				target = depreciable
			}
		}
		amount := target - item.accumulated
		if amount > 0 {
			calculatedRows = append(calculatedRows, calculated{item, amount})
		}
	}
	if len(calculatedRows) == 0 {
		return nil
	}
	voucherID := ulid.Make().String()
	date := month.AddDate(0, 1, -1)
	if err = q.CreateAccountingVoucher(ctx, dbsqlc.CreateAccountingVoucherParams{
		ID: voucherID, BookID: bookID, SourceType: "DEPRECIATION", SourceID: bookID + ":" + month.Format("2006-01"),
		BusinessDate: pgtype.Date{Time: date, Valid: true}, ActorID: systemidentity.UserID,
	}); err != nil {
		return databaseError("create depreciation voucher", err)
	}
	lineOrder := 0
	for _, item := range calculatedRows {
		for _, line := range []struct {
			subject             string
			dimensions          []byte
			dimensionReferences []byte
			debit               bool
		}{{item.expenseSubjectID, item.expenseDimensions, item.expenseDimensionReferences, true}, {item.accumulatedSubjectID, item.accumulatedDimensions, item.accumulatedDimensionReferences, false}} {
			debit, credit := int64(0), int64(0)
			if line.debit {
				debit = item.amount
			} else {
				credit = item.amount
			}
			if err = q.InsertAccountingVoucherLine(ctx, dbsqlc.InsertAccountingVoucherLineParams{
				ID: ulid.Make().String(), BookID: bookID, VoucherID: voucherID, SubjectID: line.subject,
				Currency: "CNY", DebitMinor: debit, CreditMinor: credit, Dimensions: line.dimensions, DimensionReferences: line.dimensionReferences,
				SourceLineID: item.assetID, LineOrder: int32(lineOrder),
			}); err != nil {
				return databaseError("create depreciation voucher line", err)
			}
			lineOrder++
		}
		if err = q.InsertAccountingDepreciationEntry(ctx, dbsqlc.InsertAccountingDepreciationEntryParams{
			ID: ulid.Make().String(), BookID: bookID, AssetID: item.assetID,
			PeriodMonth: pgtype.Date{Time: month, Valid: true}, AmountMinor: item.amount, SystemVoucherID: voucherID,
		}); err != nil {
			return databaseError("create depreciation entry", err)
		}
		if err = q.AddAccountingAssetDepreciation(ctx, dbsqlc.AddAccountingAssetDepreciationParams{AmountMinor: item.amount, BookID: bookID, AssetID: item.assetID}); err != nil {
			return databaseError("update asset depreciation", err)
		}
	}
	return nil
}

func roundedRatio(value, numerator, denominator int64) int64 {
	product := new(big.Int).Mul(big.NewInt(value), big.NewInt(numerator))
	quotient, remainder := new(big.Int), new(big.Int)
	quotient.QuoRem(product, big.NewInt(denominator), remainder)
	if new(big.Int).Mul(remainder, big.NewInt(2)).Cmp(big.NewInt(denominator)) >= 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	return quotient.Int64()
}

func buildPeriodBalances(ctx context.Context, q *dbsqlc.Queries, bookID string, month time.Time) error {
	next := month.AddDate(0, 1, 0)
	if err := q.DeleteAccountingPeriodBalances(ctx, dbsqlc.DeleteAccountingPeriodBalancesParams{BookID: bookID, PeriodMonth: pgtype.Date{Time: month, Valid: true}}); err != nil {
		return databaseError("clear period balances", err)
	}
	err := q.BuildAccountingPeriodBalances(ctx, dbsqlc.BuildAccountingPeriodBalancesParams{
		BookID: bookID, PeriodMonth: pgtype.Date{Time: month, Valid: true}, PeriodEnd: pgtype.Date{Time: next, Valid: true},
	})
	if err != nil {
		return databaseError("build accounting period balances", err)
	}
	return nil
}

func reversePeriodDerivedFacts(ctx context.Context, q *dbsqlc.Queries, bookID string, month time.Time) error {
	period := pgtype.Date{Time: month, Valid: true}
	if err := q.ReverseAccountingAssetDepreciation(ctx, dbsqlc.ReverseAccountingAssetDepreciationParams{BookID: bookID, PeriodMonth: period}); err != nil {
		return databaseError("reverse asset depreciation", err)
	}
	if err := q.DeleteAccountingPeriodBalances(ctx, dbsqlc.DeleteAccountingPeriodBalancesParams{BookID: bookID, PeriodMonth: period}); err != nil {
		return databaseError("delete period balances", err)
	}
	if err := q.DeleteAccountingDepreciationEntries(ctx, dbsqlc.DeleteAccountingDepreciationEntriesParams{BookID: bookID, PeriodMonth: period}); err != nil {
		return databaseError("delete depreciation entries", err)
	}
	if err := q.DeleteAccountingInventoryCostAllocations(ctx, dbsqlc.DeleteAccountingInventoryCostAllocationsParams{BookID: bookID, PeriodMonth: period}); err != nil {
		return databaseError("delete inventory costs", err)
	}
	if err := q.DeleteAccountingPeriodSystemVouchers(ctx, dbsqlc.DeleteAccountingPeriodSystemVouchersParams{BookID: bookID, SourceID: bookID + ":" + month.Format("2006-01")}); err != nil {
		return databaseError("delete period system vouchers", err)
	}
	return nil
}
