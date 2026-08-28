package acc

import (
	"context"

	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type approvalRowScanner interface{ Scan(...any) error }

func scanACCApprovalEntry(row approvalRowScanner) (approval.Entry, error) {
	var entry approval.Entry
	var status string
	var createdAt, updatedAt, submittedAt, approvedAt pgtype.Timestamptz
	if err := row.Scan(&entry.ID, &entry.Domain, &entry.Entity, &entry.SubjectID, &entry.VersionNo,
		&status, &entry.Revision, &entry.CreatedBy, &createdAt, &entry.UpdatedBy, &updatedAt,
		&entry.SubmittedBy, &submittedAt, &entry.ApprovedBy, &approvedAt); err != nil {
		return approval.Entry{}, err
	}
	entry.Status = approval.Status(status)
	entry.CreatedAt, entry.UpdatedAt = createdAt.Time, updatedAt.Time
	if submittedAt.Valid {
		entry.SubmittedAt = &submittedAt.Time
	}
	if approvedAt.Valid {
		entry.ApprovedAt = &approvedAt.Time
	}
	return entry, nil
}

func readACCApprovalEntry(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, entity, subjectID, entryID string) (approval.Entry, error) {
	filter := ""
	args := []any{entity, subjectID}
	if entryID != "" {
		filter = " AND id=$3"
		args = append(args, entryID)
	}
	return scanACCApprovalEntry(q.QueryRow(ctx, `SELECT id,domain,entity,subject_id,version_no,status,revision,
		created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at
		FROM approval_entries WHERE domain='acc' AND entity=$1 AND subject_id=$2`+filter+`
		ORDER BY (status IN ('DRAFT','PENDING')) DESC,version_no DESC NULLS LAST LIMIT 1`, args...))
}

// readDCLApprovalEntry reads a DCL-owned approval entry by ID.
// Used after cutover when ACC mapping approval entries moved to DCL domain.
func readDCLApprovalEntry(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, entryID string) (approval.Entry, error) {
	return scanACCApprovalEntry(q.QueryRow(ctx, `SELECT id,domain,entity,subject_id,version_no,status,revision,
		created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at
		FROM approval_entries WHERE id=$1 AND domain='dcl' AND entity='acc-mapping'`, entryID))
}
