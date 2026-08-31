package dcl

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type rptDefinitionApplicationService interface {
	Create(context.Context, RptDefinitionCreateInput, approval.Actor) (RptDefinitionMutation, error)
	Save(context.Context, RptDefinitionSaveInput, approval.Actor) (RptDefinitionMutation, error)
	Submit(context.Context, RptDefinitionVersionInput, approval.Actor) (RptDefinitionMutation, error)
	Unsubmit(context.Context, RptDefinitionVersionInput, approval.Actor) (RptDefinitionMutation, error)
	Reject(context.Context, RptDefinitionReviewInput, approval.Actor) (RptDefinitionMutation, error)
	Approve(context.Context, RptDefinitionVersionInput, approval.Actor) (RptDefinitionMutation, error)
	Unapprove(context.Context, RptDefinitionReviewInput, approval.Actor) (RptDefinitionMutation, error)
	Delete(context.Context, RptDefinitionDeleteInput, approval.Actor) error
	CreateNext(context.Context, RptDefinitionVersionInput, approval.Actor) (RptDefinitionMutation, error)
	Enable(context.Context, RptDefinitionEnableInput, approval.Actor) (RptDefinitionMutation, error)
	Disable(context.Context, RptDefinitionEnableInput, approval.Actor) (RptDefinitionMutation, error)
	Get(context.Context, RptDefinitionGetInput, approval.Actor) (RptDefinitionView, error)
	Query(context.Context, RptDefinitionQueryInput, approval.Actor) (Page[RptDefinitionListItem], error)
	Versions(context.Context, RptDefinitionHistoryInput, approval.Actor) (Page[RptDefinitionVersionView], error)
	AuditHistory(context.Context, RptDefinitionHistoryInput, approval.Actor) (Page[approval.EventView], error)
}

type RptDefinitionHandler struct {
	service rptDefinitionApplicationService
	handlerSupport
}

func NewRptDefinitionHandler(service rptDefinitionApplicationService, authorizer authorization.Authorizer, logger *slog.Logger) *RptDefinitionHandler {
	return &RptDefinitionHandler{service: service, handlerSupport: newHandlerSupport(authorizer, logger)}
}

func (h *RptDefinitionHandler) Register(router *gin.Engine) {
	group := router.Group("/dcl/" + EntityRptDefinition)
	routes := map[string]gin.HandlerFunc{
		"create": h.create, "save": h.save, "submit": h.submit, "unsubmit": h.unsubmit,
		"reject": h.reject, "approve": h.approve, "unapprove": h.unapprove, "delete-version": h.delete,
		"create-next": h.createNext, "enable": h.enable, "disable": h.disable,
		"get": h.get, "query": h.query, "versions": h.versions, "audit-history": h.auditHistory,
	}
	for action, handle := range routes {
		path := "/dcl/" + EntityRptDefinition + "/" + action
		group.POST("/"+action, authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError), handle)
	}
}

func (h *RptDefinitionHandler) create(c *gin.Context) {
	var input RptDefinitionCreateInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Create(c, input, actor) })
	}
}

func (h *RptDefinitionHandler) save(c *gin.Context) {
	var input RptDefinitionSaveInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Save(c, input, actor) })
	}
}

func (h *RptDefinitionHandler) submit(c *gin.Context) {
	var input RptDefinitionVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Submit(c, input, actor) })
	}
}

func (h *RptDefinitionHandler) unsubmit(c *gin.Context) {
	var input RptDefinitionVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unsubmit(c, input, actor) })
	}
}

func (h *RptDefinitionHandler) reject(c *gin.Context) {
	var input RptDefinitionReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Reject(c, input, actor) })
	}
}

func (h *RptDefinitionHandler) approve(c *gin.Context) {
	var input RptDefinitionVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Approve(c, input, actor) })
	}
}

func (h *RptDefinitionHandler) unapprove(c *gin.Context) {
	var input RptDefinitionReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unapprove(c, input, actor) })
	}
}

func (h *RptDefinitionHandler) delete(c *gin.Context) {
	var input RptDefinitionDeleteInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return nil, h.service.Delete(c, input, actor) })
	}
}

func (h *RptDefinitionHandler) createNext(c *gin.Context) {
	var input RptDefinitionVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.CreateNext(c, input, actor) })
	}
}

func (h *RptDefinitionHandler) enable(c *gin.Context) {
	var input RptDefinitionEnableInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Enable(c, input, actor) })
	}
}

func (h *RptDefinitionHandler) disable(c *gin.Context) {
	var input RptDefinitionEnableInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Disable(c, input, actor) })
	}
}

func (h *RptDefinitionHandler) get(c *gin.Context) {
	var input RptDefinitionGetInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Get(c, input, actor) })
	}
}

func (h *RptDefinitionHandler) query(c *gin.Context) {
	var input RptDefinitionQueryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Query(c, input, actor) })
	}
}

func (h *RptDefinitionHandler) versions(c *gin.Context) {
	var input RptDefinitionHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Versions(c, input, actor) })
	}
}

func (h *RptDefinitionHandler) auditHistory(c *gin.Context) {
	var input RptDefinitionHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.AuditHistory(c, input, actor) })
	}
}
