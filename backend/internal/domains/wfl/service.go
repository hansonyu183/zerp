package wfl

import (
	"errors"
	"log/slog"
	"strings"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type Service struct {
	pool     *pgxpool.Pool
	sales    salesVoucherService
	purchase purchaseVoucherService
	logger   *slog.Logger
}

func NewService(
	pool *pgxpool.Pool,
	_ referenceResolver,
	events *txevent.Bus,
	logger *slog.Logger,
) (*Service, error) {
	if pool == nil || events == nil {
		return nil, errors.New("WFL pool and event bus are required")
	}
	if logger == nil {
		logger = slog.Default()
	}
	service := &Service{pool: pool, logger: logger}
	if err := service.registerDocumentSubscriptions(events); err != nil {
		return nil, err
	}
	return service, nil
}

func (s *Service) SetSalesVoucherService(sales salesVoucherService) {
	s.sales = sales
}

func (s *Service) SetPurchaseVoucherService(purchase purchaseVoucherService) {
	s.purchase = purchase
}

type referenceResolver interface{}

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

var _ = voudomain.EntitySaleOrder
