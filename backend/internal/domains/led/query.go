package led

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
)

func (s *Service) QueryInventory(ctx context.Context, input QueryInput) (Page[InventoryEntryView], error) {
	query, err := validateQuery(EntityInventory, input)
	if err != nil {
		return Page[InventoryEntryView]{}, err
	}
	generationID, err := s.activeGeneration(ctx)
	if err != nil {
		return Page[InventoryEntryView]{}, err
	}
	countParams := dbsqlc.CountLedInventoryEntriesParams{
		GenerationID: generationID, DateFrom: dateValue(query.DateFrom), DateTo: dateValue(query.DateTo),
		ObjectID: query.ObjectID, SourceEntity: query.SourceEntity, DocumentNo: query.DocumentNo,
		Directions: query.Directions,
	}
	total, err := s.queries.CountLedInventoryEntries(ctx, countParams)
	if err != nil {
		return Page[InventoryEntryView]{}, s.internal("count inventory entries", err)
	}
	rows, err := s.queries.ListLedInventoryEntries(ctx, dbsqlc.ListLedInventoryEntriesParams{
		GenerationID: generationID, DateFrom: countParams.DateFrom, DateTo: countParams.DateTo,
		ObjectID: query.ObjectID, SourceEntity: query.SourceEntity, DocumentNo: query.DocumentNo,
		Directions: query.Directions, SortField: query.SortField, SortOrder: query.Order,
		PageOffset: int32((query.Page - 1) * query.PageSize), PageSize: int32(query.PageSize),
	})
	if err != nil {
		return Page[InventoryEntryView]{}, s.internal("list inventory entries", err)
	}
	items := make([]InventoryEntryView, 0, len(rows))
	for _, row := range rows {
		direction := "IN"
		if row.QuantityDeltaMicros < 0 {
			direction = "OUT"
		}
		items = append(items, InventoryEntryView{
			ID: row.ID, EntryType: row.EntryType, SourceEntity: row.SourceEntity,
			SourceDocumentID: row.SourceDocumentID, SourceDocumentNo: row.SourceDocumentNo,
			SourceLineID: row.SourceLineID, SourceRevision: row.SourceRevision,
			EffectiveDate: formatDate(row.EffectiveDate), OccurredAt: row.OccurredAt.Time,
			Direction: direction, Quantity: formatAbsoluteQuantity(row.QuantityDeltaMicros),
			Warehouse: ReferenceView{ObjectID: row.WarehouseObjectID, VersionID: row.WarehouseVersionID, Entity: bobdomain.EntityWarehouse, Code: row.WarehouseCode, Name: row.WarehouseName},
			Product:   ReferenceView{ObjectID: row.ProductObjectID, VersionID: row.ProductVersionID, Entity: bobdomain.EntityProduct, Code: row.ProductCode, Name: row.ProductName, Unit: row.ProductUnit},
			Reason:    deref(row.Reason),
		})
	}
	return Page[InventoryEntryView]{Items: items, Total: total, Page: query.Page, PageSize: query.PageSize}, nil
}

func (s *Service) QueryFund(ctx context.Context, input QueryInput) (Page[FundEntryView], error) {
	query, err := validateQuery(EntityFund, input)
	if err != nil {
		return Page[FundEntryView]{}, err
	}
	generationID, err := s.activeGeneration(ctx)
	if err != nil {
		return Page[FundEntryView]{}, err
	}
	countParams := dbsqlc.CountLedFundEntriesParams{
		GenerationID: generationID, DateFrom: dateValue(query.DateFrom), DateTo: dateValue(query.DateTo),
		ObjectID: query.ObjectID, SourceEntity: query.SourceEntity, DocumentNo: query.DocumentNo,
		Directions: query.Directions,
	}
	total, err := s.queries.CountLedFundEntries(ctx, countParams)
	if err != nil {
		return Page[FundEntryView]{}, s.internal("count fund entries", err)
	}
	rows, err := s.queries.ListLedFundEntries(ctx, dbsqlc.ListLedFundEntriesParams{
		GenerationID: generationID, DateFrom: countParams.DateFrom, DateTo: countParams.DateTo,
		ObjectID: query.ObjectID, SourceEntity: query.SourceEntity, DocumentNo: query.DocumentNo,
		Directions: query.Directions, SortField: query.SortField, SortOrder: query.Order,
		PageOffset: int32((query.Page - 1) * query.PageSize), PageSize: int32(query.PageSize),
	})
	if err != nil {
		return Page[FundEntryView]{}, s.internal("list fund entries", err)
	}
	items := make([]FundEntryView, 0, len(rows))
	for _, row := range rows {
		direction := "IN"
		if row.AmountDeltaCents < 0 {
			direction = "OUT"
		}
		items = append(items, FundEntryView{
			ID: row.ID, EntryType: row.EntryType, SourceEntity: row.SourceEntity,
			SourceDocumentID: row.SourceDocumentID, SourceDocumentNo: row.SourceDocumentNo,
			SourceRevision: row.SourceRevision, EffectiveDate: formatDate(row.EffectiveDate),
			OccurredAt: row.OccurredAt.Time, Direction: direction, Amount: formatAbsoluteMoney(row.AmountDeltaCents),
			FundAccount: ReferenceView{ObjectID: row.FundAccountObjectID, VersionID: row.FundAccountVersionID, Entity: bobdomain.EntityFundAccount, Code: row.FundAccountCode, Name: row.FundAccountName, Currency: row.Currency},
			Currency:    row.Currency, Reason: deref(row.Reason),
		})
	}
	return Page[FundEntryView]{Items: items, Total: total, Page: query.Page, PageSize: query.PageSize}, nil
}

