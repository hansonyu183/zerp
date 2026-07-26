package led

import (
	"context"
	"errors"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp-back/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp-back/internal/api/authorization"
	"github.com/hansonyu183/zerp-back/internal/api/requestbody"
	"github.com/hansonyu183/zerp-back/internal/api/response"
)

const principalContextKey = "ledPrincipal"

type applicationService interface {
	GetOpening(context.Context) (OpeningView, error)
	SaveOpening(context.Context, OpeningSaveInput, string, string) (MutationResult, error)
	Activate(context.Context, RevisionInput, string, string) (MutationResult, error)
	Reopen(context.Context, ReopenInput, string, string) (MutationResult, error)
	CancelReopen(context.Context, RevisionInput, string, string) (MutationResult, error)
	AuditHistory(context.Context, HistoryInput) (Page[AuditEventView], error)
	QueryInventory(context.Context, QueryInput) (Page[InventoryEntryView], error)
	InventoryBalance(context.Context, BalanceInput) (Page[InventoryBalanceView], error)
	QueryFund(context.Context, QueryInput) (Page[FundEntryView], error)
	FundBalance(context.Context, BalanceInput) (Page[FundBalanceView], error)
	QueryParty(context.Context, QueryInput) (Page[PartyEntryView], error)
	PartyBalance(context.Context, BalanceInput) (Page[PartyBalanceView], error)
}

type containerApplicationService interface {
	QueryContainer(context.Context, QueryInput) (Page[ContainerEntryView], error)
	ContainerBalance(context.Context, BalanceInput) (Page[ContainerBalanceView], error)
}

type Handler struct {
	service    applicationService
	authorizer authorization.Authorizer
	logger     *slog.Logger
}

func NewHandler(service applicationService, authorizer authorization.Authorizer, logger *slog.Logger) *Handler {
	if authorizer == nil {
		authorizer = authorization.FailClosed{}
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{service: service, authorizer: authorizer, logger: logger}
}

func (h *Handler) Register(router *gin.Engine) {
	routes := []struct {
		entity, action string
		handle         gin.HandlerFunc
	}{
		{EntityOpening, "get", h.getOpening},
		{EntityOpening, "save", h.saveOpening},
		{EntityOpening, "activate", h.activate},
		{EntityOpening, "reopen", h.reopen},
		{EntityOpening, "cancel-reopen", h.cancelReopen},
		{EntityOpening, "audit-history", h.auditHistory},
		{EntityInventory, "query", h.queryInventory},
		{EntityInventory, "balance", h.inventoryBalance},
		{EntityFund, "query", h.queryFund},
		{EntityFund, "balance", h.fundBalance},
		{EntityParty, "query", h.queryParty},
		{EntityParty, "balance", h.partyBalance},
		{EntityContainer, "query", h.queryContainer},
		{EntityContainer, "balance", h.containerBalance},
	}
	for _, route := range routes {
		path := "/led/" + route.entity + "/" + route.action
		router.POST(path, h.authorize(path), route.handle)
	}
}

func (h *Handler) authorize(path string) gin.HandlerFunc {
	return authmiddleware.Require(h.authorizer, path, principalContextKey, h.writeAuthorizationError)
}

func (h *Handler) getOpening(c *gin.Context) {
	var input struct{}
	if h.bind(c, &input) {
		result, err := h.service.GetOpening(c.Request.Context())
		h.result(c, result, err)
	}
}

func (h *Handler) saveOpening(c *gin.Context) {
	var input OpeningSaveInput
	if h.bind(c, &input) {
		result, err := h.service.SaveOpening(c.Request.Context(), input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) activate(c *gin.Context) {
	var input RevisionInput
	if h.bind(c, &input) {
		result, err := h.service.Activate(c.Request.Context(), input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) reopen(c *gin.Context) {
	var input ReopenInput
	if h.bind(c, &input) {
		result, err := h.service.Reopen(c.Request.Context(), input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) cancelReopen(c *gin.Context) {
	var input RevisionInput
	if h.bind(c, &input) {
		result, err := h.service.CancelReopen(c.Request.Context(), input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) auditHistory(c *gin.Context) {
	var input HistoryInput
	if h.bind(c, &input) {
		result, err := h.service.AuditHistory(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) queryInventory(c *gin.Context) {
	var input QueryInput
	if h.bind(c, &input) {
		result, err := h.service.QueryInventory(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) inventoryBalance(c *gin.Context) {
	var input BalanceInput
	if h.bind(c, &input) {
		result, err := h.service.InventoryBalance(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) queryFund(c *gin.Context) {
	var input QueryInput
	if h.bind(c, &input) {
		result, err := h.service.QueryFund(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) fundBalance(c *gin.Context) {
	var input BalanceInput
	if h.bind(c, &input) {
		result, err := h.service.FundBalance(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) queryParty(c *gin.Context) {
	var input QueryInput
	if h.bind(c, &input) {
		result, err := h.service.QueryParty(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) partyBalance(c *gin.Context) {
	var input BalanceInput
	if h.bind(c, &input) {
		result, err := h.service.PartyBalance(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) queryContainer(c *gin.Context) {
	var input QueryInput
	if h.bind(c, &input) {
		service, ok := h.service.(containerApplicationService)
		if !ok {
			h.result(c, nil, domainError(ErrorInternal, "container ledger is unavailable", nil, nil))
			return
		}
		result, err := service.QueryContainer(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) containerBalance(c *gin.Context) {
	var input BalanceInput
	if h.bind(c, &input) {
		service, ok := h.service.(containerApplicationService)
		if !ok {
			h.result(c, nil, domainError(ErrorInternal, "container ledger is unavailable", nil, nil))
			return
		}
		result, err := service.ContainerBalance(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) bind(c *gin.Context, target any) bool {
	if err := requestbody.DecodeJSON(c, target); err != nil {
		h.writeError(c, domainError(ErrorValidation, "invalid request", nil, err))
		return false
	}
	return true
}

func (h *Handler) actorID(c *gin.Context) string {
	principal, _ := c.Get(principalContextKey)
	return principal.(authorization.Principal).ActorID
}

func (h *Handler) result(c *gin.Context, data any, err error) {
	if err != nil {
		h.writeError(c, err)
		return
	}
	response.OK(c, data)
}

func (h *Handler) writeAuthorizationError(c *gin.Context, err error) {
	code, message := response.CodeInternal, "internal server error"
	switch {
	case authorization.IsKind(err, authorization.ErrorUnauthenticated):
		code, message = response.CodeUnauthenticated, "session expired"
	case authorization.IsKind(err, authorization.ErrorForbidden):
		code, message = response.CodeForbidden, "permission denied"
	default:
		h.logger.Error("led authorization failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", err)
	}
	response.BusinessError(c, code, message, nil)
}

func (h *Handler) writeError(c *gin.Context, err error) {
	var domainErr *DomainError
	if !errors.As(err, &domainErr) {
		domainErr = &DomainError{Kind: ErrorInternal, Message: "internal server error", Cause: err}
	}
	code := response.CodeInternal
	switch domainErr.Kind {
	case ErrorValidation:
		code = response.CodeValidation
	case ErrorConflict:
		code = response.CodeConflict
	}
	if domainErr.Kind == ErrorInternal {
		h.logger.Error("led handler failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", domainErr.Cause)
	}
	response.BusinessError(c, code, domainErr.Message, domainErr.Data)
}
