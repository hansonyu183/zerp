//go:build integration

package dcl

import (
	"context"
	"errors"
	"slices"
	"sort"
	"testing"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type signalingRelationshipPartyReader struct {
	called chan<- struct{}
	result bobdomain.PartyRelationshipResolved
}

func TestPartyQueryAndGetReturnServerApprovalActionsIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	service := newPartyIntegrationService(pool, nil)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	permissions := []string{
		"/dcl/party/submit", "/dcl/party/unsubmit", "/dcl/party/reject",
		"/dcl/party/approve", "/dcl/party/unapprove",
	}
	creator := func(requestID string) approval.Actor {
		return dclActorWithPermissions(t, creatorID, requestID, permissions...)
	}
	reviewer := func(requestID string) approval.Actor {
		return dclActorWithPermissions(t, reviewerID, requestID, permissions...)
	}

	draft := createPartyDraft(t, service, partyDeclarationData("动作资格主体", "91310000PARTYACTION"), creator("party-actions-create"))
	assertPartyProjectionActions(t, service, draft.PartyID, creator("party-actions-draft-query"), []approval.LifecycleAction{approval.LifecycleSubmit})

	pending, err := service.Submit(t.Context(), partyVersionInput(draft), creator("party-actions-submit"))
	if err != nil {
		t.Fatalf("submit Party: %v", err)
	}
	assertPartyProjectionActions(t, service, draft.PartyID, creator("party-actions-self-query"), []approval.LifecycleAction{approval.LifecycleUnsubmit})
	assertPartyProjectionActions(t, service, draft.PartyID, reviewer("party-actions-reviewer-query"), []approval.LifecycleAction{
		approval.LifecycleUnsubmit, approval.LifecycleReject, approval.LifecycleApprove,
	})

	approved, err := service.Approve(t.Context(), partyVersionInput(pending), reviewer("party-actions-approve"))
	if err != nil {
		t.Fatalf("approve Party: %v", err)
	}
	if approved.Approval.Status != approval.StatusApproved {
		t.Fatalf("approved status = %s", approved.Approval.Status)
	}
	assertPartyProjectionActions(t, service, draft.PartyID, reviewer("party-actions-approved-query"), []approval.LifecycleAction{approval.LifecycleUnapprove})
}

func assertPartyProjectionActions(
	t *testing.T,
	service *PartyService,
	partyID string,
	actor approval.Actor,
	want []approval.LifecycleAction,
) {
	t.Helper()
	view, err := service.Get(t.Context(), PartyGetInput{PartyID: partyID}, bobdomain.PartyRelationshipVisibility{}, actor)
	if err != nil {
		t.Fatalf("get Party: %v", err)
	}
	if !slices.Equal(view.AvailableApprovalActions, want) {
		t.Fatalf("get actions = %v, want %v", view.AvailableApprovalActions, want)
	}
	page, err := service.Query(t.Context(), bobdomain.QueryInput{Page: 1, PageSize: 20}, actor)
	if err != nil {
		t.Fatalf("query Parties: %v", err)
	}
	for _, item := range page.Items {
		if item.PartyID == partyID {
			if !slices.Equal(item.AvailableApprovalActions, want) {
				t.Fatalf("query actions = %v, want %v", item.AvailableApprovalActions, want)
			}
			return
		}
	}
	t.Fatalf("Party %s absent from query", partyID)
}

func (r signalingRelationshipPartyReader) ResolveForRelationship(context.Context, pgx.Tx, string) (bobdomain.PartyRelationshipResolved, error) {
	r.called <- struct{}{}
	return r.result, nil
}

