package wfl

import (
	"context"
	"errors"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/api/requestbody"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
)

const principalContextKey = "wflPrincipal"

type applicationService interface{}

type salesApplicationService interface {
	SalesQuery(context.Context, QueryInput) (Page[SalesProcessListItem], error)
	SalesGet(context.Context, GetInput) (ProcessView, error)
	SalesAction(context.Context, string, ActionInput, string, string) (any, error)
	SalesHistory(context.Context, HistoryInput) (Page[AuditView], error)
}

type purchaseApplicationService interface {
	PurchaseQuery(context.Context, QueryInput) (Page[PurchaseProcessListItem], error)
	PurchaseGet(context.Context, GetInput) (ProcessView, error)
	PurchaseAction(context.Context, string, ActionInput, string, string) (any, error)
	PurchaseHistory(context.Context, HistoryInput) (Page[AuditView], error)
}

type genericApplicationService interface {
	DefinitionCatalog(context.Context) (DefinitionCatalog, error)
	DefinitionQuery(context.Context, DefinitionQueryInput) (Page[DefinitionListItem], error)
	DefinitionGet(context.Context, DefinitionGetInput) (DefinitionView, error)
	DefinitionCreate(context.Context, DefinitionCreateInput, string) (DefinitionView, error)
	DefinitionSave(context.Context, DefinitionSaveInput, string) (DefinitionView, error)
	DefinitionAction(context.Context, string, DefinitionActionInput, string) (any, error)
	InstanceQuery(context.Context, InstanceQueryInput) (Page[InstanceListItem], error)
	InstanceGet(context.Context, InstanceGetInput) (InstanceView, error)
	InstanceHistory(context.Context, InstanceHistoryInput) (Page[RuntimeAuditView], error)
}

var (
	_ salesApplicationService    = (*Service)(nil)
	_ purchaseApplicationService = (*Service)(nil)
	_ genericApplicationService  = (*Service)(nil)
)

type Handler struct {
	service    applicationService
	authorizer authorization.Authorizer
	logger     *slog.Logger
}

var salesWorkflowActions = [...]string{
	"short-close-request", "short-close-cancel", "short-close-confirm", "short-close-unconfirm",
}

var purchaseWorkflowActions = [...]string{
	"short-close-request", "short-close-cancel", "short-close-confirm", "short-close-unconfirm",
}

