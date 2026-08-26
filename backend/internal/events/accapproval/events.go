package accapproval

import "github.com/hansonyu183/zerp/backend/internal/platform/approval"

// Payload identifies the immutable ACC aggregate snapshot affected by an
// Approval transition. ApprovalEntryID is populated for versioned mappings;
// approval-only openings use BookID as their stable subject.
type Payload struct {
	BookID          string
	MappingID       string
	VouEntity       string
	ApprovalEntryID string
}

func Topic(entity string) approval.Topic[Payload] {
	return approval.MustTopic[Payload]("acc." + entity + ".approval")
}
