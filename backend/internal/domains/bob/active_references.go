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

type ActiveReferenceBlockers struct {
	References []ActiveReferenceCount `json:"references"`
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

func listActiveReferenceCounts(ctx context.Context, q *dbsqlc.Queries, entity, objectID string) ([]ActiveReferenceCount, error) {
	uses, err := listDirectReferenceUses(ctx, q, entity, objectID)
	if err != nil {
		return nil, err
	}
	grouped := make(map[string]*ActiveReferenceCount)
	for _, use := range uses {
		key := use.entity + "\x00" + use.role
		if grouped[key] == nil {
			grouped[key] = &ActiveReferenceCount{Entity: use.entity, Field: use.role}
		}
		grouped[key].Count++
	}
	counts := make([]ActiveReferenceCount, 0, len(grouped))
	for _, count := range grouped {
		counts = append(counts, *count)
	}
	sort.Slice(counts, func(left, right int) bool {
		if counts[left].Entity != counts[right].Entity {
			return counts[left].Entity < counts[right].Entity
		}
		return counts[left].Field < counts[right].Field
	})
	return counts, nil
}

func listVoucherApprovalEntryReferenceCounts(ctx context.Context, q *dbsqlc.Queries, entryID string) ([]ActiveReferenceCount, error) {
	rows, err := q.ListVouApprovalEntryReferenceCounts(ctx, entryID)
	if err != nil {
		return nil, err
	}
	counts := make([]ActiveReferenceCount, 0, len(rows))
	for _, row := range rows {
		counts = append(counts, ActiveReferenceCount{Entity: row.Entity, Field: row.Field, Count: int(row.ReferenceCount)})
	}
	return counts, nil
}
