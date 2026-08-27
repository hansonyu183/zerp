package dcl

import (
	"context"
	"errors"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/api/requestbody"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type operatingEntityApplicationService interface {
	Create(context.Context, OperatingEntityCreateInput, approval.Actor) (OperatingEntityMutation, error)
	Save(context.Context, OperatingEntitySaveInput, approval.Actor) (OperatingEntityMutation, error)
	Submit(context.Context, OperatingEntityVersionInput, approval.Actor) (OperatingEntityMutation, error)
	Unsubmit(context.Context, OperatingEntityReviewInput, approval.Actor) (OperatingEntityMutation, error)
	Reject(context.Context, OperatingEntityReviewInput, approval.Actor) (OperatingEntityMutation, error)
	Approve(context.Context, OperatingEntityVersionInput, approval.Actor) (OperatingEntityMutation, error)
	Unapprove(context.Context, OperatingEntityReviewInput, approval.Actor) (OperatingEntityMutation, error)
	Delete(context.Context, OperatingEntityDeleteInput, approval.Actor) error
	Get(context.Context, OperatingEntityGetInput, approval.Actor) (OperatingEntityView, error)
	Query(context.Context, OperatingEntityQueryInput, approval.Actor) (Page[OperatingEntityQueryItem], error)
	Versions(context.Context, OperatingEntityHistoryInput, approval.Actor) (Page[OperatingEntityVersionView], error)
	AuditHistory(context.Context, OperatingEntityHistoryInput, approval.Actor) (Page[approval.EventView], error)
}

type Handler struct {
	service operatingEntityApplicationService
	handlerSupport
}

type handlerSupport struct {
	authorizer authorization.Authorizer
	logger     *slog.Logger
}

func newHandlerSupport(authorizer authorization.Authorizer, logger *slog.Logger) handlerSupport {
	if authorizer == nil {
		authorizer = authorization.FailClosed{}
	}
	if logger == nil {
		logger = slog.Default()
	}
	return handlerSupport{authorizer: authorizer, logger: logger}
}

func NewHandler(service operatingEntityApplicationService, authorizer authorization.Authorizer, logger *slog.Logger) *Handler {
	return &Handler{service: service, handlerSupport: newHandlerSupport(authorizer, logger)}
}

func (h *Handler) Register(router *gin.Engine) {
	group := router.Group("/dcl/" + EntityOperatingEntity)
	routes := map[string]gin.HandlerFunc{
		"create": h.create, "save": h.save, "submit": h.submit, "unsubmit": h.unsubmit,
		"reject": h.reject, "approve": h.approve, "unapprove": h.unapprove, "delete": h.delete,
		"get": h.get, "query": h.query, "versions": h.versions, "audit-history": h.auditHistory,
	}
	for action, handle := range routes {
		path := "/dcl/" + EntityOperatingEntity + "/" + action
		group.POST("/"+action, authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError), handle)
	}
}

func (h *Handler) create(c *gin.Context) {
	var input OperatingEntityCreateInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Create(c, input, actor) })
	}
}

func (h *Handler) save(c *gin.Context) {
	var input OperatingEntitySaveInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Save(c, input, actor) })
	}
}

func (h *Handler) submit(c *gin.Context) {
	var input OperatingEntityVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Submit(c, input, actor) })
	}
}

func (h *Handler) unsubmit(c *gin.Context) {
	var input OperatingEntityReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unsubmit(c, input, actor) })
	}
}

func (h *Handler) reject(c *gin.Context) {
	var input OperatingEntityReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Reject(c, input, actor) })
	}
}

func (h *Handler) approve(c *gin.Context) {
	var input OperatingEntityVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Approve(c, input, actor) })
	}
}

func (h *Handler) unapprove(c *gin.Context) {
	var input OperatingEntityReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unapprove(c, input, actor) })
	}
}

func (h *Handler) delete(c *gin.Context) {
	var input OperatingEntityDeleteInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return nil, h.service.Delete(c, input, actor) })
	}
}

func (h *Handler) get(c *gin.Context) {
	var input OperatingEntityGetInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Get(c, input, actor) })
	}
}

func (h *Handler) query(c *gin.Context) {
	var input OperatingEntityQueryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Query(c, input, actor) })
	}
}

func (h *Handler) versions(c *gin.Context) {
	var input OperatingEntityHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Versions(c, input, actor) })
	}
}

func (h *Handler) auditHistory(c *gin.Context) {
	var input OperatingEntityHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.AuditHistory(c, input, actor) })
	}
}

func (h *handlerSupport) withActor(c *gin.Context, operation func(approval.Actor) (any, error)) {
	actor, err := approval.UserActor(authmiddleware.Principal(c), response.RequestID(c))
	if err != nil {
		h.writeError(c, translateError(err))
		return
	}
	result, err := operation(actor)
	if err != nil {
		h.writeError(c, err)
		return
	}
	response.OK(c, result)
}

func (h *handlerSupport) bind(c *gin.Context, target any) bool {
	if err := requestbody.DecodeJSON(c, target); err != nil {
		h.writeError(c, newError(ErrorValidation, "validation_failed", "invalid request", nil, err))
		return false
	}
	return true
}

func (h *handlerSupport) writeAuthorizationError(c *gin.Context, err error) {
	code, message := response.CodeInternal, "internal server error"
	switch {
	case authorization.IsKind(err, authorization.ErrorUnauthenticated):
		code, message = response.CodeUnauthenticated, "session expired"
	case authorization.IsKind(err, authorization.ErrorForbidden):
		code, message = response.CodeForbidden, "permission denied"
	default:
		h.logger.Error("dcl authorization failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", err)
	}
	response.BusinessError(c, code, response.ErrorKeyForCode(code), message, nil)
}

func (h *handlerSupport) writeError(c *gin.Context, err error) {
	var domainErr *DomainError
	if !errors.As(err, &domainErr) {
		domainErr = &DomainError{Kind: ErrorInternal, ErrorKey: "internal_error", Message: "internal server error", Cause: err}
	}
	code := response.CodeInternal
	switch domainErr.Kind {
	case ErrorValidation:
		code = response.CodeValidation
	case ErrorConflict:
		code = response.CodeConflict
	case ErrorForbidden:
		code = response.CodeForbidden
	}
	if domainErr.Kind == ErrorInternal {
		h.logger.Error("dcl handler failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", domainErr.Cause)
	}
	errorKey := domainErr.ErrorKey
	if errorKey == "" {
		errorKey = response.ErrorKeyForCode(code)
	}
	response.BusinessError(c, code, errorKey, domainErr.Message, domainErr.Data)
}
