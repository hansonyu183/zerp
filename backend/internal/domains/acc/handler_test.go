package acc

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/api/middleware"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
)

type bookServiceStub struct{ actions []string }

const handlerActorID = "01JACC00000000000000000001"

func (stub *bookServiceStub) QueryBooks(_ context.Context, input QueryBooksInput, _ string) (BookPage, error) {
	stub.actions = append(stub.actions, "query")
	return BookPage{Items: []BookView{}, Page: input.Page, PageSize: input.PageSize}, nil
}
func (stub *bookServiceStub) GetBook(_ context.Context, _, _ string) (BookView, error) {
	stub.actions = append(stub.actions, "get")
	return BookView{}, nil
}
func (stub *bookServiceStub) CreateBook(_ context.Context, _ CreateBookInput, _ string) (BookView, error) {
	stub.actions = append(stub.actions, "create")
	return BookView{}, nil
}
func (stub *bookServiceStub) SaveBook(_ context.Context, _ SaveBookInput, _ string) (BookView, error) {
	stub.actions = append(stub.actions, "save")
	return BookView{}, nil
}
func (stub *bookServiceStub) DeleteBook(_ context.Context, _ string, _ int64, _ string) error {
	stub.actions = append(stub.actions, "delete")
	return nil
}

func testRouter(service bookApplicationService, authorizer authorization.Authorizer) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequestID())
	NewHandler(service, authorizer, slog.New(slog.NewTextHandler(io.Discard, nil))).Register(router)
	return router
}

func TestBookHandlerUsesExactActionPermissionsAndBusinessEnvelope(t *testing.T) {
	tests := []struct{ action, body string }{
		{"query", `{"page":1,"pageSize":20}`},
		{"get", `{"bookId":"01JACC00000000000000000001"}`},
		{"create", `{"name":"主账簿","startMonth":"2026-08","baseCurrency":"CNY"}`},
		{"save", `{"bookId":"01JACC00000000000000000001","name":"主账簿","baseCurrency":"CNY","revision":1}`},
		{"delete", `{"bookId":"01JACC00000000000000000001","revision":1}`},
	}
	for _, test := range tests {
		t.Run(test.action, func(t *testing.T) {
			service := &bookServiceStub{}
			var permission string
			authorizer := authorization.Func(func(_ context.Context, _ *http.Request, path, _ string) (authorization.Principal, error) {
				permission = path
				return authorization.Principal{ActorID: handlerActorID}, nil
			})
			request := httptest.NewRequest(http.MethodPost, "/acc/book/"+test.action, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			testRouter(service, authorizer).ServeHTTP(recorder, request)

			var envelope response.Envelope
			if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if recorder.Code != http.StatusOK || envelope.Code != response.CodeOK {
				t.Fatalf("response = %d %s", recorder.Code, recorder.Body.String())
			}
			if permission != "/acc/book/"+test.action {
				t.Fatalf("permission = %q", permission)
			}
			if len(service.actions) != 1 || service.actions[0] != test.action {
				t.Fatalf("service actions = %v", service.actions)
			}
		})
	}
}

func TestBookHandlerRejectsUnknownFieldsBeforeCallingService(t *testing.T) {
	service := &bookServiceStub{}
	authorizer := authorization.Func(func(_ context.Context, _ *http.Request, _, _ string) (authorization.Principal, error) {
		return authorization.Principal{ActorID: handlerActorID}, nil
	})
	request := httptest.NewRequest(http.MethodPost, "/acc/book/create", strings.NewReader(
		`{"code":"MANUAL","name":"主账簿","startMonth":"2026-08","baseCurrency":"CNY"}`,
	))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	testRouter(service, authorizer).ServeHTTP(recorder, request)

	var envelope response.Envelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Code != response.CodeValidation || len(service.actions) != 0 {
		t.Fatalf("response = %s, actions = %v", recorder.Body.String(), service.actions)
	}
}
