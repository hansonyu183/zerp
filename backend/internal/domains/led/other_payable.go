package led

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
)

func (s *Service) QueryOtherPayable(ctx context.Context, input QueryInput) (Page[PartyEntryView], error) {
	query, err := validateQuery(EntityOtherPayable, input)
	if err != nil {
		return Page[PartyEntryView]{}, err
	}
	generationID, err := s.activeGeneration(ctx)
	if err != nil {
		return Page[PartyEntryView]{}, err
	}
	params := dbsqlc.CountLedOtherPayableEntriesParams{
		GenerationID: generationID, DateFrom: dateValue(query.DateFrom), DateTo: dateValue(query.DateTo),
		ObjectID: query.ObjectID, SourceEntity: query.SourceEntity, DocumentNo: query.DocumentNo,
		PayableCategory: query.PayableCategory, Directions: query.Directions,
	}
	total, err := s.queries.CountLedOtherPayableEntries(ctx, params)
	if err != nil {
		return Page[PartyEntryView]{}, s.internal("count other payable entries", err)
	}
	rows, err := s.queries.ListLedOtherPayableEntries(ctx, dbsqlc.ListLedOtherPayableEntriesParams{
		GenerationID: params.GenerationID, DateFrom: params.DateFrom, DateTo: params.DateTo,
		ObjectID: params.ObjectID, SourceEntity: params.SourceEntity, DocumentNo: params.DocumentNo,
		PayableCategory: params.PayableCategory, Directions: params.Directions,
		SortField: query.SortField, SortOrder: query.Order,
		PageOffset: int32((query.Page - 1) * query.PageSize), PageSize: int32(query.PageSize),
	})
	if err != nil {
		return Page[PartyEntryView]{}, s.internal("list other payable entries", err)
	}
	items := make([]PartyEntryView, 0, len(rows))
	for _, row := range rows {
		direction := "DEBIT"
		if row.AmountDeltaCents < 0 {
			direction = "CREDIT"
		}
		category := ""
		if row.PayableCategory != nil {
			category = *row.PayableCategory
		}
		items = append(items, PartyEntryView{
			ID: row.ID, EntryType: row.EntryType, SourceEntity: row.SourceEntity,
			SourceDocumentID: row.SourceDocumentID, SourceDocumentNo: row.SourceDocumentNo,
			SourceRevision: row.SourceRevision, EffectiveDate: formatDate(row.EffectiveDate),
			OccurredAt: row.OccurredAt.Time, Direction: direction, Amount: formatAbsoluteMoney(row.AmountDeltaCents),
			CounterpartyType: row.CounterpartyEntity,
			Counterparty: ReferenceView{ObjectID: row.CounterpartyObjectID, VersionID: row.CounterpartyVersionID,
				Entity: row.CounterpartyEntity, Code: row.CounterpartyCode, Name: row.CounterpartyName},
			Currency: row.Currency, Remark: deref(row.Remark), PayableCategory: category,
		})
	}
	return Page[PartyEntryView]{Items: items, Total: total, Page: query.Page, PageSize: query.PageSize}, nil
}

func (s *Service) OtherPayableBalance(ctx context.Context, input BalanceInput) (Page[PartyBalanceView], error) {
	asOf, err := validateBalance(input)
	if err != nil {
		return Page[PartyBalanceView]{}, err
	}
	generationID, err := s.activeGeneration(ctx)
	if err != nil {
		return Page[PartyBalanceView]{}, err
	}
	params := dbsqlc.CountLedOtherPayableBalancesParams{
		GenerationID: generationID, AsOfDate: dateValue(asOf), ObjectID: input.Filters.ObjectID,
	}
	total, err := s.queries.CountLedOtherPayableBalances(ctx, params)
	if err != nil {
		return Page[PartyBalanceView]{}, s.internal("count other payable balances", err)
	}
	rows, err := s.queries.ListLedOtherPayableBalances(ctx, dbsqlc.ListLedOtherPayableBalancesParams{
		GenerationID: params.GenerationID, AsOfDate: params.AsOfDate, ObjectID: params.ObjectID,
		PageOffset: int32((input.Page - 1) * input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[PartyBalanceView]{}, s.internal("list other payable balances", err)
	}
	items := make([]PartyBalanceView, 0, len(rows))
	for _, row := range rows {
		category := ""
		if row.PayableCategory != nil {
			category = *row.PayableCategory
		}
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
			PayableCategory: category,
		})
	}
	return Page[PartyBalanceView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}
