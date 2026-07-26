package authmiddleware

import (
	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp-back/internal/api/authorization"
	"github.com/hansonyu183/zerp-back/internal/api/response"
)

func Require(
	authorizer authorization.Authorizer,
	path string,
	principalKey string,
	writeError func(*gin.Context, error),
) gin.HandlerFunc {
	if authorizer == nil {
		authorizer = authorization.FailClosed{}
	}
	return func(c *gin.Context) {
		principal, err := authorizer.Authorize(
			c.Request.Context(),
			c.Request,
			path,
			response.RequestID(c),
		)
		if err != nil {
			writeError(c, err)
			c.Abort()
			return
		}
		if principal.ActorID == "" {
			writeError(
				c,
				authorization.NewError(
					authorization.ErrorUnauthenticated,
					"session expired",
					nil,
				),
			)
			c.Abort()
			return
		}
		c.Set(principalKey, principal)
		c.Next()
	}
}
