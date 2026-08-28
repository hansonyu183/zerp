package dcl

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type supplierApplicationService interface {
	Create(context.Context, SupplierCreateInput, approval.Actor) (SupplierMutation, error)
	Save(context.Context, SupplierSaveInput, approval.Actor) (SupplierMutation, error)
	Submit(context.Context, SupplierVersionInput, approval.Actor) (SupplierMutation, error)
	Unsubmit(context.Context, SupplierReviewInput, approval.Actor) (SupplierMutation, error)
	Reject(context.Context, SupplierReviewInput, approval.Actor) (SupplierMutation, error)
	Approve(context.Context, SupplierVersionInput, approval.Actor) (SupplierMutation, error)
	Unapprove(context.Context, SupplierReviewInput, approval.Actor) (SupplierMutation, error)
	Delete(context.Context, SupplierDeleteInput, approval.Actor) error
	Get(context.Context, SupplierGetInput, approval.Actor) (SupplierView, error)
	Query(context.Context, SupplierQueryInput, approval.Actor) (Page[SupplierQueryItem], error)
	Versions(context.Context, SupplierHistoryInput, approval.Actor) (Page[SupplierVersionView], error)
	AuditHistory(context.Context, SupplierHistoryInput, approval.Actor) (Page[approval.EventView], error)
}
type SupplierHandler struct {
	service supplierApplicationService
	handlerSupport
}

func NewSupplierHandler(service supplierApplicationService, authorizer authorization.Authorizer, logger *slog.Logger) *SupplierHandler {
	return &SupplierHandler{service: service, handlerSupport: newHandlerSupport(authorizer, logger)}
}
func (h *SupplierHandler) Register(router *gin.Engine) {
	g := router.Group("/dcl/" + EntitySupplier)
	for action, fn := range map[string]gin.HandlerFunc{"create": h.create, "save": h.save, "submit": h.submit, "unsubmit": h.unsubmit, "reject": h.reject, "approve": h.approve, "unapprove": h.unapprove, "delete": h.delete, "get": h.get, "query": h.query, "versions": h.versions, "audit-history": h.auditHistory} {
		path := "/dcl/" + EntitySupplier + "/" + action
		g.POST("/"+action, authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError), fn)
	}
}
func (h *SupplierHandler) create(c *gin.Context) {
	var i SupplierCreateInput
	if h.bind(c, &i) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.Create(c, i, a) })
	}
}
func (h *SupplierHandler) save(c *gin.Context) {
	var i SupplierSaveInput
	if h.bind(c, &i) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.Save(c, i, a) })
	}
}
func (h *SupplierHandler) submit(c *gin.Context) {
	var i SupplierVersionInput
	if h.bind(c, &i) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.Submit(c, i, a) })
	}
}
func (h *SupplierHandler) unsubmit(c *gin.Context) {
	var i SupplierReviewInput
	if h.bind(c, &i) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.Unsubmit(c, i, a) })
	}
}
func (h *SupplierHandler) reject(c *gin.Context) {
	var i SupplierReviewInput
	if h.bind(c, &i) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.Reject(c, i, a) })
	}
}
func (h *SupplierHandler) approve(c *gin.Context) {
	var i SupplierVersionInput
	if h.bind(c, &i) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.Approve(c, i, a) })
	}
}
func (h *SupplierHandler) unapprove(c *gin.Context) {
	var i SupplierReviewInput
	if h.bind(c, &i) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.Unapprove(c, i, a) })
	}
}
func (h *SupplierHandler) delete(c *gin.Context) {
	var i SupplierDeleteInput
	if h.bind(c, &i) {
		h.withActor(c, func(a approval.Actor) (any, error) { return nil, h.service.Delete(c, i, a) })
	}
}
func (h *SupplierHandler) get(c *gin.Context) {
	var i SupplierGetInput
	if h.bind(c, &i) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.Get(c, i, a) })
	}
}
func (h *SupplierHandler) query(c *gin.Context) {
	var i SupplierQueryInput
	if h.bind(c, &i) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.Query(c, i, a) })
	}
}
func (h *SupplierHandler) versions(c *gin.Context) {
	var i SupplierHistoryInput
	if h.bind(c, &i) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.Versions(c, i, a) })
	}
}
func (h *SupplierHandler) auditHistory(c *gin.Context) {
	var i SupplierHistoryInput
	if h.bind(c, &i) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.AuditHistory(c, i, a) })
	}
}
