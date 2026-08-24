package app

import (
	"context"
	"errors"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/requestbody"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
	"github.com/hansonyu183/zerp/backend/internal/config"
)

const principalContextKey = "appPrincipal"

type applicationService interface {
	Signin(context.Context, string, string, string) (SessionResult, error)
	RestoreSession(context.Context, string) (SessionResult, error)
	Authorize(context.Context, string, string, string, string) (Principal, error)
	AuthorizeSession(context.Context, string, string, string, string) (Principal, error)
	Signout(context.Context, Principal, string) error
	GetProfile(context.Context, string) (ProfileView, error)
	SaveProfile(context.Context, string, SaveProfileInput, string) (ProfileView, error)
	ChangePassword(context.Context, Principal, ChangePasswordInput, string) error
	QueryUsers(context.Context, PageRequest, Principal) (Page[UserListItem], error)
	GetUserDetail(context.Context, string, Principal) (UserDetail, error)
	CreateUser(context.Context, CreateUserInput, Principal, string) (UserDetail, error)
	SaveUser(context.Context, SaveUserInput, Principal, string) (UserDetail, error)
	SetUserStatus(context.Context, string, int64, string, Principal, string) (UserDetail, error)
	ResetUserPassword(context.Context, ResetPasswordInput, Principal, string) (ResetPasswordResult, error)
	QueryRoles(context.Context, PageRequest, Principal) (Page[RoleListItem], error)
	GetRole(context.Context, string, Principal) (RoleDetail, error)
	CreateRole(context.Context, CreateRoleInput, Principal, string) (RoleDetail, error)
	SaveRole(context.Context, SaveRoleInput, Principal, string) (RoleDetail, error)
	SetRoleStatus(context.Context, string, int64, string, Principal, string) (RoleDetail, error)
	QueryPermissions(context.Context, PageRequest, Principal) (Page[PermissionView], error)
	GetPermission(context.Context, string, Principal) (PermissionDetail, error)
	QuerySystemParameters(context.Context, PageRequest) (Page[SystemParameterView], error)
	GetSystemParameter(context.Context, string) (SystemParameterView, error)
	SaveSystemParameter(context.Context, SaveSystemParameterInput, string, string) (SystemParameterView, error)
	ResetSystemParameter(context.Context, ResetSystemParameterInput, string, string) (SystemParameterView, error)
	GetMenu(context.Context, Principal) (MenuGetData, error)
	SaveBusinessMenu(context.Context, SaveBusinessMenuInput, Principal, string) (MenuGetData, error)
	ActivateMenu(context.Context, ActivateMenuInput, Principal, string) (MenuGetData, error)
	ResetBusinessMenu(context.Context, ResetBusinessMenuInput, Principal, string) (MenuGetData, error)
	QueryWorkbench(context.Context, Principal, WorkbenchQueryInput) (Page[WorkbenchItem], error)
}

type Handler struct {
	service applicationService
	cfg     config.Config
	logger  *slog.Logger
	limiter *signinLimiter
}

func NewHandler(service applicationService, cfg config.Config, logger *slog.Logger) *Handler {
	return &Handler{service: service, cfg: cfg, logger: logger, limiter: newSigninLimiter()}
}

