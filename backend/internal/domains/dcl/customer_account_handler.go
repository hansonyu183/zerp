package dcl

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type customerAccountApplicationService interface {
	Create(context.Context, CustomerAccountCreateInput, approval.Actor) (CustomerAccountMutation, error)
	Save(context.Context, CustomerAccountSaveInput, approval.Actor) (CustomerAccountMutation, error)
	Submit(context.Context, CustomerAccountVersionInput, approval.Actor) (CustomerAccountMutation, error)
	Unsubmit(context.Context, CustomerAccountReviewInput, approval.Actor) (CustomerAccountMutation, error)
	Reject(context.Context, CustomerAccountReviewInput, approval.Actor) (CustomerAccountMutation, error)
	Approve(context.Context, CustomerAccountVersionInput, approval.Actor) (CustomerAccountMutation, error)
	Unapprove(context.Context, CustomerAccountReviewInput, approval.Actor) (CustomerAccountMutation, error)
	Delete(context.Context, CustomerAccountDeleteInput, approval.Actor) error
	Get(context.Context, CustomerAccountGetInput, approval.Actor) (CustomerAccountView, error)
	Query(context.Context, CustomerAccountQueryInput, approval.Actor) (Page[CustomerAccountQueryItem], error)
	Versions(context.Context, CustomerAccountHistoryInput, approval.Actor) (Page[CustomerAccountVersionView], error)
	AuditHistory(context.Context, CustomerAccountHistoryInput, approval.Actor) (Page[approval.EventView], error)
}

// CustomerAccountHandler exposes the independent DCL customer-account
// approval subject. Attachment metadata remains under /dcl/customer and uses
// its explicit scope to select account versions.
type CustomerAccountHandler struct {
	service customerAccountApplicationService
	handlerSupport
}

func NewCustomerAccountHandler(service customerAccountApplicationService, authorizer authorization.Authorizer, logger *slog.Logger) *CustomerAccountHandler {
	return &CustomerAccountHandler{service: service, handlerSupport: newHandlerSupport(authorizer, logger)}
}

func (h *CustomerAccountHandler) Register(router *gin.Engine) {
	group := router.Group("/dcl/" + EntityCustomerAccount)
	routes := map[string]gin.HandlerFunc{
		"create": h.create, "save": h.save, "submit": h.submit, "unsubmit": h.unsubmit,
		"reject": h.reject, "approve": h.approve, "unapprove": h.unapprove, "delete": h.delete,
		"get": h.get, "query": h.query, "versions": h.versions, "audit-history": h.auditHistory,
	}
	for action, handle := range routes {
		path := "/dcl/" + EntityCustomerAccount + "/" + action
		group.POST("/"+action, authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError), handle)
	}
}

func (h *CustomerAccountHandler) create(c *gin.Context) {
	var input CustomerAccountCreateInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Create(c, input, actor) })
	}
}
func (h *CustomerAccountHandler) save(c *gin.Context) {
	var input CustomerAccountSaveInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Save(c, input, actor) })
	}
}
func (h *CustomerAccountHandler) submit(c *gin.Context) {
	var input CustomerAccountVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Submit(c, input, actor) })
	}
}
func (h *CustomerAccountHandler) unsubmit(c *gin.Context) {
	var input CustomerAccountReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unsubmit(c, input, actor) })
	}
}
func (h *CustomerAccountHandler) reject(c *gin.Context) {
	var input CustomerAccountReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Reject(c, input, actor) })
	}
}
func (h *CustomerAccountHandler) approve(c *gin.Context) {
	var input CustomerAccountVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Approve(c, input, actor) })
	}
}
func (h *CustomerAccountHandler) unapprove(c *gin.Context) {
	var input CustomerAccountReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unapprove(c, input, actor) })
	}
}
func (h *CustomerAccountHandler) delete(c *gin.Context) {
	var input CustomerAccountDeleteInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return nil, h.service.Delete(c, input, actor) })
	}
}
func (h *CustomerAccountHandler) get(c *gin.Context) {
	var input CustomerAccountGetInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Get(c, input, actor) })
	}
}
func (h *CustomerAccountHandler) query(c *gin.Context) {
	var input CustomerAccountQueryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Query(c, input, actor) })
	}
}
func (h *CustomerAccountHandler) versions(c *gin.Context) {
	var input CustomerAccountHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Versions(c, input, actor) })
	}
}
func (h *CustomerAccountHandler) auditHistory(c *gin.Context) {
	var input CustomerAccountHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.AuditHistory(c, input, actor) })
	}
}
