package dcl

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/api/middleware"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type partyMergeAuthorizationStub struct {
	permissionPaths []string
	permissions     []string
}

func (s *partyMergeAuthorizationStub) AuthenticateSession(context.Context, *http.Request, string, string) (authorization.Principal, error) {
	permissions := s.permissions
	if permissions == nil {
		permissions = []string{"/bob/customer/get"}
	}
	return authorization.Principal{ActorID: strings.Repeat("A", 26), Permissions: permissions}, nil
}
func (s *partyMergeAuthorizationStub) RequirePermission(_ context.Context, _ authorization.Principal, path, _ string) error {
	s.permissionPaths = append(s.permissionPaths, path)
	if path == "/dcl/party/merge-preflight" || path == "/dcl/party/merge-confirm" || path == "/dcl/party/get" {
		return nil
	}
	return authorization.NewError(authorization.ErrorForbidden, "permission denied", nil)
}
func (*partyMergeAuthorizationStub) ClearSessionCookie(http.ResponseWriter) {}

type partyHandlerStub struct {
	preflightCalls int
	getCalls       int
	visibility     bobdomain.PartyRelationshipVisibility
}

func (*partyHandlerStub) Save(context.Context, PartySaveInput, approval.Actor) (PartyMutation, error) {
	return PartyMutation{}, nil
}
func (*partyHandlerStub) Submit(context.Context, PartyVersionInput, approval.Actor) (PartyMutation, error) {
	return PartyMutation{}, nil
}
func (*partyHandlerStub) Unsubmit(context.Context, PartyReviewInput, approval.Actor) (PartyMutation, error) {
	return PartyMutation{}, nil
}
func (*partyHandlerStub) Reject(context.Context, PartyReviewInput, approval.Actor) (PartyMutation, error) {
	return PartyMutation{}, nil
}
func (*partyHandlerStub) Approve(context.Context, PartyVersionInput, approval.Actor) (PartyMutation, error) {
	return PartyMutation{}, nil
}
func (*partyHandlerStub) Unapprove(context.Context, PartyReviewInput, approval.Actor) (PartyMutation, error) {
	return PartyMutation{}, nil
}
func (*partyHandlerStub) Delete(context.Context, PartyVersionInput, approval.Actor) error { return nil }
func (s *partyHandlerStub) Get(_ context.Context, _ PartyGetInput, visibility bobdomain.PartyRelationshipVisibility, _ approval.Actor) (PartyView, error) {
	s.getCalls++
	s.visibility = visibility
	return PartyView{}, nil
}
func (*partyHandlerStub) Query(context.Context, bobdomain.QueryInput, approval.Actor) (Page[PartyListItem], error) {
	return Page[PartyListItem]{}, nil
}

func TestPartyGetHandlerPassesOnlyRelationshipGetVisibility(t *testing.T) {
	gin.SetMode(gin.TestMode)
	authorizer := &partyMergeAuthorizationStub{permissions: []string{
		"/bob/customer/get", "/bob/other-unit/get", "/bob/supplier/query",
	}}
	service := &partyHandlerStub{}
	router := gin.New()
	router.Use(middleware.RequestID())
	NewPartyHandler(service, authorizer, nil).Register(router)

	request := httptest.NewRequest(http.MethodPost, "/dcl/party/get", strings.NewReader(`{"partyId":"`+strings.Repeat("A", 26)+`"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK || service.getCalls != 1 {
		t.Fatalf("status=%d calls=%d", response.Code, service.getCalls)
	}
	if !service.visibility.Customer || !service.visibility.OtherUnit || service.visibility.Supplier || service.visibility.Employment || service.visibility.SalesPartner {
		t.Fatalf("visibility=%+v", service.visibility)
	}
}
func (*partyHandlerStub) Versions(context.Context, PartyHistoryInput, approval.Actor) (Page[PartyVersionView], error) {
	return Page[PartyVersionView]{}, nil
}
func (*partyHandlerStub) AuditHistory(context.Context, PartyHistoryInput, approval.Actor) (Page[approval.EventView], error) {
	return Page[approval.EventView]{}, nil
}
func (s *partyHandlerStub) MergePreflight(_ context.Context, input bobdomain.PartyMergePreflightInput, _ bobdomain.PartyRelationshipVisibility, _ approval.Actor) (bobdomain.PartyMergePreflightResult, error) {
	s.preflightCalls++
	return bobdomain.PartyMergePreflightResult{CanMerge: true, SourcePartyID: input.SourcePartyID, TargetPartyID: input.TargetPartyID,
		SourceApprovalEntryID: input.SourceApprovalEntryID, TargetApprovalEntryID: input.TargetApprovalEntryID,
		SourceApprovalRevision: input.SourceApprovalRevision, TargetApprovalRevision: input.TargetApprovalRevision,
		BlockReasons: []string{}, RelationshipConflicts: []bobdomain.PartyMergeRelationshipConflict{}}, nil
}
func (*partyHandlerStub) MergeConfirm(context.Context, bobdomain.PartyMergeConfirmInput, bobdomain.PartyRelationshipVisibility, approval.Actor) (bobdomain.PartyMergeResult, error) {
	return bobdomain.PartyMergeResult{}, nil
}

func TestPartyMergeHandlerUsesDCLExactPermission(t *testing.T) {
	gin.SetMode(gin.TestMode)
	authorizer := &partyMergeAuthorizationStub{}
	merger := &partyHandlerStub{}
	router := gin.New()
	router.Use(middleware.RequestID())
	NewPartyHandler(merger, authorizer, nil).Register(router)

	id := strings.Repeat("A", 26)
	request := httptest.NewRequest(http.MethodPost, "/dcl/party/merge-preflight", strings.NewReader(`{"sourcePartyId":"`+id+`","targetPartyId":"`+strings.Repeat("B", 26)+`","sourceApprovalEntryId":"`+strings.Repeat("C", 26)+`","targetApprovalEntryId":"`+strings.Repeat("D", 26)+`","sourceApprovalRevision":1,"targetApprovalRevision":1}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK || merger.preflightCalls != 1 {
		t.Fatalf("status=%d calls=%d", response.Code, merger.preflightCalls)
	}
	if len(authorizer.permissionPaths) != 1 || authorizer.permissionPaths[0] != "/dcl/party/merge-preflight" {
		t.Fatalf("permission paths=%#v", authorizer.permissionPaths)
	}
}
