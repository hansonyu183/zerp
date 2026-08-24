package authorization

import (
	"context"
	"errors"
	"net/http"
	"time"
)

type Principal struct {
	SessionID              string
	ActorID                string
	Username               string
	DisplayName            string
	AvatarURL              *string
	CSRFHash               []byte
	Permissions            []string
	PasswordChangeRequired bool
	IdleExpires            time.Time
	AbsoluteEnds           time.Time
}

type ErrorKind int

const (
	ErrorUnauthenticated ErrorKind = iota + 1
	ErrorForbidden
	ErrorInternal
)

type Error struct {
	Kind    ErrorKind
	Message string
	Cause   error
}

func (e *Error) Error() string { return e.Message }
func (e *Error) Unwrap() error { return e.Cause }

func NewError(kind ErrorKind, message string, cause error) error {
	return &Error{Kind: kind, Message: message, Cause: cause}
}

func IsKind(err error, kind ErrorKind) bool {
	var target *Error
	return errors.As(err, &target) && target.Kind == kind
}

type Authorizer interface {
	AuthenticateSession(context.Context, *http.Request, string, string) (Principal, error)
	RequirePermission(context.Context, Principal, string, string) error
	ClearSessionCookie(http.ResponseWriter)
}

type FailClosed struct{}

func (FailClosed) AuthenticateSession(context.Context, *http.Request, string, string) (Principal, error) {
	return Principal{}, NewError(ErrorUnauthenticated, "session expired", nil)
}

func (FailClosed) RequirePermission(context.Context, Principal, string, string) error {
	return NewError(ErrorUnauthenticated, "session expired", nil)
}

func (FailClosed) ClearSessionCookie(http.ResponseWriter) {}

type Func func(context.Context, *http.Request, string, string) (Principal, error)

func (fn Func) AuthenticateSession(ctx context.Context, request *http.Request, path, requestID string) (Principal, error) {
	if fn == nil {
		return Principal{}, NewError(ErrorUnauthenticated, "session expired", nil)
	}
	return fn(ctx, request, path, requestID)
}

func (Func) RequirePermission(context.Context, Principal, string, string) error { return nil }

func (Func) ClearSessionCookie(http.ResponseWriter) {}
