package wfl

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

const principalContextKey = "wflPrincipal"

type applicationService interface {
	Query(context.Context, QueryInput) (Page[ProcessView], error)
	Get(context.Context, GetInput, []string) (ProcessView, error)
	Create(context.Context, CreateInput, string, string) (MutationResult, error)
	Save(context.Context, SaveInput, string, string) (MutationResult, error)
	History(context.Context, HistoryInput) (Page[AuditView], error)
	Action(context.Context, string, ActionInput, string, string) (any, error)
	InitiateAttachment(context.Context, string, AttachmentInitiateInput, string, string) (AttachmentInitiateResult, error)
	DownloadAttachment(context.Context, string, AttachmentDownloadInput, string) (AttachmentDownloadResult, error)
	RemoveAttachment(context.Context, string, AttachmentRemoveInput, string, string) (AttachmentRemoveResult, error)
}

type Handler struct {
	service    applicationService
	authorizer authorization.Authorizer
	logger     *slog.Logger
}

var workflowActions = [...]string{
	"check", "uncheck", "approve", "unapprove",
	"short-close-request", "short-close-cancel", "short-close-confirm", "short-close-unconfirm",
	"procurement-create", "procurement-get", "procurement-save", "procurement-delete",
	"procurement-check", "procurement-uncheck", "procurement-place", "procurement-unplace",
	"receipt-create", "receipt-get", "receipt-save", "receipt-delete",
	"receipt-check", "receipt-uncheck", "receipt-confirm", "receipt-unconfirm",
	"delivery-create", "delivery-get", "delivery-save", "delivery-delete",
	"delivery-check", "delivery-uncheck", "delivery-execute", "delivery-unexecute",
	"signoff-create", "signoff-get", "signoff-save", "signoff-delete",
	"signoff-check", "signoff-uncheck", "signoff-confirm", "signoff-unconfirm",
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
	group := router.Group("/wfl/intermediary-trade")
	group.POST("/query", h.authorize("/wfl/intermediary-trade/query"), h.query)
	group.POST("/get", h.authorize("/wfl/intermediary-trade/get"), h.get)
	group.POST("/create", h.authorize("/wfl/intermediary-trade/create"), h.create)
	group.POST("/save", h.authorize("/wfl/intermediary-trade/save"), h.save)
	group.POST("/audit-history", h.authorize("/wfl/intermediary-trade/audit-history"), h.history)
	for _, value := range workflowActions {
		action := value
		group.POST("/"+action, h.authorize("/wfl/intermediary-trade/"+action), func(c *gin.Context) {
			var input ActionInput
			if h.bind(c, &input) {
				principal := h.principal(c)
				result, err := h.service.Action(c.Request.Context(), action, input, principal.ActorID, response.RequestID(c))
				h.result(c, result, err)
			}
		})
	}
	for _, stage := range []string{"procurement", "receipt", "delivery", "signoff"} {
		for _, operation := range []string{"initiate", "download", "remove"} {
			action := stage + "-attachment-" + operation
			group.POST("/"+action, h.authorize("/wfl/intermediary-trade/"+action), func(c *gin.Context) {
				h.attachment(c, action, operation)
			})
		}
	}
}

func (h *Handler) attachment(c *gin.Context, action, operation string) {
	principal := h.principal(c)
	switch operation {
	case "initiate":
		var input AttachmentInitiateInput
		if h.bind(c, &input) {
			result, err := h.service.InitiateAttachment(c.Request.Context(), action, input,
				principal.ActorID, response.RequestID(c))
			h.result(c, result, err)
		}
	case "download":
		var input AttachmentDownloadInput
		if h.bind(c, &input) {
			result, err := h.service.DownloadAttachment(c.Request.Context(), action, input, principal.ActorID)
			h.result(c, result, err)
		}
	case "remove":
		var input AttachmentRemoveInput
		if h.bind(c, &input) {
			result, err := h.service.RemoveAttachment(c.Request.Context(), action, input,
				principal.ActorID, response.RequestID(c))
			h.result(c, result, err)
		}
	}
}

func (h *Handler) authorize(path string) gin.HandlerFunc {
	return authmiddleware.Require(h.authorizer, path, principalContextKey, h.writeAuthorizationError)
}

func (h *Handler) query(c *gin.Context) {
	var input QueryInput
	if h.bind(c, &input) {
		result, err := h.service.Query(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) get(c *gin.Context) {
	var input GetInput
	if h.bind(c, &input) {
		result, err := h.service.Get(c.Request.Context(), input, h.principal(c).Permissions)
		h.result(c, result, err)
	}
}

func (h *Handler) create(c *gin.Context) {
	var input CreateInput
	if h.bind(c, &input) {
		result, err := h.service.Create(c.Request.Context(), input, h.principal(c).ActorID, response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) save(c *gin.Context) {
	var input SaveInput
	if h.bind(c, &input) {
		result, err := h.service.Save(c.Request.Context(), input, h.principal(c).ActorID, response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) history(c *gin.Context) {
	var input HistoryInput
	if h.bind(c, &input) {
		result, err := h.service.History(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) bind(c *gin.Context, target any) bool {
	if err := requestbody.DecodeJSON(c, target); err != nil {
		h.writeError(c, validation("invalid request", nil))
		return false
	}
	return true
}

func (h *Handler) principal(c *gin.Context) authorization.Principal {
	value, _ := c.Get(principalContextKey)
	return value.(authorization.Principal)
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
		h.logger.Error("wfl authorization failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", err)
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
		h.logger.Error("wfl handler failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", domainErr.Cause)
	}
	response.BusinessError(c, code, domainErr.Message, domainErr.Data)
}
