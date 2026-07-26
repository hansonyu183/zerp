package middleware

import (
	"crypto/rand"
	"strings"
	"time"
	"unicode"

	"github.com/gin-gonic/gin"
	"github.com/oklog/ulid/v2"
)

const (
	requestIDContextKey = "requestId"
	requestIDHeader     = "X-Request-ID"
	maxRequestIDLength  = 128
)

func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := strings.TrimSpace(c.GetHeader(requestIDHeader))
		if !validRequestID(requestID) {
			requestID = ulid.MustNew(ulid.Timestamp(time.Now().UTC()), rand.Reader).String()
		}

		c.Set(requestIDContextKey, requestID)
		c.Header(requestIDHeader, requestID)
		c.Next()
	}
}

func validRequestID(value string) bool {
	if value == "" || len(value) > maxRequestIDLength {
		return false
	}
	for _, r := range value {
		if r > unicode.MaxASCII || unicode.IsControl(r) || unicode.IsSpace(r) {
			return false
		}
	}
	return true
}
