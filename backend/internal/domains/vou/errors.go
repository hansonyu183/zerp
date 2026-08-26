package vou

import (
	"errors"
	"fmt"
	"strings"

	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgconn"
)

func (s *Service) internal(operation string, err error) error {
	return domainError(ErrorInternal, "internal server error", nil, fmt.Errorf("%s: %w", operation, err))
}

func mapApprovalError(err error) error {
	var rejection *txevent.RejectionError
	if errors.As(err, &rejection) {
		return domainError(ErrorConflict, rejection.Message, rejection.Data, err)
	}
	var approvalErr *approval.Error
	if !errors.As(err, &approvalErr) {
		return domainError(ErrorInternal, "internal server error", nil, err)
	}
	kind := ErrorInternal
	switch approvalErr.Kind {
	case approval.ErrorValidation, approval.ErrorNotFound:
		kind = ErrorValidation
	case approval.ErrorConflict:
		kind = ErrorConflict
	case approval.ErrorForbidden:
		kind = ErrorForbidden
	}
	return &DomainError{Kind: kind, ErrorKey: approvalErr.ErrorKey, Message: approvalErr.Message, Cause: err}
}

func (s *Service) writeError(operation string, err error) error {
	var domainErr *DomainError
	if errors.As(err, &domainErr) {
		return err
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		if pgErr.Code == "23514" && pgErr.Message == "accounting period is locked" {
			return domainError(ErrorConflict, pgErr.Message, map[string]any{"locked": true}, err)
		}
		if pgErr.Code == "P0001" && strings.Contains(pgErr.Message, "closed through") {
			return domainError(
				ErrorConflict,
				pgErr.Message,
				map[string]any{"closed": true},
				err,
			)
		}
		switch pgErr.Code {
		case "23505", "23514", "23P01", "40001", "40P01":
			return domainError(ErrorConflict, "data conflict", nil, err)
		}
	}
	return s.internal(operation, err)
}

func (s *Service) eventError(operation string, err error) error {
	var rejection *txevent.RejectionError
	if errors.As(err, &rejection) {
		return domainError(ErrorConflict, rejection.Message, rejection.Data, err)
	}
	return s.internal(operation, err)
}
