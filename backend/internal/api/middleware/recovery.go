package middleware

import (
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp-back/internal/api/response"
)

func Recovery(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.Error("panic recovered",
					"requestId", c.GetString(requestIDContextKey),
					"path", c.Request.URL.Path,
					"panic", recovered,
				)
				c.Abort()
				response.BusinessError(c, response.CodeInternal, "internal server error", nil)
			}
		}()
		c.Next()
	}
}