// This is the public DCL lifecycle seam: the test only observes durable
// Approval, typed snapshots, latest-approved visibility and identifier claims.
func TestPartyDeclarationLifecycleControlsCurrentAndClaimsIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	service := newPartyIntegrationService(pool, nil)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }

	v1 := createPartyDraft(t, service, partyDeclarationData("主体 V1", "91310000PARTYV1001"), creator("create-v1"))
	assertPartyCurrent(t, pool, v1.PartyID, "", "")
	assertPartyClaims(t, pool, []partyClaim{{bobdomain.PartyIdentifierUnifiedSocialCreditCode, "91310000PARTYV1001", "", "", v1.PartyID, v1.Approval.ApprovalEntryID}})

	v1, err := service.Submit(t.Context(), partyVersionInput(v1), creator("submit-v1"))
	if err != nil {
		t.Fatalf("submit V1: %v", err)
	}
	assertPartyCurrent(t, pool, v1.PartyID, "", "")
	assertPartyClaims(t, pool, []partyClaim{{bobdomain.PartyIdentifierUnifiedSocialCreditCode, "91310000PARTYV1001", "", "", v1.PartyID, v1.Approval.ApprovalEntryID}})

	v1, err = service.Approve(t.Context(), partyVersionInput(v1), reviewer("approve-v1"))
	if err != nil {
		t.Fatalf("approve V1: %v", err)
	}
	assertPartyCurrent(t, pool, v1.PartyID, v1.Approval.ApprovalEntryID, "主体 V1")
	assertPartyClaims(t, pool, []partyClaim{{bobdomain.PartyIdentifierUnifiedSocialCreditCode, "91310000PARTYV1001", v1.PartyID, v1.Approval.ApprovalEntryID, "", ""}})

	v2, err := service.Save(t.Context(), PartySaveInput{PartyID: v1.PartyID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Data: partyDeclarationData("主体 V2", "91310000PARTYV2002")}, creator("save-v2"))
	if err != nil {
		t.Fatalf("save V2: %v", err)
	}
	if v2.Approval.VersionNo != 2 || v2.Approval.Status != approval.StatusDraft {
		t.Fatalf("V2 candidate = %+v", v2.Approval)
	}
	assertPartyCurrent(t, pool, v1.PartyID, v1.Approval.ApprovalEntryID, "主体 V1")
	assertPartyClaims(t, pool, []partyClaim{
		{bobdomain.PartyIdentifierUnifiedSocialCreditCode, "91310000PARTYV1001", v1.PartyID, v1.Approval.ApprovalEntryID, "", ""},
		{bobdomain.PartyIdentifierUnifiedSocialCreditCode, "91310000PARTYV2002", "", "", v1.PartyID, v2.Approval.ApprovalEntryID},
	})

	v2, err = service.Submit(t.Context(), partyVersionInput(v2), creator("submit-v2"))
	if err != nil {
		t.Fatalf("submit V2: %v", err)
	}
	assertPartyCurrent(t, pool, v1.PartyID, v1.Approval.ApprovalEntryID, "主体 V1")

	v2, err = service.Approve(t.Context(), partyVersionInput(v2), reviewer("approve-v2"))
	if err != nil {
		t.Fatalf("approve V2: %v", err)
	}
	assertPartyCurrent(t, pool, v1.PartyID, v2.Approval.ApprovalEntryID, "主体 V2")
	assertPartyClaims(t, pool, []partyClaim{{bobdomain.PartyIdentifierUnifiedSocialCreditCode, "91310000PARTYV2002", v1.PartyID, v2.Approval.ApprovalEntryID, "", ""}})

	v2, err = service.Unapprove(t.Context(), PartyReviewInput{PartyID: v1.PartyID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "回落 V1"}, creator("unapprove-v2"))
	if err != nil {
		t.Fatalf("unapprove V2: %v", err)
	}
	assertPartyCurrent(t, pool, v1.PartyID, v1.Approval.ApprovalEntryID, "主体 V1")
	assertPartyClaims(t, pool, []partyClaim{
		{bobdomain.PartyIdentifierUnifiedSocialCreditCode, "91310000PARTYV1001", v1.PartyID, v1.Approval.ApprovalEntryID, "", ""},
		{bobdomain.PartyIdentifierUnifiedSocialCreditCode, "91310000PARTYV2002", "", "", v1.PartyID, v2.Approval.ApprovalEntryID},
	})
	v2, err = service.Unsubmit(t.Context(), PartyReviewInput{PartyID: v2.PartyID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision}, creator("unsubmit-v2"))
	if err != nil {
		t.Fatalf("unsubmit V2: %v", err)
	}
	if err = service.Delete(t.Context(), partyVersionInput(v2), creator("delete-v2")); err != nil {
		t.Fatalf("delete V2: %v", err)
	}
	assertPartyClaims(t, pool, []partyClaim{{bobdomain.PartyIdentifierUnifiedSocialCreditCode, "91310000PARTYV1001", v1.PartyID, v1.Approval.ApprovalEntryID, "", ""}})

	if _, err = service.Unapprove(t.Context(), PartyReviewInput{PartyID: v1.PartyID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Reason: "撤销首版"}, creator("unapprove-v1")); err != nil {
		t.Fatalf("unapprove V1: %v", err)
	}
	assertPartyCurrent(t, pool, v1.PartyID, "", "")
	assertPartyClaims(t, pool, []partyClaim{{bobdomain.PartyIdentifierUnifiedSocialCreditCode, "91310000PARTYV1001", "", "", v1.PartyID, v1.Approval.ApprovalEntryID}})
}

