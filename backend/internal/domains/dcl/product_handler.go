package dcl

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type productApplicationService interface {
	Create(context.Context, ProductCreateInput, approval.Actor) (ProductMutation, error)
	Save(context.Context, ProductSaveInput, approval.Actor) (ProductView, error)
	Submit(context.Context, ProductVersionInput, approval.Actor) (ProductMutation, error)
	Unsubmit(context.Context, ProductReviewInput, approval.Actor) (ProductMutation, error)
	Reject(context.Context, ProductReviewInput, approval.Actor) (ProductMutation, error)
	Approve(context.Context, ProductVersionInput, approval.Actor) (ProductMutation, error)
	Unapprove(context.Context, ProductReviewInput, approval.Actor) (ProductMutation, error)
	Delete(context.Context, ProductDeleteInput, approval.Actor) error
	Get(context.Context, ProductGetInput, approval.Actor) (ProductView, error)
	Query(context.Context, ProductQueryInput, approval.Actor) (Page[ProductQueryItem], error)
	Versions(context.Context, ProductHistoryInput, approval.Actor) (Page[ProductVersionView], error)
	AuditHistory(context.Context, ProductHistoryInput, approval.Actor) (Page[approval.EventView], error)
}

// ProductHandler owns the DCL product declaration routes. It is separate
// from the operating-entity Handler so httpserver can compose both slices.
type ProductHandler struct {
	service productApplicationService
	handlerSupport
}

func NewProductHandler(service productApplicationService, authorizer authorization.Authorizer, logger *slog.Logger) *ProductHandler {
	return &ProductHandler{service: service, handlerSupport: newHandlerSupport(authorizer, logger)}
}

func (h *ProductHandler) Register(router *gin.Engine) {
	group := router.Group("/dcl/" + EntityProduct)
	routes := map[string]gin.HandlerFunc{
		"create": h.create, "save": h.save, "submit": h.submit, "unsubmit": h.unsubmit,
		"reject": h.reject, "approve": h.approve, "unapprove": h.unapprove, "delete": h.delete,
		"get": h.get, "query": h.query, "versions": h.versions, "audit-history": h.auditHistory,
	}
	for action, handle := range routes {
		path := "/dcl/" + EntityProduct + "/" + action
		group.POST("/"+action, authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError), handle)
	}
}

func (h *ProductHandler) create(c *gin.Context) {
	var input ProductCreateInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Create(c, input, actor) })
	}
}
func (h *ProductHandler) save(c *gin.Context) {
	var input ProductSaveInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Save(c, input, actor) })
	}
}
func (h *ProductHandler) submit(c *gin.Context) {
	var input ProductVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Submit(c, input, actor) })
	}
}
func (h *ProductHandler) unsubmit(c *gin.Context) {
	var input ProductReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unsubmit(c, input, actor) })
	}
}
func (h *ProductHandler) reject(c *gin.Context) {
	var input ProductReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Reject(c, input, actor) })
	}
}
func (h *ProductHandler) approve(c *gin.Context) {
	var input ProductVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Approve(c, input, actor) })
	}
}
func (h *ProductHandler) unapprove(c *gin.Context) {
	var input ProductReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unapprove(c, input, actor) })
	}
}
func (h *ProductHandler) delete(c *gin.Context) {
	var input ProductDeleteInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return nil, h.service.Delete(c, input, actor) })
	}
}
func (h *ProductHandler) get(c *gin.Context) {
	var input ProductGetInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Get(c, input, actor) })
	}
}
func (h *ProductHandler) query(c *gin.Context) {
	var input ProductQueryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Query(c, input, actor) })
	}
}
func (h *ProductHandler) versions(c *gin.Context) {
	var input ProductHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Versions(c, input, actor) })
	}
}
func (h *ProductHandler) auditHistory(c *gin.Context) {
	var input ProductHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.AuditHistory(c, input, actor) })
	}
}
