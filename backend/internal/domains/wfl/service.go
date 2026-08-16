package wfl

import (
	"errors"
	"log/slog"

	"github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type Service struct {
	pool    *pgxpool.Pool
	queries *sqlc.Queries
	runtime WorkflowRuntime
	logger  *slog.Logger
}

func NewService(
	pool *pgxpool.Pool,
	events *txevent.Bus,
	runtime WorkflowRuntime,
	logger *slog.Logger,
) (*Service, error) {
	if pool == nil || events == nil || runtime == nil {
		return nil, errors.New("WFL pool, event bus, and runtime are required")
	}
	if logger == nil {
		logger = slog.Default()
	}
	service := &Service{pool: pool, queries: sqlc.New(pool), runtime: runtime, logger: logger}
	if err := service.registerSubscriptions(events); err != nil {
		return nil, err
	}
	return service, nil
}

func newID() string             { return ulid.Make().String() }
func validID(value string) bool { _, err := ulid.ParseStrict(value); return err == nil }

func validation(message string, data any) error {
	return &DomainError{Kind: ErrorValidation, Message: message, Data: data}
}

func conflict(message string, data any) error {
	return &DomainError{Kind: ErrorConflict, Message: message, Data: data}
}

func internal(message string, err error) error {
	return &DomainError{Kind: ErrorInternal, Message: message, Cause: err}
}