func TestPartyLastApprovedVersionIsBlockedByApprovedRelationshipIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	auxiliary := auxdomain.NewService(pool)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
	parties := NewPartyService(pool, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	relationships := NewRelationshipService(
		pool, business, parties, bobdomain.NewPartyCurrentReader(pool), authorizer, bus,
	)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }

	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{
		Data: bobdomain.OperatingEntityData{Name: "Party blocker 经营主体"},
	}, creator("owner-create"))
	if err != nil {
		t.Fatal(err)
	}
	owner = submitAndApproveOperatingEntity(
		t, operating, owner, creator("owner-submit"), reviewer("owner-approve"),
	)
	relation, err := relationships.CreateOtherUnit(t.Context(), OtherUnitCreateInput{
		OperatingEntityID: owner.ObjectID,
		NewParty: &bobdomain.PartyCreateData{
			Kind:      bobdomain.PartyKindOrganization,
			LegalName: "有正式关系的主体",
			StrongIdentifiers: []bobdomain.PartyIdentifierInput{{
				Type: bobdomain.PartyIdentifierUnifiedSocialCreditCode, Value: "91310000BLOCK31501",
			}},
		},
		Data: OtherUnitData{},
	}, creator("relationship-create"))
	if err != nil {
		t.Fatalf("create relationship: %v", err)
	}
	approveRelationshipParty(
		t, parties, relation.PartyID, creator("party-submit"), reviewer("party-approve"),
	)
	partyView, err := parties.Get(
		t.Context(), PartyGetInput{PartyID: relation.PartyID},
		bobdomain.PartyRelationshipVisibility{}, creator("party-get"),
	)
	if err != nil {
		t.Fatalf("get approved Party: %v", err)
	}
	relation, err = relationships.SubmitOtherUnit(t.Context(), RelationshipVersionInput{
		ObjectID: relation.ObjectID, ApprovalEntryID: relation.Approval.ApprovalEntryID,
		ApprovalRevision: relation.Approval.Revision,
	}, creator("relationship-submit"))
	if err != nil {
		t.Fatalf("submit relationship: %v", err)
	}
	relation, err = relationships.ApproveOtherUnit(t.Context(), RelationshipVersionInput{
		ObjectID: relation.ObjectID, ApprovalEntryID: relation.Approval.ApprovalEntryID,
		ApprovalRevision: relation.Approval.Revision,
	}, reviewer("relationship-approve"))
	if err != nil {
		t.Fatalf("approve relationship: %v", err)
	}
	partyV2, err := parties.Save(t.Context(), PartySaveInput{
		PartyID: partyView.PartyID, ApprovalEntryID: partyView.Approval.ApprovalEntryID,
		ApprovalRevision: partyView.Approval.Revision,
		Data:             partyDeclarationData("有正式关系的主体 V2", "91310000BLOCK31502"),
	}, creator("party-v2-save"))
	if err != nil {
		t.Fatalf("save Party V2: %v", err)
	}
	partyV2, err = parties.Submit(t.Context(), partyVersionInput(partyV2), creator("party-v2-submit"))
	if err != nil {
		t.Fatalf("submit Party V2: %v", err)
	}
	partyV2, err = parties.Approve(t.Context(), partyVersionInput(partyV2), reviewer("party-v2-approve"))
	if err != nil {
		t.Fatalf("approve Party V2: %v", err)
	}
	partyV2, err = parties.Unapprove(t.Context(), PartyReviewInput{
		PartyID: partyV2.PartyID, ApprovalEntryID: partyV2.Approval.ApprovalEntryID,
		ApprovalRevision: partyV2.Approval.Revision, Reason: "回退到仍获批准的 V1",
	}, reviewer("party-v2-unapprove"))
	if err != nil {
		t.Fatalf("unapprove Party V2 with approved V1 fallback: %v", err)
	}
	assertPartyCurrent(t, pool, partyView.PartyID, partyView.Approval.ApprovalEntryID, "有正式关系的主体")
	partyV2, err = parties.Unsubmit(t.Context(), PartyReviewInput{
		PartyID: partyV2.PartyID, ApprovalEntryID: partyV2.Approval.ApprovalEntryID,
		ApprovalRevision: partyV2.Approval.Revision,
	}, creator("party-v2-unsubmit"))
	if err != nil {
		t.Fatalf("unsubmit Party V2: %v", err)
	}
	if err = parties.Delete(t.Context(), partyVersionInput(partyV2), creator("party-v2-delete")); err != nil {
		t.Fatalf("delete Party V2: %v", err)
	}

	_, err = parties.Unapprove(t.Context(), PartyReviewInput{
		PartyID: relation.PartyID, ApprovalEntryID: partyView.Approval.ApprovalEntryID,
		ApprovalRevision: partyView.Approval.Revision, Reason: "正式关系仍存在",
	}, reviewer("party-unapprove"))
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "bob_unapprove_blocked" {
		t.Fatalf("Party unapprove blocker error = %v", err)
	}
	blockers, ok := domainErr.Data.(bobdomain.ActiveReferenceBlockers)
	if !ok || len(blockers.References) != 1 || blockers.References[0] != (bobdomain.ActiveReferenceCount{
		Entity: EntityOtherUnit, Field: "partyId", Count: 1,
	}) {
		t.Fatalf("Party unapprove blockers = %#v", domainErr.Data)
	}
	assertApprovalState(
		t, pool, partyView.Approval.ApprovalEntryID, approval.StatusApproved, partyView.Approval.Revision,
	)
}

