package app

import (
	"context"
	"errors"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authmiddleware"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/api/requestbody"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
	"github.com/hansonyu183/zerp/backend/internal/config"
)

type applicationService interface {
	Signin(context.Context, string, string, string) (SessionResult, error)
	RestoreSession(context.Context, Principal) (SessionResult, error)
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
	service    applicationService
	cfg        config.Config
	logger     *slog.Logger
	authorizer authorization.Authorizer
}

func NewHandler(service applicationService, authorizer authorization.Authorizer, cfg config.Config, logger *slog.Logger) *Handler {
	if authorizer == nil {
		authorizer = authorization.FailClosed{}
	}
	return &Handler{service: service, authorizer: authorizer, cfg: cfg, logger: logger}
}

func (h *Handler) Register(router *gin.Engine) {
	appGroup := router.Group("/app")
	user := appGroup.Group("/user")
	user.POST("/signin", h.signin)
	user.POST("/session", h.requireSession("/app/user/session"), h.session)
	user.POST("/signout", h.requireSession(signoutPath), h.signout)
	user.POST("/profile", h.requireSession("/app/user/profile"), h.profile)
	user.POST("/change-password", h.requireSession(changePasswordPath), h.changePassword)
	user.POST("/query", h.requirePermission("/app/user/query"), h.queryUsers)
	user.POST("/get", h.requirePermission("/app/user/get"), h.getUser)
	user.POST("/create", h.requirePermission("/app/user/create"), h.createUser)
	user.POST("/save", h.requirePermission("/app/user/save"), h.saveUser)
	user.POST("/enable", h.requirePermission("/app/user/enable"), h.setUserStatus(StatusEnabled))
	user.POST("/disable", h.requirePermission("/app/user/disable"), h.setUserStatus(StatusDisabled))
	user.POST("/reset-password", h.requirePermission("/app/user/reset-password"), h.resetUserPassword)

	role := appGroup.Group("/role")
	role.Use(h.requirePermission(""))
	role.POST("/query", h.queryRoles)
	role.POST("/get", h.getRole)
	role.POST("/create", h.createRole)
	role.POST("/save", h.saveRole)
	role.POST("/enable", h.setRoleStatus(StatusEnabled))
	role.POST("/disable", h.setRoleStatus(StatusDisabled))

	permission := appGroup.Group("/permission")
	permission.Use(h.requirePermission(""))
	permission.POST("/query", h.queryPermissions)
	permission.POST("/get", h.getPermission)

	systemParameter := appGroup.Group("/system-parameter")
	systemParameter.Use(h.requirePermission(""))
	systemParameter.POST("/query", h.querySystemParameters)
	systemParameter.POST("/get", h.getSystemParameter)
	systemParameter.POST("/save", h.saveSystemParameter)
	systemParameter.POST("/reset", h.resetSystemParameter)

	menuRead := appGroup.Group("/menu")
	menuRead.Use(h.requireSession(""))
	menuRead.POST("/get", h.getMenu)

	menuWrite := appGroup.Group("/menu")
	menuWrite.Use(h.requirePermission(""))
	menuWrite.POST("/save-business", h.saveBusinessMenu)
	menuWrite.POST("/activate", h.activateMenu)
	menuWrite.POST("/reset-business", h.resetBusinessMenu)

	workbench := appGroup.Group("/workbench")
	workbench.Use(h.requireSession(""))
	workbench.POST("/query", h.queryWorkbench)

}

func (h *Handler) requireSession(path string) gin.HandlerFunc {
	return authmiddleware.RequireSession(h.authorizer, path, h.writeError)
}

func (h *Handler) requirePermission(path string) gin.HandlerFunc {
	return authmiddleware.RequirePermission(h.authorizer, path, h.writeError)
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
	var authorizationErr *authorization.Error
	if errors.As(err, &authorizationErr) {
		code := response.CodeInternal
		switch authorizationErr.Kind {
		case authorization.ErrorUnauthenticated:
			code = response.CodeUnauthenticated
		case authorization.ErrorForbidden:
			code = response.CodeForbidden
		}
		if authorizationErr.Kind == authorization.ErrorInternal {
			h.logger.Error("app authorization failure", "requestId", response.RequestID(c), "path", c.Request.URL.Path, "error", authorizationErr.Cause)
		}
		response.BusinessError(c, code, authorizationErr.ErrorKey, authorizationErr.Message, nil)
		return
	}
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
	errorKey := domainErr.ErrorKey
	if errorKey == "" {
		errorKey = response.ErrorKeyForCode(code)
	}
	response.BusinessError(c, code, errorKey, domainErr.Message, nil)
}

func actorID(c *gin.Context) string {
	return currentPrincipal(c).User.ID
}

func currentPrincipal(c *gin.Context) Principal {
	principal := authmiddleware.Principal(c)
	return Principal{
		SessionID: principal.SessionID,
		User:      UserSummary{ID: principal.ActorID, Username: principal.Username, DisplayName: principal.DisplayName, AvatarURL: principal.AvatarURL},
		CSRFHash:  principal.CSRFHash, Permissions: principal.Permissions,
		PasswordChangeRequired: principal.PasswordChangeRequired,
		IdleExpires:            principal.IdleExpires, AbsoluteEnds: principal.AbsoluteEnds,
	}
}
