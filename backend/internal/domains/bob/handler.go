package bob

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

type applicationService interface {
	PartyQuery(context.Context, QueryInput) (Page[PartyListItem], error)
	PartyGet(context.Context, PartyGetInput, PartyRelationshipVisibility) (PartyView, error)
	Query(context.Context, string, QueryInput) (Page[QueryItem], error)
	Get(context.Context, string, GetInput) (ObjectView, error)
	CustomerCurrentQuery(context.Context, CustomerCurrentQueryInput) (Page[CustomerCurrentListItem], error)
	CustomerCurrentGet(context.Context, string) (CustomerCurrentView, error)
	CustomerAccountCurrentQuery(context.Context, CustomerAccountCurrentQueryInput) (Page[CustomerAccountCurrentListItem], error)
	CustomerAccountCurrentGet(context.Context, string) (CustomerAccountCurrentView, error)
	QueryReferenceCandidates(context.Context, ReferenceQueryInput) ([]ReferenceCandidate, error)
}

type Handler struct {
	service    applicationService
	authorizer authorization.Authorizer
	logger     *slog.Logger
}

type actionRoute struct {
	action string
	handle func(*Handler, *gin.Context, string)
}

var actionRoutes = [...]actionRoute{
	{action: "query", handle: (*Handler).query},
	{action: "get", handle: (*Handler).get},
}

func NewHandler(
	service applicationService,
	authorizer authorization.Authorizer,
	logger *slog.Logger,
) *Handler {
	if authorizer == nil {
		authorizer = authorization.FailClosed{}
	}
	return &Handler{service: service, authorizer: authorizer, logger: logger}
}

func (h *Handler) Register(router *gin.Engine) {
	group := router.Group("/bob")
	for _, registeredEntity := range publicEntities {
		entity := registeredEntity
		entityGroup := group.Group("/" + entity)
		for _, route := range actionRoutes {
			action := route.action
			handle := route.handle
			path := "/bob/" + entity + "/" + action
			entityGroup.POST("/"+action, h.authorize(path), func(c *gin.Context) {
				handle(h, c, entity)
			})
		}
	}
	partyGroup := group.Group("/party")
	partyGroup.POST("/query", h.authorize("/bob/party/query"), h.partyQuery)
	partyGroup.POST("/get", h.authorize("/bob/party/get"), h.partyGet)
	referenceGroup := group.Group("/reference")
	referenceGroup.POST("/query", authmiddleware.RequireSession(h.authorizer, "/bob/reference/query", h.writeAuthorizationError), h.referenceQuery)
}

func (h *Handler) partyQuery(c *gin.Context) {
	var input QueryInput
	if h.bind(c, &input) {
		result, err := h.service.PartyQuery(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) partyGet(c *gin.Context) {
	var input PartyGetInput
	if !h.bind(c, &input) {
		return
	}
	principal := h.principal(c)
	result, err := h.service.PartyGet(c.Request.Context(), input, PartyRelationshipVisibility{
		Customer: hasPermission(principal, "/bob/customer/get"), Supplier: hasPermission(principal, "/bob/supplier/get"),
		Employment: hasPermission(principal, "/bob/employee/get"), OtherUnit: hasPermission(principal, "/bob/other-unit/get"),
		SalesPartner: hasPermission(principal, "/bob/sales-partner/get"),
	})
	h.result(c, result, err)
}

func hasPermission(principal authorization.Principal, path string) bool {
	for _, permission := range principal.Permissions {
		if permission == path {
			return true
		}
	}
	return false
}

func (h *Handler) principal(c *gin.Context) authorization.Principal {
	return authmiddleware.Principal(c)
}

func (h *Handler) referenceQuery(c *gin.Context) {
	var input ReferenceQueryInput
	if !h.bind(c, &input) {
		return
	}
	if !authmiddleware.CheckPermission(c, h.authorizer, "/bob/"+input.Entity+"/query", h.writeAuthorizationError) {
		return
	}
	result, err := h.service.QueryReferenceCandidates(c.Request.Context(), input)
	h.result(c, result, err)
}

func (h *Handler) authorize(path string) gin.HandlerFunc {
	return authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError)
}

func (h *Handler) query(c *gin.Context, entity string) {
	if entity == EntityCustomer {
		var input CustomerCurrentQueryInput
		if h.bind(c, &input) {
			result, err := h.service.CustomerCurrentQuery(c.Request.Context(), input)
			h.result(c, result, err)
		}
		return
	}
	if entity == EntityCustomerAccount {
		var input CustomerAccountCurrentQueryInput
		if h.bind(c, &input) {
			result, err := h.service.CustomerAccountCurrentQuery(c.Request.Context(), input)
			h.result(c, result, err)
		}
		return
	}
	var input QueryInput
	if h.bind(c, &input) {
		result, err := h.service.Query(c.Request.Context(), entity, input)
		h.result(c, result, err)
	}
}

func (h *Handler) get(c *gin.Context, entity string) {
	var input GetInput
	if h.bind(c, &input) {
		if entity == EntityCustomer {
			if input.ApprovalEntryID != "" {
				h.writeError(c, domainError(ErrorValidation, "BOB customer get reads only current projection", nil, nil))
				return
			}
			result, err := h.service.CustomerCurrentGet(c.Request.Context(), input.ObjectID)
			h.result(c, result, err)
			return
		}
		if entity == EntityCustomerAccount {
			if input.ApprovalEntryID != "" {
				h.writeError(c, domainError(ErrorValidation, "BOB customer account get reads only current projection", nil, nil))
				return
			}
			result, err := h.service.CustomerAccountCurrentGet(c.Request.Context(), input.ObjectID)
			h.result(c, result, err)
			return
		}
		result, err := h.service.Get(c.Request.Context(), entity, input)
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

func (h *Handler) result(c *gin.Context, data any, err error) {
	if err != nil {
		h.writeError(c, err)
		return
	}
	response.OK(c, data)
}

func (h *Handler) writeAuthorizationError(c *gin.Context, err error) {
	code := response.CodeInternal
	message := "internal server error"
	switch {
	case authorization.IsKind(err, authorization.ErrorUnauthenticated):
		code, message = response.CodeUnauthenticated, "session expired"
	case authorization.IsKind(err, authorization.ErrorForbidden):
		code, message = response.CodeForbidden, "permission denied"
	default:
		h.logger.Error("bob authorization failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", err)
	}
	response.BusinessError(c, code, response.ErrorKeyForCode(code), message, nil)
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
		h.logger.Error("bob handler failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", domainErr.Cause)
	}
	errorKey := domainErr.ErrorKey
	if errorKey == "" {
		errorKey = response.ErrorKeyForCode(code)
	}
	response.BusinessError(c, code, errorKey, domainErr.Message, domainErr.Data)
}
