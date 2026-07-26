package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCORSAllowsAttachmentPUTForTrustedOrigin(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(CORS([]string{"https://frontend.example"}))
	router.PUT("/files/attachments/upload/:token", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	request := httptest.NewRequest(http.MethodOptions, "/files/attachments/upload/token", nil)
	request.Header.Set("Origin", "https://frontend.example")
	request.Header.Set("Access-Control-Request-Method", http.MethodPut)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d", recorder.Code)
	}
	if methods := recorder.Header().Get("Access-Control-Allow-Methods"); methods != "GET, POST, PUT, OPTIONS" {
		t.Fatalf("allow methods = %q", methods)
	}
}
