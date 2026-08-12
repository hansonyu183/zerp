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
	Kind    ErrorKind
	Message string
	Cause   error
}

func (err *DomainError) Error() string { return err.Message }
func (err *DomainError) Unwrap() error { return err.Cause }

func domainError(kind ErrorKind, message string, cause error) error {
	return &DomainError{Kind: kind, Message: message, Cause: cause}
}

func IsKind(err error, kind ErrorKind) bool {
	var domainErr *DomainError
	return errors.As(err, &domainErr) && domainErr.Kind == kind
}