func (s *Service) QueryParty(ctx context.Context, input QueryInput) (Page[PartyEntryView], error) {
	query, err := validateQuery(EntityParty, input)
	if err != nil {
		return Page[PartyEntryView]{}, err
	}
	generationID, err := s.activeGeneration(ctx)
	if err != nil {
		return Page[PartyEntryView]{}, err
	}
	countParams := dbsqlc.CountLedPartyEntriesParams{
		GenerationID: generationID, DateFrom: dateValue(query.DateFrom), DateTo: dateValue(query.DateTo),
		ObjectID: query.ObjectID, SourceEntity: query.SourceEntity, DocumentNo: query.DocumentNo,
		Directions: query.Directions,
	}
	total, err := s.queries.CountLedPartyEntries(ctx, countParams)
	if err != nil {
		return Page[PartyEntryView]{}, s.internal("count party entries", err)
	}
	rows, err := s.queries.ListLedPartyEntries(ctx, dbsqlc.ListLedPartyEntriesParams{
		GenerationID: generationID, DateFrom: countParams.DateFrom, DateTo: countParams.DateTo,
		ObjectID: query.ObjectID, SourceEntity: query.SourceEntity, DocumentNo: query.DocumentNo,
		Directions: query.Directions, SortField: query.SortField, SortOrder: query.Order,
		PageOffset: int32((query.Page - 1) * query.PageSize), PageSize: int32(query.PageSize),
	})
	if err != nil {
		return Page[PartyEntryView]{}, s.internal("list party entries", err)
	}
	items := make([]PartyEntryView, 0, len(rows))
	for _, row := range rows {
		direction := "DEBIT"
		if row.AmountDeltaCents < 0 {
			direction = "CREDIT"
		}
		items = append(items, PartyEntryView{
			ID: row.ID, EntryType: row.EntryType, SourceEntity: row.SourceEntity,
			SourceDocumentID: row.SourceDocumentID, SourceDocumentNo: row.SourceDocumentNo,
			SourceRevision: row.SourceRevision, EffectiveDate: formatDate(row.EffectiveDate),
			OccurredAt: row.OccurredAt.Time, Direction: direction, Amount: formatAbsoluteMoney(row.AmountDeltaCents),
			CounterpartyType: row.CounterpartyEntity,
			Counterparty:     ReferenceView{ObjectID: row.CounterpartyObjectID, VersionID: row.CounterpartyVersionID, Entity: row.CounterpartyEntity, Code: row.CounterpartyCode, Name: row.CounterpartyName},
			Currency:         row.Currency, Reason: deref(row.Reason),
		})
	}
	return Page[PartyEntryView]{Items: items, Total: total, Page: query.Page, PageSize: query.PageSize}, nil
}

