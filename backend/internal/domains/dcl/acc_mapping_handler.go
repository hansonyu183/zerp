package dcl

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type accMappingApplicationService interface {
	Create(context.Context, AccMappingCreateInput, approval.Actor) (AccMappingMutation, error)
	Save(context.Context, AccMappingSaveInput, approval.Actor) (AccMappingMutation, error)
	Submit(context.Context, AccMappingVersionInput, approval.Actor) (AccMappingMutation, error)
	Unsubmit(context.Context, AccMappingVersionInput, approval.Actor) (AccMappingMutation, error)
	Reject(context.Context, AccMappingReviewInput, approval.Actor) (AccMappingMutation, error)
	Approve(context.Context, AccMappingVersionInput, approval.Actor) (AccMappingMutation, error)
	Unapprove(context.Context, AccMappingReviewInput, approval.Actor) (AccMappingMutation, error)
	Delete(context.Context, AccMappingDeleteInput, approval.Actor) error
	CreateNext(context.Context, AccMappingVersionInput, approval.Actor) (AccMappingMutation, error)
	Get(context.Context, AccMappingGetInput, approval.Actor) (AccMappingView, error)
	Query(context.Context, AccMappingQueryInput, approval.Actor) (Page[AccMappingListItem], error)
	Versions(context.Context, AccMappingHistoryInput, approval.Actor) (Page[AccMappingVersionView], error)
	AuditHistory(context.Context, AccMappingHistoryInput, approval.Actor) (Page[approval.EventView], error)
}

type AccMappingHandler struct {
	service accMappingApplicationService
	handlerSupport
}

func NewAccMappingHandler(service accMappingApplicationService, authorizer authorization.Authorizer, logger *slog.Logger) *AccMappingHandler {
	return &AccMappingHandler{service: service, handlerSupport: newHandlerSupport(authorizer, logger)}
}

func (h *AccMappingHandler) Register(router *gin.Engine) {
	group := router.Group("/dcl/" + EntityAccMapping)
	routes := map[string]gin.HandlerFunc{
		"create": h.create, "save": h.save, "submit": h.submit, "unsubmit": h.unsubmit,
		"reject": h.reject, "approve": h.approve, "unapprove": h.unapprove, "delete-version": h.delete,
		"create-next": h.createNext, "get": h.get, "query": h.query, "versions": h.versions, "audit-history": h.auditHistory,
	}
	for action, handle := range routes {
		path := "/dcl/" + EntityAccMapping + "/" + action
		group.POST("/"+action, authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError), handle)
	}
}

func (h *AccMappingHandler) create(c *gin.Context) {
	var input AccMappingCreateInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Create(c, input, actor) })
	}
}

func (h *AccMappingHandler) save(c *gin.Context) {
	var input AccMappingSaveInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Save(c, input, actor) })
	}
}

func (h *AccMappingHandler) submit(c *gin.Context) {
	var input AccMappingVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Submit(c, input, actor) })
	}
}

func (h *AccMappingHandler) unsubmit(c *gin.Context) {
	var input AccMappingVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unsubmit(c, input, actor) })
	}
}

func (h *AccMappingHandler) reject(c *gin.Context) {
	var input AccMappingReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Reject(c, input, actor) })
	}
}

func (h *AccMappingHandler) approve(c *gin.Context) {
	var input AccMappingVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Approve(c, input, actor) })
	}
}

func (h *AccMappingHandler) unapprove(c *gin.Context) {
	var input AccMappingReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unapprove(c, input, actor) })
	}
}

func (h *AccMappingHandler) delete(c *gin.Context) {
	var input AccMappingDeleteInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return nil, h.service.Delete(c, input, actor) })
	}
}

func (h *AccMappingHandler) createNext(c *gin.Context) {
	var input AccMappingVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.CreateNext(c, input, actor) })
	}
}

func (h *AccMappingHandler) get(c *gin.Context) {
	var input AccMappingGetInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Get(c, input, actor) })
	}
}

func (h *AccMappingHandler) query(c *gin.Context) {
	var input AccMappingQueryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Query(c, input, actor) })
	}
}

func (h *AccMappingHandler) versions(c *gin.Context) {
	var input AccMappingHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Versions(c, input, actor) })
	}
}

func (h *AccMappingHandler) auditHistory(c *gin.Context) {
	var input AccMappingHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.AuditHistory(c, input, actor) })
	}
}
