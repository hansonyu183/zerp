package authorization

import (
	"context"
	"errors"
	"net/http"
)

type Principal struct {
	ActorID     string
	Permissions []string
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
	Authorize(context.Context, *http.Request, string, string) (Principal, error)
}

type FailClosed struct{}

func (FailClosed) Authorize(context.Context, *http.Request, string, string) (Principal, error) {
	return Principal{}, NewError(ErrorUnauthenticated, "session expired", nil)
}

type Func func(context.Context, *http.Request, string, string) (Principal, error)

func (fn Func) Authorize(ctx context.Context, request *http.Request, path, requestID string) (Principal, error) {
	return fn(ctx, request, path, requestID)
}
