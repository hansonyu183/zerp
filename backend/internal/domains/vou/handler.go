package vou

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp-back/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp-back/internal/api/authorization"
	"github.com/hansonyu183/zerp-back/internal/api/requestbody"
	"github.com/hansonyu183/zerp-back/internal/api/response"
)

const principalContextKey = "vouPrincipal"

type applicationService interface {
	Query(context.Context, string, QueryInput) (Page[ListItem], error)
	Get(context.Context, string, GetInput) (DocumentView, error)
	Create(context.Context, string, CreateInput, string, string) (MutationResult, error)
	Save(context.Context, string, SaveInput, string, string) (MutationResult, error)
	Review(context.Context, string, DocumentRevisionInput, string, string) (MutationResult, error)
	Unreview(context.Context, string, ReverseInput, string, string) (MutationResult, error)
	Approve(context.Context, string, DocumentRevisionInput, string, string) (MutationResult, error)
	Unapprove(context.Context, string, ReverseInput, string, string) (MutationResult, error)
	Execute(context.Context, string, ExecuteInput, string, string) (MutationResult, error)
	Unexecute(context.Context, string, ReverseInput, string, string) (MutationResult, error)
	AuditHistory(context.Context, string, HistoryInput) (Page[AuditEventView], error)
	InitiateAttachment(context.Context, string, AttachmentInitiateInput, string, string) (AttachmentInitiateResult, error)
	CreateDownload(context.Context, string, AttachmentDownloadInput, string) (AttachmentDownloadResult, error)
	RemoveAttachment(context.Context, string, AttachmentRemoveInput, string, string) (MutationResult, error)
	Upload(context.Context, string, io.Reader, int64, string, string) error
	OpenDownload(context.Context, string) (DownloadFile, error)
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
	{action: "save", handle: (*Handler).save},
	{action: "review", handle: (*Handler).review},
	{action: "unreview", handle: (*Handler).unreview},
	{action: "approve", handle: (*Handler).approve},
	{action: "unapprove", handle: (*Handler).unapprove},
	{action: "execute", handle: (*Handler).execute},
	{action: "unexecute", handle: (*Handler).unexecute},
	{action: "audit-history", handle: (*Handler).auditHistory},
	{action: "attachment-initiate", handle: (*Handler).attachmentInitiate},
	{action: "attachment-download", handle: (*Handler).attachmentDownload},
	{action: "attachment-remove", handle: (*Handler).attachmentRemove},
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
	group := router.Group("/vou")
	for _, registeredEntity := range entities {
		entity := registeredEntity
		entityGroup := group.Group("/" + entity)
		for _, route := range actionRoutes {
			action := route.action
			handle := route.handle
			path := "/vou/" + entity + "/" + action
			entityGroup.POST("/"+action, h.authorize(path), func(c *gin.Context) {
				handle(h, c, entity)
			})
		}
	}
	router.PUT("/files/attachments/upload/:token", h.upload)
	router.GET("/files/attachments/download/:token", h.download)
}

func (h *Handler) authorize(path string) gin.HandlerFunc {
	return authmiddleware.Require(h.authorizer, path, principalContextKey, h.writeAuthorizationError)
}

func (h *Handler) query(c *gin.Context, entity string) {
	var input QueryInput
	if h.bind(c, &input) {
		input.permissions = h.principal(c).Permissions
		result, err := h.service.Query(c.Request.Context(), entity, input)
		h.result(c, result, err)
	}
}

func (h *Handler) get(c *gin.Context, entity string) {
	var input GetInput
	if h.bind(c, &input) {
		input.permissions = h.principal(c).Permissions
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

func (h *Handler) review(c *gin.Context, entity string) {
	var input DocumentRevisionInput
	if h.bind(c, &input) {
		result, err := h.service.Review(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) unreview(c *gin.Context, entity string) {
	var input ReverseInput
	if h.bind(c, &input) {
		result, err := h.service.Unreview(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) approve(c *gin.Context, entity string) {
	var input DocumentRevisionInput
	if h.bind(c, &input) {
		result, err := h.service.Approve(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) unapprove(c *gin.Context, entity string) {
	var input ReverseInput
	if h.bind(c, &input) {
		result, err := h.service.Unapprove(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) execute(c *gin.Context, entity string) {
	var input ExecuteInput
	if h.bind(c, &input) {
		result, err := h.service.Execute(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) unexecute(c *gin.Context, entity string) {
	var input ReverseInput
	if h.bind(c, &input) {
		result, err := h.service.Unexecute(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
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

func (h *Handler) attachmentInitiate(c *gin.Context, entity string) {
	var input AttachmentInitiateInput
	if h.bind(c, &input) {
		result, err := h.service.InitiateAttachment(
			c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c),
		)
		h.result(c, result, err)
	}
}

func (h *Handler) attachmentDownload(c *gin.Context, entity string) {
	var input AttachmentDownloadInput
	if h.bind(c, &input) {
		result, err := h.service.CreateDownload(c.Request.Context(), entity, input, h.actorID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) attachmentRemove(c *gin.Context, entity string) {
	var input AttachmentRemoveInput
	if h.bind(c, &input) {
		result, err := h.service.RemoveAttachment(
			c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c),
		)
		h.result(c, result, err)
	}
}

func (h *Handler) upload(c *gin.Context) {
	err := h.service.Upload(
		c.Request.Context(), c.Param("token"), c.Request.Body, c.Request.ContentLength,
		c.GetHeader("Content-Type"), response.RequestID(c),
	)
	if err != nil {
		h.writeFileError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) download(c *gin.Context) {
	file, err := h.service.OpenDownload(c.Request.Context(), c.Param("token"))
	if err != nil {
		h.writeFileError(c, err)
		return
	}
	defer file.Reader.Close()
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": file.FileName})
	c.Header("Content-Disposition", disposition)
	c.Header("Content-Type", file.ContentType)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, no-store")
	c.Status(http.StatusOK)
	if _, err = io.Copy(c.Writer, file.Reader); err != nil {
		h.logger.Warn("attachment download interrupted", "requestId", response.RequestID(c), "error", err)
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
	return h.principal(c).ActorID
}

func (h *Handler) principal(c *gin.Context) authorization.Principal {
	principal, _ := c.Get(principalContextKey)
	return principal.(authorization.Principal)
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
		h.logger.Error("vou authorization failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", err)
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
		h.logger.Error("vou handler failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", domainErr.Cause)
	}
	response.BusinessError(c, code, domainErr.Message, domainErr.Data)
}

func (h *Handler) writeFileError(c *gin.Context, err error) {
	var domainErr *DomainError
	if !errors.As(err, &domainErr) {
		domainErr = &DomainError{Kind: ErrorInternal, Message: "internal server error", Cause: err}
	}
	status := http.StatusInternalServerError
	if domainErr.Kind == ErrorValidation {
		status = http.StatusBadRequest
	} else if domainErr.Kind == ErrorConflict {
		status = http.StatusConflict
	}
	if status == http.StatusInternalServerError {
		h.logger.Error("vou file endpoint failure", "requestId", response.RequestID(c), "path", c.FullPath(), "error", domainErr.Cause)
	}
	c.JSON(status, gin.H{"error": domainErr.Message, "requestId": response.RequestID(c)})
}