func (h *Handler) Register(router *gin.Engine) {
	appGroup := router.Group("/app")
	user := appGroup.Group("/user")
	user.POST("/signin", h.signin)
	user.POST("/session", h.session)
	user.POST("/signout", h.signout)

	protectedUser := user.Group("")
	protectedUser.Use(h.authorize())
	protectedUser.POST("/query", h.queryUsers)
	protectedUser.POST("/profile", h.profile)
	protectedUser.POST("/change-password", h.changePassword)
	protectedUser.POST("/get", h.getUser)
	protectedUser.POST("/create", h.createUser)
	protectedUser.POST("/save", h.saveUser)
	protectedUser.POST("/enable", h.setUserStatus(StatusEnabled))
	protectedUser.POST("/disable", h.setUserStatus(StatusDisabled))
	protectedUser.POST("/reset-password", h.resetUserPassword)

	role := appGroup.Group("/role")
	role.Use(h.authorize())
	role.POST("/query", h.queryRoles)
	role.POST("/get", h.getRole)
	role.POST("/create", h.createRole)
	role.POST("/save", h.saveRole)
	role.POST("/enable", h.setRoleStatus(StatusEnabled))
	role.POST("/disable", h.setRoleStatus(StatusDisabled))

	permission := appGroup.Group("/permission")
	permission.Use(h.authorize())
	permission.POST("/query", h.queryPermissions)
	permission.POST("/get", h.getPermission)

	systemParameter := appGroup.Group("/system-parameter")
	systemParameter.Use(h.authorize())
	systemParameter.POST("/query", h.querySystemParameters)
	systemParameter.POST("/get", h.getSystemParameter)
	systemParameter.POST("/save", h.saveSystemParameter)
	systemParameter.POST("/reset", h.resetSystemParameter)

	menuRead := appGroup.Group("/menu")
	menuRead.Use(h.authorizeSession())
	menuRead.POST("/get", h.getMenu)

	menuWrite := appGroup.Group("/menu")
	menuWrite.Use(h.authorize())
	menuWrite.POST("/save-business", h.saveBusinessMenu)
	menuWrite.POST("/activate", h.activateMenu)
	menuWrite.POST("/reset-business", h.resetBusinessMenu)

	workbench := appGroup.Group("/workbench")
	workbench.Use(h.authorizeSession())
	workbench.POST("/query", h.queryWorkbench)

}

func (h *Handler) authorize() gin.HandlerFunc {
	return func(c *gin.Context) {
		rawToken, _ := c.Cookie(h.cfg.SessionCookieName)
		principal, err := h.service.Authorize(c.Request.Context(), rawToken, c.GetHeader("X-CSRF-Token"), c.Request.URL.Path, response.RequestID(c))
		if err != nil {
			if errorIsKind(err, ErrorUnauthenticated) {
				h.clearSessionCookie(c)
			}
			h.writeError(c, err)
			c.Abort()
			return
		}
		c.Set(principalContextKey, principal)
		c.Next()
	}
}

func (h *Handler) authorizeSession() gin.HandlerFunc {
	return h.authorizeSessionAt("")
}

func (h *Handler) authorizeSessionAt(authorizationPath string) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := authorizationPath
		if path == "" {
			path = c.Request.URL.Path
		}
		rawToken, _ := c.Cookie(h.cfg.SessionCookieName)
		principal, err := h.service.AuthorizeSession(
			c.Request.Context(), rawToken, c.GetHeader("X-CSRF-Token"),
			path, response.RequestID(c),
		)
		if err != nil {
			if errorIsKind(err, ErrorUnauthenticated) {
				h.clearSessionCookie(c)
			}
			h.writeError(c, err)
			c.Abort()
			return
		}
		c.Set(principalContextKey, principal)
		c.Next()
	}
}

type idInput struct {
	ID string `json:"id"`
}

type revisionInput struct {
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
}

func (h *Handler) bind(c *gin.Context, target any) bool {
	if err := requestbody.DecodeJSON(c, target); err != nil {
		h.writeError(c, domainError(ErrorValidation, "invalid request", err))
		return false
	}
	return true
}

func (h *Handler) result(c *gin.Context, data any, err error) {
	if err != nil {
		h.writeError(c, err)
		return
	}
	response.OK(c, data)
}

func (h *Handler) writeError(c *gin.Context, err error) {
	var domainErr *DomainError
	if !errors.As(err, &domainErr) {
		domainErr = &DomainError{Kind: ErrorInternal, Message: "internal server error", Cause: err}
	}
	code := response.CodeInternal
	switch domainErr.Kind {
	case ErrorUnauthenticated:
		code = response.CodeUnauthenticated
	case ErrorForbidden:
		code = response.CodeForbidden
	case ErrorValidation, ErrorNotFound:
		code = response.CodeValidation
	case ErrorConflict:
		code = response.CodeConflict
	}
	if domainErr.Kind == ErrorInternal {
		h.logger.Error("app handler failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", domainErr.Cause)
	}
	response.BusinessError(c, code, domainErr.Message, nil)
}

func actorID(c *gin.Context) string {
	return currentPrincipal(c).User.ID
}

func currentPrincipal(c *gin.Context) Principal {
	value, exists := c.Get(principalContextKey)
	if !exists {
		return Principal{}
	}
	principal, ok := value.(Principal)
	if !ok {
		return Principal{}
	}
	return principal
}
