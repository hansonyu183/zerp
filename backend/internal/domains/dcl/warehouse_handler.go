package dcl

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type warehouseApplicationService interface {
	Create(context.Context, WarehouseCreateInput, approval.Actor) (WarehouseMutation, error)
	Save(context.Context, WarehouseSaveInput, approval.Actor) (WarehouseMutation, error)
	Submit(context.Context, WarehouseVersionInput, approval.Actor) (WarehouseMutation, error)
	Unsubmit(context.Context, WarehouseReviewInput, approval.Actor) (WarehouseMutation, error)
	Reject(context.Context, WarehouseReviewInput, approval.Actor) (WarehouseMutation, error)
	Approve(context.Context, WarehouseVersionInput, approval.Actor) (WarehouseMutation, error)
	Unapprove(context.Context, WarehouseReviewInput, approval.Actor) (WarehouseMutation, error)
	Delete(context.Context, WarehouseDeleteInput, approval.Actor) error
	Get(context.Context, WarehouseGetInput, approval.Actor) (WarehouseView, error)
	Query(context.Context, WarehouseQueryInput, approval.Actor) (Page[WarehouseQueryItem], error)
	Versions(context.Context, WarehouseHistoryInput, approval.Actor) (Page[WarehouseVersionView], error)
	AuditHistory(context.Context, WarehouseHistoryInput, approval.Actor) (Page[approval.EventView], error)
}

// WarehouseHandler owns the DCL warehouse declaration routes. It is separate
// from the operating-entity Handler so httpserver can compose both slices.
type WarehouseHandler struct {
	service warehouseApplicationService
	handlerSupport
}

func NewWarehouseHandler(service warehouseApplicationService, authorizer authorization.Authorizer, logger *slog.Logger) *WarehouseHandler {
	return &WarehouseHandler{service: service, handlerSupport: newHandlerSupport(authorizer, logger)}
}

func (h *WarehouseHandler) Register(router *gin.Engine) {
	group := router.Group("/dcl/" + EntityWarehouse)
	routes := map[string]gin.HandlerFunc{
		"create": h.create, "save": h.save, "submit": h.submit, "unsubmit": h.unsubmit,
		"reject": h.reject, "approve": h.approve, "unapprove": h.unapprove, "delete": h.delete,
		"get": h.get, "query": h.query, "versions": h.versions, "audit-history": h.auditHistory,
	}
	for action, handle := range routes {
		path := "/dcl/" + EntityWarehouse + "/" + action
		group.POST("/"+action, authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError), handle)
	}
}

func (h *WarehouseHandler) create(c *gin.Context) {
	var input WarehouseCreateInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Create(c, input, actor) })
	}
}
func (h *WarehouseHandler) save(c *gin.Context) {
	var input WarehouseSaveInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Save(c, input, actor) })
	}
}
func (h *WarehouseHandler) submit(c *gin.Context) {
	var input WarehouseVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Submit(c, input, actor) })
	}
}
func (h *WarehouseHandler) unsubmit(c *gin.Context) {
	var input WarehouseReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unsubmit(c, input, actor) })
	}
}
func (h *WarehouseHandler) reject(c *gin.Context) {
	var input WarehouseReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Reject(c, input, actor) })
	}
}
func (h *WarehouseHandler) approve(c *gin.Context) {
	var input WarehouseVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Approve(c, input, actor) })
	}
}
func (h *WarehouseHandler) unapprove(c *gin.Context) {
	var input WarehouseReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unapprove(c, input, actor) })
	}
}
func (h *WarehouseHandler) delete(c *gin.Context) {
	var input WarehouseDeleteInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return nil, h.service.Delete(c, input, actor) })
	}
}
func (h *WarehouseHandler) get(c *gin.Context) {
	var input WarehouseGetInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Get(c, input, actor) })
	}
}
func (h *WarehouseHandler) query(c *gin.Context) {
	var input WarehouseQueryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Query(c, input, actor) })
	}
}
func (h *WarehouseHandler) versions(c *gin.Context) {
	var input WarehouseHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Versions(c, input, actor) })
	}
}
func (h *WarehouseHandler) auditHistory(c *gin.Context) {
	var input WarehouseHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.AuditHistory(c, input, actor) })
	}
}
