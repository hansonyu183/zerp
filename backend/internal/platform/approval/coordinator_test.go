package approval

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
)

func TestAvailableLifecycleActions(t *testing.T) {
	all := LifecyclePermissions{
		Submit: true, Unsubmit: true, Reject: true, Approve: true, Unapprove: true,
	}
	tests := []struct {
		name        string
		entry       Entry
		actorID     string
		permissions LifecyclePermissions
		want        []LifecycleAction
	}{
		{name: "draft without submit permission", entry: Entry{Status: StatusDraft}, actorID: "actor-1", permissions: LifecyclePermissions{}, want: []LifecycleAction{}},
		{name: "draft with only submit permission", entry: Entry{Status: StatusDraft}, actorID: "actor-1", permissions: LifecyclePermissions{Submit: true}, want: []LifecycleAction{LifecycleSubmit}},
		{name: "pending submitter cannot review", entry: Entry{Status: StatusPending, SubmittedBy: stringPointer("actor-1")}, actorID: "actor-1", permissions: all, want: []LifecycleAction{LifecycleUnsubmit}},
		{name: "pending reviewer gets deterministic order", entry: Entry{Status: StatusPending, SubmittedBy: stringPointer("actor-1")}, actorID: "actor-2", permissions: all, want: []LifecycleAction{LifecycleUnsubmit, LifecycleReject, LifecycleApprove}},
		{name: "pending reviewer gets each exact permission", entry: Entry{Status: StatusPending, SubmittedBy: stringPointer("actor-1")}, actorID: "actor-2", permissions: LifecyclePermissions{Reject: true}, want: []LifecycleAction{LifecycleReject}},
		{name: "approved with only unapprove permission", entry: Entry{Status: StatusApproved}, actorID: "actor-2", permissions: LifecyclePermissions{Unapprove: true}, want: []LifecycleAction{LifecycleUnapprove}},
		{name: "unknown status has no actions", entry: Entry{Status: Status("UNKNOWN")}, actorID: "actor-2", permissions: all, want: []LifecycleAction{}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := AvailableLifecycleActions(test.entry, test.actorID, test.permissions)
			if !slices.Equal(got, test.want) {
				t.Fatalf("AvailableLifecycleActions() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestCoordinatorLifecycleActionsUseFixedEntityPermissions(t *testing.T) {
	coordinator, err := NewCoordinator(
		"dcl",
		"warehouse",
		allowAuthorizer{},
		txevent.NewBus(),
		MustTopic[string]("approval.test.dcl-warehouse-actions"),
	)
	if err != nil {
		t.Fatalf("new coordinator: %v", err)
	}
	submitterID := "01J00000000000000000000001"
	reviewerID := "01J00000000000000000000002"
	actor, err := UserActor(authorization.Principal{
		ActorID: reviewerID,
		Permissions: []string{
			"/dcl/warehouse/unsubmit",
			"/dcl/warehouse/reject",
			"/dcl/warehouse/approve",
			"/dcl/vehicle/unapprove",
		},
	}, "request-dcl-warehouse-actions")
	if err != nil {
		t.Fatalf("new actor: %v", err)
	}

	got := coordinator.LifecycleActions(Entry{
		Status: StatusPending, SubmittedBy: &submitterID,
	}, actor)
	want := []LifecycleAction{LifecycleUnsubmit, LifecycleReject, LifecycleApprove}
	if !slices.Equal(got, want) {
		t.Fatalf("LifecycleActions() = %v, want %v", got, want)
	}
	if got = coordinator.LifecycleActions(Entry{Status: StatusApproved}, actor); len(got) != 0 {
		t.Fatalf("LifecycleActions() accepted another entity permission: %v", got)
	}
	if got == nil {
		t.Fatal("LifecycleActions() returned nil instead of an empty JSON array")
	}
}

func TestCoordinatorRejectsDomainSpecificPermissionActions(t *testing.T) {
	coordinator, err := NewCoordinator(
		"dcl",
		"customer",
		allowAuthorizer{},
		txevent.NewBus(),
		MustTopic[string]("approval.test.domain-specific-permission"),
	)
	if err != nil {
		t.Fatalf("new coordinator: %v", err)
	}
	actor, err := UserActor(authorization.Principal{
		ActorID: "01J00000000000000000000001",
	}, "request-domain-specific-permission")
	if err != nil {
		t.Fatalf("new actor: %v", err)
	}

	if err = coordinator.Authorize(t.Context(), actor, "save-subunits"); !IsKey(err, "approval_invalid_action") {
		t.Fatalf("Authorize() domain-specific action error = %v", err)
	}
}

type allowAuthorizer struct{}

func (allowAuthorizer) RequirePermission(context.Context, authorization.Principal, string, string) error {
	return nil
}

func TestTransitionMatrix(t *testing.T) {
	allowed := map[Status]map[Action]bool{
		StatusDraft: {
			ActionSaved: true, ActionSubmitted: true,
		},
		StatusPending: {
			ActionUnsubmitted: true, ActionRejected: true, ActionApproved: true,
		},
		StatusApproved: {
			ActionUnapproved: true,
		},
	}
	actions := []Action{ActionSaved, ActionSubmitted, ActionUnsubmitted, ActionRejected, ActionApproved, ActionUnapproved}
	for _, status := range []Status{StatusDraft, StatusPending, StatusApproved} {
		for _, action := range actions {
			if got, want := transitionAllowed(status, action), allowed[status][action]; got != want {
				t.Errorf("transitionAllowed(%s, %s) = %t, want %t", status, action, got, want)
			}
		}
	}
}

func TestActorConstructionAndCoordinatorConfiguration(t *testing.T) {
	if _, err := UserActor(authorization.Principal{}, "request"); !IsKey(err, "approval_invalid_actor") {
		t.Fatalf("empty user actor error = %v", err)
	}
	system, err := TrustedSystemActor("request")
	if err != nil || !system.Trusted() || system.ID() != systemidentity.UserID {
		t.Fatalf("trusted system actor = %+v, err = %v", system, err)
	}
	topic := MustTopic[string]("approval.test.lifecycle")
	if _, err = NewCoordinator("Invalid", "subject", allowAuthorizer{}, txevent.NewBus(), topic); !IsKey(err, "approval_invalid_configuration") {
		t.Fatalf("invalid coordinator error = %v", err)
	}
	if _, err = NewCoordinator("test", "subject", allowAuthorizer{}, txevent.NewBus(), topic); err != nil {
		t.Fatalf("new coordinator: %v", err)
	}
}

func TestApprovalErrorClassification(t *testing.T) {
	cause := errors.New("cause")
	err := newError(ErrorConflict, "approval_stale_revision", "changed", cause)
	if !IsKind(err, ErrorConflict) || !IsKey(err, "approval_stale_revision") || !errors.Is(err, cause) {
		t.Fatalf("error classification failed: %v", err)
	}
}
