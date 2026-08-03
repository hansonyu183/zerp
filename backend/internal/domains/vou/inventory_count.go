package vou

import (
	"context"
	"errors"
	"sort"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) InventoryCountBookBalance(
	ctx context.Context, input InventoryCountBalanceInput,
) (Page[InventoryCountBalanceItem], error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 || !validID(input.WarehouseObjectID) {
		return Page[InventoryCountBalanceItem]{}, domainError(ErrorValidation, "invalid inventory count balance request", nil, nil)
	}
	asOfDate, err := time.Parse(dateLayout, input.AsOfDate)
	if err != nil {
		return Page[InventoryCountBalanceItem]{}, domainError(ErrorValidation, "invalid asOfDate", nil, err)
	}
	control, err := s.queries.GetLedControl(ctx)
	if err != nil {
		return Page[InventoryCountBalanceItem]{}, s.internal("read inventory ledger", err)
	}
	if control.Status != "ACTIVE" || control.ActiveGenerationID == nil {
		return Page[InventoryCountBalanceItem]{}, domainError(ErrorConflict, "inventory ledger is not active", nil, nil)
	}
	date := pgtype.Date{Time: asOfDate, Valid: true}
	total, err := s.queries.CountVouInventoryCountBookBalances(ctx,
		dbsqlc.CountVouInventoryCountBookBalancesParams{
			GenerationID: *control.ActiveGenerationID, WarehouseObjectID: input.WarehouseObjectID,
			AsOfDate: date,
		})
	if err != nil {
		return Page[InventoryCountBalanceItem]{}, s.internal("count inventory count balances", err)
	}
	rows, err := s.queries.ListVouInventoryCountBookBalances(ctx,
		dbsqlc.ListVouInventoryCountBookBalancesParams{
			GenerationID: *control.ActiveGenerationID, WarehouseObjectID: input.WarehouseObjectID,
			AsOfDate: date, PageSize: int32(input.PageSize),
			PageOffset: int32((input.Page - 1) * input.PageSize),
		})
	if err != nil {
		return Page[InventoryCountBalanceItem]{}, s.internal("list inventory count balances", err)
	}
	items := make([]InventoryCountBalanceItem, 0, len(rows))
	for _, row := range rows {
		item := InventoryCountBalanceItem{Product: ReferenceView{
			ObjectID: row.ProductObjectID, VersionID: row.ProductVersionID, Entity: "product",
			Code: row.ProductCode, Name: row.ProductName, Unit: row.ProductUnit,
		}, Quantity: formatQuantity(row.QuantityMicros)}
		items = append(items, item)
	}
	return Page[InventoryCountBalanceItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) prepareInventoryCountFinalization(
	ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, document dbsqlc.VouDocument,
) (map[string]any, error) {
	control, err := q.LockLedControl(ctx)
	if err != nil {
		return nil, s.internal("lock inventory ledger", err)
	}
	if control.Status != "ACTIVE" || control.ActiveGenerationID == nil || !control.CutoverDate.Valid {
		return nil, domainError(ErrorConflict, "inventory ledger is not active", nil, nil)
	}
	businessDate := document.BusinessDate.Time
	if businessDate.Before(control.CutoverDate.Time) {
		return nil, domainError(ErrorConflict, "inventory count predates the active ledger", nil, nil)
	}
	if control.LastClosingID != nil {
		latestClosingDate, closingErr := q.GetVouInventoryCountClosingDate(ctx, *control.LastClosingID)
		if closingErr != nil {
			return nil, s.internal("read latest inventory closing", closingErr)
		}
		if !businessDate.After(latestClosingDate.Time) {
			return nil, domainError(ErrorConflict, "inventory count date is already closed", nil, nil)
		}
	}
	detail, err := q.GetVouInventoryCountDetail(ctx, document.ID)
	if err != nil {
		return nil, s.internal("read inventory count detail", err)
	}
	lines, err := q.ListVouInventoryCountLines(ctx, document.ID)
	if err != nil {
		return nil, s.internal("read inventory count lines", err)
	}
	sort.Slice(lines, func(i, j int) bool {
		return lines[i].ProductObjectID < lines[j].ProductObjectID
	})
	changed := 0
	for _, line := range lines {
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
			detail.WarehouseObjectID+"/"+line.ProductObjectID); err != nil {
			return nil, s.internal("lock inventory count dimension", err)
		}
		bookQuantity, bookErr := q.GetVouInventoryCountBookQuantity(ctx,
			dbsqlc.GetVouInventoryCountBookQuantityParams{
				GenerationID: *control.ActiveGenerationID, WarehouseObjectID: detail.WarehouseObjectID,
				ProductObjectID: line.ProductObjectID, AsOfDate: document.BusinessDate,
			})
		if bookErr != nil {
			return nil, s.internal("read inventory count quantity", bookErr)
		}
		difference := line.ActualQuantityMicros - bookQuantity
		updated, updateErr := q.SetVouInventoryCountResult(ctx, dbsqlc.SetVouInventoryCountResultParams{
			BookQuantityMicros: &bookQuantity, DifferenceQuantityMicros: &difference,
			ID: line.ID, DocumentID: document.ID,
		})
		if updateErr != nil {
			return nil, s.writeError("save inventory count result", updateErr)
		}
		if updated != 1 {
			return nil, domainError(ErrorConflict, "inventory count line changed", nil, errors.New("line not found"))
		}
		if difference != 0 {
			changed++
		}
	}
	return map[string]any{"lineCount": len(lines), "differenceLineCount": changed}, nil
}