func TestPartyUnapproveAndRelationshipApproveSerializeOnPartyRootIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	auxiliary := auxdomain.NewService(pool)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
	parties := NewPartyService(pool, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	relationships := NewRelationshipService(pool, business, parties, bobdomain.NewPartyCurrentReader(pool), authorizer, bus)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }

	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{
		Data: bobdomain.OperatingEntityData{Name: "Party race 经营主体"},
	}, creator("race-owner-create"))
	if err != nil {
		t.Fatal(err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("race-owner-submit"), reviewer("race-owner-approve"))
	relation, err := relationships.CreateOtherUnit(t.Context(), OtherUnitCreateInput{
		OperatingEntityID: owner.ObjectID,
		NewParty: &bobdomain.PartyCreateData{
			Kind: bobdomain.PartyKindOrganization, LegalName: "并发主体",
			StrongIdentifiers: []bobdomain.PartyIdentifierInput{{
				Type: bobdomain.PartyIdentifierUnifiedSocialCreditCode, Value: "91310000RACE315001",
			}},
		},
		Data: OtherUnitData{},
	}, creator("race-relationship-create"))
	if err != nil {
		t.Fatal(err)
	}
	approveRelationshipParty(t, parties, relation.PartyID, creator("race-party-submit"), reviewer("race-party-approve"))
	partyView, err := parties.Get(t.Context(), PartyGetInput{PartyID: relation.PartyID}, bobdomain.PartyRelationshipVisibility{}, creator("race-party-get"))
	if err != nil {
		t.Fatal(err)
	}
	relation, err = relationships.SubmitOtherUnit(t.Context(), RelationshipVersionInput{
		ObjectID: relation.ObjectID, ApprovalEntryID: relation.Approval.ApprovalEntryID,
		ApprovalRevision: relation.Approval.Revision,
	}, creator("race-relationship-submit"))
	if err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	relationshipResult := make(chan error, 1)
	partyResult := make(chan error, 1)
	relationshipActor := reviewer("race-relationship-approve")
	partyActor := reviewer("race-party-unapprove")
	go func() {
		<-start
		_, approveErr := relationships.ApproveOtherUnit(t.Context(), RelationshipVersionInput{
			ObjectID: relation.ObjectID, ApprovalEntryID: relation.Approval.ApprovalEntryID,
			ApprovalRevision: relation.Approval.Revision,
		}, relationshipActor)
		relationshipResult <- approveErr
	}()
	go func() {
		<-start
		_, unapproveErr := parties.Unapprove(t.Context(), PartyReviewInput{
			PartyID: partyView.PartyID, ApprovalEntryID: partyView.Approval.ApprovalEntryID,
			ApprovalRevision: partyView.Approval.Revision, Reason: "并发撤销",
		}, partyActor)
		partyResult <- unapproveErr
	}()
	close(start)
	relationshipErr, partyErr := <-relationshipResult, <-partyResult

	q := dbsqlc.New(pool)
	partyEntry, err := q.GetApprovalEntry(t.Context(), dbsqlc.GetApprovalEntryParams{
		ID: partyView.Approval.ApprovalEntryID, Domain: "dcl", Entity: EntityParty,
	})
	if err != nil {
		t.Fatal(err)
	}
	relationshipEntry, err := q.GetApprovalEntry(t.Context(), dbsqlc.GetApprovalEntryParams{
		ID: relation.Approval.ApprovalEntryID, Domain: "dcl", Entity: EntityOtherUnit,
	})
	if err != nil {
		t.Fatal(err)
	}
	if partyEntry.Status != string(approval.StatusApproved) && relationshipEntry.Status == string(approval.StatusApproved) {
		t.Fatalf("orphaned approved relationship: Party=%s relationship=%s errors=(%v, %v)", partyEntry.Status, relationshipEntry.Status, partyErr, relationshipErr)
	}
	if relationshipErr == nil {
		var domainErr *DomainError
		if !errors.As(partyErr, &domainErr) || domainErr.ErrorKey != "bob_unapprove_blocked" {
			t.Fatalf("relationship won race but Party error=%v", partyErr)
		}
	} else if partyErr == nil {
		if partyEntry.Status != string(approval.StatusPending) || relationshipEntry.Status != string(approval.StatusPending) {
			t.Fatalf("Party won race states=(%s,%s), relationship error=%v", partyEntry.Status, relationshipEntry.Status, relationshipErr)
		}
	} else {
		t.Fatalf("both concurrent operations failed: Party=%v relationship=%v", partyErr, relationshipErr)
	}
}

