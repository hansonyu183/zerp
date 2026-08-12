package acc

import (
	"context"
	"encoding/json"
	"math/big"
	"sort"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5/pgtype"
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

func settleInventoryCosts(ctx context.Context, q *dbsqlc.Queries, bookID string, month time.Time) error {
	next := month.AddDate(0, 1, 0)
	if err := q.DeleteAccountingInventoryCostAllocations(ctx, dbsqlc.DeleteAccountingInventoryCostAllocationsParams{BookID: bookID, PeriodMonth: pgtype.Date{Time: month, Valid: true}}); err != nil {
		return databaseError("clear inventory cost retry", err)
	}
	rows, err := q.ListAccountingInventoryCostFacts(ctx, dbsqlc.ListAccountingInventoryCostFactsParams{BookID: bookID, BeforeDate: pgtype.Date{Time: next, Valid: true}})
	if err != nil {
		return databaseError("list inventory cost facts", err)
	}
	entries := make([]inventoryCostEntry, 0, len(rows))
	for _, row := range rows {
		entries = append(entries, inventoryCostEntry{
			id: row.ID, voucherID: row.VoucherID, subjectID: row.SubjectID,
			productID: row.ProductID, warehouseID: row.WarehouseID,
			quantity: row.QuantityDeltaMicros, businessDate: row.BusinessDate.Time,
			currency: row.Currency, directValue: row.DirectValue, sourceEntity: row.SourceEntity,
			sourceDocumentID: row.SourceID, sourceLineID: row.SourceLineID,
			dimensions: row.Dimensions, counterpartSubjectID: row.CostCounterpartSubjectID,
			counterpartDimensions: row.CostCounterpartDimensions,
			originDocumentID:      row.OriginSourceDocumentID, originLineID: row.OriginSourceLineID,
		})
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
					if state.quantity > 0 && state.value > 0 {
						result.cost = proportionalCost(state.value, entry.quantity, state.quantity)
					} else if purchaseCost, found := latestPurchaseCost(results, entry); found {
						result.cost = purchaseCost
					} else {
						return domainError(ErrorConflict, "inventory gain cost is unavailable", nil)
					}
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
	return persistInventoryCosts(ctx, q, bookID, month, monthResults)
}

func latestPurchaseCost(results []inventoryCostResult, entry inventoryCostEntry) (int64, bool) {
	for index := len(results) - 1; index >= 0; index-- {
		candidate := results[index]
		if candidate.entry.sourceEntity != "purchase-inbound" || candidate.entry.quantity <= 0 || candidate.cost <= 0 {
			continue
		}
		if candidate.entry.subjectID != entry.subjectID || candidate.entry.productID != entry.productID || candidate.entry.warehouseID != entry.warehouseID {
			continue
		}
		return proportionalCost(candidate.cost, entry.quantity, candidate.entry.quantity), true
	}
	return 0, false
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

func persistInventoryCosts(ctx context.Context, q *dbsqlc.Queries, bookID string, month time.Time, results []inventoryCostResult) error {
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
		if err := q.CreateAccountingVoucher(ctx, dbsqlc.CreateAccountingVoucherParams{
			ID: id, BookID: bookID, SourceType: "COST_SETTLEMENT", SourceID: bookID + ":" + month.Format("2006-01"),
			BusinessDate: pgtype.Date{Time: businessDate, Valid: true}, ActorID: systemidentity.UserID,
		}); err != nil {
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
				if err := q.InsertAccountingVoucherLine(ctx, dbsqlc.InsertAccountingVoucherLineParams{
					ID: ulid.Make().String(), BookID: bookID, VoucherID: id, SubjectID: line.subjectID,
					Currency: "CNY", DebitMinor: debit, CreditMinor: credit, Dimensions: line.dimensions,
					SourceLineID: result.entry.id, LineOrder: int32(lineOrder),
				}); err != nil {
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
		if err := q.InsertAccountingInventoryCostAllocation(ctx, dbsqlc.InsertAccountingInventoryCostAllocationParams{
			EntryID: result.entry.id, BookID: bookID, PeriodMonth: pgtype.Date{Time: month, Valid: true},
			QuantityMicros: absCostQuantity(result.entry.quantity), CostMinor: result.cost,
			SourceCostEntryID: result.sourceCostEntryID, SystemVoucherID: allocationVoucherID,
		}); err != nil {
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
