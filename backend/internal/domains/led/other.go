package led

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
)

func (s *Service) QueryOther(ctx context.Context, input QueryInput) (Page[PartyEntryView], error) {
	query, err := validateQuery(EntityOther, input)
	if err != nil {
		return Page[PartyEntryView]{}, err
	}
	generationID, err := s.activeGeneration(ctx)
	if err != nil {
		return Page[PartyEntryView]{}, err
	}
	params := dbsqlc.CountLedOtherEntriesParams{
		GenerationID: generationID, DateFrom: dateValue(query.DateFrom), DateTo: dateValue(query.DateTo),
		ObjectID: query.ObjectID, SourceEntity: query.SourceEntity, DocumentNo: query.DocumentNo,
		CounterpartyEntity: query.CounterpartyType, OtherCategory: query.OtherCategory, Directions: query.Directions,
	}
	total, err := s.queries.CountLedOtherEntries(ctx, params)
	if err != nil {
		return Page[PartyEntryView]{}, s.internal("count other entries", err)
	}
	rows, err := s.queries.ListLedOtherEntries(ctx, dbsqlc.ListLedOtherEntriesParams{
		GenerationID: params.GenerationID, DateFrom: params.DateFrom, DateTo: params.DateTo,
		ObjectID: params.ObjectID, SourceEntity: params.SourceEntity, DocumentNo: params.DocumentNo,
		CounterpartyEntity: params.CounterpartyEntity, OtherCategory: params.OtherCategory, Directions: params.Directions,
		SortField: query.SortField, SortOrder: query.Order,
		PageOffset: int32((query.Page - 1) * query.PageSize), PageSize: int32(query.PageSize),
	})
	if err != nil {
		return Page[PartyEntryView]{}, s.internal("list other entries", err)
	}
	items := make([]PartyEntryView, 0, len(rows))
	for _, row := range rows {
		direction := "DEBIT"
		if row.AmountDeltaCents < 0 {
			direction = "CREDIT"
		}
		category := ""
		if row.OtherCategory != nil {
			category = *row.OtherCategory
		}
		items = append(items, PartyEntryView{
			ID: row.ID, EntryType: row.EntryType, SourceEntity: row.SourceEntity,
			SourceDocumentID: row.SourceDocumentID, SourceDocumentNo: row.SourceDocumentNo,
			SourceRevision: row.SourceRevision, EffectiveDate: formatDate(row.EffectiveDate),
			OccurredAt: row.OccurredAt.Time, Direction: direction, Amount: formatAbsoluteMoney(row.AmountDeltaCents),
			CounterpartyType: row.CounterpartyEntity,
			Counterparty: ReferenceView{ObjectID: row.CounterpartyObjectID, VersionID: row.CounterpartyVersionID,
				Entity: row.CounterpartyEntity, Code: row.CounterpartyCode, Name: row.CounterpartyName},
			Currency: row.Currency, Remark: deref(row.Remark), OtherCategory: category,
		})
	}
	return Page[PartyEntryView]{Items: items, Total: total, Page: query.Page, PageSize: query.PageSize}, nil
}

func (s *Service) OtherBalance(ctx context.Context, input OtherBalanceInput) (Page[PartyBalanceView], error) {
	asOf, err := validateOtherBalance(input)
	if err != nil {
		return Page[PartyBalanceView]{}, err
	}
	generationID, err := s.activeGeneration(ctx)
	if err != nil {
		return Page[PartyBalanceView]{}, err
	}
	params := dbsqlc.CountLedOtherBalancesParams{
		GenerationID: generationID, AsOfDate: dateValue(asOf), ObjectID: input.Filters.ObjectID,
		CounterpartyEntity: input.Filters.CounterpartyType,
	}
	total, err := s.queries.CountLedOtherBalances(ctx, params)
	if err != nil {
		return Page[PartyBalanceView]{}, s.internal("count other balances", err)
	}
	rows, err := s.queries.ListLedOtherBalances(ctx, dbsqlc.ListLedOtherBalancesParams{
		GenerationID: params.GenerationID, AsOfDate: params.AsOfDate, ObjectID: params.ObjectID,
		CounterpartyEntity: params.CounterpartyEntity,
		PageOffset:         int32((input.Page - 1) * input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[PartyBalanceView]{}, s.internal("list other balances", err)
	}
	items := make([]PartyBalanceView, 0, len(rows))
	for _, row := range rows {
		balanceType := "ZERO"
		if row.BalanceCents > 0 {
			balanceType = "RECEIVABLE"
		} else if row.BalanceCents < 0 {
			balanceType = "PAYABLE"
		}
		items = append(items, PartyBalanceView{
			CounterpartyType: row.CounterpartyEntity,
			Counterparty: ReferenceView{ObjectID: row.CounterpartyObjectID, VersionID: row.CounterpartyVersionID,
				Entity: row.CounterpartyEntity, Code: row.CounterpartyCode, Name: row.CounterpartyName},
			Currency: row.Currency, BalanceType: balanceType, Amount: formatAbsoluteMoney(row.BalanceCents),
		})
	}
	return Page[PartyBalanceView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}
