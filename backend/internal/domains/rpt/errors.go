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
	Kind    ErrorKind
	Message string
	Data    any
	Cause   error
}

func (e *DomainError) Error() string { return e.Message }
func (e *DomainError) Unwrap() error { return e.Cause }
func domainError(kind ErrorKind, message string, data any, cause error) error {
	return &DomainError{Kind: kind, Message: message, Data: data, Cause: cause}
}
func validation(message string, data any) error {
	return domainError(ErrorValidation, message, data, nil)
}
func internal(message string, err error) error {
	return domainError(ErrorInternal, message, nil, fmt.Errorf("%s: %w", message, err))
}
