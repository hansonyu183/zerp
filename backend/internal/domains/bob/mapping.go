package bob

import (
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5/pgtype"
)

func approvalMeta(entry dbsqlc.ApprovalEntry) approval.VersionMeta {
	versionNo := int32(0)
	if entry.VersionNo != nil {
		versionNo = *entry.VersionNo
	}
	return approval.VersionMeta{ApprovalEntryID: entry.ID, VersionNo: versionNo, Status: approval.Status(entry.Status), Revision: entry.Revision,
		CreatedBy: entry.CreatedBy, CreatedAt: entry.CreatedAt.Time, UpdatedBy: entry.UpdatedBy, UpdatedAt: entry.UpdatedAt.Time,
		SubmittedBy: entry.SubmittedBy, SubmittedAt: timePointer(entry.SubmittedAt), ApprovedBy: entry.ApprovedBy, ApprovedAt: timePointer(entry.ApprovedAt)}
}

func approvalEventView(row dbsqlc.ApprovalEvent) AuditEventView {
	var from, to *approval.Status
	if row.FromStatus != nil {
		value := approval.Status(*row.FromStatus)
		from = &value
	}
	if row.ToStatus != nil {
		value := approval.Status(*row.ToStatus)
		to = &value
	}
	return AuditEventView{ID: row.ID, ApprovalEntryID: row.EntryID, Action: approval.Action(row.Action), FromStatus: from, ToStatus: to, ActorID: row.ActorID, Reason: row.Reason, RequestID: row.RequestID, CreatedAt: row.CreatedAt.Time}
}

func timePointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	result := value.Time
	return &result
}
func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
