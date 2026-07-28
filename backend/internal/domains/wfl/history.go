package wfl

import (
	"context"
	"encoding/json"
)

func (s *Service) SalesHistory(
	ctx context.Context, input HistoryInput,
) (Page[AuditView], error) {
	return s.history(ctx, ProcessTypeSales, input)
}

func (s *Service) PurchaseHistory(
	ctx context.Context, input HistoryInput,
) (Page[AuditView], error) {
	return s.history(ctx, ProcessTypePurchase, input)
}

func (s *Service) history(
	ctx context.Context, processType string, input HistoryInput,
) (Page[AuditView], error) {
	if !validID(input.ProcessID) || input.Page < 1 || input.PageSize < 1 || input.PageSize > 100 {
		return Page[AuditView]{}, validation("invalid workflow audit query", nil)
	}
	rows, err := s.pool.Query(ctx, `SELECT a.id,a.event_type,a.from_status,a.to_status,
		a.stage,a.document_id,a.document_no,a.document_status,a.actor_id,a.occurred_at,
		a.reason,a.request_id,a.summary
		FROM wfl_audit_events a
		JOIN wfl_process_instances p ON p.id=a.process_id
		WHERE a.process_id=$1 AND p.process_type=$2
		ORDER BY a.occurred_at DESC,a.id DESC
		LIMIT $3 OFFSET $4`,
		input.ProcessID, processType, input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return Page[AuditView]{}, internal("query workflow audit", err)
	}
	defer rows.Close()
	items := make([]AuditView, 0)
	for rows.Next() {
		var item AuditView
		var summary []byte
		if err = rows.Scan(
			&item.ID, &item.EventType, &item.FromStatus, &item.ToStatus,
			&item.Stage, &item.DocumentID, &item.DocumentNo, &item.DocumentStatus,
			&item.ActorID, &item.OccurredAt, &item.Reason, &item.RequestID, &summary,
		); err != nil {
			return Page[AuditView]{}, internal("scan workflow audit", err)
		}
		item.Summary = json.RawMessage(summary)
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return Page[AuditView]{}, internal("iterate workflow audit", err)
	}
	var total int64
	if err = s.pool.QueryRow(ctx, `SELECT count(*)
		FROM wfl_audit_events a
		JOIN wfl_process_instances p ON p.id=a.process_id
		WHERE a.process_id=$1 AND p.process_type=$2`,
		input.ProcessID, processType).Scan(&total); err != nil {
		return Page[AuditView]{}, internal("count workflow audit", err)
	}
	return Page[AuditView]{
		Items: items, Total: total, Page: input.Page, PageSize: input.PageSize,
	}, nil
}
