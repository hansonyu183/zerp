package bob

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
)

const principalContextKey = "bobPrincipal"

type applicationService interface {
	Query(context.Context, string, QueryInput) (Page[QueryItem], error)
	Get(context.Context, string, GetInput) (ObjectView, error)
	Create(context.Context, string, CreateInput, string, string) (MutationResult, error)
	Save(context.Context, string, SaveInput, string, string) (MutationResult, error)
	Delete(context.Context, string, DeleteInput) error
	Submit(context.Context, string, VersionRevisionInput, string, string) (MutationResult, error)
	Unsubmit(context.Context, string, ReverseInput, string, string) (MutationResult, error)
	Approve(context.Context, string, ReviewInput, string, string) (MutationResult, error)
	Unapprove(context.Context, string, ReverseInput, string, string) (MutationResult, error)
	Reject(context.Context, string, ReviewInput, string, string) (MutationResult, error)
	Enable(context.Context, string, ObjectRevisionInput, string, string) (MutationResult, error)
	Disable(context.Context, string, ObjectRevisionInput, string, string) (MutationResult, error)
	Versions(context.Context, string, HistoryInput) (Page[VersionHistoryItem], error)
	AuditHistory(context.Context, string, HistoryInput) (Page[AuditEventView], error)
	CustomerQuery(context.Context, QueryInput) (Page[CustomerListItem], error)
	CustomerGet(context.Context, GetInput) (CustomerDetailView, error)
	CustomerCreate(context.Context, CustomerCreateInput, string, string) (CustomerCreateResult, error)
	CustomerSave(context.Context, CustomerSaveInput, string, string) (MutationResult, error)
	SupplierQuery(context.Context, QueryInput) (Page[SupplierListItem], error)
	SupplierGet(context.Context, GetInput) (SupplierDetailView, error)
	SupplierCreate(context.Context, SupplierCreateInput, string, string) (MutationResult, error)
	SupplierSave(context.Context, SupplierSaveInput, string, string) (MutationResult, error)
	CustomerGroupGet(context.Context, string) (CustomerGroupView, error)
	CustomerGroupSave(context.Context, CustomerGroupSaveInput, string, string) (CustomerGroupView, error)
	CustomerGroupAuditHistory(context.Context, HistoryInput) (Page[AuditEventView], error)
	TransferReferences(context.Context, ReferenceTransferInput, string, string) (ReferenceTransferResult, error)
	QueryReferenceCandidates(context.Context, ReferenceQueryInput) ([]ReferenceCandidate, error)
	CustomerTaxMatches(context.Context, CustomerTaxMatchInput) ([]CustomerTaxMatch, error)
	SupplierTaxMatches(context.Context, SupplierTaxMatchInput) ([]SupplierTaxMatch, error)
}

type customerAttachmentApplicationService interface {
	Initiate(context.Context, CustomerAttachmentInitiateInput, string, string) (CustomerAttachmentInitiateResult, error)
	CreateDownload(context.Context, CustomerAttachmentDownloadInput, string) (CustomerAttachmentDownloadResult, error)
	Remove(context.Context, CustomerAttachmentRemoveInput, string, string) (CustomerAttachmentMutationResult, error)
	Upload(context.Context, string, io.Reader, int64, string) error
	OpenDownload(context.Context, string) (CustomerAttachmentDownloadFile, error)
	EnrichDetail(context.Context, *CustomerDetailView) error
}

type Handler struct {
	service     applicationService
	attachments customerAttachmentApplicationService
	authorizer  authorization.Authorizer
	logger      *slog.Logger
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
	{action: "delete", handle: (*Handler).delete},
	{action: "submit", handle: (*Handler).submit},
	{action: "unsubmit", handle: (*Handler).unsubmit},
	{action: "approve", handle: (*Handler).approve},
	{action: "unapprove", handle: (*Handler).unapprove},
	{action: "reject", handle: (*Handler).reject},
	{action: "enable", handle: (*Handler).enable},
	{action: "disable", handle: (*Handler).disable},
	{action: "versions", handle: (*Handler).versions},
	{action: "audit-history", handle: (*Handler).auditHistory},
}