func TestRelationshipCreateLocksPartyRootBeforeReadingApprovedPartyIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	parties := newPartyIntegrationService(pool, nil)
	actor := dclActor(t, ulid.Make().String(), "relationship-create-root-lock")
	party := createPartyDraft(
		t, parties, partyDeclarationData("创建串行主体", "91310000CREATE31501"), actor,
	)

	rootTx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer rootTx.Rollback(t.Context())
	if err = lockPartyRoot(t.Context(), rootTx, party.PartyID); err != nil {
		t.Fatalf("lock Party root: %v", err)
	}
	createTx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer createTx.Rollback(t.Context())
	called := make(chan struct{}, 1)
	result := make(chan error, 1)
	go func() {
		_, resolveErr := resolveExistingPartyForRelationship(
			context.Background(), createTx,
			signalingRelationshipPartyReader{
				called: called,
				result: bobdomain.PartyRelationshipResolved{ID: party.PartyID},
			},
			party.PartyID,
		)
		result <- resolveErr
	}()

	select {
	case <-called:
		t.Fatal("relationship create read Party before acquiring its stable root lock")
	case <-time.After(150 * time.Millisecond):
	}
	if err = rootTx.Commit(t.Context()); err != nil {
		t.Fatalf("release Party root: %v", err)
	}
	select {
	case err = <-result:
		if err != nil {
			t.Fatalf("resolve Party after root release: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("relationship create did not continue after Party root release")
	}
	select {
	case <-called:
	default:
		t.Fatal("relationship create never read the Party after acquiring its root lock")
	}
}

func TestPartyIdentifierClaimsRejectCrossPartyAndReleaseCandidateChangesIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	service := newPartyIntegrationService(pool, nil)
	creator := func(requestID string) approval.Actor { return dclActor(t, ulid.Make().String(), requestID) }
	v1 := createPartyDraft(t, service, partyDeclarationData("主体 A", "91310000CLAIM00001"), creator("create-a"))
	conflictTx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.CreateForRelationship(t.Context(), conflictTx, partyDeclarationData("主体 B", "91310000CLAIM00001"), creator("create-conflict"), true)
	_ = conflictTx.Rollback(t.Context())
	if err == nil {
		t.Fatal("cross-party strong identifier conflict unexpectedly succeeded")
	}

	v1, err = service.Save(t.Context(), PartySaveInput{PartyID: v1.PartyID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Data: partyDeclarationData("主体 A", "91310000CLAIM00002")}, creator("replace-candidate"))
	if err != nil {
		t.Fatalf("replace candidate identifier: %v", err)
	}
	assertPartyClaims(t, pool, []partyClaim{{bobdomain.PartyIdentifierUnifiedSocialCreditCode, "91310000CLAIM00002", "", "", v1.PartyID, v1.Approval.ApprovalEntryID}})
	_ = createPartyDraft(t, service, partyDeclarationData("主体 B", "91310000CLAIM00001"), creator("claim-released-a"))
	if err = service.Delete(t.Context(), partyVersionInput(v1), creator("delete-v1")); err == nil {
		t.Fatal("initial Party declaration delete unexpectedly succeeded")
	}
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "party_initial_declaration_delete_blocked" {
		t.Fatalf("initial Party delete error = %v", err)
	}
	v1 = approveParty(t, service, v1, creator("submit-a"), creator("approve-a"))
	v2, err := service.Save(t.Context(), PartySaveInput{PartyID: v1.PartyID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Data: partyDeclarationData("主体 A V2", "91310000CLAIM00003")}, creator("save-v2"))
	if err != nil {
		t.Fatalf("create V2 candidate: %v", err)
	}
	if err = service.Delete(t.Context(), partyVersionInput(v2), creator("delete-v2")); err != nil {
		t.Fatalf("delete V2 candidate: %v", err)
	}
	_ = createPartyDraft(t, service, partyDeclarationData("主体 C", "91310000CLAIM00003"), creator("claim-released-b"))
}

