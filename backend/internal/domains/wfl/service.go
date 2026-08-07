package wfl

import (
	"errors"
	"log/slog"
	"strings"

	"github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type Service struct {
	pool      *pgxpool.Pool
	queries   *sqlc.Queries
	sales     salesVoucherService
	purchase  purchaseVoucherService
	converter workflowDocumentConverter
	validator workflowDocumentValidator
	logger    *slog.Logger
}

type documentService interface {
	salesVoucherService
	purchaseVoucherService
	workflowDocumentConverter
	workflowDocumentValidator
}

func NewService(
	pool *pgxpool.Pool,
	events *txevent.Bus,
	documents documentService,
	logger *slog.Logger,
) (*Service, error) {
	if pool == nil || events == nil || documents == nil {
		return nil, errors.New("WFL pool, event bus, and document service are required")
	}
	if logger == nil {
		logger = slog.Default()
	}
	service := &Service{
		pool: pool, queries: sqlc.New(pool), logger: logger,
		sales: documents, purchase: documents, converter: documents, validator: documents,
	}
	if err := service.registerDocumentSubscriptions(events); err != nil {
		return nil, err
	}
	if err := service.registerGenericSubscriptions(events); err != nil {
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

type validatedQuery struct {
	page, pageSize int
	offset         int32
	keyword        string
	statuses       []string
}

func validateQuery(input QueryInput) (validatedQuery, error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 100 {
		return validatedQuery{}, validation("invalid pagination", nil)
	}
	allowed := map[string]bool{
		StatusDraft: true, StatusChecked: true, StatusApproved: true,
		StatusCompleted: true, StatusShortRequested: true, StatusShortClosed: true,
		StatusReturning: true,
	}
	statuses := make([]string, 0, len(input.Statuses))
	for _, status := range input.Statuses {
		status = strings.TrimSpace(status)
		if !allowed[status] {
			return validatedQuery{}, validation("invalid workflow status", nil)
		}
		statuses = append(statuses, status)
	}
	return validatedQuery{
		page: input.Page, pageSize: input.PageSize,
		offset:  int32((input.Page - 1) * input.PageSize),
		keyword: strings.TrimSpace(input.Keyword), statuses: statuses,
	}, nil
}

func workflowQuantity(value int64) string {
	return fixeddecimal.Format(value, 6, true)
}
