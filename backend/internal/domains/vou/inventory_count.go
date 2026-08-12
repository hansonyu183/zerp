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
	_, err = s.queries.GetAccountingControlBookForVou(ctx)
	if err != nil {
		return Page[InventoryCountBalanceItem]{}, domainError(ErrorConflict, "accounting control book is not ready", nil, err)
	}
	date := pgtype.Date{Time: asOfDate, Valid: true}
	total, err := s.queries.CountVouInventoryCountBookBalances(ctx,
		dbsqlc.CountVouInventoryCountBookBalancesParams{
			WarehouseObjectID: input.WarehouseObjectID, AsOfDate: date,
		})
	if err != nil {
		return Page[InventoryCountBalanceItem]{}, s.internal("count inventory count balances", err)
	}
	rows, err := s.queries.ListVouInventoryCountBookBalances(ctx,
		dbsqlc.ListVouInventoryCountBookBalancesParams{
			WarehouseObjectID: input.WarehouseObjectID, AsOfDate: date, PageSize: int32(input.PageSize),
			PageOffset: int32((input.Page - 1) * input.PageSize),
		})
	if err != nil {
		return Page[InventoryCountBalanceItem]{}, s.internal("list inventory count balances", err)
	}
	items := make([]InventoryCountBalanceItem, 0, len(rows))
	for _, row := range rows {
		item := InventoryCountBalanceItem{Product: ReferenceView{
			ObjectID: row.ProductObjectID, VersionID: deref(row.ProductVersionID), Entity: "product",
			Code: row.ProductCode, Name: row.ProductName, Unit: row.ProductUnit,
		}, Quantity: formatQuantity(row.QuantityMicros)}
		items = append(items, item)
	}
	return Page[InventoryCountBalanceItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) prepareInventoryCountFinalization(
	ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, document dbsqlc.VouDocument,
) (map[string]any, error) {
	control, err := q.LockAccountingControlBookForVou(ctx)
	if err != nil {
		return nil, domainError(ErrorConflict, "accounting control book is not ready", nil, err)
	}
	businessDate := document.BusinessDate.Time
	if businessDate.Before(control.StartMonth.Time) {
		return nil, domainError(ErrorConflict, "inventory count predates the accounting control book", nil, nil)
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
				WarehouseObjectID: detail.WarehouseObjectID, ProductObjectID: line.ProductObjectID,
				AsOfDate: document.BusinessDate,
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
