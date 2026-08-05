package led

import (
	"context"
	"errors"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/api/requestbody"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
)

const principalContextKey = "ledPrincipal"

type applicationService interface {
	GetClosing(context.Context) (ClosingView, error)
	Close(context.Context, ClosingInput, string, string) (ClosingMutationResult, error)
	Unclose(context.Context, UncloseInput, string, string) (ClosingMutationResult, error)
	ClosingHistory(context.Context, HistoryInput) (Page[ClosingHistoryView], error)
	QueryInventory(context.Context, QueryInput) (Page[InventoryEntryView], error)
	InventoryBalance(context.Context, BalanceInput) (Page[InventoryBalanceView], error)
	QueryFund(context.Context, QueryInput) (Page[FundEntryView], error)
	FundBalance(context.Context, BalanceInput) (Page[FundBalanceView], error)
	QueryParty(context.Context, QueryInput, ...string) (Page[PartyEntryView], error)
	PartyBalance(context.Context, BalanceInput, ...string) (Page[PartyBalanceView], error)
}

type containerApplicationService interface {
	QueryContainer(context.Context, QueryInput) (Page[ContainerEntryView], error)
	ContainerBalance(context.Context, BalanceInput) (Page[ContainerBalanceView], error)
}

type assetApplicationService interface {
	QueryAssets(context.Context, AssetQueryInput) (Page[AssetView], error)
	GetAsset(context.Context, AssetGetInput) (AssetDetailView, error)
}

type billApplicationService interface {
	QueryBills(context.Context, BillQueryInput) (Page[BillView], error)
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
		{EntityClosing, "get", h.getClosing},
		{EntityClosing, "close", h.close},
		{EntityClosing, "unclose", h.unclose},
		{EntityClosing, "history", h.closingHistory},
		{EntityInventory, "query", h.queryInventory},
		{EntityInventory, "balance", h.inventoryBalance},
		{EntityFund, "query", h.queryFund},
		{EntityFund, "balance", h.fundBalance},
		{EntityCustomer, "query", h.queryParty(EntityCustomer)},
		{EntityCustomer, "balance", h.partyBalance(EntityCustomer)},
		{EntitySupplier, "query", h.queryParty(EntitySupplier)},
		{EntitySupplier, "balance", h.partyBalance(EntitySupplier)},
		{EntityOther, "query", h.queryParty("other-party")},
		{EntityOther, "balance", h.partyBalance("other-party")},
		{EntityEmployee, "query", h.queryParty(EntityEmployee)},
		{EntityEmployee, "balance", h.partyBalance(EntityEmployee)},
		{EntityContainer, "query", h.queryContainer},
		{EntityContainer, "balance", h.containerBalance},
		{EntityAsset, "query", h.queryAssets},
		{EntityAsset, "get", h.getAsset},
		{EntityBill, "query", h.queryBills},
	}
	for _, route := range routes {
		path := "/led/" + route.entity + "/" + route.action
		router.POST(path, h.authorize(path), route.handle)
	}
}

func (h *Handler) queryBills(c *gin.Context) {
	var input BillQueryInput
	if h.bind(c, &input) {
		service, ok := h.service.(billApplicationService)
		if !ok {
			h.result(c, nil, domainError(ErrorInternal, "bill ledger is unavailable", nil, nil))
			return
		}
		result, err := service.QueryBills(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) queryAssets(c *gin.Context) {
	var input AssetQueryInput
	if h.bind(c, &input) {
		service, ok := h.service.(assetApplicationService)
		if !ok {
			h.result(c, nil, domainError(ErrorInternal, "asset ledger is unavailable", nil, nil))
			return
		}
		result, err := service.QueryAssets(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) getAsset(c *gin.Context) {
	var input AssetGetInput
	if h.bind(c, &input) {
		service, ok := h.service.(assetApplicationService)
		if !ok {
			h.result(c, nil, domainError(ErrorInternal, "asset ledger is unavailable", nil, nil))
			return
		}
		result, err := service.GetAsset(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) authorize(path string) gin.HandlerFunc {
	return authmiddleware.Require(h.authorizer, path, principalContextKey, h.writeAuthorizationError)
}

func (h *Handler) getClosing(c *gin.Context) {
	var input struct{}
	if h.bind(c, &input) {
		result, err := h.service.GetClosing(c.Request.Context())
		h.result(c, result, err)
	}
}

func (h *Handler) close(c *gin.Context) {
	var input ClosingInput
	if h.bind(c, &input) {
		result, err := h.service.Close(c.Request.Context(), input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) unclose(c *gin.Context) {
	var input UncloseInput
	if h.bind(c, &input) {
		result, err := h.service.Unclose(c.Request.Context(), input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) closingHistory(c *gin.Context) {
	var input HistoryInput
	if h.bind(c, &input) {
		result, err := h.service.ClosingHistory(c.Request.Context(), input)
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

func (h *Handler) queryParty(counterpartyType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input QueryInput
		if h.bind(c, &input) {
			result, err := h.service.QueryParty(c.Request.Context(), input, counterpartyType)
			h.result(c, result, err)
		}
	}
}

func (h *Handler) partyBalance(counterpartyType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input BalanceInput
		if h.bind(c, &input) {
			result, err := h.service.PartyBalance(c.Request.Context(), input, counterpartyType)
			h.result(c, result, err)
		}
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
