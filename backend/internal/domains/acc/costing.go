package acc

import (
	"context"
	"encoding/json"
	"math/big"
	"sort"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"
)

type inventoryCostEntry struct {
	id, voucherID, subjectID, productID, warehouseID, currency, sourceEntity, sourceDocumentID, sourceLineID string
	quantity                                                                                                 int64
	directValue                                                                                              int64
	businessDate                                                                                             time.Time
	dimensions, counterpartDimensions                                                                        []byte
	counterpartSubjectID                                                                                     *string
	originDocumentID, originLineID                                                                           *string
}

type inventoryCostResult struct {
	entry               inventoryCostEntry
	cost                int64
	sourceCostEntryID   *string
	requiresSystemEntry bool
}

type inventoryCostState struct{ quantity, value int64 }

func settleInventoryCosts(ctx context.Context, tx pgx.Tx, bookID string, month time.Time) error {
	next := month.AddDate(0, 1, 0)
	if _, err := tx.Exec(ctx, `DELETE FROM acc_inventory_cost_allocations WHERE book_id=$1 AND period_month=$2`, bookID, month); err != nil {
		return databaseError("clear inventory cost retry", err)
	}
	rows, err := tx.Query(ctx, `SELECT entry.id,entry.voucher_id,entry.subject_id,entry.product_id,entry.warehouse_id,
		entry.quantity_delta_micros,voucher.business_date,line.currency,line.debit_minor-line.credit_minor,
		COALESCE(voucher.source_entity,''),voucher.source_id,entry.source_line_id,line.dimensions,
		entry.cost_counterpart_subject_id,entry.cost_counterpart_dimensions,
		entry.origin_source_document_id,entry.origin_source_line_id
		FROM acc_inventory_entries entry
		JOIN acc_vouchers voucher ON voucher.book_id=entry.book_id AND voucher.id=entry.voucher_id
		JOIN acc_voucher_lines line ON line.id=entry.voucher_line_id
		WHERE entry.book_id=$1 AND voucher.business_date<$2
		ORDER BY voucher.business_date,
		  CASE WHEN COALESCE(voucher.source_entity,'') IN ('order-production','self-production') AND entry.quantity_delta_micros<0 THEN 0 ELSE 1 END,
		  voucher.created_at,voucher.id,line.line_order,entry.id`, bookID, next)
	if err != nil {
		return databaseError("list inventory cost facts", err)
	}
	defer rows.Close()
	entries := make([]inventoryCostEntry, 0)
	for rows.Next() {
		var item inventoryCostEntry
		if err = rows.Scan(&item.id, &item.voucherID, &item.subjectID, &item.productID, &item.warehouseID,
			&item.quantity, &item.businessDate, &item.currency, &item.directValue, &item.sourceEntity,
			&item.sourceDocumentID, &item.sourceLineID, &item.dimensions, &item.counterpartSubjectID,
			&item.counterpartDimensions, &item.originDocumentID, &item.originLineID); err != nil {
			return databaseError("scan inventory cost fact", err)
		}
		entries = append(entries, item)
	}
	if err = rows.Err(); err != nil {
		return databaseError("list inventory cost facts", err)
	}

	states := map[string]inventoryCostState{}
	resultsByEntry := map[string]inventoryCostResult{}
	results := make([]inventoryCostResult, 0, len(entries))
	productionMaterialCosts := map[string]int64{}
	productionOutputQuantity := map[string]int64{}
	productionOutputCount := map[string]int{}
	for _, entry := range entries {
		if (entry.sourceEntity == "order-production" || entry.sourceEntity == "self-production") && entry.quantity > 0 {
			productionOutputQuantity[entry.voucherID] += entry.quantity
			productionOutputCount[entry.voucherID]++
		}
	}
	for _, entry := range entries {
		if entry.currency != "CNY" {
			return domainError(ErrorConflict, "inventory costing only supports CNY", nil)
		}
		key := entry.subjectID + ":" + entry.productID + ":" + entry.warehouseID
		state := states[key]
		result := inventoryCostResult{entry: entry}
		if entry.quantity < 0 {
			quantity := -entry.quantity
			if state.quantity < quantity || state.quantity <= 0 || state.value <= 0 {
				return domainError(ErrorConflict, "inventory cost is unavailable", nil)
			}
			result.cost = proportionalCost(state.value, quantity, state.quantity)
			if quantity == state.quantity {
				result.cost = state.value
			}
			result.requiresSystemEntry = true
			state.quantity -= quantity
			state.value -= result.cost
			if entry.sourceEntity == "order-production" || entry.sourceEntity == "self-production" {
				productionMaterialCosts[entry.voucherID] += result.cost
			}
		} else {
			result.cost = entry.directValue
			if result.cost < 0 {
				result.cost = -result.cost
			}
			switch entry.sourceEntity {
			case "sale-return":
				origin, found := findOriginCost(resultsByEntry, entry)
				if !found {
					return domainError(ErrorConflict, "sale return original cost is unavailable", nil)
				}
				result.cost = proportionalCost(origin.cost, entry.quantity, -origin.entry.quantity)
				sourceID := origin.entry.id
				result.sourceCostEntryID = &sourceID
				result.requiresSystemEntry = true
			case "order-production", "self-production":
				totalCost := productionMaterialCosts[entry.voucherID]
				remainingQuantity := productionOutputQuantity[entry.voucherID]
				if totalCost <= 0 || remainingQuantity <= 0 {
					return domainError(ErrorConflict, "production output cost is unavailable", nil)
				}
				result.cost = totalCost
				if productionOutputCount[entry.voucherID] > 1 {
					result.cost = proportionalCost(totalCost, entry.quantity, remainingQuantity)
				}
				productionMaterialCosts[entry.voucherID] -= result.cost
				productionOutputQuantity[entry.voucherID] -= entry.quantity
				productionOutputCount[entry.voucherID]--
				result.requiresSystemEntry = true
			case "inventory-count":
				if result.cost == 0 {
					if state.quantity <= 0 || state.value <= 0 {
						return domainError(ErrorConflict, "inventory gain cost is unavailable", nil)
					}
					result.cost = proportionalCost(state.value, entry.quantity, state.quantity)
					result.requiresSystemEntry = true
				}
			}
			if result.cost <= 0 && entry.businessDate.Before(next) {
				return domainError(ErrorConflict, "inventory inbound cost is unavailable", nil)
			}
			state.quantity += entry.quantity
			state.value += result.cost
		}
		states[key] = state
		results = append(results, result)
		resultsByEntry[entry.id] = result
	}

	monthResults := make([]inventoryCostResult, 0)
	for _, result := range results {
		if !result.entry.businessDate.Before(month) && result.entry.businessDate.Before(next) {
			monthResults = append(monthResults, result)
		}
	}
	return persistInventoryCosts(ctx, tx, bookID, month, monthResults)
}