func TestPartyIdentifierReuseReturnsApprovedPartyOnlyWhenReadableIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	service := newPartyIntegrationService(pool, nil)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	existing := approveParty(t, service,
		createPartyDraft(t, service, partyDeclarationData("复用主体", "91310000REUSE0001"), creator("create")),
		creator("submit"), dclActor(t, reviewerID, "approve"))

	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := service.CreateForRelationship(t.Context(), tx, partyDeclarationData("不会覆盖当前资料", "91310000REUSE0001"), creator("reuse-readable"), true)
	if err != nil {
		_ = tx.Rollback(t.Context())
		t.Fatalf("reuse readable Party: %v", err)
	}
	if resolved.ID != existing.PartyID || resolved.DisplayName != "复用主体" {
		_ = tx.Rollback(t.Context())
		t.Fatalf("resolved Party = %+v, want existing %s", resolved, existing.PartyID)
	}
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatal(err)
	}

	hiddenTx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.CreateForRelationship(t.Context(), hiddenTx, partyDeclarationData("隐藏复用", "91310000REUSE0001"), creator("reuse-hidden"), false)
	_ = hiddenTx.Rollback(t.Context())
	if err == nil {
		t.Fatal("hidden claimed Party unexpectedly reused")
	}
	var roots, entries int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM dcl_parties WHERE id=$1`, existing.PartyID).Scan(&roots); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_entries WHERE domain='dcl' AND entity='party'`).Scan(&entries); err != nil {
		t.Fatal(err)
	}
	if roots != 1 || entries != 1 {
		t.Fatalf("reuse created duplicate state: roots=%d entries=%d", roots, entries)
	}
}

func TestPartyFirstRelationshipTransactionRollbackLeavesNoDeclarationIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	service := newPartyIntegrationService(pool, nil)
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	created, err := service.CreateForRelationship(t.Context(), tx, partyDeclarationData("回滚主体", "91310000ROLLBACK01"), dclActor(t, ulid.Make().String(), "relationship-fails"), true)
	if err != nil {
		t.Fatalf("create Party declaration: %v", err)
	}
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatalf("rollback relationship transaction: %v", err)
	}
	for table, predicate := range map[string]string{
		"dcl_parties": "id=$1", "dcl_subjects": "id=$1", "approval_entries": "subject_id=$1", "dcl_party_versions": "party_id=$1",
		"dcl_party_identifier_claims": "open_party_id=$1 OR approved_party_id=$1",
	} {
		var count int
		if err = pool.QueryRow(t.Context(), "SELECT count(*) FROM "+table+" WHERE "+predicate, created.ID).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("rollback leaked %d rows in %s", count, table)
		}
	}
}

