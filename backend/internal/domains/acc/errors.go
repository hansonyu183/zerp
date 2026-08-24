package acc

import "errors"

type ErrorKind string

const (
	ErrorValidation ErrorKind = "VALIDATION"
	ErrorForbidden  ErrorKind = "FORBIDDEN"
	ErrorConflict   ErrorKind = "CONFLICT"
	ErrorInternal   ErrorKind = "INTERNAL"
)

type DomainError struct {
	Kind     ErrorKind
	ErrorKey string
	Message  string
	Cause    error
}

func (err *DomainError) Error() string { return err.Message }
func (err *DomainError) Unwrap() error { return err.Cause }

func domainError(kind ErrorKind, message string, cause error) error {
	return domainErrorWithKey(kind, defaultErrorKey(kind), message, cause)
}

func domainErrorWithKey(kind ErrorKind, errorKey, message string, cause error) error {
	return &DomainError{Kind: kind, ErrorKey: errorKey, Message: message, Cause: cause}
}

func defaultErrorKey(kind ErrorKind) string {
	switch kind {
	case ErrorValidation:
		return "validation_failed"
	case ErrorForbidden:
		return "forbidden"
	case ErrorConflict:
		return "conflict"
	default:
		return "internal_error"
	}
}

func IsKind(err error, kind ErrorKind) bool {
	var domainErr *DomainError
	return errors.As(err, &domainErr) && domainErr.Kind == kind
}
