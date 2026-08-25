package approval

import (
	"strings"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
)

type Status string

const (
	StatusDraft    Status = "DRAFT"
	StatusPending  Status = "PENDING"
	StatusApproved Status = "APPROVED"
)

type Action string

const (
	ActionCreated     Action = "CREATED"
	ActionSaved       Action = "SAVED"
	ActionSubmitted   Action = "SUBMITTED"
	ActionUnsubmitted Action = "UNSUBMITTED"
	ActionRejected    Action = "REJECTED"
	ActionApproved    Action = "APPROVED"
	ActionUnapproved  Action = "UNAPPROVED"
	ActionDeleted     Action = "DELETED"
)

type EntryRef struct {
	ID        string
	Domain    string
	Entity    string
	SubjectID string
	VersionNo *int32
}

type Entry struct {
	EntryRef
	Status      Status
	Revision    int64
	CreatedBy   string
	CreatedAt   time.Time
	UpdatedBy   string
	UpdatedAt   time.Time
	SubmittedBy *string
	SubmittedAt *time.Time
	ApprovedBy  *string
	ApprovedAt  *time.Time
}

// Actor can only be constructed as an authenticated user or the fixed system
// identity. Callers cannot mark an arbitrary principal as trusted.
type Actor struct {
	principal authorization.Principal
	requestID string
	trusted   bool
}

func UserActor(principal authorization.Principal, requestID string) (Actor, error) {
	requestID = strings.TrimSpace(requestID)
	if len(strings.TrimSpace(principal.ActorID)) != 26 || requestID == "" || len(requestID) > 128 {
		return Actor{}, newError(ErrorValidation, "approval_invalid_actor", "invalid approval actor", nil)
	}
	return Actor{principal: principal, requestID: requestID}, nil
}

func TrustedSystemActor(requestID string) (Actor, error) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" || len(requestID) > 128 {
		return Actor{}, newError(ErrorValidation, "approval_invalid_actor", "invalid approval actor", nil)
	}
	return Actor{
		principal: authorization.Principal{
			ActorID:     systemidentity.UserID,
			Username:    systemidentity.Username,
			DisplayName: systemidentity.UserDisplayName,
		},
		requestID: requestID,
		trusted:   true,
	}, nil
}

func (a Actor) ID() string        { return a.principal.ActorID }
func (a Actor) RequestID() string { return a.requestID }
func (a Actor) Trusted() bool     { return a.trusted }

type Event[T any] struct {
	Entry        Entry
	Action       Action
	FromStatus   *Status
	ToStatus     *Status
	FromRevision *int64
	ToRevision   *int64
	ActorID      string
	RequestID    string
	Reason       *string
	Payload      T
	SubmittedBy  *string
	SubmittedAt  *time.Time
	ApprovedBy   *string
	ApprovedAt   *time.Time
}

type Prepared struct {
	domain string
	entity string
	entry  Entry
	action Action
	actor  Actor
	reason *string
}

func (p Prepared) Entry() Entry   { return p.entry }
func (p Prepared) Action() Action { return p.action }
