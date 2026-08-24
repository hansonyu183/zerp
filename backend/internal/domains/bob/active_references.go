package bob

import (
	"context"
	"sort"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
)

type directReferenceUse struct {
	objectID string
	entity   string
	role     string
}

type ActiveReferenceCount struct {
	Entity string `json:"entity"`
	Field  string `json:"field"`
	Count  int    `json:"count"`
}

func listDirectReferenceUses(ctx context.Context, q *dbsqlc.Queries, entity, objectID string) ([]directReferenceUse, error) {
	uses := []directReferenceUse{}
	switch entity {
	case EntityEmployee:
		rows, err := q.ListCustomerSalesReferencesForEmployee(ctx, &objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
		purchaserRows, err := q.ListSupplierPurchaserReferencesForEmployee(ctx, &objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range purchaserRows {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
		managerRows, err := q.ListWarehouseManagerReferencesForEmployee(ctx, &objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range managerRows {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
	case EntityOtherUnit:
		rows, err := q.ListVehicleCarrierServiceReferences(ctx, &objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
	case EntitySalesPartner:
		rows, err := q.ListCustomerSalesReferencesForSalesPartner(ctx, &objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
	case EntityOperatingEntity:
		rows, err := q.ListCustomerOperatingReferences(ctx, &objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
		fundRows, err := q.ListFundOperatingReferences(ctx, &objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range fundRows {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
		vehicleRows, err := q.ListVehicleCarrierOperatingReferences(ctx, &objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range vehicleRows {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
	case EntityProduct:
		rows, err := q.ListFormulaMaterialReferences(ctx, objectID)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			uses = append(uses, directReferenceUse{row.ObjectID, row.Entity, row.Role})
		}
	}
	sort.Slice(uses, func(left, right int) bool {
		if uses[left].objectID != uses[right].objectID {
			return uses[left].objectID < uses[right].objectID
		}
		return uses[left].role < uses[right].role
	})
	return uses, nil
}