func NewHandler(
	service applicationService,
	attachments customerAttachmentApplicationService,
	authorizer authorization.Authorizer,
	logger *slog.Logger,
) *Handler {
	if authorizer == nil {
		authorizer = authorization.FailClosed{}
	}
	return &Handler{service: service, attachments: attachments, authorizer: authorizer, logger: logger}
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
	groupGroup := group.Group("/customer-group")
	groupGroup.POST("/get", h.authorize("/bob/customer-group/get"), h.customerGroupGet)
	groupGroup.POST("/save", h.authorize("/bob/customer-group/save"), h.customerGroupSave)
	groupGroup.POST("/audit-history", h.authorize("/bob/customer-group/audit-history"), h.customerGroupAuditHistory)
	group.POST("/customer/tax-match", h.customerTaxMatch)
	group.POST("/supplier/tax-match", h.supplierTaxMatch)
	customerGroup := group.Group("/customer")
	customerGroup.POST("/attachment-initiate", h.authorize("/bob/customer/attachment-initiate"), h.customerAttachmentInitiate)
	customerGroup.POST("/attachment-download", h.authorize("/bob/customer/attachment-download"), h.customerAttachmentDownload)
	customerGroup.POST("/attachment-remove", h.authorize("/bob/customer/attachment-remove"), h.customerAttachmentRemove)
	referenceGroup := group.Group("/reference")
	referenceGroup.POST("/query", h.referenceQuery)
	referenceGroup.POST("/transfer", h.authorize("/bob/reference/transfer"), h.referenceTransfer)
	router.PUT("/files/customer-attachments/upload/:token", h.customerAttachmentUpload)
	router.GET("/files/customer-attachments/download/:token", h.customerAttachmentFileDownload)
}

func (h *Handler) customerTaxMatch(c *gin.Context) {
	var request struct {
		TaxNumber string `json:"taxNumber"`
	}
	if !h.bind(c, &request) {
		return
	}
	principal, err := h.authorizer.Authorize(c.Request.Context(), c.Request, "/bob/customer/create", response.RequestID(c))
	if err != nil {
		h.writeAuthorizationError(c, err)
		return
	}
	has := func(path string) bool {
		for _, permission := range principal.Permissions {
			if permission == path {
				return true
			}
		}
		return false
	}
	result, err := h.service.CustomerTaxMatches(c.Request.Context(), CustomerTaxMatchInput{TaxNumber: request.TaxNumber,
		IncludeCustomer: has("/bob/customer/get"), IncludeSupplier: has("/bob/supplier/get"),
		IncludeOtherParty: has("/bob/other-party/get")})
	h.result(c, result, err)
}

func (h *Handler) supplierTaxMatch(c *gin.Context) {
	var request struct {
		TaxNumber string `json:"taxNumber"`
	}
	if !h.bind(c, &request) {
		return
	}
	principal, err := h.authorizer.Authorize(c.Request.Context(), c.Request, "/bob/supplier/create", response.RequestID(c))
	if err != nil {
		h.writeAuthorizationError(c, err)
		return
	}
	has := func(path string) bool {
		for _, permission := range principal.Permissions {
			if permission == path {
				return true
			}
		}
		return false
	}
	result, err := h.service.SupplierTaxMatches(c.Request.Context(), SupplierTaxMatchInput{TaxNumber: request.TaxNumber,
		IncludeCustomer: has("/bob/customer-group/get"), IncludeOtherParty: has("/bob/other-party/get")})
	h.result(c, result, err)
}

func (h *Handler) referenceQuery(c *gin.Context) {
	var input ReferenceQueryInput
	if !h.bind(c, &input) {
		return
	}
	if _, err := h.authorizer.Authorize(c.Request.Context(), c.Request, "/bob/"+input.Entity+"/query", response.RequestID(c)); err != nil {
		h.writeAuthorizationError(c, err)
		return
	}
	result, err := h.service.QueryReferenceCandidates(c.Request.Context(), input)
	h.result(c, result, err)
}

func (h *Handler) authorize(path string) gin.HandlerFunc {
	return authmiddleware.Require(h.authorizer, path, principalContextKey, h.writeAuthorizationError)
}

func (h *Handler) query(c *gin.Context, entity string) {
	var input QueryInput
	if h.bind(c, &input) {
		if entity == EntityCustomer {
			result, err := h.service.CustomerQuery(c.Request.Context(), input)
			h.result(c, result, err)
			return
		}
		if entity == EntitySupplier {
			result, err := h.service.SupplierQuery(c.Request.Context(), input)
			h.result(c, result, err)
			return
		}
		result, err := h.service.Query(c.Request.Context(), entity, input)
		h.result(c, result, err)
	}
}

func (h *Handler) get(c *gin.Context, entity string) {
	var input GetInput
	if h.bind(c, &input) {
		if entity == EntityCustomer {
			result, err := h.service.CustomerGet(c.Request.Context(), input)
			if err == nil && h.attachments != nil {
				err = h.attachments.EnrichDetail(c.Request.Context(), &result)
			}
			h.result(c, result, err)
			return
		}
		if entity == EntitySupplier {
			result, err := h.service.SupplierGet(c.Request.Context(), input)
			h.result(c, result, err)
			return
		}
		result, err := h.service.Get(c.Request.Context(), entity, input)
		h.result(c, result, err)
	}
}

