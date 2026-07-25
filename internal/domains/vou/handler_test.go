package vou

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp-back/internal/api/authorization"
	"github.com/hansonyu183/zerp-back/internal/api/middleware"
)

type handlerServiceStub struct {
	queryCalls int
	entity     string
}

func (s *handlerServiceStub) Query(_ context.Context, entity string, input QueryInput) (Page[ListItem], error) {
	s.queryCalls++
	s.entity = entity
	return Page[ListItem]{Items: []ListItem{}, Page: input.Page, PageSize: input.PageSize}, nil
}
func (*handlerServiceStub) Get(context.Context, string, GetInput) (DocumentView, error) {
	return DocumentView{}, nil
}
func (*handlerServiceStub) Create(context.Context, string, CreateInput, string, string) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) Save(context.Context, string, SaveInput, string, string) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) Review(context.Context, string, DocumentRevisionInput, string, string) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) Unreview(context.Context, string, ReverseInput, string, string) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) Approve(context.Context, string, DocumentRevisionInput, string, string) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) Unapprove(context.Context, string, ReverseInput, string, string) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) Execute(context.Context, string, ExecuteInput, string, string) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) Unexecute(context.Context, string, ReverseInput, string, string) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) AuditHistory(context.Context, string, HistoryInput) (Page[AuditEventView], error) {
	return Page[AuditEventView]{Items: []AuditEventView{}}, nil
}
func (*handlerServiceStub) InitiateAttachment(context.Context, string, AttachmentInitiateInput, string, string) (AttachmentInitiateResult, error) {
	return AttachmentInitiateResult{}, nil
}
func (*handlerServiceStub) CreateDownload(context.Context, string, AttachmentDownloadInput, string) (AttachmentDownloadResult, error) {
	return AttachmentDownloadResult{}, nil
}
func (*handlerServiceStub) RemoveAttachment(context.Context, string, AttachmentRemoveInput, string, string) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) Upload(context.Context, string, io.Reader, int64, string, string) error {
	return nil
}
func (*handlerServiceStub) OpenDownload(context.Context, string) (DownloadFile, error) {
	return DownloadFile{}, domainError(ErrorValidation, "invalid token", nil, nil)
}

func newVOUTestRouter(service applicationService, authorizer authorization.Authorizer) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequestID())
	NewHandler(service, authorizer, slog.New(slog.NewTextHandler(io.Discard, nil))).Register(router)
	return router
}

func TestHandlerRegistersEveryVOUEntityAction(t *testing.T) {
	router := newVOUTestRouter(&handlerServiceStub{}, authorization.FailClosed{})
	wanted := map[string]string{}
	for _, entity := range entities {
		for _, route := range actionRoutes {
			wanted["/vou/"+entity+"/"+route.action] = http.MethodPost
		}
	}
	wanted["/files/attachments/upload/:token"] = http.MethodPut
	wanted["/files/attachments/download/:token"] = http.MethodGet
	for _, route := range router.Routes() {
		if method, exists := wanted[route.Path]; exists && method == route.Method {
			delete(wanted, route.Path)
		}
	}
	for path, method := range wanted {
		t.Errorf("route %s %s is not registered", method, path)
	}
	if got, want := len(router.Routes()), len(entities)*len(actionRoutes)+2; got != want {
		t.Fatalf("route count = %d, want %d", got, want)
	}
}

func TestHandlerUsesExactVOUPermissionPath(t *testing.T) {
	service := &handlerServiceStub{}
	var permission string
	authorizer := authorization.Func(func(_ context.Context, _ *http.Request, path, requestID string) (authorization.Principal, error) {
		permission = path
		if requestID == "" {
			t.Fatal("requestId was not forwarded")
		}
		return authorization.Principal{ActorID: testObjectID}, nil
	})
	router := newVOUTestRouter(service, authorizer)
	request := httptest.NewRequest(http.MethodPost, "/vou/intermediary-sale-order/query",
		strings.NewReader(`{"page":1,"pageSize":20,"filters":{},"sort":[]}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", recorder.Code, recorder.Body.String())
	}
	if permission != "/vou/intermediary-sale-order/query" {
		t.Fatalf("permission = %q", permission)
	}
	if service.queryCalls != 1 || service.entity != EntityIntermediarySaleOrder {
		t.Fatalf("query calls=%d entity=%q", service.queryCalls, service.entity)
	}
}
