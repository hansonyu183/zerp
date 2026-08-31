package vou

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/api/requestbody"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type applicationService interface {
	Query(context.Context, string, QueryInput) (Page[ListItem], error)
	Get(context.Context, string, GetInput) (DocumentView, error)
	FormulaDefault(context.Context, FormulaDefaultInput) (FormulaDefaultView, error)
	PriceReference(context.Context, string, PriceReferenceInput) (PriceReferenceView, error)
	Create(context.Context, string, CreateInput, approval.Actor) (MutationResult, error)
	Save(context.Context, string, SaveInput, approval.Actor) (MutationResult, error)
	Submit(context.Context, string, DocumentRevisionInput, approval.Actor) (MutationResult, error)
	Unsubmit(context.Context, string, DocumentRevisionInput, approval.Actor) (MutationResult, error)
	Reject(context.Context, string, ReverseInput, approval.Actor) (MutationResult, error)
	Approve(context.Context, string, DocumentRevisionInput, approval.Actor) (MutationResult, error)
	Unapprove(context.Context, string, ReverseInput, approval.Actor) (MutationResult, error)
	Delete(context.Context, string, DeleteInput, approval.Actor) (MutationResult, error)
	AuditHistory(context.Context, string, HistoryInput) (Page[AuditEventView], error)
	InventoryCountBookBalance(context.Context, InventoryCountBalanceInput) (Page[InventoryCountBalanceItem], error)
	AvailableBills(context.Context, AvailableBillQueryInput) (Page[AvailableBillItem], error)
	AvailableAssets(context.Context, AvailableAssetQueryInput) (Page[AvailableAssetItem], error)
	InitiateAttachment(context.Context, string, AttachmentInitiateInput, approval.Actor) (AttachmentInitiateResult, error)
	CreateDownload(context.Context, string, AttachmentDownloadInput, string) (AttachmentDownloadResult, error)
	RemoveAttachment(context.Context, string, AttachmentRemoveInput, approval.Actor) (MutationResult, error)
	Upload(context.Context, string, io.Reader, int64, string, string) error
	OpenDownload(context.Context, string) (DownloadFile, error)
	IntermediarySource(context.Context, IntermediarySourceInput) (IntermediarySourceView, error)
	GetIntermediaryScript(context.Context) (IntermediaryScriptSnapshot, error)
	SaveIntermediaryScript(context.Context, IntermediaryScriptSaveInput, string) (IntermediaryScriptSnapshot, error)
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
	{action: "book-balance", handle: (*Handler).inventoryCountBookBalance},
	{action: "bill-source", handle: (*Handler).availableBills},
	{action: "asset-source", handle: (*Handler).availableAssets},
	{action: "formula-default", handle: (*Handler).formulaDefault},
	{action: "price-reference", handle: (*Handler).priceReference},
	{action: "create", handle: (*Handler).create},
	{action: "save", handle: (*Handler).save},
	{action: "submit", handle: (*Handler).submit},
	{action: "unsubmit", handle: (*Handler).unsubmit},
	{action: "reject", handle: (*Handler).reject},
	{action: "approve", handle: (*Handler).approve},
	{action: "unapprove", handle: (*Handler).unapprove},
	{action: "delete", handle: (*Handler).delete},
	{action: "audit-history", handle: (*Handler).auditHistory},
	{action: "attachment-initiate", handle: (*Handler).attachmentInitiate},
	{action: "attachment-download", handle: (*Handler).attachmentDownload},
	{action: "attachment-remove", handle: (*Handler).attachmentRemove},
	{action: "source", handle: (*Handler).intermediarySource},
	{action: "script-get", handle: (*Handler).intermediaryScriptGet},
	{action: "script-save", handle: (*Handler).intermediaryScriptSave},
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
			if route.action == "create" && !publicCreateEntity(entity) {
				continue
			}
			if route.action == "formula-default" &&
				entity != EntitySaleOrder &&
				entity != EntitySelfProduction {
				continue
			}
			if route.action == "price-reference" && entity != EntitySaleOrder && entity != EntityPurchaseOrder {
				continue
			}
			if route.action == "book-balance" && entity != EntityInventoryCount {
				continue
			}
			if route.action == "bill-source" && entity != EntityBillReceipt &&
				entity != EntityBillPayment &&
				entity != EntityBillDiscount && entity != EntityBillMaturity {
				continue
			}
			if route.action == "asset-source" && entity != EntityAssetSale && entity != EntityAssetLiquidation {
				continue
			}
			if (route.action == "source" || route.action == "script-get" || route.action == "script-save") &&
				entity != EntityIntermediaryCalculation {
				continue
			}
			action := route.action
			handle := route.handle
			path := "/vou/" + entity + "/" + action
			permissionPath := path
			if action == "bill-source" || action == "asset-source" {
				permissionPath = "/vou/" + entity + "/query"
			}
			entityGroup.POST("/"+action, h.authorize(permissionPath), func(c *gin.Context) {
				handle(h, c, entity)
			})
		}
	}
	router.PUT("/files/attachments/upload/:token", h.upload)
	router.GET("/files/attachments/download/:token", h.download)
}

