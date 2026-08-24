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

type applicationService interface{}

type genericApplicationService interface {
	DefinitionQuery(context.Context, DefinitionQueryInput) (Page[DefinitionListItem], error)
	DefinitionGet(context.Context, DefinitionGetInput) (DefinitionView, error)
	DefinitionCreate(context.Context, DefinitionCreateInput, string) (DefinitionView, error)
	DefinitionSave(context.Context, DefinitionSaveInput, string) (DefinitionView, error)
	DefinitionTrial(context.Context, DefinitionTrialInput, string, string) (DefinitionTrialResult, error)
	DefinitionAction(context.Context, string, DefinitionActionInput, string) (any, error)
	InstanceQuery(context.Context, InstanceQueryInput) (Page[InstanceListItem], error)
	InstanceGet(context.Context, InstanceGetInput) (InstanceView, error)
	InstanceHistory(context.Context, InstanceHistoryInput) (Page[RuntimeAuditView], error)
	InstanceQueryByDefinitionCode(context.Context, string, InstanceQueryInput) (Page[InstanceListItem], error)
	InstanceGetByDefinitionCode(context.Context, string, InstanceGetInput) (InstanceView, error)
	InstanceHistoryByDefinitionCode(context.Context, string, InstanceHistoryInput) (Page[RuntimeAuditView], error)
	CreateChildByDefinitionCode(context.Context, string, CreateChildInput, string) (BusinessObjectReference, error)
}

var _ genericApplicationService = (*Service)(nil)

type Handler struct {
	service    applicationService
	authorizer authorization.Authorizer
	logger     *slog.Logger
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
	h.registerDynamicWorkflow(router)
}

func (h *Handler) registerGenericWorkflow(router *gin.Engine) {
	definitions := router.Group("/wfl/process-definition")
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
	definitions.POST("/trial", h.authorize("/wfl/process-definition/save"), func(c *gin.Context) {
		service, ok := h.service.(genericApplicationService)
		if !ok {
			h.writeError(c, internal("generic workflow service is unavailable", nil))
			return
		}
		var input DefinitionTrialInput
		if h.bind(c, &input) {
			result, err := service.DefinitionTrial(c.Request.Context(), input, h.principal(c).ActorID, response.RequestID(c))
			h.result(c, result, err)
		}
	})
	for _, value := range []string{"publish", "enable", "disable", "delete"} {
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

func (h *Handler) registerDynamicWorkflow(router *gin.Engine) {
	group := router.Group("/wfl/:processName")
	group.POST("/query", h.authorizeDynamicWorkflow("query"), func(c *gin.Context) {
		service, ok := h.service.(genericApplicationService)
		if !ok {
			h.writeError(c, internal("generic workflow service is unavailable", nil))
			return
		}
		var input InstanceQueryInput
		if h.bind(c, &input) {
			result, err := service.InstanceQueryByDefinitionCode(c.Request.Context(), c.Param("processName"), input)
			h.result(c, result, err)
		}
	})
	group.POST("/get", h.authorizeDynamicWorkflow("get"), func(c *gin.Context) {
		service, ok := h.service.(genericApplicationService)
		if !ok {
			h.writeError(c, internal("generic workflow service is unavailable", nil))
			return
		}
		var input InstanceGetInput
		if h.bind(c, &input) {
			result, err := service.InstanceGetByDefinitionCode(c.Request.Context(), c.Param("processName"), input)
			h.result(c, result, err)
		}
	})
	group.POST("/audit-history", h.authorizeDynamicWorkflow("audit-history"), func(c *gin.Context) {
		service, ok := h.service.(genericApplicationService)
		if !ok {
			h.writeError(c, internal("generic workflow service is unavailable", nil))
			return
		}
		var input InstanceHistoryInput
		if h.bind(c, &input) {
			result, err := service.InstanceHistoryByDefinitionCode(c.Request.Context(), c.Param("processName"), input)
			h.result(c, result, err)
		}
	})
	group.POST("/create-child", h.authorizeDynamicWorkflow("create-child"), func(c *gin.Context) {
		service, ok := h.service.(genericApplicationService)
		if !ok {
			h.writeError(c, internal("generic workflow service is unavailable", nil))
			return
		}
		var input CreateChildInput
		if h.bind(c, &input) {
			result, err := service.CreateChildByDefinitionCode(c.Request.Context(), c.Param("processName"), input, h.principal(c).ActorID)
			h.result(c, result, err)
		}
	})
}

func (h *Handler) authorizeDynamicWorkflow(_ string) gin.HandlerFunc {
	return authmiddleware.RequirePermission(h.authorizer, "", h.writeAuthorizationError)
}

func (h *Handler) authorize(path string) gin.HandlerFunc {
	return authmiddleware.RequirePermission(h.authorizer, path, h.writeAuthorizationError)
}

func (h *Handler) bind(c *gin.Context, target any) bool {
	if err := requestbody.DecodeJSON(c, target); err != nil {
		h.writeError(c, validation("invalid request", nil))
		return false
	}
	return true
}

func (h *Handler) principal(c *gin.Context) authorization.Principal {
	return authmiddleware.Principal(c)
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
	response.BusinessError(c, code, response.ErrorKeyForCode(code), message, nil)
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
				Kind: kind, ErrorKey: vouErr.ErrorKey, Message: vouErr.Message, Data: vouErr.Data, Cause: vouErr,
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
	errorKey := domainErr.ErrorKey
	if errorKey == "" {
		errorKey = response.ErrorKeyForCode(code)
	}
	response.BusinessError(c, code, errorKey, domainErr.Message, domainErr.Data)
}
