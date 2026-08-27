package dcl

import (
	"context"
	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"log/slog"
)

type partyApplicationService interface {
	Save(context.Context, PartySaveInput, approval.Actor) (PartyMutation, error)
	Submit(context.Context, PartyVersionInput, approval.Actor) (PartyMutation, error)
	Unsubmit(context.Context, PartyReviewInput, approval.Actor) (PartyMutation, error)
	Reject(context.Context, PartyReviewInput, approval.Actor) (PartyMutation, error)
	Approve(context.Context, PartyVersionInput, approval.Actor) (PartyMutation, error)
	Unapprove(context.Context, PartyReviewInput, approval.Actor) (PartyMutation, error)
	Delete(context.Context, PartyVersionInput, approval.Actor) error
	Get(context.Context, PartyGetInput, bobdomain.PartyRelationshipVisibility, approval.Actor) (PartyView, error)
	Query(context.Context, bobdomain.QueryInput, approval.Actor) (Page[PartyListItem], error)
	Versions(context.Context, PartyHistoryInput, approval.Actor) (Page[PartyVersionView], error)
	AuditHistory(context.Context, PartyHistoryInput, approval.Actor) (Page[approval.EventView], error)
	MergePreflight(context.Context, bobdomain.PartyMergePreflightInput, bobdomain.PartyRelationshipVisibility, approval.Actor) (bobdomain.PartyMergePreflightResult, error)
	MergeConfirm(context.Context, bobdomain.PartyMergeConfirmInput, bobdomain.PartyRelationshipVisibility, approval.Actor) (bobdomain.PartyMergeResult, error)
}
type PartyHandler struct {
	service partyApplicationService
	handlerSupport
}

func NewPartyHandler(s partyApplicationService, a authorization.Authorizer, l *slog.Logger) *PartyHandler {
	return &PartyHandler{service: s, handlerSupport: newHandlerSupport(a, l)}
}
func (h *PartyHandler) Register(r *gin.Engine) {
	g := r.Group("/dcl/party")
	routes := map[string]gin.HandlerFunc{"save": h.save, "submit": h.submit, "unsubmit": h.unsubmit, "reject": h.reject, "approve": h.approve, "unapprove": h.unapprove, "delete": h.delete, "get": h.get, "query": h.query, "versions": h.versions, "audit-history": h.audit, "merge-preflight": h.mergePreflight, "merge-confirm": h.mergeConfirm}
	for a, f := range routes {
		p := "/dcl/party/" + a
		g.POST("/"+a, authmiddleware.RequirePermission(h.authorizer, p, h.writeAuthorizationError), f)
	}
}
func (h *PartyHandler) call(c *gin.Context, op func(approval.Actor) (any, error)) { h.withActor(c, op) }
func (h *PartyHandler) save(c *gin.Context) {
	var x PartySaveInput
	if h.bind(c, &x) {
		h.call(c, func(a approval.Actor) (any, error) { return h.service.Save(c, x, a) })
	}
}
func (h *PartyHandler) submit(c *gin.Context) {
	var x PartyVersionInput
	if h.bind(c, &x) {
		h.call(c, func(a approval.Actor) (any, error) { return h.service.Submit(c, x, a) })
	}
}
func (h *PartyHandler) unsubmit(c *gin.Context) {
	var x PartyReviewInput
	if h.bind(c, &x) {
		h.call(c, func(a approval.Actor) (any, error) { return h.service.Unsubmit(c, x, a) })
	}
}
func (h *PartyHandler) reject(c *gin.Context) {
	var x PartyReviewInput
	if h.bind(c, &x) {
		h.call(c, func(a approval.Actor) (any, error) { return h.service.Reject(c, x, a) })
	}
}
func (h *PartyHandler) approve(c *gin.Context) {
	var x PartyVersionInput
	if h.bind(c, &x) {
		h.call(c, func(a approval.Actor) (any, error) { return h.service.Approve(c, x, a) })
	}
}
func (h *PartyHandler) unapprove(c *gin.Context) {
	var x PartyReviewInput
	if h.bind(c, &x) {
		h.call(c, func(a approval.Actor) (any, error) { return h.service.Unapprove(c, x, a) })
	}
}
func (h *PartyHandler) delete(c *gin.Context) {
	var x PartyVersionInput
	if h.bind(c, &x) {
		h.call(c, func(a approval.Actor) (any, error) { return nil, h.service.Delete(c, x, a) })
	}
}
func (h *PartyHandler) get(c *gin.Context) {
	var x PartyGetInput
	if h.bind(c, &x) {
		h.call(c, func(a approval.Actor) (any, error) { return h.service.Get(c, x, h.partyRelationshipVisibility(c), a) })
	}
}
func (h *PartyHandler) query(c *gin.Context) {
	var x bobdomain.QueryInput
	if h.bind(c, &x) {
		h.call(c, func(a approval.Actor) (any, error) { return h.service.Query(c, x, a) })
	}
}
func (h *PartyHandler) versions(c *gin.Context) {
	var x PartyHistoryInput
	if h.bind(c, &x) {
		h.call(c, func(a approval.Actor) (any, error) { return h.service.Versions(c, x, a) })
	}
}
func (h *PartyHandler) audit(c *gin.Context) {
	var x PartyHistoryInput
	if h.bind(c, &x) {
		h.call(c, func(a approval.Actor) (any, error) { return h.service.AuditHistory(c, x, a) })
	}
}
func (h *PartyHandler) mergeVisibility(c *gin.Context) bobdomain.PartyRelationshipVisibility {
	return h.partyRelationshipVisibility(c)
}
func (h *PartyHandler) partyRelationshipVisibility(c *gin.Context) bobdomain.PartyRelationshipVisibility {
	p := authmiddleware.Principal(c)
	return bobdomain.PartyRelationshipVisibility{
		Customer: hasDCLPermission(p, "/bob/customer/get"), Supplier: hasDCLPermission(p, "/bob/supplier/get"),
		Employment: hasDCLPermission(p, "/bob/employee/get"), OtherUnit: hasDCLPermission(p, "/bob/other-unit/get"),
		SalesPartner: hasDCLPermission(p, "/bob/sales-partner/get"),
	}
}
func hasDCLPermission(p authorization.Principal, path string) bool {
	for _, granted := range p.Permissions {
		if granted == path {
			return true
		}
	}
	return false
}
func (h *PartyHandler) mergePreflight(c *gin.Context) {
	var x bobdomain.PartyMergePreflightInput
	if h.bind(c, &x) {
		h.call(c, func(a approval.Actor) (any, error) {
			result, err := h.service.MergePreflight(c, x, h.mergeVisibility(c), a)
			return result, translateError(err)
		})
	}
}
func (h *PartyHandler) mergeConfirm(c *gin.Context) {
	var x bobdomain.PartyMergeConfirmInput
	if h.bind(c, &x) {
		h.call(c, func(a approval.Actor) (any, error) {
			result, err := h.service.MergeConfirm(c, x, h.mergeVisibility(c), a)
			return result, translateError(err)
		})
	}
}
