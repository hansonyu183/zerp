package wfl

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
)

type handlerStub struct{}

func (*handlerStub) Query(context.Context, QueryInput) (Page[ProcessView], error) {
	return Page[ProcessView]{}, nil
}
func (*handlerStub) Get(context.Context, GetInput, []string) (ProcessView, error) {
	return ProcessView{}, nil
}
func (*handlerStub) Create(context.Context, CreateInput, string, string) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerStub) Save(context.Context, SaveInput, string, string) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerStub) History(context.Context, HistoryInput) (Page[AuditView], error) {
	return Page[AuditView]{}, nil
}
func (*handlerStub) Action(context.Context, string, ActionInput, string, string) (any, error) {
	return MutationResult{}, nil
}
func (*handlerStub) InitiateAttachment(context.Context, string, AttachmentInitiateInput, string, string) (AttachmentInitiateResult, error) {
	return AttachmentInitiateResult{}, nil
}
func (*handlerStub) DownloadAttachment(context.Context, string, AttachmentDownloadInput, string) (AttachmentDownloadResult, error) {
	return AttachmentDownloadResult{}, nil
}
func (*handlerStub) RemoveAttachment(context.Context, string, AttachmentRemoveInput, string, string) (AttachmentRemoveResult, error) {
	return AttachmentRemoveResult{}, nil
}

func TestHandlerRegistersTypedWorkflowPermissions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	NewHandler(&handlerStub{}, authorization.FailClosed{},
		slog.New(slog.NewTextHandler(io.Discard, nil))).Register(router)
	routes := map[string]string{}
	for _, route := range router.Routes() {
		routes[route.Path] = route.Method
	}
	if len(routes) != 57 {
		t.Fatalf("route count = %d, want 57", len(routes))
	}
	for _, path := range []string{
		"/wfl/intermediary-trade/create",
		"/wfl/intermediary-trade/procurement-place",
		"/wfl/intermediary-trade/receipt-confirm",
		"/wfl/intermediary-trade/delivery-execute",
		"/wfl/intermediary-trade/signoff-confirm",
		"/wfl/intermediary-trade/signoff-attachment-download",
	} {
		if routes[path] != http.MethodPost {
			t.Fatalf("missing POST %s", path)
		}
	}
}
