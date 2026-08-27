package dcl

import (
	"errors"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type ErrorKind int

const (
	ErrorValidation ErrorKind = iota + 1
	ErrorConflict
	ErrorForbidden
	ErrorInternal
)

type DomainError struct {
	Kind     ErrorKind
	ErrorKey string
	Message  string
	Data     any
	Cause    error
}

func (e *DomainError) Error() string { return e.Message }
func (e *DomainError) Unwrap() error { return e.Cause }

func newError(kind ErrorKind, key, message string, data any, cause error) error {
	return &DomainError{Kind: kind, ErrorKey: key, Message: message, Data: data, Cause: cause}
}

func translateError(err error) error {
	if err == nil {
		return nil
	}
	var approvalErr *approval.Error
	if errors.As(err, &approvalErr) {
		kind := ErrorInternal
		switch approvalErr.Kind {
		case approval.ErrorValidation, approval.ErrorNotFound:
			kind = ErrorValidation
		case approval.ErrorConflict:
			kind = ErrorConflict
		case approval.ErrorForbidden:
			kind = ErrorForbidden
		}
		return newError(kind, approvalErr.ErrorKey, approvalErr.Message, nil, err)
	}
	var bobErr *bobdomain.DomainError
	if errors.As(err, &bobErr) {
		kind := ErrorInternal
		switch bobErr.Kind {
		case bobdomain.ErrorValidation:
			kind = ErrorValidation
		case bobdomain.ErrorConflict:
			kind = ErrorConflict
		}
		return newError(kind, bobErr.ErrorKey, bobErr.Message, bobErr.Data, err)
	}
	return newError(ErrorInternal, "internal_error", "internal server error", nil, err)
}
