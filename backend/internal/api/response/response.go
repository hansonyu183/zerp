package response

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

const (
	CodeOK              = 0
	CodeUnauthenticated = 1001
	CodeForbidden       = 1002
	CodeValidation      = 2001
	CodeConflict        = 3001
	CodeInternal        = 5000

	ErrorKeyUnauthenticated = "unauthenticated"
	ErrorKeyForbidden       = "forbidden"
	ErrorKeyValidation      = "validation_failed"
	ErrorKeyConflict        = "conflict"
	ErrorKeyInternal        = "internal_error"
)

const resultCodeContextKey = "businessCode"

type Envelope struct {
	Code      int    `json:"code"`
	ErrorKey  string `json:"errorKey"`
	Message   string `json:"message"`
	Data      any    `json:"data"`
	RequestID string `json:"requestId"`
}

func OK(c *gin.Context, data any) {
	c.Set(resultCodeContextKey, CodeOK)
	c.JSON(http.StatusOK, Envelope{
		Code:      CodeOK,
		ErrorKey:  "",
		Message:   "ok",
		Data:      data,
		RequestID: RequestID(c),
	})
}

func BusinessError(c *gin.Context, code int, errorKey, message string, data any) {
	c.Set(resultCodeContextKey, code)
	c.JSON(http.StatusOK, Envelope{
		Code:      code,
		ErrorKey:  errorKey,
		Message:   message,
		Data:      data,
		RequestID: RequestID(c),
	})
}

func ErrorKeyForCode(code int) string {
	switch code {
	case CodeUnauthenticated:
		return ErrorKeyUnauthenticated
	case CodeForbidden:
		return ErrorKeyForbidden
	case CodeValidation:
		return ErrorKeyValidation
	case CodeConflict:
		return ErrorKeyConflict
	default:
		return ErrorKeyInternal
	}
}

func ResultCode(c *gin.Context) (int, bool) {
	value, exists := c.Get(resultCodeContextKey)
	if !exists {
		return 0, false
	}
	code, ok := value.(int)
	return code, ok
}

func RequestID(c *gin.Context) string {
	return c.GetString("requestId")
}
