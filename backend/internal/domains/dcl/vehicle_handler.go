package dcl

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type vehicleApplicationService interface {
	Create(context.Context, VehicleCreateInput, approval.Actor) (VehicleMutation, error)
	Save(context.Context, VehicleSaveInput, approval.Actor) (VehicleMutation, error)
	Submit(context.Context, VehicleVersionInput, approval.Actor) (VehicleMutation, error)
	Unsubmit(context.Context, VehicleReviewInput, approval.Actor) (VehicleMutation, error)
	Reject(context.Context, VehicleReviewInput, approval.Actor) (VehicleMutation, error)
	Approve(context.Context, VehicleVersionInput, approval.Actor) (VehicleMutation, error)
	Unapprove(context.Context, VehicleReviewInput, approval.Actor) (VehicleMutation, error)
	Delete(context.Context, VehicleDeleteInput, approval.Actor) error
	Get(context.Context, VehicleGetInput, approval.Actor) (VehicleView, error)
	Query(context.Context, VehicleQueryInput, approval.Actor) (Page[VehicleQueryItem], error)
	Versions(context.Context, VehicleHistoryInput, approval.Actor) (Page[VehicleVersionView], error)
	AuditHistory(context.Context, VehicleHistoryInput, approval.Actor) (Page[approval.EventView], error)
}

type VehicleHandler struct {
	service vehicleApplicationService
	handlerSupport
}

func NewVehicleHandler(service vehicleApplicationService, authorizer authorization.Authorizer, logger *slog.Logger) *VehicleHandler {
	return &VehicleHandler{service: service, handlerSupport: newHandlerSupport(authorizer, logger)}
}

func (h *VehicleHandler) Register(router *gin.Engine) {
	group := router.Group("/dcl/" + EntityVehicle)
	routes := map[string]gin.HandlerFunc{
		"create": h.create, "save": h.save, "submit": h.submit, "unsubmit": h.unsubmit,
		"reject": h.reject, "approve": h.approve, "unapprove": h.unapprove, "delete": h.delete,
		"get": h.get, "query": h.query, "versions": h.versions, "audit-history": h.auditHistory,
	}
	for action, handle := range routes {
		path := "/dcl/" + EntityVehicle + "/" + action
		group.POST("/"+action, authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError), handle)
	}
}

func (h *VehicleHandler) create(c *gin.Context) {
	var input VehicleCreateInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Create(c, input, actor) })
	}
}
func (h *VehicleHandler) save(c *gin.Context) {
	var input VehicleSaveInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Save(c, input, actor) })
	}
}
func (h *VehicleHandler) submit(c *gin.Context) {
	var input VehicleVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Submit(c, input, actor) })
	}
}
func (h *VehicleHandler) unsubmit(c *gin.Context) {
	var input VehicleReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unsubmit(c, input, actor) })
	}
}
func (h *VehicleHandler) reject(c *gin.Context) {
	var input VehicleReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Reject(c, input, actor) })
	}
}
func (h *VehicleHandler) approve(c *gin.Context) {
	var input VehicleVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Approve(c, input, actor) })
	}
}
func (h *VehicleHandler) unapprove(c *gin.Context) {
	var input VehicleReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unapprove(c, input, actor) })
	}
}
func (h *VehicleHandler) delete(c *gin.Context) {
	var input VehicleDeleteInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return nil, h.service.Delete(c, input, actor) })
	}
}
func (h *VehicleHandler) get(c *gin.Context) {
	var input VehicleGetInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Get(c, input, actor) })
	}
}
func (h *VehicleHandler) query(c *gin.Context) {
	var input VehicleQueryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Query(c, input, actor) })
	}
}
func (h *VehicleHandler) versions(c *gin.Context) {
	var input VehicleHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Versions(c, input, actor) })
	}
}
func (h *VehicleHandler) auditHistory(c *gin.Context) {
	var input VehicleHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.AuditHistory(c, input, actor) })
	}
}
