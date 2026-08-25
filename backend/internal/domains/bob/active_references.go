package bob

import (
	"context"
	"sort"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
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

// listVoucherApprovalEntryReferenceCounts inspects the concrete VOU snapshot
// columns in the live schema. VOU keeps references in its typed detail tables,
// and every such column has the *_approval_entry_id suffix. This deliberately
// counts rows in every document status while excluding audit/history text.
func listVoucherApprovalEntryReferenceCounts(ctx context.Context, tx pgx.Tx, entryID string) ([]ActiveReferenceCount, error) {
	rows, err := tx.Query(ctx, `
		SELECT table_schema, table_name, column_name
		FROM information_schema.columns
		WHERE table_schema = current_schema()
		  AND table_name LIKE 'vou\_%' ESCAPE '\'
		  AND column_name LIKE '%\_approval\_entry\_id' ESCAPE '\'
		ORDER BY table_name, column_name`)
	if err != nil {
		return nil, err
	}
	type referenceColumn struct{ schema, table, column string }
	columns := []referenceColumn{}
	for rows.Next() {
		var column referenceColumn
		if err = rows.Scan(&column.schema, &column.table, &column.column); err != nil {
			rows.Close()
			return nil, err
		}
		columns = append(columns, column)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	counts := []ActiveReferenceCount{}
	for _, column := range columns {
		statement := "SELECT count(*) FROM " + pgx.Identifier{column.schema, column.table}.Sanitize() +
			" WHERE " + pgx.Identifier{column.column}.Sanitize() + " = $1"
		var count int
		if err = tx.QueryRow(ctx, statement, entryID).Scan(&count); err != nil {
			return nil, err
		}
		if count != 0 {
			counts = append(counts, ActiveReferenceCount{Entity: column.table, Field: column.column, Count: count})
		}
	}
	return counts, nil
}
