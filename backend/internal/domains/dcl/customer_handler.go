package dcl

import (
	"context"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type customerApplicationService interface {
	Create(context.Context, CustomerCreateInput, approval.Actor) (CustomerMutation, error)
	Save(context.Context, CustomerSaveInput, approval.Actor) (CustomerMutation, error)
	Submit(context.Context, CustomerVersionInput, approval.Actor) (CustomerMutation, error)
	Unsubmit(context.Context, CustomerReviewInput, approval.Actor) (CustomerMutation, error)
	Reject(context.Context, CustomerReviewInput, approval.Actor) (CustomerMutation, error)
	Approve(context.Context, CustomerVersionInput, approval.Actor) (CustomerMutation, error)
	Unapprove(context.Context, CustomerReviewInput, approval.Actor) (CustomerMutation, error)
	Delete(context.Context, CustomerDeleteInput, approval.Actor) error
	Get(context.Context, CustomerGetInput, approval.Actor) (CustomerView, error)
	Query(context.Context, CustomerQueryInput, approval.Actor) (Page[CustomerQueryItem], error)
	Versions(context.Context, CustomerHistoryInput, approval.Actor) (Page[CustomerVersionView], error)
	AuditHistory(context.Context, CustomerHistoryInput, approval.Actor) (Page[approval.EventView], error)
}

type customerAttachmentApplicationService interface {
	Initiate(context.Context, CustomerAttachmentInitiateInput, approval.Actor) (CustomerAttachmentInitiateResult, error)
	CreateDownload(context.Context, CustomerAttachmentDownloadInput, string) (CustomerAttachmentDownloadResult, error)
	Remove(context.Context, CustomerAttachmentRemoveInput, approval.Actor) (CustomerAttachmentMutationResult, error)
	Upload(context.Context, string, io.Reader, int64, string) error
	OpenDownload(context.Context, string) (CustomerAttachmentDownloadFile, error)
}

// CustomerHandler exposes only DCL relationship declaration routes. Account
// approvals are a separate handler and subject under /dcl/customer-account.
type CustomerHandler struct {
	service     customerApplicationService
	attachments customerAttachmentApplicationService
	handlerSupport
}

func NewCustomerHandler(service customerApplicationService, attachments customerAttachmentApplicationService, authorizer authorization.Authorizer, logger *slog.Logger) *CustomerHandler {
	return &CustomerHandler{service: service, attachments: attachments, handlerSupport: newHandlerSupport(authorizer, logger)}
}

func (h *CustomerHandler) Register(router *gin.Engine) {
	group := router.Group("/dcl/" + EntityCustomer)
	routes := map[string]gin.HandlerFunc{
		"create": h.create, "save": h.save, "submit": h.submit, "unsubmit": h.unsubmit,
		"reject": h.reject, "approve": h.approve, "unapprove": h.unapprove, "delete": h.delete,
		"get": h.get, "query": h.query, "versions": h.versions, "audit-history": h.auditHistory,
	}
	for action, handle := range routes {
		path := "/dcl/" + EntityCustomer + "/" + action
		group.POST("/"+action, authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError), handle)
	}
	for action, handle := range map[string]gin.HandlerFunc{
		"attachment-initiate": h.attachmentInitiate,
		"attachment-download": h.attachmentDownload,
		"attachment-remove":   h.attachmentRemove,
	} {
		path := "/dcl/" + EntityCustomer + "/" + action
		group.POST("/"+action, authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError), handle)
	}
	router.PUT("/files/customer-attachments/upload/:token", h.attachmentUpload)
	router.GET("/files/customer-attachments/download/:token", h.attachmentFileDownload)
}

func (h *CustomerHandler) create(c *gin.Context) {
	var input CustomerCreateInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Create(c, input, actor) })
	}
}
func (h *CustomerHandler) save(c *gin.Context) {
	var input CustomerSaveInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Save(c, input, actor) })
	}
}
func (h *CustomerHandler) submit(c *gin.Context) {
	var input CustomerVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Submit(c, input, actor) })
	}
}
func (h *CustomerHandler) unsubmit(c *gin.Context) {
	var input CustomerReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unsubmit(c, input, actor) })
	}
}
func (h *CustomerHandler) reject(c *gin.Context) {
	var input CustomerReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Reject(c, input, actor) })
	}
}
func (h *CustomerHandler) approve(c *gin.Context) {
	var input CustomerVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Approve(c, input, actor) })
	}
}
func (h *CustomerHandler) unapprove(c *gin.Context) {
	var input CustomerReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unapprove(c, input, actor) })
	}
}
func (h *CustomerHandler) delete(c *gin.Context) {
	var input CustomerDeleteInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return nil, h.service.Delete(c, input, actor) })
	}
}
func (h *CustomerHandler) get(c *gin.Context) {
	var input CustomerGetInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Get(c, input, actor) })
	}
}
func (h *CustomerHandler) query(c *gin.Context) {
	var input CustomerQueryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Query(c, input, actor) })
	}
}
func (h *CustomerHandler) versions(c *gin.Context) {
	var input CustomerHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Versions(c, input, actor) })
	}
}
func (h *CustomerHandler) auditHistory(c *gin.Context) {
	var input CustomerHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.AuditHistory(c, input, actor) })
	}
}

func (h *CustomerHandler) attachmentInitiate(c *gin.Context) {
	var input CustomerAttachmentInitiateInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.attachments.Initiate(c, input, actor) })
	}
}

func (h *CustomerHandler) attachmentDownload(c *gin.Context) {
	var input CustomerAttachmentDownloadInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.attachments.CreateDownload(c, input, actor.ID()) })
	}
}

func (h *CustomerHandler) attachmentRemove(c *gin.Context) {
	var input CustomerAttachmentRemoveInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.attachments.Remove(c, input, actor) })
	}
}

func (h *CustomerHandler) attachmentUpload(c *gin.Context) {
	if h.attachments == nil {
		h.writeError(c, newError(ErrorInternal, "internal_error", "attachment service unavailable", nil, nil))
		return
	}
	if err := h.attachments.Upload(c, c.Param("token"), c.Request.Body, c.Request.ContentLength, c.GetHeader("Content-Type")); err != nil {
		h.writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *CustomerHandler) attachmentFileDownload(c *gin.Context) {
	if h.attachments == nil {
		h.writeError(c, newError(ErrorInternal, "internal_error", "attachment service unavailable", nil, nil))
		return
	}
	file, err := h.attachments.OpenDownload(c, c.Param("token"))
	if err != nil {
		h.writeError(c, err)
		return
	}
	defer file.Reader.Close()
	c.Header("Content-Type", file.ContentType)
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": file.FileName}))
	c.Header("Content-Length", strconv.FormatInt(file.Size, 10))
	c.Status(http.StatusOK)
	_, _ = io.Copy(c.Writer, file.Reader)
}
