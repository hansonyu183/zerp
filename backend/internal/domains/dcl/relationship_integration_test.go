//go:build integration

package dcl

import (
	"errors"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/oklog/ulid/v2"
)

// TestRelationshipDeclarationsDriveLatestApprovedReadsIntegration is the
// public DCL-to-BOB seam for both typed relationships. Candidates are DCL-only;
// BOB derives its view from the latest approved snapshot and naturally falls
// back after unapproval.
func TestRelationshipDeclarationsDriveLatestApprovedReadsIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	auxiliary := auxdomain.NewService(pool)
	parties := NewPartyService(pool, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	relationships := NewRelationshipService(pool, business, parties, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)
	partyReader := bobdomain.NewPartyCurrentReader(pool)

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
	} else {
		var domainErr *bobdomain.DomainError
		if !errors.As(err, &domainErr) || domainErr.Kind != bobdomain.ErrorValidation {
			if domainErr != nil {
				t.Fatalf("BOB candidate lookup error=%v cause=%v", err, domainErr.Cause)
			}
			t.Fatalf("BOB candidate lookup error=%v", err)
		}
	}
	assertRelationshipCurrentQueryAbsent(t, business, bobdomain.EntityOtherUnit)
	approveRelationshipParty(t, parties, other.PartyID, creator("other-unit-party-submit"), reviewer("other-unit-party-approve"))
	partyCurrent, err := business.PartyGet(t.Context(), bobdomain.PartyGetInput{PartyID: other.PartyID}, bobdomain.PartyRelationshipVisibility{})
	if err != nil || partyCurrent.SourceApprovalEntryID == "" || partyCurrent.SourceVersionNo != 1 {
		t.Fatalf("BOB Party current source = (%q,%d), err=%v", partyCurrent.SourceApprovalEntryID, partyCurrent.SourceVersionNo, err)
	}
	partyPage, err := business.PartyQuery(t.Context(), bobdomain.QueryInput{Page: 1, PageSize: 20, Filters: bobdomain.QueryFilters{Keyword: "测试往来单位"}})
	if err != nil || len(partyPage.Items) != 1 || partyPage.Items[0].SourceApprovalEntryID != partyCurrent.SourceApprovalEntryID || partyPage.Items[0].SourceVersionNo != 1 {
		t.Fatalf("BOB Party current query source = %+v, err=%v", partyPage.Items, err)
	}
	cards, err := partyReader.RelationshipCards(t.Context(), other.PartyID, bobdomain.PartyRelationshipVisibility{OtherUnit: true})
	if err != nil || len(cards) != 0 {
		t.Fatalf("BOB Party exposed candidate relationship: cards=%+v err=%v", cards, err)
	}
	other = submitAndApproveOtherUnit(t, relationships, other, creator("other-unit-submit"), reviewer("other-unit-approve"))
	assertRelationshipCurrent(t, business, bobdomain.EntityOtherUnit, other.ObjectID, other.Approval.ApprovalEntryID, "测试往来单位")
	assertRelationshipCurrentQuery(t, business, bobdomain.EntityOtherUnit, other.ObjectID, other.Approval.ApprovalEntryID)
	cards, err = partyReader.RelationshipCards(t.Context(), other.PartyID, bobdomain.PartyRelationshipVisibility{OtherUnit: true})
	if err != nil || len(cards) != 1 || cards[0].ObjectID != other.ObjectID || cards[0].SourceApprovalEntryID != other.Approval.ApprovalEntryID || cards[0].SourceVersionNo != 1 {
		t.Fatalf("BOB Party current relationships = %+v, err=%v", cards, err)
	}

	otherV2, err := relationships.SaveOtherUnit(t.Context(), OtherUnitSaveInput{ObjectID: other.ObjectID, ApprovalEntryID: other.Approval.ApprovalEntryID, ApprovalRevision: other.Approval.Revision, Enabled: false, Data: OtherUnitData{ContactName: "赵六", ContactPhone: "13900139000", Remark: "二版"}}, creator("other-unit-save"))
	if err != nil {
		t.Fatalf("save Other Unit V2: %v", err)
	}
	assertRelationshipCurrentQuery(t, business, bobdomain.EntityOtherUnit, other.ObjectID, other.Approval.ApprovalEntryID)
	otherV2 = submitAndApproveOtherUnit(t, relationships, otherV2, creator("other-unit-submit-v2"), reviewer("other-unit-approve-v2"))
	if _, err = relationships.UnapproveOtherUnit(t.Context(), RelationshipReviewInput{ObjectID: otherV2.ObjectID, ApprovalEntryID: otherV2.Approval.ApprovalEntryID, ApprovalRevision: otherV2.Approval.Revision, Reason: "回落"}, reviewer("other-unit-unapprove")); err != nil {
		t.Fatalf("unapprove Other Unit V2: %v", err)
	}
	assertRelationshipCurrent(t, business, bobdomain.EntityOtherUnit, other.ObjectID, other.Approval.ApprovalEntryID, "测试往来单位")
	cards, err = partyReader.RelationshipCards(t.Context(), other.PartyID, bobdomain.PartyRelationshipVisibility{OtherUnit: true})
	if err != nil || len(cards) != 1 || cards[0].SourceApprovalEntryID != other.Approval.ApprovalEntryID || cards[0].SourceVersionNo != 1 {
		t.Fatalf("BOB Party relationship fallback source = %+v, err=%v", cards, err)
	}

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
	assertRelationshipCurrentQueryAbsent(t, business, bobdomain.EntitySalesPartner)
	sales, err = relationships.ApproveSalesPartner(t.Context(), RelationshipVersionInput{ObjectID: pendingSales.ObjectID, ApprovalEntryID: pendingSales.Approval.ApprovalEntryID, ApprovalRevision: pendingSales.Approval.Revision}, reviewer("sales-partner-approve"))
	if err != nil {
		t.Fatalf("approve Sales Partner: %v", err)
	}
	assertRelationshipCurrent(t, business, bobdomain.EntitySalesPartner, sales.ObjectID, sales.Approval.ApprovalEntryID, "测试销售合作方")
	assertRelationshipCurrentQuery(t, business, bobdomain.EntitySalesPartner, sales.ObjectID, sales.Approval.ApprovalEntryID)

	salesV2, err := relationships.SaveSalesPartner(t.Context(), SalesPartnerSaveInput{
		ObjectID: sales.ObjectID, ApprovalEntryID: sales.Approval.ApprovalEntryID, ApprovalRevision: sales.Approval.Revision,
		Enabled: false, Data: SalesPartnerData{Capabilities: []string{"EXTERNAL_PART_TIME"}, ContactName: "孙八"},
	}, creator("sales-partner-save-v2"))
	if err != nil {
		t.Fatalf("save Sales Partner V2: %v", err)
	}
	salesV2, err = relationships.SubmitSalesPartner(t.Context(), RelationshipVersionInput{
		ObjectID: salesV2.ObjectID, ApprovalEntryID: salesV2.Approval.ApprovalEntryID, ApprovalRevision: salesV2.Approval.Revision,
	}, creator("sales-partner-submit-v2"))
	if err != nil {
		t.Fatalf("submit Sales Partner V2: %v", err)
	}
	assertRelationshipCurrentQuery(t, business, bobdomain.EntitySalesPartner, sales.ObjectID, sales.Approval.ApprovalEntryID)
}

