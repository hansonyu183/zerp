package bob

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

const principalContextKey = "bobPrincipal"

type applicationService interface {
	Query(context.Context, string, QueryInput) (Page[QueryItem], error)
	Get(context.Context, string, GetInput) (ObjectView, error)
	Create(context.Context, string, CreateInput, string, string) (MutationResult, error)
	Edit(context.Context, string, ObjectRevisionInput, string, string) (MutationResult, error)
	Save(context.Context, string, SaveInput, string, string) (MutationResult, error)
	Delete(context.Context, string, DeleteInput) error
	Submit(context.Context, string, VersionRevisionInput, string, string) (MutationResult, error)
	Approve(context.Context, string, ReviewInput, string, string) (MutationResult, error)
	Reject(context.Context, string, ReviewInput, string, string) (MutationResult, error)
	Versions(context.Context, string, HistoryInput) (Page[VersionHistoryItem], error)
	AuditHistory(context.Context, string, HistoryInput) (Page[AuditEventView], error)
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
	{action: "create", handle: (*Handler).create},
	{action: "edit", handle: (*Handler).edit},
	{action: "save", handle: (*Handler).save},
	{action: "delete", handle: (*Handler).delete},
	{action: "submit", handle: (*Handler).submit},
	{action: "approve", handle: (*Handler).approve},
	{action: "reject", handle: (*Handler).reject},
	{action: "versions", handle: (*Handler).versions},
	{action: "audit-history", handle: (*Handler).auditHistory},
}

func NewHandler(service applicationService, authorizer authorization.Authorizer, logger *slog.Logger) *Handler {
	if authorizer == nil {
		authorizer = authorization.FailClosed{}
	}
	return &Handler{service: service, authorizer: authorizer, logger: logger}
}

func (h *Handler) Register(router *gin.Engine) {
	group := router.Group("/bob")
	for _, registeredEntity := range entities {
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
}

func (h *Handler) authorize(path string) gin.HandlerFunc {
	return authmiddleware.Require(h.authorizer, path, principalContextKey, h.writeAuthorizationError)
}

func (h *Handler) query(c *gin.Context, entity string) {
	var input QueryInput
	if h.bind(c, &input) {
		result, err := h.service.Query(c.Request.Context(), entity, input)
		h.result(c, result, err)
	}
}

func (h *Handler) get(c *gin.Context, entity string) {
	var input GetInput
	if h.bind(c, &input) {
		result, err := h.service.Get(c.Request.Context(), entity, input)
		h.result(c, result, err)
	}
}

func (h *Handler) create(c *gin.Context, entity string) {
	var input CreateInput
	if h.bind(c, &input) {
		result, err := h.service.Create(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) edit(c *gin.Context, entity string) {
	var input ObjectRevisionInput
	if h.bind(c, &input) {
		result, err := h.service.Edit(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) save(c *gin.Context, entity string) {
	var input SaveInput
	if h.bind(c, &input) {
		result, err := h.service.Save(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) delete(c *gin.Context, entity string) {
	var input DeleteInput
	if h.bind(c, &input) {
		err := h.service.Delete(c.Request.Context(), entity, input)
		h.result(c, nil, err)
	}
}

func (h *Handler) submit(c *gin.Context, entity string) {
	var input VersionRevisionInput
	if h.bind(c, &input) {
		result, err := h.service.Submit(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) approve(c *gin.Context, entity string) {
	var input ReviewInput
	if h.bind(c, &input) {
		result, err := h.service.Approve(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) reject(c *gin.Context, entity string) {
	var input ReviewInput
	if h.bind(c, &input) {
		result, err := h.service.Reject(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) versions(c *gin.Context, entity string) {
	var input HistoryInput
	if h.bind(c, &input) {
		result, err := h.service.Versions(c.Request.Context(), entity, input)
		h.result(c, result, err)
	}
}

func (h *Handler) auditHistory(c *gin.Context, entity string) {
	var input HistoryInput
	if h.bind(c, &input) {
		result, err := h.service.AuditHistory(c.Request.Context(), entity, input)
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
		h.logger.Error("bob handler failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", domainErr.Cause)
	}
	response.BusinessError(c, code, domainErr.Message, domainErr.Data)
}
