package led

import (
	"context"
	"fmt"
	"strings"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) QueryContainer(
	ctx context.Context, input QueryInput,
) (Page[ContainerEntryView], error) {
	query, err := validateQuery(EntityContainer, input)
	if err != nil {
		return Page[ContainerEntryView]{}, err
	}
	generationID, err := s.activeGeneration(ctx)
	if err != nil {
		return Page[ContainerEntryView]{}, err
	}
	where := `generation_id=$1 AND effective_date BETWEEN $2 AND $3
		AND ($4='' OR customer_object_id=$4)
		AND ($5='' OR source_entity=$5)
		AND ($6='' OR source_document_no ILIKE '%'||$6||'%')`
	var total int64
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM led_container_entries WHERE `+where,
		generationID, query.DateFrom, query.DateTo, query.ObjectID, query.SourceEntity,
		query.DocumentNo).Scan(&total); err != nil {
		return Page[ContainerEntryView]{}, s.internal("count container entries", err)
	}
	orderBy := map[string]string{"effectiveDate": "effective_date", "occurredAt": "occurred_at",
		"documentNo": "source_document_no"}[query.SortField]
	rows, err := s.pool.Query(ctx, fmt.Sprintf(`SELECT id,entry_type,source_entity,
		source_document_id,source_document_no,root_document_id,root_document_no,source_revision,
		effective_date,occurred_at,customer_object_id,customer_version_id,customer_code,
		customer_name,container_type,quantity_delta,COALESCE(remark,'')
		FROM led_container_entries WHERE %s ORDER BY %s %s,occurred_at %s,id %s
		LIMIT $7 OFFSET $8`, where, orderBy, strings.ToUpper(query.Order),
		strings.ToUpper(query.Order), strings.ToUpper(query.Order)),
		generationID, query.DateFrom, query.DateTo, query.ObjectID, query.SourceEntity,
		query.DocumentNo, query.PageSize, (query.Page-1)*query.PageSize)
	if err != nil {
		return Page[ContainerEntryView]{}, s.internal("list container entries", err)
	}
	defer rows.Close()
	items := make([]ContainerEntryView, 0)
	for rows.Next() {
		var item ContainerEntryView
		var date pgtype.Date
		var occurred pgtype.Timestamptz
		if err = rows.Scan(&item.ID, &item.EntryType, &item.SourceEntity,
			&item.SourceDocumentID, &item.SourceDocumentNo, &item.RootDocumentID,
			&item.RootDocumentNo, &item.SourceRevision, &date, &occurred,
			&item.Customer.ObjectID, &item.Customer.VersionID, &item.Customer.Code,
			&item.Customer.Name, &item.ContainerType, &item.Quantity, &item.Remark); err != nil {
			return Page[ContainerEntryView]{}, err
		}
		item.Customer.Entity = bobdomain.EntityCustomer
		item.EffectiveDate = formatDate(date)
		item.OccurredAt = occurred.Time
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return Page[ContainerEntryView]{}, err
	}
	return Page[ContainerEntryView]{Items: items, Total: total, Page: query.Page, PageSize: query.PageSize}, nil
}

func (s *Service) ContainerBalance(
	ctx context.Context, input BalanceInput,
) (Page[ContainerBalanceView], error) {
	asOf, err := validateBalance(input)
	if err != nil {
		return Page[ContainerBalanceView]{}, err
	}
	generationID, err := s.activeGeneration(ctx)
	if err != nil {
		return Page[ContainerBalanceView]{}, err
	}
	where := `generation_id=$1 AND effective_date<=$2 AND ($3='' OR customer_object_id=$3)`
	var total int64
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM (
		SELECT customer_object_id,container_type FROM led_container_entries WHERE `+where+`
		GROUP BY customer_object_id,container_type) x`, generationID, asOf,
		input.Filters.ObjectID).Scan(&total); err != nil {
		return Page[ContainerBalanceView]{}, err
	}
	rows, err := s.pool.Query(ctx, `SELECT customer_object_id,
		(array_agg(customer_version_id ORDER BY effective_date DESC,occurred_at DESC,id DESC))[1],
		(array_agg(customer_code ORDER BY effective_date DESC,occurred_at DESC,id DESC))[1],
		(array_agg(customer_name ORDER BY effective_date DESC,occurred_at DESC,id DESC))[1],
		container_type,sum(quantity_delta)
		FROM led_container_entries WHERE `+where+`
		GROUP BY customer_object_id,container_type ORDER BY customer_object_id,container_type
		LIMIT $4 OFFSET $5`, generationID, asOf, input.Filters.ObjectID, input.PageSize,
		(input.Page-1)*input.PageSize)
	if err != nil {
		return Page[ContainerBalanceView]{}, err
	}
	defer rows.Close()
	items := make([]ContainerBalanceView, 0)
	for rows.Next() {
		var item ContainerBalanceView
		if err = rows.Scan(&item.Customer.ObjectID, &item.Customer.VersionID, &item.Customer.Code,
			&item.Customer.Name, &item.ContainerType, &item.Quantity); err != nil {
			return Page[ContainerBalanceView]{}, err
		}
		item.Customer.Entity = bobdomain.EntityCustomer
		items = append(items, item)
	}
	return Page[ContainerBalanceView]{Items: items, Total: total,
		Page: input.Page, PageSize: input.PageSize}, rows.Err()
}