func proportionalCost(value, part, total int64) int64 {
	product := new(big.Int).Mul(big.NewInt(value), big.NewInt(part))
	quotient, remainder := new(big.Int), new(big.Int)
	quotient.QuoRem(product, big.NewInt(total), remainder)
	if new(big.Int).Mul(remainder, big.NewInt(2)).Cmp(big.NewInt(total)) >= 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	return quotient.Int64()
}

func findOriginCost(results map[string]inventoryCostResult, entry inventoryCostEntry) (inventoryCostResult, bool) {
	if entry.originDocumentID == nil && entry.originLineID == nil {
		return inventoryCostResult{}, false
	}
	candidates := make([]inventoryCostResult, 0)
	for _, result := range results {
		if result.entry.quantity >= 0 {
			continue
		}
		if entry.originDocumentID != nil && result.entry.sourceDocumentID != *entry.originDocumentID {
			continue
		}
		if entry.originLineID != nil && result.entry.sourceLineID != *entry.originLineID {
			continue
		}
		candidates = append(candidates, result)
	}
	if len(candidates) == 0 {
		return inventoryCostResult{}, false
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].entry.id < candidates[j].entry.id })
	return candidates[0], true
}

func persistInventoryCosts(ctx context.Context, tx pgx.Tx, bookID string, month time.Time, results []inventoryCostResult) error {
	derived := make([]inventoryCostResult, 0)
	for _, result := range results {
		if result.requiresSystemEntry {
			if result.entry.counterpartSubjectID == nil || result.cost <= 0 {
				return domainError(ErrorConflict, "inventory cost counterpart mapping is missing", nil)
			}
			derived = append(derived, result)
		}
	}
	var voucherID *string
	if len(derived) != 0 {
		id := ulid.Make().String()
		voucherID = &id
		businessDate := month.AddDate(0, 1, -1)
		if _, err := tx.Exec(ctx, `INSERT INTO acc_vouchers(id,book_id,source_type,source_id,business_date,created_by)
			VALUES($1,$2,'COST_SETTLEMENT',$3,$4,$5)`, id, bookID, bookID+":"+month.Format("2006-01"), businessDate, systemidentity.UserID); err != nil {
			return databaseError("create system cost voucher", err)
		}
		lineOrder := 0
		for _, result := range derived {
			inventoryDebit := result.entry.quantity > 0
			for _, line := range []struct {
				subjectID  string
				dimensions []byte
				debit      bool
			}{{result.entry.subjectID, result.entry.dimensions, inventoryDebit}, {*result.entry.counterpartSubjectID, result.entry.counterpartDimensions, !inventoryDebit}} {
				debit, credit := int64(0), int64(0)
				if line.debit {
					debit = result.cost
				} else {
					credit = result.cost
				}
				if len(line.dimensions) == 0 {
					line.dimensions = []byte(`{}`)
				}
				if !json.Valid(line.dimensions) {
					return domainError(ErrorInternal, "invalid stored cost dimensions", nil)
				}
				if _, err := tx.Exec(ctx, `INSERT INTO acc_voucher_lines(id,book_id,voucher_id,subject_id,currency,debit_minor,credit_minor,dimensions,source_line_id,line_order)
					VALUES($1,$2,$3,$4,'CNY',$5,$6,$7,$8,$9)`, ulid.Make().String(), bookID, id, line.subjectID, debit, credit, line.dimensions, result.entry.id, lineOrder); err != nil {
					return databaseError("create system cost voucher line", err)
				}
				lineOrder++
			}
		}
	}
	for _, result := range results {
		if result.cost <= 0 {
			return domainError(ErrorConflict, "inventory cost is unavailable", nil)
		}
		var allocationVoucherID *string
		if result.requiresSystemEntry {
			allocationVoucherID = voucherID
		}
		if _, err := tx.Exec(ctx, `INSERT INTO acc_inventory_cost_allocations(entry_id,book_id,period_month,quantity_micros,cost_minor,source_cost_entry_id,system_voucher_id)
			VALUES($1,$2,$3,$4,$5,$6,$7)`, result.entry.id, bookID, month, absCostQuantity(result.entry.quantity), result.cost, result.sourceCostEntryID, allocationVoucherID); err != nil {
			return databaseError("create inventory cost allocation", err)
		}
	}
	return nil
}

func absCostQuantity(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}
