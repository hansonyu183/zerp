package vou

import (
	"errors"
	"fmt"

	"github.com/hansonyu183/zerp-back/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgconn"
)

func (s *Service) internal(operation string, err error) error {
	return domainError(ErrorInternal, "internal server error", nil, fmt.Errorf("%s: %w", operation, err))
}

func (s *Service) writeError(operation string, err error) error {
	var domainErr *DomainError
	if errors.As(err, &domainErr) {
		return err
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
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
