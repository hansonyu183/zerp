package approval

import "strings"

type LifecycleAction string

const (
	LifecycleSubmit    LifecycleAction = "submit"
	LifecycleUnsubmit  LifecycleAction = "unsubmit"
	LifecycleReject    LifecycleAction = "reject"
	LifecycleApprove   LifecycleAction = "approve"
	LifecycleUnapprove LifecycleAction = "unapprove"
)

// LifecyclePermissions is the closed Approval permission set used to produce
// actor-contextual action availability. Callers cannot supply arbitrary paths
// or a per-domain action profile.
type LifecyclePermissions struct {
	Submit    bool
	Unsubmit  bool
	Reject    bool
	Approve   bool
	Unapprove bool
}

// AvailableLifecycleActions returns a deterministic query-time snapshot. It
// does not replace the Coordinator's execution-time authorization or domain
// invariant checks.
func AvailableLifecycleActions(entry Entry, actorID string, permissions LifecyclePermissions) []LifecycleAction {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return nil
	}
	switch entry.Status {
	case StatusDraft:
		if permissions.Submit {
			return []LifecycleAction{LifecycleSubmit}
		}
	case StatusPending:
		actions := make([]LifecycleAction, 0, 3)
		if permissions.Unsubmit {
			actions = append(actions, LifecycleUnsubmit)
		}
		isSubmitter := entry.SubmittedBy != nil && *entry.SubmittedBy == actorID
		if !isSubmitter && permissions.Reject {
			actions = append(actions, LifecycleReject)
		}
		if !isSubmitter && permissions.Approve {
			actions = append(actions, LifecycleApprove)
		}
		return actions
	case StatusApproved:
		if permissions.Unapprove {
			return []LifecycleAction{LifecycleUnapprove}
		}
	}
	return nil
}
