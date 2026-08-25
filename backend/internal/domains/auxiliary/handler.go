package aux

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
	Query(context.Context, string, QueryInput) (Page[QueryItem], error)
	Get(context.Context, string, GetInput) (ObjectView, error)
	Create(context.Context, string, CreateInput, string, string) (MutationResult, error)
	Save(context.Context, string, SaveInput, string, string) (MutationResult, error)
	Enable(context.Context, string, RevisionInput, string, string) (MutationResult, error)
	Disable(context.Context, string, RevisionInput, string, string) (MutationResult, error)
	Delete(context.Context, string, DeleteInput) error
	Versions(context.Context, string, HistoryInput) (Page[VersionView], error)
	AuditHistory(context.Context, string, HistoryInput) (Page[AuditEventView], error)
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
	{"query", (*Handler).query},
	{"get", (*Handler).get},
	{"create", (*Handler).create},
	{"save", (*Handler).save},
	{"enable", (*Handler).enable},
	{"disable", (*Handler).disable},
	{"delete", (*Handler).delete},
	{"versions", (*Handler).versions},
	{"audit-history", (*Handler).auditHistory},
}

func NewHandler(service applicationService, authorizer authorization.Authorizer, logger *slog.Logger) *Handler {
	if authorizer == nil {
		authorizer = authorization.FailClosed{}
	}
	return &Handler{service: service, authorizer: authorizer, logger: logger}
}

func (h *Handler) Register(router *gin.Engine) {
	group := router.Group("/aux")
	group.POST("/reference/query", authmiddleware.RequireSession(h.authorizer, "/aux/reference/query", h.writeAuthorizationError), h.referenceQuery)
	for _, registeredEntity := range entities {
		entity := registeredEntity
		entityGroup := group.Group("/" + entity)
		for _, route := range actionRoutes {
			action, handle := route.action, route.handle
			path := "/aux/" + entity + "/" + action
			entityGroup.POST("/"+action, h.authorize(path), func(c *gin.Context) {
				handle(h, c, entity)
			})
		}
	}
}

func (h *Handler) referenceQuery(c *gin.Context) {
	var input ReferenceQueryInput
	if !h.bind(c, &input) {
		return
	}
	if !authmiddleware.CheckPermission(c, h.authorizer, "/aux/"+input.Entity+"/query", h.writeAuthorizationError) {
		return
	}
	result, err := h.service.QueryReferenceCandidates(c.Request.Context(), input)
	h.result(c, result, err)
}

func (h *Handler) authorize(path string) gin.HandlerFunc {
	return authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError)
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

func (h *Handler) save(c *gin.Context, entity string) {
	var input SaveInput
	if h.bind(c, &input) {
		result, err := h.service.Save(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) enable(c *gin.Context, entity string) {
	var input RevisionInput
	if h.bind(c, &input) {
		result, err := h.service.Enable(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) disable(c *gin.Context, entity string) {
	var input RevisionInput
	if h.bind(c, &input) {
		result, err := h.service.Disable(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) delete(c *gin.Context, entity string) {
	var input DeleteInput
	if h.bind(c, &input) {
		h.result(c, nil, h.service.Delete(c.Request.Context(), entity, input))
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
	return authmiddleware.Principal(c).ActorID
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
		h.logger.Error("aux authorization failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", err)
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
		h.logger.Error("aux handler failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", domainErr.Cause)
	}
	errorKey := domainErr.ErrorKey
	if errorKey == "" {
		errorKey = response.ErrorKeyForCode(code)
	}
	response.BusinessError(c, code, errorKey, domainErr.Message, domainErr.Data)
}