func TestPartyMergeHidesSourceRetainsClaimsAndBlocksOpenCandidateIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	service := newPartyIntegrationService(pool, nil)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }
	source := approveParty(t, service, createPartyDraft(t, service, partyDeclarationData("来源", "91310000MERGESRC01"), creator("source-create")), creator("source-submit"), reviewer("source-approve"))
	target := approveParty(t, service, createPartyDraft(t, service, partyDeclarationData("保留", "91310000MERGETGT01"), creator("target-create")), creator("target-submit"), reviewer("target-approve"))
	open, err := service.Save(t.Context(), PartySaveInput{PartyID: source.PartyID, ApprovalEntryID: source.Approval.ApprovalEntryID, ApprovalRevision: source.Approval.Revision, Data: partyDeclarationData("来源候选", "91310000MERGESRC02")}, creator("source-open"))
	if err != nil {
		t.Fatalf("create source candidate: %v", err)
	}
	preflight, err := service.MergePreflight(t.Context(), mergePreflight(source, target), bobdomain.PartyRelationshipVisibility{}, creator("preflight-blocked"))
	if err != nil {
		t.Fatalf("preflight with candidate: %v", err)
	}
	if preflight.CanMerge || len(preflight.BlockReasons) == 0 {
		t.Fatalf("preflight did not block open candidate: %+v", preflight)
	}
	if err = service.Delete(t.Context(), partyVersionInput(open), creator("delete-source-candidate")); err != nil {
		t.Fatalf("delete source candidate: %v", err)
	}
	preflight, err = service.MergePreflight(t.Context(), mergePreflight(source, target), bobdomain.PartyRelationshipVisibility{}, creator("preflight"))
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	if !preflight.CanMerge {
		t.Fatalf("preflight cannot merge: %+v", preflight)
	}
	if _, err = service.MergeConfirm(t.Context(), bobdomain.PartyMergeConfirmInput{PreflightID: preflight.PreflightID}, bobdomain.PartyRelationshipVisibility{}, creator("confirm")); err != nil {
		t.Fatalf("confirm merge: %v", err)
	}
	assertPartyCurrent(t, pool, source.PartyID, "", "")
	assertPartyCurrent(t, pool, target.PartyID, target.Approval.ApprovalEntryID, "保留")
	assertPartyClaims(t, pool, []partyClaim{
		{bobdomain.PartyIdentifierUnifiedSocialCreditCode, "91310000MERGESRC01", source.PartyID, source.Approval.ApprovalEntryID, "", ""},
		{bobdomain.PartyIdentifierUnifiedSocialCreditCode, "91310000MERGETGT01", target.PartyID, target.Approval.ApprovalEntryID, "", ""},
	})
	assertPartyMergeAudit(t, service, source.PartyID, creator("source-audit"))
	assertPartyMergeAudit(t, service, target.PartyID, creator("target-audit"))
}

func assertPartyMergeAudit(t *testing.T, service *PartyService, partyID string, actor approval.Actor) {
	t.Helper()
	history, err := service.AuditHistory(t.Context(), PartyHistoryInput{PartyID: partyID, Page: 1, PageSize: 100}, actor)
	if err != nil {
		t.Fatalf("get Party merge audit: %v", err)
	}
	for _, event := range history.Items {
		if string(event.Action) == "MERGED" {
			return
		}
	}
	t.Fatalf("Party %s audit has no MERGED event: %+v", partyID, history.Items)
}

