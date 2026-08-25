package approval

import "errors"

type ErrorKind int

const (
	ErrorValidation ErrorKind = iota + 1
	ErrorNotFound
	ErrorConflict
	ErrorForbidden
	ErrorInternal
)

type Error struct {
	Kind     ErrorKind
	ErrorKey string
	Message  string
	Cause    error
}

func (e *Error) Error() string { return e.Message }
func (e *Error) Unwrap() error { return e.Cause }

func newError(kind ErrorKind, errorKey, message string, cause error) error {
	return &Error{Kind: kind, ErrorKey: errorKey, Message: message, Cause: cause}
}

func IsKind(err error, kind ErrorKind) bool {
	var target *Error
	return errors.As(err, &target) && target.Kind == kind
}

func IsKey(err error, errorKey string) bool {
	var target *Error
	return errors.As(err, &target) && target.ErrorKey == errorKey
}
