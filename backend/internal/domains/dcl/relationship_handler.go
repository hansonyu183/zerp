package dcl

import (
	"context"
	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"log/slog"
)

type relationshipApplicationService interface {
	CreateOtherUnit(context.Context, OtherUnitCreateInput, approval.Actor) (RelationshipMutation, error)
	SaveOtherUnit(context.Context, OtherUnitSaveInput, approval.Actor) (RelationshipMutation, error)
	SubmitOtherUnit(context.Context, RelationshipVersionInput, approval.Actor) (RelationshipMutation, error)
	UnsubmitOtherUnit(context.Context, RelationshipReviewInput, approval.Actor) (RelationshipMutation, error)
	RejectOtherUnit(context.Context, RelationshipReviewInput, approval.Actor) (RelationshipMutation, error)
	ApproveOtherUnit(context.Context, RelationshipVersionInput, approval.Actor) (RelationshipMutation, error)
	UnapproveOtherUnit(context.Context, RelationshipReviewInput, approval.Actor) (RelationshipMutation, error)
	EnableOtherUnit(context.Context, RelationshipVersionInput, approval.Actor) (RelationshipMutation, error)
	DisableOtherUnit(context.Context, RelationshipVersionInput, approval.Actor) (RelationshipMutation, error)
	DeleteOtherUnit(context.Context, RelationshipVersionInput, approval.Actor) error
	GetOtherUnit(context.Context, RelationshipGetInput, approval.Actor) (OtherUnitView, error)
	QueryOtherUnits(context.Context, RelationshipQueryInput, approval.Actor) (Page[OtherUnitQueryItem], error)
	OtherUnitVersions(context.Context, RelationshipHistoryInput, approval.Actor) (Page[OtherUnitVersionView], error)
	OtherUnitAuditHistory(context.Context, RelationshipHistoryInput, approval.Actor) (Page[approval.EventView], error)
	CreateSalesPartner(context.Context, SalesPartnerCreateInput, approval.Actor) (RelationshipMutation, error)
	SaveSalesPartner(context.Context, SalesPartnerSaveInput, approval.Actor) (RelationshipMutation, error)
	SubmitSalesPartner(context.Context, RelationshipVersionInput, approval.Actor) (RelationshipMutation, error)
	UnsubmitSalesPartner(context.Context, RelationshipReviewInput, approval.Actor) (RelationshipMutation, error)
	RejectSalesPartner(context.Context, RelationshipReviewInput, approval.Actor) (RelationshipMutation, error)
	ApproveSalesPartner(context.Context, RelationshipVersionInput, approval.Actor) (RelationshipMutation, error)
	UnapproveSalesPartner(context.Context, RelationshipReviewInput, approval.Actor) (RelationshipMutation, error)
	EnableSalesPartner(context.Context, RelationshipVersionInput, approval.Actor) (RelationshipMutation, error)
	DisableSalesPartner(context.Context, RelationshipVersionInput, approval.Actor) (RelationshipMutation, error)
	DeleteSalesPartner(context.Context, RelationshipVersionInput, approval.Actor) error
	GetSalesPartner(context.Context, RelationshipGetInput, approval.Actor) (SalesPartnerView, error)
	QuerySalesPartners(context.Context, RelationshipQueryInput, approval.Actor) (Page[SalesPartnerQueryItem], error)
	SalesPartnerVersions(context.Context, RelationshipHistoryInput, approval.Actor) (Page[SalesPartnerVersionView], error)
	SalesPartnerAuditHistory(context.Context, RelationshipHistoryInput, approval.Actor) (Page[approval.EventView], error)
}
type RelationshipHandler struct {
	service relationshipApplicationService
	handlerSupport
}

