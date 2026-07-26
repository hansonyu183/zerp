package requestbody

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func decode(t *testing.T, contentType, body string, target any) error {
	t.Helper()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", contentType)
	return DecodeJSON(c, target)
}

func TestDecodeJSONStrictness(t *testing.T) {
	var target struct {
		Name string `json:"name"`
	}
	if err := decode(t, "application/json; charset=utf-8", `{"name":"ok"}`, &target); err != nil || target.Name != "ok" {
		t.Fatalf("valid JSON: target=%+v err=%v", target, err)
	}
	for _, test := range []struct {
		name, contentType, body string
	}{
		{"content type", "text/plain", `{}`},
		{"unknown field", "application/json", `{"name":"ok","extra":true}`},
		{"trailing value", "application/json", `{"name":"ok"} {}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := decode(t, test.contentType, test.body, &target); err == nil {
				t.Fatal("DecodeJSON() accepted invalid input")
			}
		})
	}
}

func TestDecodeEmptyObject(t *testing.T) {
	for _, body := range []string{`null`, `[]`, `{"value":1}`} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		if err := DecodeEmptyObject(c); err == nil {
			t.Fatalf("DecodeEmptyObject() accepted %s", body)
		}
	}
}
