package response

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestEnvelopeAlwaysCarriesErrorKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, test := range []struct {
		name     string
		write    func(*gin.Context)
		wantCode int
		wantKey  string
	}{
		{name: "success", write: func(c *gin.Context) { OK(c, map[string]any{"saved": true}) }, wantCode: CodeOK, wantKey: ""},
		{name: "business error", write: func(c *gin.Context) {
			BusinessError(c, CodeConflict, "role_changed", "role changed concurrently", nil)
		}, wantCode: CodeConflict, wantKey: "role_changed"},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Set("requestId", "request-1")
			test.write(context)

			var envelope Envelope
			if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if envelope.Code != test.wantCode || envelope.ErrorKey != test.wantKey {
				t.Fatalf("envelope = %#v, want code %d key %q", envelope, test.wantCode, test.wantKey)
			}
		})
	}
}
