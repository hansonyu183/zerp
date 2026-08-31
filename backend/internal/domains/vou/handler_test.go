package vou

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
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type handlerServiceStub struct {
	queryCalls  int
	createCalls int
	entity      string
	getResult   DocumentView
}

func (s *handlerServiceStub) Query(_ context.Context, entity string, input QueryInput) (Page[ListItem], error) {
	s.queryCalls++
	s.entity = entity
	return Page[ListItem]{Items: []ListItem{}, Page: input.Page, PageSize: input.PageSize}, nil
}
func (s *handlerServiceStub) Get(context.Context, string, GetInput) (DocumentView, error) {
	return s.getResult, nil
}
func (*handlerServiceStub) FormulaDefault(context.Context, FormulaDefaultInput) (FormulaDefaultView, error) {
	return FormulaDefaultView{}, nil
}
func (*handlerServiceStub) PriceReference(context.Context, string, PriceReferenceInput) (PriceReferenceView, error) {
	return PriceReferenceView{}, nil
}
func (s *handlerServiceStub) Create(context.Context, string, CreateInput, approval.Actor) (MutationResult, error) {
	s.createCalls++
	return MutationResult{}, nil
}
func (*handlerServiceStub) Save(context.Context, string, SaveInput, approval.Actor) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) Submit(context.Context, string, DocumentRevisionInput, approval.Actor) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) Unsubmit(context.Context, string, DocumentRevisionInput, approval.Actor) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) Reject(context.Context, string, ReverseInput, approval.Actor) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) Approve(context.Context, string, DocumentRevisionInput, approval.Actor) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) Unapprove(context.Context, string, ReverseInput, approval.Actor) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) Delete(context.Context, string, DeleteInput, approval.Actor) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) AuditHistory(context.Context, string, HistoryInput) (Page[AuditEventView], error) {
	return Page[AuditEventView]{Items: []AuditEventView{}}, nil
}
func (*handlerServiceStub) InventoryCountBookBalance(context.Context, InventoryCountBalanceInput) (Page[InventoryCountBalanceItem], error) {
	return Page[InventoryCountBalanceItem]{Items: []InventoryCountBalanceItem{}}, nil
}
func (*handlerServiceStub) AvailableBills(context.Context, AvailableBillQueryInput) (Page[AvailableBillItem], error) {
	return Page[AvailableBillItem]{Items: []AvailableBillItem{}}, nil
}
func (*handlerServiceStub) AvailableAssets(context.Context, AvailableAssetQueryInput) (Page[AvailableAssetItem], error) {
	return Page[AvailableAssetItem]{Items: []AvailableAssetItem{}}, nil
}
func (*handlerServiceStub) InitiateAttachment(context.Context, string, AttachmentInitiateInput, approval.Actor) (AttachmentInitiateResult, error) {
	return AttachmentInitiateResult{}, nil
}
func (*handlerServiceStub) CreateDownload(context.Context, string, AttachmentDownloadInput, string) (AttachmentDownloadResult, error) {
	return AttachmentDownloadResult{}, nil
}
func (*handlerServiceStub) RemoveAttachment(context.Context, string, AttachmentRemoveInput, approval.Actor) (MutationResult, error) {
	return MutationResult{}, nil
}
func (*handlerServiceStub) Upload(context.Context, string, io.Reader, int64, string, string) error {
	return nil
}
func (*handlerServiceStub) OpenDownload(context.Context, string) (DownloadFile, error) {
	return DownloadFile{}, domainError(ErrorValidation, "invalid token", nil, nil)
}
func (*handlerServiceStub) IntermediarySource(context.Context, IntermediarySourceInput) (IntermediarySourceView, error) {
	return IntermediarySourceView{}, nil
}
func (*handlerServiceStub) GetIntermediaryScript(context.Context) (IntermediaryScriptSnapshot, error) {
	return IntermediaryScriptSnapshot{}, nil
}
func (*handlerServiceStub) SaveIntermediaryScript(context.Context, IntermediaryScriptSaveInput, string) (IntermediaryScriptSnapshot, error) {
	return IntermediaryScriptSnapshot{}, nil
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
			if route.action == "create" && !publicCreateEntity(entity) {
				continue
			}
			if route.action == "formula-default" &&
				entity != EntitySaleOrder &&
				entity != EntitySelfProduction {
				continue
			}
			if route.action == "price-reference" && entity != EntitySaleOrder && entity != EntityPurchaseOrder {
				continue
			}
			if (route.action == "source" || route.action == "script-get" || route.action == "script-save") &&
				entity != EntityIntermediaryCalculation {
				continue
			}
			if route.action == "book-balance" && entity != EntityInventoryCount {
				continue
			}
			if route.action == "bill-source" && entity != EntityBillReceipt &&
				entity != EntityBillPayment &&
				entity != EntityBillDiscount && entity != EntityBillMaturity {
				continue
			}
			if route.action == "asset-source" && entity != EntityAssetSale && entity != EntityAssetLiquidation {
				continue
			}
			wanted["/vou/"+entity+"/"+route.action] = http.MethodPost
		}
	}
	wanted["/files/attachments/upload/:token"] = http.MethodPut
	wanted["/files/attachments/download/:token"] = http.MethodGet
	wantedCount := len(wanted)
	for _, route := range router.Routes() {
		if method, exists := wanted[route.Path]; exists && method == route.Method {
			delete(wanted, route.Path)
		}
	}
	for path, method := range wanted {
		t.Errorf("route %s %s is not registered", method, path)
	}
	if got, want := len(router.Routes()), wantedCount; got != want {
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
	request := httptest.NewRequest(http.MethodPost, "/vou/purchase-inbound/query",
		strings.NewReader(`{"page":1,"pageSize":20,"filters":{},"sort":[]}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", recorder.Code, recorder.Body.String())
	}
	if permission != "/vou/purchase-inbound/query" {
		t.Fatalf("permission = %q", permission)
	}
	if service.queryCalls != 1 || service.entity != EntityPurchaseInbound {
		t.Fatalf("query calls=%d entity=%q", service.queryCalls, service.entity)
	}
}

func TestHandlerRejectsRetiredAuxiliaryApprovalEntryIDs(t *testing.T) {
	authorizer := authorization.Func(func(_ context.Context, _ *http.Request, _, _ string) (authorization.Principal, error) {
		return authorization.Principal{ActorID: testObjectID}, nil
	})
	for _, test := range []struct {
		name, entity, body string
	}{
		{name: "settlement method", entity: EntityServiceContract, body: `{"data":{"settlementMethod":{"objectId":"01J00000000000000000000001","approvalEntryId":"01J00000000000000000000002"}}}`},
		{name: "asset category", entity: EntityAssetAcquisition, body: `{"data":{"assetAcquisitionLines":[{"category":{"objectId":"01J00000000000000000000001","approvalEntryId":"01J00000000000000000000002"}}]}}`},
		{name: "asset department", entity: EntityAssetAcquisition, body: `{"data":{"assetAcquisitionLines":[{"department":{"objectId":"01J00000000000000000000001","approvalEntryId":"01J00000000000000000000002"}}]}}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := &handlerServiceStub{}
			request := httptest.NewRequest(http.MethodPost, "/vou/"+test.entity+"/create", strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			newVOUTestRouter(service, authorizer).ServeHTTP(recorder, request)
			var envelope response.Envelope
			if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if envelope.Code != response.CodeValidation || service.createCalls != 0 {
				t.Fatalf("response = %s, create calls = %d", recorder.Body.String(), service.createCalls)
			}
		})
	}
}

