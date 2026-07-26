package app

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

func (s *Service) internal(operation string, err error) error {
	s.logger.Error("app domain failure", "operation", operation, "error", err)
	return domainError(ErrorInternal, "internal server error", err)
}

func (s *Service) writeError(operation string, err error) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && (postgresError.Code == "23505" || postgresError.Code == "23503") {
		return domainError(ErrorConflict, "data conflict", err)
	}
	return s.internal(operation, err)
}
