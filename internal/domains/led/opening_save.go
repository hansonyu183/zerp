package led

import (
	"context"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

type openingDraftSnapshot struct {
	Inventory []dbsqlc.LedDraftInventory
	Fund      []dbsqlc.LedDraftFund
	Party     []dbsqlc.LedDraftParty
	Container []dbsqlc.LedDraftContainer
}

func (s *Service) loadOpeningDraft(ctx context.Context, q *dbsqlc.Queries) (openingDraftSnapshot, error) {
	inventory, err := q.ListLedDraftInventory(ctx)
	if err != nil {
		return openingDraftSnapshot{}, s.internal("list existing inventory opening", err)
	}
	fund, err := q.ListLedDraftFund(ctx)
	if err != nil {
		return openingDraftSnapshot{}, s.internal("list existing fund opening", err)
	}
	party, err := q.ListLedDraftParty(ctx)
	if err != nil {
		return openingDraftSnapshot{}, s.internal("list existing party opening", err)
	}
	containers, err := q.ListLedDraftContainer(ctx)
	if err != nil {
		return openingDraftSnapshot{}, s.internal("list existing container opening", err)
	}
	return openingDraftSnapshot{
		Inventory: inventory,
		Fund:      fund,
		Party:     party,
		Container: containers,
	}, nil
}

func (s *Service) clearOpeningDraft(ctx context.Context, q *dbsqlc.Queries) error {
	if err := q.DeleteLedDraftInventory(ctx); err != nil {
		return s.writeError("clear inventory opening", err)
	}
	if err := q.DeleteLedDraftFund(ctx); err != nil {
		return s.writeError("clear fund opening", err)
	}
	if err := q.DeleteLedDraftParty(ctx); err != nil {
		return s.writeError("clear party opening", err)
	}
	if err := q.DeleteLedDraftContainer(ctx); err != nil {
		return s.writeError("clear container opening", err)
	}
	return nil
}

func (s *Service) replaceInventoryOpening(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	oldInventory []dbsqlc.LedDraftInventory,
	inventory []InventoryOpeningInput,
) error {
	oldByKey := make(map[string]dbsqlc.LedDraftInventory, len(oldInventory))
	for _, row := range oldInventory {
		oldByKey[row.WarehouseObjectID+"/"+row.WarehouseVersionID+"/"+row.ProductObjectID+"/"+row.ProductVersionID] = row
	}
	for _, item := range inventory {
		quantity, _ := parsePositiveFixed(item.Quantity, 6, true)
		key := item.Warehouse.ObjectID + "/" + item.Warehouse.VersionID + "/" + item.Product.ObjectID + "/" + item.Product.VersionID
		params := dbsqlc.InsertLedDraftInventoryParams{ID: newID(), QuantityMicros: quantity}
		if old, ok := oldByKey[key]; ok {
			params.ID = old.ID
			params.WarehouseObjectID, params.WarehouseVersionID = old.WarehouseObjectID, old.WarehouseVersionID
			params.WarehouseCode, params.WarehouseName = old.WarehouseCode, old.WarehouseName
			params.ProductObjectID, params.ProductVersionID = old.ProductObjectID, old.ProductVersionID
			params.ProductCode, params.ProductName, params.ProductUnit = old.ProductCode, old.ProductName, old.ProductUnit
		} else {
			warehouse, err := s.resolve(ctx, tx, bobdomain.EntityWarehouse, item.Warehouse)
			if err != nil {
				return err
			}
			product, err := s.resolve(ctx, tx, bobdomain.EntityProduct, item.Product)
			if err != nil {
				return err
			}
			params.WarehouseObjectID, params.WarehouseVersionID = warehouse.ObjectID, warehouse.VersionID
			params.WarehouseCode, params.WarehouseName = warehouse.Code, warehouse.Data.Name
			params.ProductObjectID, params.ProductVersionID = product.ObjectID, product.VersionID
			params.ProductCode, params.ProductName, params.ProductUnit = product.Code, product.Data.Name, product.Data.Unit
		}
		if err := q.InsertLedDraftInventory(ctx, params); err != nil {
			return s.writeError("insert inventory opening", err)
		}
	}
	return nil
}

func (s *Service) replaceFundOpening(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	oldFund []dbsqlc.LedDraftFund,
	fund []FundOpeningInput,
) error {
	oldByKey := make(map[string]dbsqlc.LedDraftFund, len(oldFund))
	for _, row := range oldFund {
		oldByKey[row.FundAccountObjectID+"/"+row.FundAccountVersionID] = row
	}
	for _, item := range fund {
		amount, _ := parsePositiveFixed(item.Amount, 2, true)
		if item.BalanceType == "OVERDRAFT" {
			amount = -amount
		}
		key := item.FundAccount.ObjectID + "/" + item.FundAccount.VersionID
		params := dbsqlc.InsertLedDraftFundParams{ID: newID(), AmountCents: amount}
		if old, ok := oldByKey[key]; ok {
			params.ID = old.ID
			params.FundAccountObjectID, params.FundAccountVersionID = old.FundAccountObjectID, old.FundAccountVersionID
			params.FundAccountCode, params.FundAccountName, params.Currency = old.FundAccountCode, old.FundAccountName, old.Currency
		} else {
			account, err := s.resolve(ctx, tx, bobdomain.EntityFundAccount, item.FundAccount)
			if err != nil {
				return err
			}
			params.FundAccountObjectID, params.FundAccountVersionID = account.ObjectID, account.VersionID
			params.FundAccountCode, params.FundAccountName, params.Currency = account.Code, account.Data.Name, account.Data.Currency
		}
		if err := q.InsertLedDraftFund(ctx, params); err != nil {
			return s.writeError("insert fund opening", err)
		}
	}
	return nil
}

func (s *Service) replacePartyOpening(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	oldParty []dbsqlc.LedDraftParty,
	parties []PartyOpeningInput,
) error {
	oldByKey := make(map[string]dbsqlc.LedDraftParty, len(oldParty))
	for _, row := range oldParty {
		oldByKey[row.CounterpartyEntity+"/"+row.CounterpartyObjectID+"/"+row.CounterpartyVersionID+"/"+row.Currency] = row
	}
	for _, item := range parties {
		currency := strings.ToUpper(strings.TrimSpace(item.Currency))
		amount, _ := parsePositiveFixed(item.Amount, 2, true)
		if item.BalanceType == "PAYABLE" {
			amount = -amount
		}
		key := item.CounterpartyType + "/" + item.Counterparty.ObjectID + "/" + item.Counterparty.VersionID + "/" + currency
		params := dbsqlc.InsertLedDraftPartyParams{
			ID: newID(), CounterpartyEntity: item.CounterpartyType, Currency: currency, AmountCents: amount,
		}
		if old, ok := oldByKey[key]; ok {
			params.ID = old.ID
			params.CounterpartyObjectID, params.CounterpartyVersionID = old.CounterpartyObjectID, old.CounterpartyVersionID
			params.CounterpartyCode, params.CounterpartyName = old.CounterpartyCode, old.CounterpartyName
		} else {
			party, err := s.resolve(ctx, tx, item.CounterpartyType, item.Counterparty)
			if err != nil {
				return err
			}
			params.CounterpartyObjectID, params.CounterpartyVersionID = party.ObjectID, party.VersionID
			params.CounterpartyCode, params.CounterpartyName = party.Code, party.Data.Name
		}
		if err := q.InsertLedDraftParty(ctx, params); err != nil {
			return s.writeError("insert party opening", err)
		}
	}
	return nil
}

func (s *Service) replaceContainerOpening(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	oldContainers []dbsqlc.LedDraftContainer,
	containers []ContainerOpeningInput,
) error {
	oldByKey := make(map[string]dbsqlc.LedDraftContainer, len(oldContainers))
	for _, row := range oldContainers {
		oldByKey[row.CustomerObjectID+"/"+row.CustomerVersionID+"/"+row.ContainerType] = row
	}
	for _, item := range containers {
		key := item.Customer.ObjectID + "/" + item.Customer.VersionID + "/" + item.ContainerType
		params := dbsqlc.InsertLedDraftContainerParams{
			ID: newID(), ContainerType: item.ContainerType, Quantity: item.Quantity,
		}
		if old, ok := oldByKey[key]; ok {
			params.ID = old.ID
			params.CustomerObjectID, params.CustomerVersionID = old.CustomerObjectID, old.CustomerVersionID
			params.CustomerCode, params.CustomerName = old.CustomerCode, old.CustomerName
		} else {
			customer, err := s.resolve(ctx, tx, bobdomain.EntityCustomer, item.Customer)
			if err != nil {
				return err
			}
			params.CustomerObjectID, params.CustomerVersionID = customer.ObjectID, customer.VersionID
			params.CustomerCode, params.CustomerName = customer.Code, customer.Data.Name
		}
		if err := q.InsertLedDraftContainer(ctx, params); err != nil {
			return s.writeError("insert container opening", err)
		}
	}
	return nil
}
