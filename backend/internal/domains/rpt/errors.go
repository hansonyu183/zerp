package rpt

import "fmt"

type ErrorKind string

const (
	ErrorValidation ErrorKind = "VALIDATION"
	ErrorConflict   ErrorKind = "CONFLICT"
	ErrorForbidden  ErrorKind = "FORBIDDEN"
	ErrorInternal   ErrorKind = "INTERNAL"
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
func domainError(kind ErrorKind, message string, data any, cause error) error {
	return &DomainError{Kind: kind, ErrorKey: defaultErrorKey(kind), Message: message, Data: data, Cause: cause}
}
func defaultErrorKey(kind ErrorKind) string {
	switch kind {
	case ErrorValidation:
		return "validation_failed"
	case ErrorConflict:
		return "conflict"
	case ErrorForbidden:
		return "forbidden"
	default:
		return "internal_error"
	}
}
func validation(message string, data any) error {
	return domainError(ErrorValidation, message, data, nil)
}
func internal(message string, err error) error {
	return domainError(ErrorInternal, message, nil, fmt.Errorf("%s: %w", message, err))
}
