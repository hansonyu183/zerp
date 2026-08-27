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
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type applicationService interface {
	partyOtherUnitApplicationService
	Query(context.Context, string, QueryInput) (Page[QueryItem], error)
	Get(context.Context, string, GetInput) (ObjectView, error)
	Create(context.Context, string, CreateInput, approval.Actor) (MutationResult, error)
	Save(context.Context, string, SaveInput, approval.Actor) (MutationResult, error)
	Delete(context.Context, string, DeleteInput, approval.Actor) error
	Submit(context.Context, string, VersionRevisionInput, approval.Actor) (MutationResult, error)
	Unsubmit(context.Context, string, ReverseInput, approval.Actor) (MutationResult, error)
	Approve(context.Context, string, ReviewInput, approval.Actor) (MutationResult, error)
	Unapprove(context.Context, string, ReverseInput, approval.Actor) (MutationResult, error)
	Reject(context.Context, string, ReviewInput, approval.Actor) (MutationResult, error)
	Enable(context.Context, string, ObjectRevisionInput, approval.Actor) (MutationResult, error)
	Disable(context.Context, string, ObjectRevisionInput, approval.Actor) (MutationResult, error)
	Versions(context.Context, string, HistoryInput) (Page[VersionHistoryItem], error)
	AuditHistory(context.Context, string, HistoryInput) (Page[AuditEventView], error)
	CustomerQuery(context.Context, QueryInput) (Page[CustomerListItem], error)
	CustomerGet(context.Context, GetInput) (CustomerDetailView, error)
	CustomerCreate(context.Context, CustomerCreateInput, approval.Actor, bool) (CustomerCreateResult, error)
	CustomerSave(context.Context, CustomerSaveInput, approval.Actor) (MutationResult, error)
	CustomerAccountAdd(context.Context, CustomerAccountAddInput, approval.Actor) (CustomerAccountView, error)
	CustomerAccountDelete(context.Context, DeleteInput, approval.Actor) error
	SupplierQuery(context.Context, QueryInput) (Page[SupplierListItem], error)
	SupplierGet(context.Context, GetInput) (SupplierDetailView, error)
	SupplierCreate(context.Context, SupplierCreateInput, approval.Actor, bool) (SupplierCreateResult, error)
	SupplierSave(context.Context, SupplierSaveInput, approval.Actor) (MutationResult, error)
	EmploymentCreate(context.Context, EmploymentCreateInput, approval.Actor, bool) (EmploymentCreateResult, error)
	SalesPartnerQuery(context.Context, QueryInput) (Page[SalesPartnerListItem], error)
	SalesPartnerGet(context.Context, GetInput) (SalesPartnerDetailView, error)
	SalesPartnerCreate(context.Context, SalesPartnerCreateInput, approval.Actor, bool) (SalesPartnerCreateResult, error)
	SalesPartnerSave(context.Context, SalesPartnerSaveInput, approval.Actor) (MutationResult, error)
	QueryReferenceCandidates(context.Context, ReferenceQueryInput) ([]ReferenceCandidate, error)
}

type partyOtherUnitApplicationService interface {
	PartyQuery(context.Context, QueryInput) (Page[PartyListItem], error)
	PartyGet(context.Context, PartyGetInput, PartyRelationshipVisibility) (PartyView, error)
	PartySave(context.Context, PartySaveInput, string, string) (PartyView, error)
	OtherUnitQuery(context.Context, QueryInput) (Page[OtherUnitView], error)
	OtherUnitGet(context.Context, GetInput) (OtherUnitView, error)
	OtherUnitCreate(context.Context, OtherUnitCreateInput, approval.Actor, bool) (OtherUnitCreateResult, error)
	OtherUnitSave(context.Context, OtherUnitSaveInput, approval.Actor) (MutationResult, error)
	OtherUnitVersions(context.Context, HistoryInput) (Page[VersionHistoryItem], error)
	PartyMergePreflight(context.Context, PartyMergePreflightInput, PartyRelationshipVisibility, string, string) (PartyMergePreflightResult, error)
	PartyMergeConfirm(context.Context, PartyMergeConfirmInput, PartyRelationshipVisibility, string, string) (PartyMergeResult, error)
}