func TestOtherUnitDuplicateCreateRollsBackIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	auxiliary := auxdomain.NewService(pool)
	parties := NewPartyService(pool, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	relationships := NewRelationshipService(pool, business, parties, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)

	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }
	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "重复关系主体"}}, creator("owner-create"))
	if err != nil {
		t.Fatalf("create operating entity: %v", err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("owner-submit"), reviewer("owner-approve"))

	other, err := relationships.CreateOtherUnit(t.Context(), OtherUnitCreateInput{
		NewParty:          &bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: "去重往来单位", StrongIdentifiers: []bobdomain.PartyIdentifierInput{{Type: bobdomain.PartyIdentifierUnifiedSocialCreditCode, Value: "91110108DUPOTU001"}}},
		OperatingEntityID: owner.ObjectID,
		Data:              OtherUnitData{ContactName: "联系人"},
	}, creator("other-unit-create"))
	if err != nil {
		t.Fatalf("create first other-unit: %v", err)
	}
	var otherCode string
	if err = pool.QueryRow(t.Context(), `SELECT dcl_require_subject_code(code) FROM dcl_subjects WHERE id=$1`, other.ObjectID).Scan(&otherCode); err != nil {
		t.Fatalf("read first other-unit code: %v", err)
	}
	beforeRelCount := int64(0)
	beforeSubCount := int64(0)
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM dcl_service_relationships WHERE party_id=$1 AND operating_entity_id=$2`, other.PartyID, owner.ObjectID).Scan(&beforeRelCount); err != nil {
		t.Fatalf("count other-unit relationships before: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM dcl_subjects WHERE entity='other-unit'`).Scan(&beforeSubCount); err != nil {
		t.Fatalf("count other-unit subjects before: %v", err)
	}

	if _, err = relationships.CreateOtherUnit(t.Context(), OtherUnitCreateInput{
		PartyID:           other.PartyID,
		OperatingEntityID: owner.ObjectID,
		Data:              OtherUnitData{ContactName: "重复联系人"},
	}, creator("other-unit-dup")); err == nil {
		t.Fatal("duplicate other-unit create was accepted")
	} else {
		assertDCLDomainErrorKey(t, err, ErrorConflict, "relationship_exists")
		var domainErr *DomainError
		if !errors.As(err, &domainErr) {
			t.Fatalf("duplicate error type = %T", err)
		}
		data, ok := domainErr.Data.(map[string]any)
		if !ok || data["objectId"] != other.ObjectID || data["code"] != otherCode || data["entity"] != EntityOtherUnit {
			t.Fatalf("duplicate relationship data = %#v", domainErr.Data)
		}
	}

	afterRelCount := int64(0)
	afterSubCount := int64(0)
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM dcl_service_relationships WHERE party_id=$1 AND operating_entity_id=$2`, other.PartyID, owner.ObjectID).Scan(&afterRelCount); err != nil {
		t.Fatalf("count other-unit relationships after: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM dcl_subjects WHERE entity='other-unit'`).Scan(&afterSubCount); err != nil {
		t.Fatalf("count other-unit subjects after: %v", err)
	}
	if afterRelCount != beforeRelCount {
		t.Fatalf("other-unit relationship count changed after failed create: before=%d after=%d", beforeRelCount, afterRelCount)
	}
	if afterSubCount != beforeSubCount {
		t.Fatalf("other-unit subject count changed after failed create: before=%d after=%d", beforeSubCount, afterSubCount)
	}
}

