package dcl

import (
	"context"
	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"log/slog"
)

type typedArchiveApplicationService interface {
	CreateOtherUnit(context.Context, OtherUnitCreateInput, approval.Actor) (TypedArchiveMutation, error)
	SaveOtherUnit(context.Context, OtherUnitSaveInput, approval.Actor) (TypedArchiveMutation, error)
	SubmitOtherUnit(context.Context, TypedArchiveVersionInput, approval.Actor) (TypedArchiveMutation, error)
	UnsubmitOtherUnit(context.Context, TypedArchiveReviewInput, approval.Actor) (TypedArchiveMutation, error)
	RejectOtherUnit(context.Context, TypedArchiveReviewInput, approval.Actor) (TypedArchiveMutation, error)
	ApproveOtherUnit(context.Context, TypedArchiveVersionInput, approval.Actor) (TypedArchiveMutation, error)
	UnapproveOtherUnit(context.Context, TypedArchiveReviewInput, approval.Actor) (TypedArchiveMutation, error)
	DeleteOtherUnit(context.Context, TypedArchiveVersionInput, approval.Actor) error
	GetOtherUnit(context.Context, TypedArchiveGetInput, approval.Actor) (OtherUnitView, error)
	QueryOtherUnits(context.Context, TypedArchiveQueryInput, approval.Actor) (Page[OtherUnitQueryItem], error)
	OtherUnitVersions(context.Context, TypedArchiveHistoryInput, approval.Actor) (Page[OtherUnitVersionView], error)
	OtherUnitAuditHistory(context.Context, TypedArchiveHistoryInput, approval.Actor) (Page[approval.EventView], error)
	CreateSalesPartner(context.Context, SalesPartnerCreateInput, approval.Actor) (TypedArchiveMutation, error)
	SaveSalesPartner(context.Context, SalesPartnerSaveInput, approval.Actor) (TypedArchiveMutation, error)
	SubmitSalesPartner(context.Context, TypedArchiveVersionInput, approval.Actor) (TypedArchiveMutation, error)
	UnsubmitSalesPartner(context.Context, TypedArchiveReviewInput, approval.Actor) (TypedArchiveMutation, error)
	RejectSalesPartner(context.Context, TypedArchiveReviewInput, approval.Actor) (TypedArchiveMutation, error)
	ApproveSalesPartner(context.Context, TypedArchiveVersionInput, approval.Actor) (TypedArchiveMutation, error)
	UnapproveSalesPartner(context.Context, TypedArchiveReviewInput, approval.Actor) (TypedArchiveMutation, error)
	DeleteSalesPartner(context.Context, TypedArchiveVersionInput, approval.Actor) error
	GetSalesPartner(context.Context, TypedArchiveGetInput, approval.Actor) (SalesPartnerView, error)
	QuerySalesPartners(context.Context, TypedArchiveQueryInput, approval.Actor) (Page[SalesPartnerQueryItem], error)
	SalesPartnerVersions(context.Context, TypedArchiveHistoryInput, approval.Actor) (Page[SalesPartnerVersionView], error)
	SalesPartnerAuditHistory(context.Context, TypedArchiveHistoryInput, approval.Actor) (Page[approval.EventView], error)
}
type TypedArchiveHandler struct {
	service typedArchiveApplicationService
	handlerSupport
}

