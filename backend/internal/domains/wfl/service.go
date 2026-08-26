package wfl

import (
	"errors"
	"log/slog"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/events/wflapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type Service struct {
	pool     *pgxpool.Pool
	queries  *sqlc.Queries
	runtime  WorkflowRuntime
	logger   *slog.Logger
	approval *approval.Coordinator[wflapproval.Payload]
}

func NewService(
	pool *pgxpool.Pool,
	authorizer authorization.Authorizer,
	events *txevent.Bus,
	runtime WorkflowRuntime,
	logger *slog.Logger,
) (*Service, error) {
	if pool == nil || authorizer == nil || events == nil || runtime == nil {
		return nil, errors.New("WFL pool, authorizer, event bus, and runtime are required")
	}
	if logger == nil {
		logger = slog.Default()
	}
	coordinator, err := approval.NewCoordinator("wfl", "process-definition", authorizer, events, wflapproval.Topic())
	if err != nil {
		return nil, err
	}
	service := &Service{pool: pool, queries: sqlc.New(pool), runtime: runtime, logger: logger, approval: coordinator}
	if err := service.registerSubscriptions(events); err != nil {
		return nil, err
	}
	return service, nil
}

func newID() string { return ulid.Make().String() }

func validation(message string, data any) error {
	return &DomainError{Kind: ErrorValidation, ErrorKey: "validation_failed", Message: message, Data: data}
}

func conflict(message string, data any) error {
	return &DomainError{Kind: ErrorConflict, ErrorKey: "conflict", Message: message, Data: data}
}

func internal(message string, err error) error {
	return &DomainError{Kind: ErrorInternal, ErrorKey: "internal_error", Message: message, Cause: err}
}
