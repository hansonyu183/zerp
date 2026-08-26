//go:build integration

package acc

import (
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/oklog/ulid/v2"
)

func approvedVOUEvent(snapshot voudomain.DocumentView) approval.Event[voudomain.ApprovalPayload] {
	approved := approval.StatusApproved
	pending := approval.StatusPending
	toRevision := snapshot.Approval.Revision
	fromRevision := toRevision - 1
	return approval.Event[voudomain.ApprovalPayload]{
		Entry: approval.Entry{EntryRef: approval.EntryRef{
			ID: ulid.Make().String(), Domain: "vou", Entity: snapshot.Entity, SubjectID: snapshot.DocumentID,
		}, Status: approved, Revision: toRevision},
		Action: approval.ActionApproved, FromStatus: &pending, ToStatus: &approved,
		FromRevision: &fromRevision, ToRevision: &toRevision, Payload: voudomain.ApprovalPayloadFromView(snapshot),
	}
}

func unapprovedVOUEvent(snapshot voudomain.DocumentView) approval.Event[voudomain.ApprovalPayload] {
	approved := approval.StatusApproved
	pending := approval.StatusPending
	fromRevision := snapshot.Approval.Revision
	toRevision := fromRevision + 1
	return approval.Event[voudomain.ApprovalPayload]{
		Entry: approval.Entry{EntryRef: approval.EntryRef{
			ID: ulid.Make().String(), Domain: "vou", Entity: snapshot.Entity, SubjectID: snapshot.DocumentID,
		}, Status: pending, Revision: toRevision},
		Action: approval.ActionUnapproved, FromStatus: &approved, ToStatus: &pending,
		FromRevision: &fromRevision, ToRevision: &toRevision, Payload: voudomain.ApprovalPayloadFromView(snapshot),
	}
}
