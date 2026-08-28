package dcl

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type employeeApplicationService interface {
	Create(context.Context, EmployeeCreateInput, approval.Actor) (EmployeeMutation, error)
	Save(context.Context, EmployeeSaveInput, approval.Actor) (EmployeeMutation, error)
	Submit(context.Context, EmployeeVersionInput, approval.Actor) (EmployeeMutation, error)
	Unsubmit(context.Context, EmployeeReviewInput, approval.Actor) (EmployeeMutation, error)
	Reject(context.Context, EmployeeReviewInput, approval.Actor) (EmployeeMutation, error)
	Approve(context.Context, EmployeeVersionInput, approval.Actor) (EmployeeMutation, error)
	Unapprove(context.Context, EmployeeReviewInput, approval.Actor) (EmployeeMutation, error)
	Delete(context.Context, EmployeeDeleteInput, approval.Actor) error
	Get(context.Context, EmployeeGetInput, approval.Actor) (EmployeeView, error)
	Query(context.Context, EmployeeQueryInput, approval.Actor) (Page[EmployeeQueryItem], error)
	Versions(context.Context, EmployeeHistoryInput, approval.Actor) (Page[EmployeeVersionView], error)
	AuditHistory(context.Context, EmployeeHistoryInput, approval.Actor) (Page[approval.EventView], error)
}

// EmployeeHandler owns the DCL employee declaration routes. It is separate
// from the operating-entity Handler so httpserver can compose both slices.
type EmployeeHandler struct {
	service employeeApplicationService
	handlerSupport
}

func NewEmployeeHandler(service employeeApplicationService, authorizer authorization.Authorizer, logger *slog.Logger) *EmployeeHandler {
	return &EmployeeHandler{service: service, handlerSupport: newHandlerSupport(authorizer, logger)}
}

func (h *EmployeeHandler) Register(router *gin.Engine) {
	group := router.Group("/dcl/" + EntityEmployee)
	routes := map[string]gin.HandlerFunc{
		"create": h.create, "save": h.save, "submit": h.submit, "unsubmit": h.unsubmit,
		"reject": h.reject, "approve": h.approve, "unapprove": h.unapprove, "delete": h.delete,
		"get": h.get, "query": h.query, "versions": h.versions, "audit-history": h.auditHistory,
	}
	for action, handle := range routes {
		path := "/dcl/" + EntityEmployee + "/" + action
		group.POST("/"+action, authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError), handle)
	}
}

func (h *EmployeeHandler) create(c *gin.Context) {
	var input EmployeeCreateInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Create(c, input, actor) })
	}
}
func (h *EmployeeHandler) save(c *gin.Context) {
	var input EmployeeSaveInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Save(c, input, actor) })
	}
}
func (h *EmployeeHandler) submit(c *gin.Context) {
	var input EmployeeVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Submit(c, input, actor) })
	}
}
func (h *EmployeeHandler) unsubmit(c *gin.Context) {
	var input EmployeeReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unsubmit(c, input, actor) })
	}
}
func (h *EmployeeHandler) reject(c *gin.Context) {
	var input EmployeeReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Reject(c, input, actor) })
	}
}
func (h *EmployeeHandler) approve(c *gin.Context) {
	var input EmployeeVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Approve(c, input, actor) })
	}
}
func (h *EmployeeHandler) unapprove(c *gin.Context) {
	var input EmployeeReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unapprove(c, input, actor) })
	}
}
func (h *EmployeeHandler) delete(c *gin.Context) {
	var input EmployeeDeleteInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return nil, h.service.Delete(c, input, actor) })
	}
}
func (h *EmployeeHandler) get(c *gin.Context) {
	var input EmployeeGetInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Get(c, input, actor) })
	}
}
func (h *EmployeeHandler) query(c *gin.Context) {
	var input EmployeeQueryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Query(c, input, actor) })
	}
}
func (h *EmployeeHandler) versions(c *gin.Context) {
	var input EmployeeHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Versions(c, input, actor) })
	}
}
func (h *EmployeeHandler) auditHistory(c *gin.Context) {
	var input EmployeeHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.AuditHistory(c, input, actor) })
	}
}