func (h *Handler) customerAttachmentInitiate(c *gin.Context) {
	var input CustomerAttachmentInitiateInput
	if h.bind(c, &input) {
		result, err := h.attachments.Initiate(c.Request.Context(), input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) customerAttachmentDownload(c *gin.Context) {
	var input CustomerAttachmentDownloadInput
	if h.bind(c, &input) {
		result, err := h.attachments.CreateDownload(c.Request.Context(), input, h.actorID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) customerAttachmentRemove(c *gin.Context) {
	var input CustomerAttachmentRemoveInput
	if h.bind(c, &input) {
		result, err := h.attachments.Remove(c.Request.Context(), input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) customerAttachmentUpload(c *gin.Context) {
	err := h.attachments.Upload(c.Request.Context(), c.Param("token"), c.Request.Body, c.Request.ContentLength, c.GetHeader("Content-Type"))
	if err != nil {
		h.writeFileError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) customerAttachmentFileDownload(c *gin.Context) {
	file, err := h.attachments.OpenDownload(c.Request.Context(), c.Param("token"))
	if err != nil {
		h.writeFileError(c, err)
		return
	}
	defer file.Reader.Close()
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": file.FileName}))
	c.Header("Content-Type", file.ContentType)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, no-store")
	c.Status(http.StatusOK)
	if _, err = io.Copy(c.Writer, file.Reader); err != nil {
		h.logger.Warn("customer attachment download interrupted", "requestId", response.RequestID(c), "error", err)
	}
}

func (h *Handler) create(c *gin.Context, entity string) {
	if entity == EntityCustomer {
		var input CustomerCreateInput
		if h.bind(c, &input) {
			result, err := h.service.CustomerCreate(c.Request.Context(), input, h.actorID(c), response.RequestID(c))
			h.result(c, result, err)
		}
		return
	}
	if entity == EntitySupplier {
		var input SupplierCreateInput
		if h.bind(c, &input) {
			result, err := h.service.SupplierCreate(c.Request.Context(), input, h.actorID(c), response.RequestID(c))
			h.result(c, result, err)
		}
		return
	}
	var input CreateInput
	if h.bind(c, &input) {
		result, err := h.service.Create(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) customerGroupGet(c *gin.Context) {
	var input struct {
		ID string `json:"id"`
	}
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.CustomerGroupGet(c.Request.Context(), input.ID)
	h.result(c, result, err)
}

func (h *Handler) customerGroupSave(c *gin.Context) {
	var input CustomerGroupSaveInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.CustomerGroupSave(c.Request.Context(), input, h.actorID(c), response.RequestID(c))
	h.result(c, result, err)
}

func (h *Handler) customerGroupAuditHistory(c *gin.Context) {
	var input HistoryInput
	if !h.bind(c, &input) {
		return
	}
	result, err := h.service.CustomerGroupAuditHistory(c.Request.Context(), input)
	h.result(c, result, err)
}

func (h *Handler) referenceTransfer(c *gin.Context) {
	var input ReferenceTransferInput
	if !h.bind(c, &input) {
		return
	}
	if _, err := h.authorizer.Authorize(
		c.Request.Context(), c.Request, "/bob/"+input.Entity+"/disable", response.RequestID(c),
	); err != nil {
		h.writeAuthorizationError(c, err)
		return
	}
	result, err := h.service.TransferReferences(c.Request.Context(), input, h.actorID(c), response.RequestID(c))
	h.result(c, result, err)
}

func (h *Handler) save(c *gin.Context, entity string) {
	if entity == EntityCustomer {
		var input CustomerSaveInput
		if h.bind(c, &input) {
			result, err := h.service.CustomerSave(c.Request.Context(), input, h.actorID(c), response.RequestID(c))
			h.result(c, result, err)
		}
		return
	}
	if entity == EntitySupplier {
		var input SupplierSaveInput
		if h.bind(c, &input) {
			result, err := h.service.SupplierSave(c.Request.Context(), input, h.actorID(c), response.RequestID(c))
			h.result(c, result, err)
		}
		return
	}
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

func (h *Handler) unsubmit(c *gin.Context, entity string) {
	var input ReverseInput
	if h.bind(c, &input) {
		result, err := h.service.Unsubmit(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
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

func (h *Handler) unapprove(c *gin.Context, entity string) {
	var input ReverseInput
	if h.bind(c, &input) {
		result, err := h.service.Unapprove(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
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

func (h *Handler) enable(c *gin.Context, entity string) {
	var input ObjectRevisionInput
	if h.bind(c, &input) {
		result, err := h.service.Enable(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) disable(c *gin.Context, entity string) {
	var input ObjectRevisionInput
	if h.bind(c, &input) {
		result, err := h.service.Disable(c.Request.Context(), entity, input, h.actorID(c), response.RequestID(c))
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
		h.logger.Error("bob file endpoint failure", "requestId", response.RequestID(c), "path", c.FullPath(), "error", domainErr.Cause)
	}
	c.JSON(status, gin.H{"error": domainErr.Message, "requestId": response.RequestID(c)})
}
