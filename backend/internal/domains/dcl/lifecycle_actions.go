package dcl

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

func dclActiveEntry(ctx context.Context, q *dbsqlc.Queries, entity, openEntryID, approvedEntryID string) (approval.Entry, bool, error) {
	entryID := openEntryID
	if entryID == "" {
		entryID = approvedEntryID
	}
	if entryID == "" {
		return approval.Entry{}, false, nil
	}
	row, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: entity})
	if err != nil {
		return approval.Entry{}, false, translateError(err)
	}
	return approvalEntry(row), true, nil
}
