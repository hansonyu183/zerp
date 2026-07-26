package app

import (
	"context"
	"errors"
	"io"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp-back/internal/api/requestbody"
	"github.com/hansonyu183/zerp-back/internal/api/response"
	"github.com/hansonyu183/zerp-back/internal/config"
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
	QueryUsers(context.Context, PageRequest) (Page[UserView], error)
	GetUser(context.Context, string) (UserView, error)
	CreateUser(context.Context, CreateUserInput, string, string) (UserView, error)
	SaveUser(context.Context, SaveUserInput, string, string) (UserView, error)
	SetUserStatus(context.Context, string, int64, string, string, string) (UserView, error)
	QueryRoles(context.Context, PageRequest) (Page[RoleView], error)
	GetRole(context.Context, string) (RoleView, error)
	CreateRole(context.Context, CreateRoleInput, string, string) (RoleView, error)
	SaveRole(context.Context, SaveRoleInput, string, string) (RoleView, error)
	SetRoleStatus(context.Context, string, int64, string, string, string) (RoleView, error)
	QueryPermissions(context.Context, PageRequest) (Page[PermissionView], error)
	GetPermission(context.Context, string) (PermissionView, error)
	CreateFeedback(context.Context, CreateFeedbackInput, string) (FeedbackCreatedView, error)
	GetFeedback(context.Context, string, string) (FeedbackView, error)
	InitiateFeedbackAttachment(context.Context, FeedbackAttachmentInitiateInput, string) (FeedbackAttachmentInitiateResult, error)
	UploadFeedbackAttachment(context.Context, string, io.Reader, int64, string) error
	RemoveFeedbackAttachment(context.Context, string, string) error
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

	feedback := appGroup.Group("/feedback")
	feedback.Use(h.authorizeSession())
	feedback.POST("/attachment-initiate", h.initiateFeedbackAttachment)
	feedback.POST("/attachment-remove", h.removeFeedbackAttachment)
	feedback.POST("/create", h.createFeedback)
	feedback.POST("/get", h.getFeedback)

	router.PUT("/files/feedback/attachments/upload/:token", h.uploadFeedbackAttachment)
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
	return func(c *gin.Context) {
		rawToken, _ := c.Cookie(h.cfg.SessionCookieName)
		principal, err := h.service.AuthorizeSession(
			c.Request.Context(), rawToken, c.GetHeader("X-CSRF-Token"),
			c.Request.URL.Path, response.RequestID(c),
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