func NewTypedArchiveHandler(s typedArchiveApplicationService, a authorization.Authorizer, l *slog.Logger) *TypedArchiveHandler {
	return &TypedArchiveHandler{service: s, handlerSupport: newHandlerSupport(a, l)}
}
func (h *TypedArchiveHandler) Register(r *gin.Engine) { h.registerOther(r); h.registerSales(r) }
func (h *TypedArchiveHandler) route(r *gin.RouterGroup, entity, action string, fn gin.HandlerFunc) {
	path := "/dcl/" + entity + "/" + action
	r.POST("/"+action, authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError), fn)
}
func (h *TypedArchiveHandler) registerOther(r *gin.Engine) {
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
func (h *TypedArchiveHandler) registerSales(r *gin.Engine) {
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
func (h *TypedArchiveHandler) otherCreate(c *gin.Context) {
	var x OtherUnitCreateInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.CreateOtherUnit(c, x, a) })
	}
}
func (h *TypedArchiveHandler) otherSave(c *gin.Context) {
	var x OtherUnitSaveInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.SaveOtherUnit(c, x, a) })
	}
}
func (h *TypedArchiveHandler) otherSubmit(c *gin.Context) {
	var x TypedArchiveVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.SubmitOtherUnit(c, x, a) })
	}
}
func (h *TypedArchiveHandler) otherUnsubmit(c *gin.Context) {
	var x TypedArchiveReviewInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.UnsubmitOtherUnit(c, x, a) })
	}
}
func (h *TypedArchiveHandler) otherReject(c *gin.Context) {
	var x TypedArchiveReviewInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.RejectOtherUnit(c, x, a) })
	}
}
func (h *TypedArchiveHandler) otherApprove(c *gin.Context) {
	var x TypedArchiveVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.ApproveOtherUnit(c, x, a) })
	}
}
func (h *TypedArchiveHandler) otherUnapprove(c *gin.Context) {
	var x TypedArchiveReviewInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.UnapproveOtherUnit(c, x, a) })
	}
}
func (h *TypedArchiveHandler) otherDelete(c *gin.Context) {
	var x TypedArchiveVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return nil, h.service.DeleteOtherUnit(c, x, a) })
	}
}
func (h *TypedArchiveHandler) otherGet(c *gin.Context) {
	var x TypedArchiveGetInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.GetOtherUnit(c, x, a) })
	}
}
func (h *TypedArchiveHandler) otherQuery(c *gin.Context) {
	var x TypedArchiveQueryInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.QueryOtherUnits(c, x, a) })
	}
}
func (h *TypedArchiveHandler) otherVersions(c *gin.Context) {
	var x TypedArchiveHistoryInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.OtherUnitVersions(c, x, a) })
	}
}
func (h *TypedArchiveHandler) otherAudit(c *gin.Context) {
	var x TypedArchiveHistoryInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.OtherUnitAuditHistory(c, x, a) })
	}
}
func (h *TypedArchiveHandler) salesCreate(c *gin.Context) {
	var x SalesPartnerCreateInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.CreateSalesPartner(c, x, a) })
	}
}
func (h *TypedArchiveHandler) salesSave(c *gin.Context) {
	var x SalesPartnerSaveInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.SaveSalesPartner(c, x, a) })
	}
}
func (h *TypedArchiveHandler) salesSubmit(c *gin.Context) {
	var x TypedArchiveVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.SubmitSalesPartner(c, x, a) })
	}
}
func (h *TypedArchiveHandler) salesUnsubmit(c *gin.Context) {
	var x TypedArchiveReviewInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.UnsubmitSalesPartner(c, x, a) })
	}
}
func (h *TypedArchiveHandler) salesReject(c *gin.Context) {
	var x TypedArchiveReviewInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.RejectSalesPartner(c, x, a) })
	}
}
func (h *TypedArchiveHandler) salesApprove(c *gin.Context) {
	var x TypedArchiveVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.ApproveSalesPartner(c, x, a) })
	}
}
func (h *TypedArchiveHandler) salesUnapprove(c *gin.Context) {
	var x TypedArchiveReviewInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.UnapproveSalesPartner(c, x, a) })
	}
}
func (h *TypedArchiveHandler) salesDelete(c *gin.Context) {
	var x TypedArchiveVersionInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return nil, h.service.DeleteSalesPartner(c, x, a) })
	}
}
func (h *TypedArchiveHandler) salesGet(c *gin.Context) {
	var x TypedArchiveGetInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.GetSalesPartner(c, x, a) })
	}
}
func (h *TypedArchiveHandler) salesQuery(c *gin.Context) {
	var x TypedArchiveQueryInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.QuerySalesPartners(c, x, a) })
	}
}
func (h *TypedArchiveHandler) salesVersions(c *gin.Context) {
	var x TypedArchiveHistoryInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.SalesPartnerVersions(c, x, a) })
	}
}
func (h *TypedArchiveHandler) salesAudit(c *gin.Context) {
	var x TypedArchiveHistoryInput
	if h.bind(c, &x) {
		h.withActor(c, func(a approval.Actor) (any, error) { return h.service.SalesPartnerAuditHistory(c, x, a) })
	}
}