func newPartyIntegrationService(pool *pgxpool.Pool, _ any) *PartyService {
	return NewPartyService(pool, bobdomain.NewPartyCurrentReader(pool), authorization.Func(nil), txevent.NewBus())
}
func partyDeclarationData(name, identifier string) bobdomain.PartyCreateData {
	return bobdomain.PartyCreateData{Kind: bobdomain.PartyKindOrganization, LegalName: name, StrongIdentifiers: []bobdomain.PartyIdentifierInput{{Type: bobdomain.PartyIdentifierUnifiedSocialCreditCode, Value: identifier}}}
}
func createPartyDraft(t *testing.T, service *PartyService, data bobdomain.PartyCreateData, actor approval.Actor) PartyMutation {
	t.Helper()
	tx, err := service.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := service.CreateForRelationship(t.Context(), tx, data, actor, true)
	if err == nil {
		err = tx.Commit(t.Context())
	}
	if err != nil {
		_ = tx.Rollback(t.Context())
		t.Fatalf("create Party V1: %v", err)
	}
	view, err := service.Get(t.Context(), PartyGetInput{PartyID: resolved.ID}, bobdomain.PartyRelationshipVisibility{}, actor)
	if err != nil {
		t.Fatalf("get Party V1: %v", err)
	}
	return PartyMutation{PartyID: resolved.ID, Approval: view.Approval}
}
func approveParty(t *testing.T, service *PartyService, mutation PartyMutation, submitter, reviewer approval.Actor) PartyMutation {
	t.Helper()
	pending, err := service.Submit(t.Context(), partyVersionInput(mutation), submitter)
	if err != nil {
		t.Fatalf("submit Party: %v", err)
	}
	approved, err := service.Approve(t.Context(), partyVersionInput(pending), reviewer)
	if err != nil {
		t.Fatalf("approve Party: %v", err)
	}
	return approved
}
func partyVersionInput(mutation PartyMutation) PartyVersionInput {
	return PartyVersionInput{PartyID: mutation.PartyID, ApprovalEntryID: mutation.Approval.ApprovalEntryID, ApprovalRevision: mutation.Approval.Revision}
}
func mergePreflight(source, target PartyMutation) bobdomain.PartyMergePreflightInput {
	return bobdomain.PartyMergePreflightInput{SourcePartyID: source.PartyID, TargetPartyID: target.PartyID, SourceApprovalEntryID: source.Approval.ApprovalEntryID, TargetApprovalEntryID: target.Approval.ApprovalEntryID, SourceApprovalRevision: source.Approval.Revision, TargetApprovalRevision: target.Approval.Revision}
}

func assertPartyCurrent(t *testing.T, pool *pgxpool.Pool, partyID, entryID, displayName string) {
	t.Helper()
	var gotEntry, gotName string
	err := pool.QueryRow(t.Context(), `
		SELECT entry.id,version.display_name
		FROM approval_entries entry
		JOIN dcl_party_versions version ON version.approval_entry_id=entry.id
		JOIN dcl_parties party ON party.id=entry.subject_id AND party.merged_into_party_id IS NULL
		WHERE entry.domain='dcl' AND entry.entity='party' AND entry.subject_id=$1 AND entry.status='APPROVED'
		ORDER BY entry.version_no DESC LIMIT 1`, partyID).Scan(&gotEntry, &gotName)
	if entryID == "" {
		if !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("Party %s current = (%q,%q,%v), want absent", partyID, gotEntry, gotName, err)
		}
		return
	}
	if err != nil || gotEntry != entryID || gotName != displayName {
		t.Fatalf("Party %s current = (%q,%q,%v), want (%q,%q)", partyID, gotEntry, gotName, err, entryID, displayName)
	}
}

type partyClaim struct{ identifierType, normalizedValue, approvedPartyID, approvedEntryID, openPartyID, openEntryID string }

func assertPartyClaims(t *testing.T, pool *pgxpool.Pool, want []partyClaim) {
	t.Helper()
	rows, err := pool.Query(t.Context(), `SELECT identifier_type,normalized_value,COALESCE(approved_party_id,''),COALESCE(approved_approval_entry_id,''),COALESCE(open_party_id,''),COALESCE(open_approval_entry_id,'') FROM dcl_party_identifier_claims ORDER BY identifier_type,normalized_value`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := []partyClaim{}
	for rows.Next() {
		var claim partyClaim
		if err = rows.Scan(&claim.identifierType, &claim.normalizedValue, &claim.approvedPartyID, &claim.approvedEntryID, &claim.openPartyID, &claim.openEntryID); err != nil {
			t.Fatal(err)
		}
		got = append(got, claim)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	sort.Slice(want, func(i, j int) bool {
		return want[i].identifierType+want[i].normalizedValue < want[j].identifierType+want[j].normalizedValue
	})
	if len(got) != len(want) {
		t.Fatalf("claim count = %d, want %d; got=%+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("claim[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}
