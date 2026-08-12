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
func (stub *bookServiceStub) QuerySubjects(_ context.Context, input QuerySubjectsInput, _ string) (SubjectPage, error) {
	stub.actions = append(stub.actions, "subject-query")
	return SubjectPage{Items: []SubjectView{}, Page: input.Page, PageSize: input.PageSize}, nil
}
func (stub *bookServiceStub) GetSubject(_ context.Context, _, _, _ string) (SubjectView, error) {
	stub.actions = append(stub.actions, "subject-get")
	return SubjectView{}, nil
}
func (stub *bookServiceStub) CreateSubject(_ context.Context, _ CreateSubjectInput, _ string) (SubjectView, error) {
	stub.actions = append(stub.actions, "subject-create")
	return SubjectView{}, nil
}
func (stub *bookServiceStub) SaveSubject(_ context.Context, _ SaveSubjectInput, _ string) (SubjectView, error) {
	stub.actions = append(stub.actions, "subject-save")
	return SubjectView{}, nil
}
func (stub *bookServiceStub) DeleteSubject(_ context.Context, _, _ string, _ int64, _ string) error {
	stub.actions = append(stub.actions, "subject-delete")
	return nil
}
func (stub *bookServiceStub) GetOpening(_ context.Context, _, _ string) (OpeningView, error) {
	stub.actions = append(stub.actions, "opening-query")
	return OpeningView{}, nil
}
func (stub *bookServiceStub) SaveOpening(_ context.Context, _ SaveOpeningInput, _ string) (OpeningView, error) {
	stub.actions = append(stub.actions, "opening-save")
	return OpeningView{}, nil
}
func (stub *bookServiceStub) ApproveOpening(_ context.Context, _ string, _ int64, _ string) (OpeningView, error) {
	stub.actions = append(stub.actions, "opening-approve")
	return OpeningView{}, nil
}
func (stub *bookServiceStub) UnapproveOpening(_ context.Context, _ string, _ int64, _ string) (OpeningView, error) {
	stub.actions = append(stub.actions, "opening-unapprove")
	return OpeningView{}, nil
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
		{"create", `{"name":"主账簿","startMonth":"2026-08","baseCurrency":"CNY","subjectTemplate":"EMPTY"}`},
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

func TestSubjectHandlerUsesExactActionPermissionsAndBusinessEnvelope(t *testing.T) {
	tests := []struct{ action, body string }{
		{"query", `{"bookId":"01JACC00000000000000000001","page":1,"pageSize":20}`},
		{"get", `{"bookId":"01JACC00000000000000000001","subjectId":"01JACC00000000000000000002"}`},
		{"create", `{"bookId":"01JACC00000000000000000001","code":"1001","name":"库存现金","balanceDirection":"DEBIT","enabled":true,"requiredDimensions":[],"inventoryQuantity":false,"settlementPurpose":"NONE"}`},
		{"save", `{"bookId":"01JACC00000000000000000001","subjectId":"01JACC00000000000000000002","code":"1001","name":"库存现金","balanceDirection":"DEBIT","enabled":true,"requiredDimensions":[],"inventoryQuantity":false,"settlementPurpose":"NONE","revision":1}`},
		{"delete", `{"bookId":"01JACC00000000000000000001","subjectId":"01JACC00000000000000000002","revision":1}`},
	}
	for _, test := range tests {
		t.Run(test.action, func(t *testing.T) {
			service := &bookServiceStub{}
			var permission string
			authorizer := authorization.Func(func(_ context.Context, _ *http.Request, path, _ string) (authorization.Principal, error) {
				permission = path
				return authorization.Principal{ActorID: handlerActorID}, nil
			})
			request := httptest.NewRequest(http.MethodPost, "/acc/subject/"+test.action, strings.NewReader(test.body))
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
			if permission != "/acc/subject/"+test.action {
				t.Fatalf("permission = %q", permission)
			}
			if len(service.actions) != 1 || service.actions[0] != "subject-"+test.action {
				t.Fatalf("service actions = %v", service.actions)
			}
		})
	}
}

func TestOpeningHandlerUsesExactActionPermissionsAndBusinessEnvelope(t *testing.T) {
	tests := []struct{ action, body string }{
		{"query", `{"bookId":"01JACC00000000000000000001"}`},
		{"save", `{"bookId":"01JACC00000000000000000001","revision":0,"lines":[]}`},
		{"approve", `{"bookId":"01JACC00000000000000000001","revision":0}`},
		{"unapprove", `{"bookId":"01JACC00000000000000000001","revision":1}`},
	}
	for _, test := range tests {
		t.Run(test.action, func(t *testing.T) {
			service := &bookServiceStub{}
			var permission string
			authorizer := authorization.Func(func(_ context.Context, _ *http.Request, path, _ string) (authorization.Principal, error) {
				permission = path
				return authorization.Principal{ActorID: handlerActorID}, nil
			})
			request := httptest.NewRequest(http.MethodPost, "/acc/opening/"+test.action, strings.NewReader(test.body))
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
			if permission != "/acc/opening/"+test.action || len(service.actions) != 1 || service.actions[0] != "opening-"+test.action {
				t.Fatalf("permission = %q, actions = %v", permission, service.actions)
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