func (h *Handler) intermediarySource(c *gin.Context, entity string) {
	if entity != EntityIntermediaryCalculation {
		h.result(c, IntermediarySourceView{}, domainError(ErrorValidation, "invalid entity", nil, nil))
		return
	}
	var input IntermediarySourceInput
	if h.bind(c, &input) {
		result, err := h.service.IntermediarySource(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) intermediaryScriptGet(c *gin.Context, entity string) {
	if entity != EntityIntermediaryCalculation {
		h.result(c, IntermediaryScriptSnapshot{}, domainError(ErrorValidation, "invalid entity", nil, nil))
		return
	}
	var input struct{}
	if h.bind(c, &input) {
		result, err := h.service.GetIntermediaryScript(c.Request.Context())
		h.result(c, result, err)
	}
}

func (h *Handler) intermediaryScriptSave(c *gin.Context, entity string) {
	if entity != EntityIntermediaryCalculation {
		h.result(c, IntermediaryScriptSnapshot{}, domainError(ErrorValidation, "invalid entity", nil, nil))
		return
	}
	var input IntermediaryScriptSaveInput
	if h.bind(c, &input) {
		result, err := h.service.SaveIntermediaryScript(c.Request.Context(), input, h.actorID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) inventoryCountBookBalance(c *gin.Context, entity string) {
	if entity != EntityInventoryCount {
		h.result(c, Page[InventoryCountBalanceItem]{}, domainError(ErrorValidation, "invalid entity", nil, nil))
		return
	}
	var input InventoryCountBalanceInput
	if h.bind(c, &input) {
		result, err := h.service.InventoryCountBookBalance(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) availableBills(c *gin.Context, _ string) {
	var input AvailableBillQueryInput
	if h.bind(c, &input) {
		result, err := h.service.AvailableBills(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) availableAssets(c *gin.Context, _ string) {
	var input AvailableAssetQueryInput
	if h.bind(c, &input) {
		result, err := h.service.AvailableAssets(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) priceReference(c *gin.Context, entity string) {
	var input PriceReferenceInput
	if h.bind(c, &input) {
		result, err := h.service.PriceReference(c.Request.Context(), entity, input)
		h.result(c, result, err)
	}
}

func (h *Handler) formulaDefault(c *gin.Context, entity string) {
	if entity != EntitySaleOrder && entity != EntitySelfProduction {
		h.result(c, FormulaDefaultView{}, domainError(ErrorValidation, "invalid entity", nil, nil))
		return
	}
	var input FormulaDefaultInput
	if h.bind(c, &input) {
		result, err := h.service.FormulaDefault(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) authorize(path string) gin.HandlerFunc {
	return authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError)
}

func (h *Handler) query(c *gin.Context, entity string) {
	var input QueryInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		input.actor = actor
		result, err := h.service.Query(c.Request.Context(), entity, input)
		h.result(c, result, err)
	}
}

func (h *Handler) get(c *gin.Context, entity string) {
	var input GetInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		input.actor = actor
		result, err := h.service.Get(c.Request.Context(), entity, input)
		h.result(c, result, err)
	}
}

func (h *Handler) create(c *gin.Context, entity string) {
	var input CreateInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.Create(c.Request.Context(), entity, input, actor)
		h.result(c, result, err)
	}
}

func (h *Handler) save(c *gin.Context, entity string) {
	var input SaveInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.Save(c.Request.Context(), entity, input, actor)
		h.result(c, result, err)
	}
}

func (h *Handler) submit(c *gin.Context, entity string) {
	var input DocumentRevisionInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.Submit(c.Request.Context(), entity, input, actor)
		h.result(c, result, err)
	}
}

func (h *Handler) unsubmit(c *gin.Context, entity string) {
	var input DocumentRevisionInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.Unsubmit(c.Request.Context(), entity, input, actor)
		h.result(c, result, err)
	}
}

func (h *Handler) reject(c *gin.Context, entity string) {
	var input ReverseInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.Reject(c.Request.Context(), entity, input, actor)
		h.result(c, result, err)
	}
}

func (h *Handler) approve(c *gin.Context, entity string) {
	var input DocumentRevisionInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.Approve(c.Request.Context(), entity, input, actor)
		h.result(c, result, err)
	}
}

func (h *Handler) unapprove(c *gin.Context, entity string) {
	var input ReverseInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.Unapprove(c.Request.Context(), entity, input, actor)
		h.result(c, result, err)
	}
}

func (h *Handler) delete(c *gin.Context, entity string) {
	var input DeleteInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.Delete(c.Request.Context(), entity, input, actor)
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
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.InitiateAttachment(c.Request.Context(), entity, input, actor)
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
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.RemoveAttachment(c.Request.Context(), entity, input, actor)
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

func (h *Handler) approvalActor(c *gin.Context) (approval.Actor, bool) {
	actor, err := approval.UserActor(h.principal(c), response.RequestID(c))
	if err != nil {
		h.writeError(c, mapApprovalError(err))
		return approval.Actor{}, false
	}
	return actor, true
}

func (h *Handler) principal(c *gin.Context) authorization.Principal {
	return authmiddleware.Principal(c)
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
	case ErrorForbidden:
		code = response.CodeForbidden
	}
	if domainErr.Kind == ErrorInternal {
		h.logger.Error("vou handler failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", domainErr.Cause)
	}
	errorKey := domainErr.ErrorKey
	if errorKey == "" {
		errorKey = response.ErrorKeyForCode(code)
	}
	response.BusinessError(c, code, errorKey, domainErr.Message, domainErr.Data)
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