func (s *Service) InventoryBalance(ctx context.Context, input BalanceInput) (Page[InventoryBalanceView], error) {
	asOf, err := validateBalance(input)
	if err != nil {
		return Page[InventoryBalanceView]{}, err
	}
	generationID, err := s.activeGeneration(ctx)
	if err != nil {
		return Page[InventoryBalanceView]{}, err
	}
	params := dbsqlc.CountLedInventoryBalancesParams{
		GenerationID: generationID, AsOfDate: dateValue(asOf), ObjectID: input.Filters.ObjectID,
	}
	total, err := s.queries.CountLedInventoryBalances(ctx, params)
	if err != nil {
		return Page[InventoryBalanceView]{}, s.internal("count inventory balances", err)
	}
	rows, err := s.queries.ListLedInventoryBalances(ctx, dbsqlc.ListLedInventoryBalancesParams{
		GenerationID: generationID, AsOfDate: params.AsOfDate, ObjectID: params.ObjectID,
		PageOffset: int32((input.Page - 1) * input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[InventoryBalanceView]{}, s.internal("list inventory balances", err)
	}
	items := make([]InventoryBalanceView, 0, len(rows))
	for _, row := range rows {
		items = append(items, InventoryBalanceView{
			Warehouse: ReferenceView{ObjectID: row.WarehouseObjectID, VersionID: row.WarehouseVersionID, Entity: bobdomain.EntityWarehouse, Code: row.WarehouseCode, Name: row.WarehouseName},
			Product:   ReferenceView{ObjectID: row.ProductObjectID, VersionID: row.ProductVersionID, Entity: bobdomain.EntityProduct, Code: row.ProductCode, Name: row.ProductName, Unit: row.ProductUnit},
			Quantity:  formatQuantity(row.BalanceMicros),
		})
	}
	return Page[InventoryBalanceView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) FundBalance(ctx context.Context, input BalanceInput) (Page[FundBalanceView], error) {
	asOf, err := validateBalance(input)
	if err != nil {
		return Page[FundBalanceView]{}, err
	}
	generationID, err := s.activeGeneration(ctx)
	if err != nil {
		return Page[FundBalanceView]{}, err
	}
	params := dbsqlc.CountLedFundBalancesParams{
		GenerationID: generationID, AsOfDate: dateValue(asOf), ObjectID: input.Filters.ObjectID,
	}
	total, err := s.queries.CountLedFundBalances(ctx, params)
	if err != nil {
		return Page[FundBalanceView]{}, s.internal("count fund balances", err)
	}
	rows, err := s.queries.ListLedFundBalances(ctx, dbsqlc.ListLedFundBalancesParams{
		GenerationID: generationID, AsOfDate: params.AsOfDate, ObjectID: params.ObjectID,
		PageOffset: int32((input.Page - 1) * input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[FundBalanceView]{}, s.internal("list fund balances", err)
	}
	items := make([]FundBalanceView, 0, len(rows))
	for _, row := range rows {
		balanceType := "POSITIVE"
		if row.BalanceCents < 0 {
			balanceType = "OVERDRAFT"
		}
		items = append(items, FundBalanceView{
			FundAccount: ReferenceView{ObjectID: row.FundAccountObjectID, VersionID: row.FundAccountVersionID, Entity: bobdomain.EntityFundAccount, Code: row.FundAccountCode, Name: row.FundAccountName, Currency: row.Currency},
			Currency:    row.Currency, BalanceType: balanceType, Amount: formatAbsoluteMoney(row.BalanceCents),
		})
	}
	return Page[FundBalanceView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) PartyBalance(ctx context.Context, input BalanceInput) (Page[PartyBalanceView], error) {
	asOf, err := validateBalance(input)
	if err != nil {
		return Page[PartyBalanceView]{}, err
	}
	generationID, err := s.activeGeneration(ctx)
	if err != nil {
		return Page[PartyBalanceView]{}, err
	}
	params := dbsqlc.CountLedPartyBalancesParams{
		GenerationID: generationID, AsOfDate: dateValue(asOf), ObjectID: input.Filters.ObjectID,
	}
	total, err := s.queries.CountLedPartyBalances(ctx, params)
	if err != nil {
		return Page[PartyBalanceView]{}, s.internal("count party balances", err)
	}
	rows, err := s.queries.ListLedPartyBalances(ctx, dbsqlc.ListLedPartyBalancesParams{
		GenerationID: generationID, AsOfDate: params.AsOfDate, ObjectID: params.ObjectID,
		PageOffset: int32((input.Page - 1) * input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[PartyBalanceView]{}, s.internal("list party balances", err)
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
			Counterparty:     ReferenceView{ObjectID: row.CounterpartyObjectID, VersionID: row.CounterpartyVersionID, Entity: row.CounterpartyEntity, Code: row.CounterpartyCode, Name: row.CounterpartyName},
			Currency:         row.Currency, BalanceType: balanceType, Amount: formatAbsoluteMoney(row.BalanceCents),
		})
	}
	return Page[PartyBalanceView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) activeGeneration(ctx context.Context) (string, error) {
	control, err := s.queries.GetLedControl(ctx)
	if err != nil {
		return "", s.internal("get ledger control", err)
	}
	if control.Status != StatusActive || control.ActiveGenerationID == nil {
		return "", domainError(ErrorConflict, "ledger is not available", map[string]any{"status": control.Status}, nil)
	}
	return *control.ActiveGenerationID, nil
}
