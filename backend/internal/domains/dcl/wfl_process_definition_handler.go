package dcl

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type wflProcessDefinitionApplicationService interface {
	Create(context.Context, WflProcessDefinitionCreateInput, approval.Actor) (WflProcessDefinitionMutation, error)
	Save(context.Context, WflProcessDefinitionSaveInput, approval.Actor) (WflProcessDefinitionMutation, error)
	Submit(context.Context, WflProcessDefinitionVersionInput, approval.Actor) (WflProcessDefinitionMutation, error)
	Unsubmit(context.Context, WflProcessDefinitionReviewInput, approval.Actor) (WflProcessDefinitionMutation, error)
	Reject(context.Context, WflProcessDefinitionReviewInput, approval.Actor) (WflProcessDefinitionMutation, error)
	Approve(context.Context, WflProcessDefinitionVersionInput, approval.Actor) (WflProcessDefinitionMutation, error)
	Unapprove(context.Context, WflProcessDefinitionReviewInput, approval.Actor) (WflProcessDefinitionMutation, error)
	Delete(context.Context, WflProcessDefinitionDeleteInput, approval.Actor) error
	CreateNext(context.Context, WflProcessDefinitionVersionInput, approval.Actor) (WflProcessDefinitionMutation, error)
	Enable(context.Context, WflProcessDefinitionEnableInput, approval.Actor) (WflProcessDefinitionMutation, error)
	Disable(context.Context, WflProcessDefinitionEnableInput, approval.Actor) (WflProcessDefinitionMutation, error)
	Get(context.Context, WflProcessDefinitionGetInput, approval.Actor) (WflProcessDefinitionView, error)
	Query(context.Context, WflProcessDefinitionQueryInput, approval.Actor) (Page[WflProcessDefinitionListItem], error)
	Versions(context.Context, WflProcessDefinitionHistoryInput, approval.Actor) (Page[WflProcessDefinitionVersionView], error)
	AuditHistory(context.Context, WflProcessDefinitionHistoryInput, approval.Actor) (Page[approval.EventView], error)
}

type WflProcessDefinitionHandler struct {
	service wflProcessDefinitionApplicationService
	handlerSupport
}

func NewWflProcessDefinitionHandler(service wflProcessDefinitionApplicationService, authorizer authorization.Authorizer, logger *slog.Logger) *WflProcessDefinitionHandler {
	return &WflProcessDefinitionHandler{service: service, handlerSupport: newHandlerSupport(authorizer, logger)}
}

func (h *WflProcessDefinitionHandler) Register(router *gin.Engine) {
	group := router.Group("/dcl/" + EntityWflProcessDefinition)
	routes := map[string]gin.HandlerFunc{
		"create": h.create, "save": h.save, "submit": h.submit, "unsubmit": h.unsubmit,
		"reject": h.reject, "approve": h.approve, "unapprove": h.unapprove, "delete-version": h.delete,
		"create-next": h.createNext, "enable": h.enable, "disable": h.disable,
		"get": h.get, "query": h.query, "versions": h.versions, "audit-history": h.auditHistory,
	}
	for action, handle := range routes {
		path := "/dcl/" + EntityWflProcessDefinition + "/" + action
		group.POST("/"+action, authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError), handle)
	}
}

func (h *WflProcessDefinitionHandler) create(c *gin.Context) {
	var input WflProcessDefinitionCreateInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Create(c, input, actor) })
	}
}

func (h *WflProcessDefinitionHandler) save(c *gin.Context) {
	var input WflProcessDefinitionSaveInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Save(c, input, actor) })
	}
}

func (h *WflProcessDefinitionHandler) submit(c *gin.Context) {
	var input WflProcessDefinitionVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Submit(c, input, actor) })
	}
}

func (h *WflProcessDefinitionHandler) unsubmit(c *gin.Context) {
	var input WflProcessDefinitionReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unsubmit(c, input, actor) })
	}
}

func (h *WflProcessDefinitionHandler) reject(c *gin.Context) {
	var input WflProcessDefinitionReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Reject(c, input, actor) })
	}
}

func (h *WflProcessDefinitionHandler) approve(c *gin.Context) {
	var input WflProcessDefinitionVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Approve(c, input, actor) })
	}
}

func (h *WflProcessDefinitionHandler) unapprove(c *gin.Context) {
	var input WflProcessDefinitionReviewInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Unapprove(c, input, actor) })
	}
}

func (h *WflProcessDefinitionHandler) delete(c *gin.Context) {
	var input WflProcessDefinitionDeleteInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return nil, h.service.Delete(c, input, actor) })
	}
}

func (h *WflProcessDefinitionHandler) createNext(c *gin.Context) {
	var input WflProcessDefinitionVersionInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.CreateNext(c, input, actor) })
	}
}

func (h *WflProcessDefinitionHandler) enable(c *gin.Context) {
	var input WflProcessDefinitionEnableInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Enable(c, input, actor) })
	}
}

func (h *WflProcessDefinitionHandler) disable(c *gin.Context) {
	var input WflProcessDefinitionEnableInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Disable(c, input, actor) })
	}
}

func (h *WflProcessDefinitionHandler) get(c *gin.Context) {
	var input WflProcessDefinitionGetInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Get(c, input, actor) })
	}
}

func (h *WflProcessDefinitionHandler) query(c *gin.Context) {
	var input WflProcessDefinitionQueryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Query(c, input, actor) })
	}
}

func (h *WflProcessDefinitionHandler) versions(c *gin.Context) {
	var input WflProcessDefinitionHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.Versions(c, input, actor) })
	}
}

func (h *WflProcessDefinitionHandler) auditHistory(c *gin.Context) {
	var input WflProcessDefinitionHistoryInput
	if h.bind(c, &input) {
		h.withActor(c, func(actor approval.Actor) (any, error) { return h.service.AuditHistory(c, input, actor) })
	}
}
