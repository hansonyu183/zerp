package approval

import "time"

// VersionMeta is the shared wire-neutral projection of a versioned Approval
// entry. Domain response models embed it instead of defining their own
// lifecycle metadata.
type VersionMeta struct {
	ApprovalEntryID string     `json:"approvalEntryId"`
	VersionNo       int32      `json:"versionNo"`
	Status          Status     `json:"status"`
	Revision        int64      `json:"revision"`
	CreatedBy       string     `json:"createdBy"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedBy       string     `json:"updatedBy"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	SubmittedBy     *string    `json:"submittedBy"`
	SubmittedAt     *time.Time `json:"submittedAt"`
	ApprovedBy      *string    `json:"approvedBy"`
	ApprovedAt      *time.Time `json:"approvedAt"`
}

func VersionMetaFromEntry(entry Entry) VersionMeta {
	versionNo := int32(0)
	if entry.VersionNo != nil {
		versionNo = *entry.VersionNo
	}
	return VersionMeta{
		ApprovalEntryID: entry.ID,
		VersionNo:       versionNo,
		Status:          entry.Status,
		Revision:        entry.Revision,
		CreatedBy:       entry.CreatedBy,
		CreatedAt:       entry.CreatedAt,
		UpdatedBy:       entry.UpdatedBy,
		UpdatedAt:       entry.UpdatedAt,
		SubmittedBy:     entry.SubmittedBy,
		SubmittedAt:     entry.SubmittedAt,
		ApprovedBy:      entry.ApprovedBy,
		ApprovedAt:      entry.ApprovedAt,
	}
}

type EventView struct {
	ID              string    `json:"id"`
	ApprovalEntryID string    `json:"approvalEntryId"`
	Action          Action    `json:"action"`
	FromStatus      *Status   `json:"fromStatus"`
	ToStatus        *Status   `json:"toStatus"`
	FromRevision    *int64    `json:"fromRevision"`
	ToRevision      *int64    `json:"toRevision"`
	ActorID         string    `json:"actorId"`
	Reason          *string   `json:"reason"`
	RequestID       string    `json:"requestId"`
	CreatedAt       time.Time `json:"createdAt"`
}
