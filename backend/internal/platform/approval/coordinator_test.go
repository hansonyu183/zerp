package approval

import (
	"context"
	"errors"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
)

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