func NewHandler(service applicationService, authorizer authorization.Authorizer, logger *slog.Logger) *Handler {
	if authorizer == nil {
		authorizer = authorization.FailClosed{}
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{service: service, authorizer: authorizer, logger: logger}
}

func (h *Handler) Register(router *gin.Engine) {
	h.registerGenericWorkflow(router)
	h.registerSalesWorkflow(router)
	h.registerPurchaseWorkflow(router)
}

func (h *Handler) registerGenericWorkflow(router *gin.Engine) {
	definitions := router.Group("/wfl/process-definition")
	definitions.POST("/catalog", h.authorize("/wfl/process-definition/catalog"), func(c *gin.Context) {
		service, ok := h.service.(genericApplicationService)
		if !ok {
			h.writeError(c, internal("generic workflow service is unavailable", nil))
			return
		}
		var input struct{}
		if h.bind(c, &input) {
			result, err := service.DefinitionCatalog(c.Request.Context())
			h.result(c, result, err)
		}
	})
	definitions.POST("/query", h.authorize("/wfl/process-definition/query"), func(c *gin.Context) {
		service, ok := h.service.(genericApplicationService)
		if !ok {
			h.writeError(c, internal("generic workflow service is unavailable", nil))
			return
		}
		var input DefinitionQueryInput
		if h.bind(c, &input) {
			result, err := service.DefinitionQuery(c.Request.Context(), input)
			h.result(c, result, err)
		}
	})
	definitions.POST("/get", h.authorize("/wfl/process-definition/get"), func(c *gin.Context) {
		service, ok := h.service.(genericApplicationService)
		if !ok {
			h.writeError(c, internal("generic workflow service is unavailable", nil))
			return
		}
		var input DefinitionGetInput
		if h.bind(c, &input) {
			result, err := service.DefinitionGet(c.Request.Context(), input)
			h.result(c, result, err)
		}
	})
	definitions.POST("/create", h.authorize("/wfl/process-definition/create"), func(c *gin.Context) {
		service, ok := h.service.(genericApplicationService)
		if !ok {
			h.writeError(c, internal("generic workflow service is unavailable", nil))
			return
		}
		var input DefinitionCreateInput
		if h.bind(c, &input) {
			result, err := service.DefinitionCreate(c.Request.Context(), input, h.principal(c).ActorID)
			h.result(c, result, err)
		}
	})
	definitions.POST("/save", h.authorize("/wfl/process-definition/save"), func(c *gin.Context) {
		service, ok := h.service.(genericApplicationService)
		if !ok {
			h.writeError(c, internal("generic workflow service is unavailable", nil))
			return
		}
		var input DefinitionSaveInput
		if h.bind(c, &input) {
			result, err := service.DefinitionSave(c.Request.Context(), input, h.principal(c).ActorID)
			h.result(c, result, err)
		}
	})
	for _, value := range []string{"enable", "disable", "delete"} {
		action := value
		definitions.POST("/"+action, h.authorize("/wfl/process-definition/"+action), func(c *gin.Context) {
			service, ok := h.service.(genericApplicationService)
			if !ok {
				h.writeError(c, internal("generic workflow service is unavailable", nil))
				return
			}
			var input DefinitionActionInput
			if h.bind(c, &input) {
				result, err := service.DefinitionAction(c.Request.Context(), action, input, h.principal(c).ActorID)
				h.result(c, result, err)
			}
		})
	}
	instances := router.Group("/wfl/process-instance")
	instances.POST("/query", h.authorize("/wfl/process-instance/query"), func(c *gin.Context) {
		service, ok := h.service.(genericApplicationService)
		if !ok {
			h.writeError(c, internal("generic workflow service is unavailable", nil))
			return
		}
		var input InstanceQueryInput
		if h.bind(c, &input) {
			result, err := service.InstanceQuery(c.Request.Context(), input)
			h.result(c, result, err)
		}
	})
	instances.POST("/get", h.authorize("/wfl/process-instance/get"), func(c *gin.Context) {
		service, ok := h.service.(genericApplicationService)
		if !ok {
			h.writeError(c, internal("generic workflow service is unavailable", nil))
			return
		}
		var input InstanceGetInput
		if h.bind(c, &input) {
			result, err := service.InstanceGet(c.Request.Context(), input)
			h.result(c, result, err)
		}
	})
	instances.POST("/audit-history", h.authorize("/wfl/process-instance/audit-history"), func(c *gin.Context) {
		service, ok := h.service.(genericApplicationService)
		if !ok {
			h.writeError(c, internal("generic workflow service is unavailable", nil))
			return
		}
		var input InstanceHistoryInput
		if h.bind(c, &input) {
			result, err := service.InstanceHistory(c.Request.Context(), input)
			h.result(c, result, err)
		}
	})
}

func (h *Handler) registerPurchaseWorkflow(router *gin.Engine) {
	group := router.Group("/wfl/purchase-fulfillment")
	group.POST("/query", h.authorize("/wfl/purchase-fulfillment/query"), h.purchaseQuery)
	group.POST("/get", h.authorize("/wfl/purchase-fulfillment/get"), h.purchaseGet)
	group.POST("/audit-history", h.authorize("/wfl/purchase-fulfillment/audit-history"), h.purchaseHistory)
	for _, value := range purchaseWorkflowActions {
		action := value
		group.POST("/"+action, h.authorize("/wfl/purchase-fulfillment/"+action), func(c *gin.Context) {
			var input ActionInput
			if h.bind(c, &input) {
				service, ok := h.service.(purchaseApplicationService)
				if !ok {
					h.writeError(c, internal("purchase workflow service is unavailable", nil))
					return
				}
				principal := h.principal(c)
				result, err := service.PurchaseAction(
					c.Request.Context(), action, input, principal.ActorID, response.RequestID(c),
				)
				h.result(c, result, err)
			}
		})
	}
}

func (h *Handler) purchaseService(c *gin.Context) (purchaseApplicationService, bool) {
	service, ok := h.service.(purchaseApplicationService)
	if !ok {
		h.writeError(c, internal("purchase workflow service is unavailable", nil))
	}
	return service, ok
}

func (h *Handler) purchaseQuery(c *gin.Context) {
	var input QueryInput
	if h.bind(c, &input) {
		if service, ok := h.purchaseService(c); ok {
			result, err := service.PurchaseQuery(c.Request.Context(), input)
			h.result(c, result, err)
		}
	}
}

func (h *Handler) purchaseGet(c *gin.Context) {
	var input GetInput
	if h.bind(c, &input) {
		if service, ok := h.purchaseService(c); ok {
			result, err := service.PurchaseGet(c.Request.Context(), input)
			h.result(c, result, err)
		}
	}
}

func (h *Handler) purchaseHistory(c *gin.Context) {
	var input HistoryInput
	if h.bind(c, &input) {
		if service, ok := h.purchaseService(c); ok {
			result, err := service.PurchaseHistory(c.Request.Context(), input)
			h.result(c, result, err)
		}
	}
}

func (h *Handler) registerSalesWorkflow(router *gin.Engine) {
	group := router.Group("/wfl/sales-fulfillment")
	group.POST("/query", h.authorize("/wfl/sales-fulfillment/query"), h.salesQuery)
	group.POST("/get", h.authorize("/wfl/sales-fulfillment/get"), h.salesGet)
	group.POST("/audit-history", h.authorize("/wfl/sales-fulfillment/audit-history"), h.salesHistory)
	for _, value := range salesWorkflowActions {
		action := value
		group.POST("/"+action, h.authorize("/wfl/sales-fulfillment/"+action), func(c *gin.Context) {
			var input ActionInput
			if h.bind(c, &input) {
				principal := h.principal(c)
				service, ok := h.service.(salesApplicationService)
				if !ok {
					h.writeError(c, internal("sales workflow service is unavailable", nil))
					return
				}
				result, err := service.SalesAction(
					c.Request.Context(), action, input, principal.ActorID, response.RequestID(c),
				)
				h.result(c, result, err)
			}
		})
	}
}

func (h *Handler) salesService(c *gin.Context) (salesApplicationService, bool) {
	service, ok := h.service.(salesApplicationService)
	if !ok {
		h.writeError(c, internal("sales workflow service is unavailable", nil))
	}
	return service, ok
}

func (h *Handler) salesQuery(c *gin.Context) {
	var input QueryInput
	if h.bind(c, &input) {
		if service, ok := h.salesService(c); ok {
			result, err := service.SalesQuery(c.Request.Context(), input)
			h.result(c, result, err)
		}
	}
}

func (h *Handler) salesGet(c *gin.Context) {
	var input GetInput
	if h.bind(c, &input) {
		if service, ok := h.salesService(c); ok {
			result, err := service.SalesGet(c.Request.Context(), input)
			h.result(c, result, err)
		}
	}
}

func (h *Handler) salesHistory(c *gin.Context) {
	var input HistoryInput
	if h.bind(c, &input) {
		if service, ok := h.salesService(c); ok {
			result, err := service.SalesHistory(c.Request.Context(), input)
			h.result(c, result, err)
		}
	}
}

func (h *Handler) authorize(path string) gin.HandlerFunc {
	return authmiddleware.Require(h.authorizer, path, principalContextKey, h.writeAuthorizationError)
}

func (h *Handler) bind(c *gin.Context, target any) bool {
	if err := requestbody.DecodeJSON(c, target); err != nil {
		h.writeError(c, validation("invalid request", nil))
		return false
	}
	return true
}

func (h *Handler) principal(c *gin.Context) authorization.Principal {
	value, _ := c.Get(principalContextKey)
	return value.(authorization.Principal)
}

func (h *Handler) result(c *gin.Context, data any, err error) {
	if err != nil {
		h.writeError(c, err)
		return
	}
	response.OK(c, data)
}

func (h *Handler) writeAuthorizationError(c *gin.Context, err error) {
	code, message := response.CodeInternal, "internal server error"
	switch {
	case authorization.IsKind(err, authorization.ErrorUnauthenticated):
		code, message = response.CodeUnauthenticated, "session expired"
	case authorization.IsKind(err, authorization.ErrorForbidden):
		code, message = response.CodeForbidden, "permission denied"
	default:
		h.logger.Error("wfl authorization failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", err)
	}
	response.BusinessError(c, code, message, nil)
}

func (h *Handler) writeError(c *gin.Context, err error) {
	var domainErr *DomainError
	if !errors.As(err, &domainErr) {
		var vouErr *voudomain.DomainError
		if errors.As(err, &vouErr) {
			kind := ErrorInternal
			switch vouErr.Kind {
			case voudomain.ErrorValidation:
				kind = ErrorValidation
			case voudomain.ErrorConflict:
				kind = ErrorConflict
			}
			domainErr = &DomainError{
				Kind: kind, Message: vouErr.Message, Data: vouErr.Data, Cause: vouErr,
			}
		} else {
			domainErr = &DomainError{Kind: ErrorInternal, Message: "internal server error", Cause: err}
		}
	}
	code := response.CodeInternal
	switch domainErr.Kind {
	case ErrorValidation:
		code = response.CodeValidation
	case ErrorConflict:
		code = response.CodeConflict
	}
	if domainErr.Kind == ErrorInternal {
		h.logger.Error("wfl handler failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", domainErr.Cause)
	}
	response.BusinessError(c, code, domainErr.Message, domainErr.Data)
}
