package authmiddleware

import (
	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
)

const principalContextKey = "authorizationPrincipal"

func RequireSession(
	authorizer authorization.Authorizer,
	path string,
	writeError func(*gin.Context, error),
) gin.HandlerFunc {
	if authorizer == nil {
		authorizer = authorization.FailClosed{}
	}
	return func(c *gin.Context) {
		if !authenticate(c, authorizer, path, writeError) {
			return
		}
		c.Next()
	}
}

func RequirePermission(
	authorizer authorization.Authorizer,
	path string,
	writeError func(*gin.Context, error),
) gin.HandlerFunc {
	if authorizer == nil {
		authorizer = authorization.FailClosed{}
	}
	return func(c *gin.Context) {
		if !authenticate(c, authorizer, path, writeError) {
			return
		}
		if !CheckPermission(c, authorizer, path, writeError) {
			return
		}
		c.Next()
	}
}

func authenticate(c *gin.Context, authorizer authorization.Authorizer, path string, writeError func(*gin.Context, error)) bool {
	resolvedPath := path
	if resolvedPath == "" {
		resolvedPath = c.Request.URL.Path
	}
	principal, err := authorizer.AuthenticateSession(c.Request.Context(), c.Request, resolvedPath, response.RequestID(c))
	if err != nil {
		if authorization.IsKind(err, authorization.ErrorUnauthenticated) {
			authorizer.ClearSessionCookie(c.Writer)
		}
		writeError(c, err)
		c.Abort()
		return false
	}
	if principal.ActorID == "" {
		authorizer.ClearSessionCookie(c.Writer)
		writeError(c, authorization.NewError(authorization.ErrorUnauthenticated, "session expired", nil))
		c.Abort()
		return false
	}
	c.Set(principalContextKey, principal)
	return true
}

func CheckPermission(
	c *gin.Context,
	authorizer authorization.Authorizer,
	path string,
	writeError func(*gin.Context, error),
) bool {
	if path == "" {
		path = c.Request.URL.Path
	}
	principal := Principal(c)
	if err := authorizer.RequirePermission(c.Request.Context(), principal, path, response.RequestID(c)); err != nil {
		writeError(c, err)
		c.Abort()
		return false
	}
	return true
}

func Principal(c *gin.Context) authorization.Principal {
	value, _ := c.Get(principalContextKey)
	principal, _ := value.(authorization.Principal)
	return principal
}
