package acc

import (
	"context"
	"math/big"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"
)

type depreciationCandidate struct {
	assetID, currency, accumulatedSubjectID, expenseSubjectID string
	accumulatedDimensions, expenseDimensions                  []byte
	original, accumulated                                     int64
	residualBPS                                               int32
	usefulLife                                                int32
	acquiredOn                                                time.Time
}

func settleDepreciation(ctx context.Context, tx pgx.Tx, bookID string, month time.Time) error {
	rows, err := tx.Query(ctx, `SELECT value.asset_id,value.currency,value.original_minor,value.accumulated_depreciation_minor,
		asset.residual_rate_bps,asset.useful_life_months,asset.acquired_on,
		value.accumulated_subject_id,value.accumulated_dimensions,value.expense_subject_id,value.expense_dimensions
		FROM acc_asset_book_values value JOIN acc_assets asset ON asset.id=value.asset_id
		WHERE value.book_id=$1 AND asset.acquired_on<$2
		  AND (asset.disposed_on IS NULL OR asset.disposed_on>=$2)
		ORDER BY asset.acquired_on,asset.id FOR UPDATE OF value`, bookID, month)
	if err != nil {
		return databaseError("list depreciation candidates", err)
	}
	defer rows.Close()
	candidates := make([]depreciationCandidate, 0)
	for rows.Next() {
		var item depreciationCandidate
		if err = rows.Scan(&item.assetID, &item.currency, &item.original, &item.accumulated, &item.residualBPS, &item.usefulLife, &item.acquiredOn,
			&item.accumulatedSubjectID, &item.accumulatedDimensions, &item.expenseSubjectID, &item.expenseDimensions); err != nil {
			return databaseError("scan depreciation candidate", err)
		}
		candidates = append(candidates, item)
	}
	if err = rows.Err(); err != nil {
		return databaseError("list depreciation candidates", err)
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
	if _, err = tx.Exec(ctx, `INSERT INTO acc_vouchers(id,book_id,source_type,source_id,business_date,created_by)
		VALUES($1,$2,'DEPRECIATION',$3,$4,$5)`, voucherID, bookID, bookID+":"+month.Format("2006-01"), date, systemidentity.UserID); err != nil {
		return databaseError("create depreciation voucher", err)
	}
	lineOrder := 0
	for _, item := range calculatedRows {
		for _, line := range []struct {
			subject    string
			dimensions []byte
			debit      bool
		}{{item.expenseSubjectID, item.expenseDimensions, true}, {item.accumulatedSubjectID, item.accumulatedDimensions, false}} {
			debit, credit := int64(0), int64(0)
			if line.debit {
				debit = item.amount
			} else {
				credit = item.amount
			}
			if _, err = tx.Exec(ctx, `INSERT INTO acc_voucher_lines(id,book_id,voucher_id,subject_id,currency,debit_minor,credit_minor,dimensions,source_line_id,line_order)
				VALUES($1,$2,$3,$4,'CNY',$5,$6,$7,$8,$9)`, ulid.Make().String(), bookID, voucherID, line.subject, debit, credit, line.dimensions, item.assetID, lineOrder); err != nil {
				return databaseError("create depreciation voucher line", err)
			}
			lineOrder++
		}
		if _, err = tx.Exec(ctx, `INSERT INTO acc_depreciation_entries(id,book_id,asset_id,period_month,amount_minor,system_voucher_id)
			VALUES($1,$2,$3,$4,$5,$6)`, ulid.Make().String(), bookID, item.assetID, month, item.amount, voucherID); err != nil {
			return databaseError("create depreciation entry", err)
		}
		if _, err = tx.Exec(ctx, `UPDATE acc_asset_book_values SET accumulated_depreciation_minor=accumulated_depreciation_minor+$1
			WHERE book_id=$2 AND asset_id=$3`, item.amount, bookID, item.assetID); err != nil {
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

func buildPeriodBalances(ctx context.Context, tx pgx.Tx, bookID string, month time.Time) error {
	next := month.AddDate(0, 1, 0)
	if _, err := tx.Exec(ctx, `DELETE FROM acc_period_balances WHERE book_id=$1 AND period_month=$2`, bookID, month); err != nil {
		return databaseError("clear period balances", err)
	}
	_, err := tx.Exec(ctx, `INSERT INTO acc_period_balances(
		id,book_id,period_month,subject_id,currency,dimensions,dimension_key,
		opening_balance_minor,debit_turnover_minor,credit_turnover_minor,closing_balance_minor)
	SELECT substr(md5($1||':'||$2::date::text||':'||line.subject_id||':'||line.currency||':'||line.dimensions::text),1,26),
		$1,$2::date,line.subject_id,line.currency,line.dimensions,line.dimensions::text,
		COALESCE(sum(line.debit_minor-line.credit_minor) FILTER(WHERE voucher.business_date<$2::date),0)::bigint,
		COALESCE(sum(line.debit_minor) FILTER(WHERE voucher.business_date>=$2::date AND voucher.business_date<$3::date),0)::bigint,
		COALESCE(sum(line.credit_minor) FILTER(WHERE voucher.business_date>=$2::date AND voucher.business_date<$3::date),0)::bigint,
		sum(line.debit_minor-line.credit_minor)::bigint
	FROM acc_voucher_lines line JOIN acc_vouchers voucher ON voucher.book_id=line.book_id AND voucher.id=line.voucher_id
	WHERE line.book_id=$1 AND voucher.business_date<$3::date
	GROUP BY line.subject_id,line.currency,line.dimensions`, bookID, month, next)
	if err != nil {
		return databaseError("build accounting period balances", err)
	}
	return nil
}

func reversePeriodDerivedFacts(ctx context.Context, tx pgx.Tx, bookID string, month time.Time) error {
	if _, err := tx.Exec(ctx, `UPDATE acc_asset_book_values value SET accumulated_depreciation_minor=value.accumulated_depreciation_minor-source.amount
		FROM (SELECT asset_id,sum(amount_minor)::bigint amount FROM acc_depreciation_entries WHERE book_id=$1 AND period_month=$2 GROUP BY asset_id) source
		WHERE value.book_id=$1 AND value.asset_id=source.asset_id`, bookID, month); err != nil {
		return databaseError("reverse asset depreciation", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM acc_period_balances WHERE book_id=$1 AND period_month=$2`, bookID, month); err != nil {
		return databaseError("delete period balances", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM acc_depreciation_entries WHERE book_id=$1 AND period_month=$2`, bookID, month); err != nil {
		return databaseError("delete depreciation entries", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM acc_inventory_cost_allocations WHERE book_id=$1 AND period_month=$2`, bookID, month); err != nil {
		return databaseError("delete inventory costs", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM acc_vouchers WHERE book_id=$1 AND source_type IN ('COST_SETTLEMENT','DEPRECIATION')
		AND source_id IN ($2,$3)`, bookID, bookID+":"+month.Format("2006-01"), bookID+":"+month.Format("2006-01")); err != nil {
		return databaseError("delete period system vouchers", err)
	}
	return nil
}