type customerAttachmentApplicationService interface {
	Initiate(context.Context, CustomerAttachmentInitiateInput, approval.Actor) (CustomerAttachmentInitiateResult, error)
	CreateDownload(context.Context, CustomerAttachmentDownloadInput, string) (CustomerAttachmentDownloadResult, error)
	Remove(context.Context, CustomerAttachmentRemoveInput, approval.Actor) (CustomerAttachmentMutationResult, error)
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
			if (entity == EntityOperatingEntity || entity == EntityWarehouse || entity == EntityVehicle || entity == EntityFundAccount) && route.action != "query" && route.action != "get" {
				continue
			}
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
	partyGroup.POST("/save", h.authorize("/bob/party/save"), h.partySave)
	partyGroup.POST("/merge-preflight", h.authorize("/bob/party/merge-preflight"), h.partyMergePreflight)
	partyGroup.POST("/merge-confirm", h.authorize("/bob/party/merge-confirm"), h.partyMergeConfirm)
	otherUnitGroup := group.Group("/" + EntityOtherUnit)
	otherUnitGroup.POST("/query", h.authorize("/bob/other-unit/query"), h.otherUnitQuery)
	otherUnitGroup.POST("/get", h.authorize("/bob/other-unit/get"), h.otherUnitGet)
	otherUnitGroup.POST("/create", h.authorize("/bob/other-unit/create"), h.otherUnitCreate)
	otherUnitGroup.POST("/save", h.authorize("/bob/other-unit/save"), h.otherUnitSave)
	otherUnitGroup.POST("/versions", h.authorize("/bob/other-unit/versions"), h.otherUnitVersions)
	for _, route := range actionRoutes {
		if route.action == "query" || route.action == "get" || route.action == "create" || route.action == "save" || route.action == "versions" {
			continue
		}
		action, handle := route.action, route.handle
		path := "/bob/other-unit/" + action
		otherUnitGroup.POST("/"+action, h.authorize(path), func(c *gin.Context) {
			handle(h, c, EntityOtherUnit)
		})
	}
	group.POST("/customer/account-add", h.authorize("/bob/customer-account/create"), h.customerAccountAdd)
	group.POST("/customer/account-delete", h.authorize("/bob/customer-account/delete"), h.customerAccountDelete)
	customerAccountGroup := group.Group("/" + EntityCustomerAccount)
	for _, route := range actionRoutes {
		if route.action == "query" || route.action == "get" || route.action == "create" || route.action == "save" ||
			route.action == "delete" {
			continue
		}
		action, handle := route.action, route.handle
		path := "/bob/" + EntityCustomerAccount + "/" + action
		customerAccountGroup.POST("/"+action, h.authorize(path), func(c *gin.Context) {
			handle(h, c, EntityCustomerAccount)
		})
	}
	customerGroup := group.Group("/customer")
	customerGroup.POST("/attachment-initiate", h.authorize("/bob/customer/attachment-initiate"), h.customerAttachmentInitiate)
	customerGroup.POST("/attachment-download", h.authorize("/bob/customer/attachment-download"), h.customerAttachmentDownload)
	customerGroup.POST("/attachment-remove", h.authorize("/bob/customer/attachment-remove"), h.customerAttachmentRemove)
	referenceGroup := group.Group("/reference")
	referenceGroup.POST("/query", authmiddleware.RequireSession(h.authorizer, "/bob/reference/query", h.writeAuthorizationError), h.referenceQuery)
	router.PUT("/files/customer-attachments/upload/:token", h.customerAttachmentUpload)
	router.GET("/files/customer-attachments/download/:token", h.customerAttachmentFileDownload)
}

