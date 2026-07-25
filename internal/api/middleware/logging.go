package middleware

import (
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp-back/internal/api/response"
)

func RequestLogger(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		startedAt := time.Now()
		c.Next()

		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}
		attributes := []any{
			"requestId", c.GetString(requestIDContextKey),
			"method", c.Request.Method,
			"path", path,
			"status", c.Writer.Status(),
			"durationMs", time.Since(startedAt).Milliseconds(),
		}
		if code, ok := response.ResultCode(c); ok {
			attributes = append(attributes, "businessCode", code)
		}
		logger.Info("http request", attributes...)
	}
}