func TestSalesPartnerDraftCapabilitiesValidationIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	auxiliary := auxdomain.NewService(pool)
	parties := NewPartyService(pool, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	relationships := NewRelationshipService(pool, business, parties, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)

	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }

	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "销售伙伴草稿主体"}}, creator("owner-create"))
	if err != nil {
		t.Fatalf("create operating entity: %v", err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("owner-submit"), reviewer("owner-approve"))

	sales, err := relationships.CreateSalesPartner(t.Context(), SalesPartnerCreateInput{
		NewParty: &bobdomain.PartyCreateData{
			Kind:              bobdomain.PartyKindOrganization,
			LegalName:         "草稿销售伙伴",
			StrongIdentifiers: []bobdomain.PartyIdentifierInput{{Type: bobdomain.PartyIdentifierUnifiedSocialCreditCode, Value: "91110108DUPSAL001"}},
		},
		OperatingEntityID: owner.ObjectID,
		Data:              SalesPartnerData{Capabilities: nil, ContactName: "张三"},
	}, creator("sales-create-empty"))
	if err != nil {
		t.Fatalf("create sales partner with empty capabilities: %v", err)
	}
	if _, err = relationships.SubmitSalesPartner(t.Context(), RelationshipVersionInput{
		ObjectID: sales.ObjectID, ApprovalEntryID: sales.Approval.ApprovalEntryID, ApprovalRevision: sales.Approval.Revision,
	}, creator("sales-submit-empty")); err == nil {
		t.Fatal("submit sales partner with empty capabilities was accepted")
	} else {
		assertDCLDomainErrorKey(t, err, ErrorValidation, "validation_failed")
	}
	approveRelationshipParty(t, parties, sales.PartyID, creator("sales-party-submit"), reviewer("sales-party-approve"))

	sales, err = relationships.SaveSalesPartner(t.Context(), SalesPartnerSaveInput{
		ObjectID: sales.ObjectID, ApprovalEntryID: sales.Approval.ApprovalEntryID, ApprovalRevision: sales.Approval.Revision,
		Enabled: true, Data: SalesPartnerData{Capabilities: nil, ContactName: "李四"},
	}, creator("sales-save-empty"))
	if err != nil {
		t.Fatalf("save sales partner with empty capabilities: %v", err)
	}
	if _, err = relationships.SubmitSalesPartner(t.Context(), RelationshipVersionInput{
		ObjectID: sales.ObjectID, ApprovalEntryID: sales.Approval.ApprovalEntryID, ApprovalRevision: sales.Approval.Revision,
	}, creator("sales-submit-empty-2")); err == nil {
		t.Fatal("submit sales partner after empty save was accepted")
	} else {
		assertDCLDomainErrorKey(t, err, ErrorValidation, "validation_failed")
	}

	sales, err = relationships.SaveSalesPartner(t.Context(), SalesPartnerSaveInput{
		ObjectID: sales.ObjectID, ApprovalEntryID: sales.Approval.ApprovalEntryID, ApprovalRevision: sales.Approval.Revision,
		Enabled: true, Data: SalesPartnerData{Capabilities: []string{"CHANNEL_PARTNER"}, ContactName: "王五"},
	}, creator("sales-save-valid"))
	if err != nil {
		t.Fatalf("save sales partner with capability: %v", err)
	}
	pending, err := relationships.SubmitSalesPartner(t.Context(), RelationshipVersionInput{
		ObjectID: sales.ObjectID, ApprovalEntryID: sales.Approval.ApprovalEntryID, ApprovalRevision: sales.Approval.Revision,
	}, creator("sales-submit-valid"))
	if err != nil {
		t.Fatalf("submit sales partner with capability: %v", err)
	}
	if _, err = relationships.ApproveSalesPartner(t.Context(), RelationshipVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer("sales-approve")); err != nil {
		t.Fatalf("approve sales partner: %v", err)
	}
	approvedCount := int64(0)
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_entries WHERE domain='dcl' AND entity='sales-partner' AND subject_id=$1 AND status='APPROVED'`, sales.ObjectID).Scan(&approvedCount); err != nil {
		t.Fatalf("query approved sales-partner count: %v", err)
	}
	if approvedCount != 1 {
		t.Fatalf("expected exactly one approved sales-partner snapshot, got %d", approvedCount)
	}
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
	if view.SourceApprovalEntryID != entryID || view.Relationship == nil || view.Relationship.PartyDisplayName != name {
		t.Fatalf("BOB %s current = %+v", entity, view)
	}
}

func assertRelationshipCurrentQueryAbsent(t *testing.T, business *bobdomain.Service, entity string) {
	t.Helper()
	page, err := business.Query(t.Context(), entity, bobdomain.QueryInput{Page: 1, PageSize: 20})
	if err != nil {
		var domainErr *bobdomain.DomainError
		if errors.As(err, &domainErr) {
			t.Fatalf("query BOB %s current with only a candidate: %v cause=%v", entity, err, domainErr.Cause)
		}
		t.Fatalf("query BOB %s current with only a candidate: %v", entity, err)
	}
	if page.Total != 0 || len(page.Items) != 0 {
		t.Fatalf("BOB %s query exposed only-candidate relationship: %+v", entity, page)
	}
}

func assertRelationshipCurrentQuery(t *testing.T, business *bobdomain.Service, entity, objectID, entryID string) {
	t.Helper()
	current, err := business.Get(t.Context(), entity, bobdomain.GetInput{ObjectID: objectID})
	if err != nil {
		t.Fatalf("get BOB %s current before query: %v", entity, err)
	}
	enabled := true
	page, err := business.Query(t.Context(), entity, bobdomain.QueryInput{Page: 1, PageSize: 20, Filters: bobdomain.QueryFilters{Keyword: current.Relationship.PartyDisplayName, Enabled: &enabled}, Sort: []bobdomain.SortItem{{Field: "code", Order: "asc"}}})
	if err != nil {
		t.Fatalf("query BOB %s current: %v", entity, err)
	}
	if page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("BOB %s current query page = %+v", entity, page)
	}
	item := page.Items[0]
	if item.ObjectID != objectID || item.SourceApprovalEntryID != entryID || !item.Enabled || !item.UpdatedAt.Equal(current.UpdatedAt) {
		t.Fatalf("BOB %s current query item = %+v, current = %+v", entity, item, current)
	}
	if _, err = business.Query(t.Context(), entity, bobdomain.QueryInput{Page: 1, PageSize: 20, Sort: []bobdomain.SortItem{{Field: "lifecycle", Order: "asc"}}}); err == nil {
		t.Fatalf("BOB %s current query accepted unsupported sort", entity)
	}
}

func assertDCLDomainErrorKey(t *testing.T, err error, wantKind ErrorKind, wantKey string) {
	t.Helper()
	var domainErr *DomainError
	if err == nil || !errors.As(err, &domainErr) || domainErr.Kind != wantKind || domainErr.ErrorKey != wantKey {
		t.Fatalf("unexpected error = %#v, want kind=%v key=%q", err, wantKind, wantKey)
	}
}