func (h *Handler) otherUnitVersions(c *gin.Context) {
	var input HistoryInput
	if h.bind(c, &input) {
		result, err := h.service.OtherUnitVersions(c.Request.Context(), input)
		h.result(c, result, err)
	}
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

func (h *Handler) partySave(c *gin.Context) {
	var input PartySaveInput
	if h.bind(c, &input) {
		result, err := h.service.PartySave(c.Request.Context(), input, h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) partyMergePreflight(c *gin.Context) {
	var input PartyMergePreflightInput
	if h.bind(c, &input) {
		result, err := h.service.PartyMergePreflight(c.Request.Context(), input,
			h.partyRelationshipVisibility(c), h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) partyMergeConfirm(c *gin.Context) {
	var input PartyMergeConfirmInput
	if h.bind(c, &input) {
		result, err := h.service.PartyMergeConfirm(c.Request.Context(), input,
			h.partyRelationshipVisibility(c), h.actorID(c), response.RequestID(c))
		h.result(c, result, err)
	}
}

func (h *Handler) partyRelationshipVisibility(c *gin.Context) PartyRelationshipVisibility {
	principal := h.principal(c)
	return PartyRelationshipVisibility{
		Customer: hasPermission(principal, "/bob/customer/get"), Supplier: hasPermission(principal, "/bob/supplier/get"),
		Employment: hasPermission(principal, "/bob/employee/get"), OtherUnit: hasPermission(principal, "/bob/other-unit/get"),
		SalesPartner: hasPermission(principal, "/bob/sales-partner/get"),
	}
}

func (h *Handler) otherUnitQuery(c *gin.Context) {
	var input QueryInput
	if h.bind(c, &input) {
		result, err := h.service.OtherUnitQuery(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) otherUnitGet(c *gin.Context) {
	var input GetInput
	if h.bind(c, &input) {
		result, err := h.service.OtherUnitGet(c.Request.Context(), input)
		h.result(c, result, err)
	}
}

func (h *Handler) otherUnitCreate(c *gin.Context) {
	var input OtherUnitCreateInput
	if !h.bind(c, &input) {
		return
	}
	requiredPartyPath := "/bob/party/get"
	if input.NewParty != nil {
		requiredPartyPath = "/bob/party/create"
	}
	if !authmiddleware.CheckPermission(c, h.authorizer, requiredPartyPath, h.writeAuthorizationError) {
		return
	}
	actor, ok := h.approvalActor(c)
	if !ok {
		return
	}
	result, err := h.service.OtherUnitCreate(c.Request.Context(), input, actor,
		hasPermission(h.principal(c), "/bob/party/get"))
	h.result(c, result, err)
}

func (h *Handler) otherUnitSave(c *gin.Context) {
	var input OtherUnitSaveInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.OtherUnitSave(c.Request.Context(), input, actor)
		h.result(c, result, err)
	}
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

func (h *Handler) approvalActor(c *gin.Context) (approval.Actor, bool) {
	actor, err := approval.UserActor(h.principal(c), response.RequestID(c))
	if err != nil {
		h.result(c, nil, err)
		return approval.Actor{}, false
	}
	return actor, true
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
		if entity == EntitySalesPartner {
			result, err := h.service.SalesPartnerQuery(c.Request.Context(), input)
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
		if entity == EntitySalesPartner {
			result, err := h.service.SalesPartnerGet(c.Request.Context(), input)
			h.result(c, result, err)
			return
		}
		result, err := h.service.Get(c.Request.Context(), entity, input)
		h.result(c, result, err)
	}
}

func (h *Handler) customerAttachmentInitiate(c *gin.Context) {
	var input CustomerAttachmentInitiateInput
	if !h.bind(c, &input) {
		return
	}
	actor, ok := h.approvalActor(c)
	if !ok {
		return
	}
	result, err := h.attachments.Initiate(c.Request.Context(), input, actor)
	h.result(c, result, err)
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
	if !h.bind(c, &input) {
		return
	}
	actor, ok := h.approvalActor(c)
	if !ok {
		return
	}
	result, err := h.attachments.Remove(c.Request.Context(), input, actor)
	h.result(c, result, err)
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
		if !h.bind(c, &input) {
			return
		}
		requiredPartyPath := "/bob/party/get"
		if input.NewParty != nil {
			requiredPartyPath = "/bob/party/create"
		}
		if !authmiddleware.CheckPermission(c, h.authorizer, requiredPartyPath, h.writeAuthorizationError) {
			return
		}
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.CustomerCreate(c.Request.Context(), input, actor, hasPermission(h.principal(c), "/bob/party/get"))
		h.result(c, result, err)
		return
	}
	if entity == EntitySupplier {
		var input SupplierCreateInput
		if !h.bind(c, &input) {
			return
		}
		requiredPartyPath := "/bob/party/get"
		if input.NewParty != nil {
			requiredPartyPath = "/bob/party/create"
		}
		if !authmiddleware.CheckPermission(c, h.authorizer, requiredPartyPath, h.writeAuthorizationError) {
			return
		}
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.SupplierCreate(c.Request.Context(), input, actor,
			hasPermission(h.principal(c), "/bob/party/get"))
		h.result(c, result, err)
		return
	}
	if entity == EntityEmployee {
		var input EmploymentCreateInput
		if !h.bind(c, &input) {
			return
		}
		requiredPartyPath := "/bob/party/get"
		if input.NewParty != nil {
			requiredPartyPath = "/bob/party/create"
		}
		if !authmiddleware.CheckPermission(c, h.authorizer, requiredPartyPath, h.writeAuthorizationError) {
			return
		}
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.EmploymentCreate(c.Request.Context(), input, actor,
			hasPermission(h.principal(c), "/bob/party/get"))
		h.result(c, result, err)
		return
	}
	if entity == EntitySalesPartner {
		var input SalesPartnerCreateInput
		if !h.bind(c, &input) {
			return
		}
		requiredPartyPath := "/bob/party/get"
		if input.NewParty != nil {
			requiredPartyPath = "/bob/party/create"
		}
		if !authmiddleware.CheckPermission(c, h.authorizer, requiredPartyPath, h.writeAuthorizationError) {
			return
		}
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.SalesPartnerCreate(c.Request.Context(), input, actor,
			hasPermission(h.principal(c), "/bob/party/get"))
		h.result(c, result, err)
		return
	}
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

func (h *Handler) customerAccountDelete(c *gin.Context) {
	var input DeleteInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		h.result(c, nil, h.service.CustomerAccountDelete(c.Request.Context(), input, actor))
	}
}

func (h *Handler) customerAccountAdd(c *gin.Context) {
	var input CustomerAccountAddInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.CustomerAccountAdd(c.Request.Context(), input, actor)
		h.result(c, result, err)
	}
}

func (h *Handler) save(c *gin.Context, entity string) {
	if entity == EntityCustomer {
		var input CustomerSaveInput
		if h.bind(c, &input) {
			actor, ok := h.approvalActor(c)
			if !ok {
				return
			}
			result, err := h.service.CustomerSave(c.Request.Context(), input, actor)
			h.result(c, result, err)
		}
		return
	}
	if entity == EntitySupplier {
		var input SupplierSaveInput
		if h.bind(c, &input) {
			actor, ok := h.approvalActor(c)
			if !ok {
				return
			}
			result, err := h.service.SupplierSave(c.Request.Context(), input, actor)
			h.result(c, result, err)
		}
		return
	}
	if entity == EntitySalesPartner {
		var input SalesPartnerSaveInput
		if h.bind(c, &input) {
			actor, ok := h.approvalActor(c)
			if !ok {
				return
			}
			result, err := h.service.SalesPartnerSave(c.Request.Context(), input, actor)
			h.result(c, result, err)
		}
		return
	}
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

func (h *Handler) delete(c *gin.Context, entity string) {
	var input DeleteInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		err := h.service.Delete(c.Request.Context(), entity, input, actor)
		h.result(c, nil, err)
	}
}

func (h *Handler) submit(c *gin.Context, entity string) {
	var input VersionRevisionInput
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
	var input ReverseInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.Unsubmit(c.Request.Context(), entity, input, actor)
		h.result(c, result, err)
	}
}

func (h *Handler) approve(c *gin.Context, entity string) {
	var input ReviewInput
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

func (h *Handler) reject(c *gin.Context, entity string) {
	var input ReviewInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.Reject(c.Request.Context(), entity, input, actor)
		h.result(c, result, err)
	}
}

func (h *Handler) enable(c *gin.Context, entity string) {
	var input ObjectRevisionInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.Enable(c.Request.Context(), entity, input, actor)
		h.result(c, result, err)
	}
}

func (h *Handler) disable(c *gin.Context, entity string) {
	var input ObjectRevisionInput
	if h.bind(c, &input) {
		actor, ok := h.approvalActor(c)
		if !ok {
			return
		}
		result, err := h.service.Disable(c.Request.Context(), entity, input, actor)
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