func TestHandlerSerializesAssetAuxiliarySnapshotsWithoutApprovalEntryID(t *testing.T) {
	service := &handlerServiceStub{getResult: DocumentView{Data: DocumentDataView{AssetAcquisitionLines: []AssetAcquisitionLineView{{
		LineID:     "line-1",
		Category:   AuxiliaryReferenceView{ObjectID: testObjectID, Entity: "asset-category", Code: "AC-1", Name: "设备"},
		Department: AuxiliaryReferenceView{ObjectID: testApprovalEntryID, Entity: "department", Code: "DEP-1", Name: "生产部"},
	}}}}}
	authorizer := authorization.Func(func(_ context.Context, _ *http.Request, _, _ string) (authorization.Principal, error) {
		return authorization.Principal{ActorID: testObjectID}, nil
	})
	request := httptest.NewRequest(http.MethodPost, "/vou/asset-acquisition/get", strings.NewReader(`{"documentId":"01J00000000000000000000003"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	newVOUTestRouter(service, authorizer).ServeHTTP(recorder, request)
	var envelope struct {
		Code int `json:"code"`
		Data struct {
			Data struct {
				Lines []struct {
					Category   map[string]any `json:"category"`
					Department map[string]any `json:"department"`
				} `json:"assetAcquisitionLines"`
			} `json:"data"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Code != response.CodeOK || len(envelope.Data.Data.Lines) != 1 {
		t.Fatalf("response = %s", recorder.Body.String())
	}
	line := envelope.Data.Data.Lines[0]
	for field, snapshot := range map[string]map[string]any{"category": line.Category, "department": line.Department} {
		if _, exists := snapshot["approvalEntryId"]; exists || len(snapshot) != 4 {
			t.Fatalf("%s snapshot = %#v", field, snapshot)
		}
	}
}
