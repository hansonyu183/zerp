package dcl

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type fundAccountApplicationService interface {
	Create(context.Context, FundAccountCreateInput, approval.Actor) (FundAccountMutation, error)
	Save(context.Context, FundAccountSaveInput, approval.Actor) (FundAccountMutation, error)
	Submit(context.Context, FundAccountVersionInput, approval.Actor) (FundAccountMutation, error)
	Unsubmit(context.Context, FundAccountReviewInput, approval.Actor) (FundAccountMutation, error)
	Reject(context.Context, FundAccountReviewInput, approval.Actor) (FundAccountMutation, error)
	Approve(context.Context, FundAccountVersionInput, approval.Actor) (FundAccountMutation, error)
	Unapprove(context.Context, FundAccountReviewInput, approval.Actor) (FundAccountMutation, error)
	Delete(context.Context, FundAccountDeleteInput, approval.Actor) error
	Get(context.Context, FundAccountGetInput, approval.Actor) (FundAccountView, error)
	Query(context.Context, FundAccountQueryInput, approval.Actor) (Page[FundAccountQueryItem], error)
	Versions(context.Context, FundAccountHistoryInput, approval.Actor) (Page[FundAccountVersionView], error)
	AuditHistory(context.Context, FundAccountHistoryInput, approval.Actor) (Page[approval.EventView], error)
}

// FundAccountHandler owns the DCL fundAccount declaration routes. It is separate
// from the operating-entity Handler so httpserver can compose both slices.
type FundAccountHandler struct {
	service fundAccountApplicationService
	handlerSupport
}

func NewFundAccountHandler(service fundAccountApplicationService, authorizer authorization.Authorizer, logger *slog.Logger) *FundAccountHandler {
	return &FundAccountHandler{service: service, handlerSupport: newHandlerSupport(authorizer, logger)}
}

func (h *FundAccountHandler) Register(router *gin.Engine) {
	group := router.Group("/dcl/" + EntityFundAccount)
	routes := map[string]gin.HandlerFunc{
		"create": h.create, "save": h.save, "submit": h.submit, "unsubmit": h.unsubmit,
		"reject": h.reject, "approve": h.approve, "unapprove": h.unapprove, "delete": h.delete,
		"get": h.get, "query": h.query, "versions": h.versions, "audit-history": h.auditHistory,
	}
	for action, handle := range routes {
		path := "/dcl/" + EntityFundAccount + "/" + action
		group.POST("/"+action, authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError), handle)
	}
}

func (h *FundAccountHandler) create(c *gin.Context) {
	var input FundAccountCreateInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Create(c, input, actor) })
	}
}
func (h *FundAccountHandler) save(c *gin.Context) {
	var input FundAccountSaveInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Save(c, input, actor) })
	}
}
func (h *FundAccountHandler) submit(c *gin.Context) {
	var input FundAccountVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Submit(c, input, actor) })
	}
}
func (h *FundAccountHandler) unsubmit(c *gin.Context) {
	var input FundAccountReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unsubmit(c, input, actor) })
	}
}
func (h *FundAccountHandler) reject(c *gin.Context) {
	var input FundAccountReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Reject(c, input, actor) })
	}
}
func (h *FundAccountHandler) approve(c *gin.Context) {
	var input FundAccountVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Approve(c, input, actor) })
	}
}
func (h *FundAccountHandler) unapprove(c *gin.Context) {
	var input FundAccountReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unapprove(c, input, actor) })
	}
}
func (h *FundAccountHandler) delete(c *gin.Context) {
	var input FundAccountDeleteInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return nil, h.service.Delete(c, input, actor) })
	}
}
func (h *FundAccountHandler) get(c *gin.Context) {
	var input FundAccountGetInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Get(c, input, actor) })
	}
}
func (h *FundAccountHandler) query(c *gin.Context) {
	var input FundAccountQueryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Query(c, input, actor) })
	}
}
func (h *FundAccountHandler) versions(c *gin.Context) {
	var input FundAccountHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Versions(c, input, actor) })
	}
}
func (h *FundAccountHandler) auditHistory(c *gin.Context) {
	var input FundAccountHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.AuditHistory(c, input, actor) })
	}
}
