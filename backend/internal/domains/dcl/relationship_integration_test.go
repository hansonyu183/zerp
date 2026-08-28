//go:build integration

package dcl

import (
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/oklog/ulid/v2"
)

// TestRelationshipDeclarationsOwnCurrentProjectionIntegration is the public
// DCL-to-BOB seam for both typed relationships. Candidates are DCL-only;
// approval applies the BOB current projection, and unapproval restores the
// preceding approved snapshot atomically.
func TestRelationshipDeclarationsOwnCurrentProjectionIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	auxiliary := auxdomain.NewService(pool, authorizer, bus)
	parties := NewPartyService(pool, bobdomain.NewPartyCurrentWriter(pool), bobdomain.NewPartyCurrentReader(pool), bobdomain.NewPartyMergeEngine(pool), authorizer, bus)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary), authorizer, bus)
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	relationships := NewRelationshipService(pool, business, parties, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)

	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }
	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "关系所属主体"}}, creator("owner-create"))
	if err != nil {
		t.Fatalf("create operating entity: %v", err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("owner-submit"), reviewer("owner-approve"))

	other, err := relationships.CreateOtherUnit(t.Context(), OtherUnitCreateInput{
		NewParty:          &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: "测试往来单位", StrongIdentifiers: []bobdomain.PartyIdentifierInput{{Type: bobdomain.PartyIdentifierUnifiedSocialCreditCode, Value: "91110108TESTREL001"}}},
		OperatingEntityID: owner.ObjectID,
		Data:              OtherUnitData{ContactName: "王五", ContactPhone: "13800138000", Remark: "首版"},
	}, creator("other-unit-create"))
	if err != nil {
		t.Fatalf("create Other Unit: %v", err)
	}
	if _, err = business.Get(t.Context(), bobdomain.EntityOtherUnit, bobdomain.GetInput{ObjectID: other.ObjectID}); err == nil {
		t.Fatal("BOB exposed unapproved Other Unit")
	}
	approveRelationshipParty(t, parties, other.PartyID, creator("other-unit-party-submit"), reviewer("other-unit-party-approve"))
	other = submitAndApproveOtherUnit(t, relationships, other, creator("other-unit-submit"), reviewer("other-unit-approve"))
	assertRelationshipCurrent(t, business, bobdomain.EntityOtherUnit, other.ObjectID, other.Approval.ApprovalEntryID, "测试往来单位")

	otherV2, err := relationships.SaveOtherUnit(t.Context(), OtherUnitSaveInput{ObjectID: other.ObjectID, ApprovalEntryID: other.Approval.ApprovalEntryID, ApprovalRevision: other.Approval.Revision, Enabled: false, Data: OtherUnitData{ContactName: "赵六", ContactPhone: "13900139000", Remark: "二版"}}, creator("other-unit-save"))
	if err != nil {
		t.Fatalf("save Other Unit V2: %v", err)
	}
	otherV2 = submitAndApproveOtherUnit(t, relationships, otherV2, creator("other-unit-submit-v2"), reviewer("other-unit-approve-v2"))
	if _, err = relationships.UnapproveOtherUnit(t.Context(), RelationshipReviewInput{ObjectID: otherV2.ObjectID, ApprovalEntryID: otherV2.Approval.ApprovalEntryID, ApprovalRevision: otherV2.Approval.Revision, Reason: "回落"}, reviewer("other-unit-unapprove")); err != nil {
		t.Fatalf("unapprove Other Unit V2: %v", err)
	}
	assertRelationshipCurrent(t, business, bobdomain.EntityOtherUnit, other.ObjectID, other.Approval.ApprovalEntryID, "测试往来单位")

	sales, err := relationships.CreateSalesPartner(t.Context(), SalesPartnerCreateInput{
		NewParty:          &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: "测试销售合作方", StrongIdentifiers: []bobdomain.PartyIdentifierInput{{Type: bobdomain.PartyIdentifierUnifiedSocialCreditCode, Value: "91110108TESTREL002"}}},
		OperatingEntityID: owner.ObjectID,
		Data:              SalesPartnerData{Capabilities: []string{"CHANNEL_PARTNER"}, ContactName: "钱七"},
	}, creator("sales-partner-create"))
	if err != nil {
		t.Fatalf("create Sales Partner: %v", err)
	}
	approveRelationshipParty(t, parties, sales.PartyID, creator("sales-partner-party-submit"), reviewer("sales-partner-party-approve"))
	pendingSales, err := relationships.SubmitSalesPartner(t.Context(), RelationshipVersionInput{ObjectID: sales.ObjectID, ApprovalEntryID: sales.Approval.ApprovalEntryID, ApprovalRevision: sales.Approval.Revision}, creator("sales-partner-submit"))
	if err != nil {
		t.Fatalf("submit Sales Partner: %v", err)
	}
	sales, err = relationships.ApproveSalesPartner(t.Context(), RelationshipVersionInput{ObjectID: pendingSales.ObjectID, ApprovalEntryID: pendingSales.Approval.ApprovalEntryID, ApprovalRevision: pendingSales.Approval.Revision}, reviewer("sales-partner-approve"))
	if err != nil {
		t.Fatalf("approve Sales Partner: %v", err)
	}
	assertRelationshipCurrent(t, business, bobdomain.EntitySalesPartner, sales.ObjectID, sales.Approval.ApprovalEntryID, "测试销售合作方")
}

func approveRelationshipParty(t *testing.T, parties *PartyService, partyID string, creator, reviewer approval.Actor) {
	t.Helper()
	view, err := parties.Get(t.Context(), PartyGetInput{PartyID: partyID}, bobdomain.PartyRelationshipVisibility{}, creator)
	if err != nil {
		t.Fatalf("get relationship Party: %v", err)
	}
	pending, err := parties.Submit(t.Context(), PartyVersionInput{PartyID: partyID, ApprovalEntryID: view.Approval.ApprovalEntryID, ApprovalRevision: view.Approval.Revision}, creator)
	if err != nil {
		t.Fatalf("submit relationship Party: %v", err)
	}
	if _, err = parties.Approve(t.Context(), PartyVersionInput{PartyID: partyID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer); err != nil {
		t.Fatalf("approve relationship Party: %v", err)
	}
}

func submitAndApproveOtherUnit(t *testing.T, service *RelationshipService, mutation RelationshipMutation, submitter, reviewer approval.Actor) RelationshipMutation {
	t.Helper()
	pending, err := service.SubmitOtherUnit(t.Context(), RelationshipVersionInput{ObjectID: mutation.ObjectID, ApprovalEntryID: mutation.Approval.ApprovalEntryID, ApprovalRevision: mutation.Approval.Revision}, submitter)
	if err != nil {
		t.Fatalf("submit Other Unit: %v", err)
	}
	approved, err := service.ApproveOtherUnit(t.Context(), RelationshipVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer)
	if err != nil {
		t.Fatalf("approve Other Unit: %v", err)
	}
	return approved
}

func assertRelationshipCurrent(t *testing.T, business *bobdomain.Service, entity, objectID, entryID, name string) {
	t.Helper()
	view, err := business.Get(t.Context(), entity, bobdomain.GetInput{ObjectID: objectID})
	if err != nil {
		t.Fatalf("get BOB %s current: %v", entity, err)
	}
	if view.Approval.ApprovalEntryID != entryID || view.Relationship == nil || view.Relationship.PartyDisplayName != name {
		t.Fatalf("BOB %s current = %+v", entity, view)
	}
}