func NewRelationshipHandler(s relationshipApplicationService, a authorization.Authorizer, l *slog.Logger) *RelationshipHandler {
	return &RelationshipHandler{service: s, handlerSupport: newHandlerSupport(a, l)}
}
func (h *RelationshipHandler) Register(r *gin.Engine) { h.registerOther(r); h.registerSales(r) }
func (h *RelationshipHandler) route(r *gin.RouterGroup, entity, action string, fn gin.HandlerFunc) {
	path := "/dcl/" + entity + "/" + action
	r.POST("/"+action, authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError), fn)
}
func (h *RelationshipHandler) registerOther(r *gin.Engine) {
	g := r.Group("/dcl/" + EntityOtherUnit)
	h.route(g, EntityOtherUnit, "create", h.otherCreate)
	h.route(g, EntityOtherUnit, "save", h.otherSave)
	h.route(g, EntityOtherUnit, "submit", h.otherSubmit)
	h.route(g, EntityOtherUnit, "unsubmit", h.otherUnsubmit)
	h.route(g, EntityOtherUnit, "reject", h.otherReject)
	h.route(g, EntityOtherUnit, "approve", h.otherApprove)
	h.route(g, EntityOtherUnit, "unapprove", h.otherUnapprove)
	h.route(g, EntityOtherUnit, "delete", h.otherDelete)
	h.route(g, EntityOtherUnit, "get", h.otherGet)
	h.route(g, EntityOtherUnit, "query", h.otherQuery)
	h.route(g, EntityOtherUnit, "versions", h.otherVersions)
	h.route(g, EntityOtherUnit, "audit-history", h.otherAudit)
}
func (h *RelationshipHandler) registerSales(r *gin.Engine) {
	g := r.Group("/dcl/" + EntitySalesPartner)
	h.route(g, EntitySalesPartner, "create", h.salesCreate)
	h.route(g, EntitySalesPartner, "save", h.salesSave)
	h.route(g, EntitySalesPartner, "submit", h.salesSubmit)
	h.route(g, EntitySalesPartner, "unsubmit", h.salesUnsubmit)
	h.route(g, EntitySalesPartner, "reject", h.salesReject)
	h.route(g, EntitySalesPartner, "approve", h.salesApprove)
	h.route(g, EntitySalesPartner, "unapprove", h.salesUnapprove)
	h.route(g, EntitySalesPartner, "delete", h.salesDelete)
	h.route(g, EntitySalesPartner, "get", h.salesGet)
	h.route(g, EntitySalesPartner, "query", h.salesQuery)
	h.route(g, EntitySalesPartner, "versions", h.salesVersions)
	h.route(g, EntitySalesPartner, "audit-history", h.salesAudit)
}
func (h *RelationshipHandler) otherCreate(c *gin.Context) {
	var x OtherUnitCreateInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.CreateOtherUnit(c, x, a) })
	}
}
func (h *RelationshipHandler) otherSave(c *gin.Context) {
	var x OtherUnitSaveInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.SaveOtherUnit(c, x, a) })
	}
}
func (h *RelationshipHandler) otherSubmit(c *gin.Context) {
	var x RelationshipVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.SubmitOtherUnit(c, x, a) })
	}
}
func (h *RelationshipHandler) otherUnsubmit(c *gin.Context) {
	var x RelationshipReviewInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.UnsubmitOtherUnit(c, x, a) })
	}
}
func (h *RelationshipHandler) otherReject(c *gin.Context) {
	var x RelationshipReviewInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.RejectOtherUnit(c, x, a) })
	}
}
func (h *RelationshipHandler) otherApprove(c *gin.Context) {
	var x RelationshipVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.ApproveOtherUnit(c, x, a) })
	}
}
func (h *RelationshipHandler) otherUnapprove(c *gin.Context) {
	var x RelationshipReviewInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.UnapproveOtherUnit(c, x, a) })
	}
}
func (h *RelationshipHandler) otherEnable(c *gin.Context) {
	var x RelationshipVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.EnableOtherUnit(c, x, a) })
	}
}
func (h *RelationshipHandler) otherDisable(c *gin.Context) {
	var x RelationshipVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.DisableOtherUnit(c, x, a) })
	}
}
func (h *RelationshipHandler) otherDelete(c *gin.Context) {
	var x RelationshipVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return nil, h.service.DeleteOtherUnit(c, x, a) })
	}
}
func (h *RelationshipHandler) otherGet(c *gin.Context) {
	var x RelationshipGetInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.GetOtherUnit(c, x, a) })
	}
}
func (h *RelationshipHandler) otherQuery(c *gin.Context) {
	var x RelationshipQueryInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.QueryOtherUnits(c, x, a) })
	}
}
func (h *RelationshipHandler) otherVersions(c *gin.Context) {
	var x RelationshipHistoryInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.OtherUnitVersions(c, x, a) })
	}
}
func (h *RelationshipHandler) otherAudit(c *gin.Context) {
	var x RelationshipHistoryInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.OtherUnitAuditHistory(c, x, a) })
	}
}
func (h *RelationshipHandler) salesCreate(c *gin.Context) {
	var x SalesPartnerCreateInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.CreateSalesPartner(c, x, a) })
	}
}
func (h *RelationshipHandler) salesSave(c *gin.Context) {
	var x SalesPartnerSaveInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.SaveSalesPartner(c, x, a) })
	}
}
func (h *RelationshipHandler) salesSubmit(c *gin.Context) {
	var x RelationshipVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.SubmitSalesPartner(c, x, a) })
	}
}
func (h *RelationshipHandler) salesUnsubmit(c *gin.Context) {
	var x RelationshipReviewInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.UnsubmitSalesPartner(c, x, a) })
	}
}
func (h *RelationshipHandler) salesReject(c *gin.Context) {
	var x RelationshipReviewInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.RejectSalesPartner(c, x, a) })
	}
}
func (h *RelationshipHandler) salesApprove(c *gin.Context) {
	var x RelationshipVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.ApproveSalesPartner(c, x, a) })
	}
}
func (h *RelationshipHandler) salesUnapprove(c *gin.Context) {
	var x RelationshipReviewInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.UnapproveSalesPartner(c, x, a) })
	}
}
func (h *RelationshipHandler) salesEnable(c *gin.Context) {
	var x RelationshipVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.EnableSalesPartner(c, x, a) })
	}
}
func (h *RelationshipHandler) salesDisable(c *gin.Context) {
	var x RelationshipVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.DisableSalesPartner(c, x, a) })
	}
}
func (h *RelationshipHandler) salesDelete(c *gin.Context) {
	var x RelationshipVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return nil, h.service.DeleteSalesPartner(c, x, a) })
	}
}
func (h *RelationshipHandler) salesGet(c *gin.Context) {
	var x RelationshipGetInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.GetSalesPartner(c, x, a) })
	}
}
func (h *RelationshipHandler) salesQuery(c *gin.Context) {
	var x RelationshipQueryInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.QuerySalesPartners(c, x, a) })
	}
}
func (h *RelationshipHandler) salesVersions(c *gin.Context) {
	var x RelationshipHistoryInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.SalesPartnerVersions(c, x, a) })
	}
}
func (h *RelationshipHandler) salesAudit(c *gin.Context) {
	var x RelationshipHistoryInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.SalesPartnerAuditHistory(c, x, a) })
	}
}
