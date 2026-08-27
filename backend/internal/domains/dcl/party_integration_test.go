//go:build integration

package dcl

import (
	"context"
	"errors"
	"sort"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

// This is the public DCL lifecycle seam: the test only observes durable
// Approval, typed snapshots, current BOB data and identifier claims.
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
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM bob_parties WHERE id=$1`, existing.PartyID).Scan(&roots); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_entries WHERE domain='dcl' AND entity='party'`).Scan(&entries); err != nil {
		t.Fatal(err)
	}
	if roots != 1 || entries != 1 {
		t.Fatalf("reuse created duplicate state: roots=%d entries=%d", roots, entries)
	}
}

func TestPartyFirstRelationshipTransactionRollbackLeavesNoDeclarationOrCurrentIntegration(t *testing.T) {
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
		"bob_parties": "id=$1", "dcl_subjects": "id=$1", "approval_entries": "subject_id=$1", "dcl_party_versions": "party_id=$1",
		"bob_party_currents": "party_id=$1", "dcl_party_identifier_claims": "open_party_id=$1 OR approved_party_id=$1", "bob_party_identifiers": "party_id=$1",
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

type failingPartyCurrentWriter struct {
	partyCurrentWriter
	failure error
}

func (w failingPartyCurrentWriter) Apply(ctx context.Context, tx pgx.Tx, partyID, entryID string, data bobdomain.PartyCreateData, identifiers []bobdomain.PartyIdentifierInput, actorID string) (bobdomain.PartyIdentity, error) {
	identity, err := w.partyCurrentWriter.Apply(ctx, tx, partyID, entryID, data, identifiers, actorID)
	if err != nil {
		return bobdomain.PartyIdentity{}, err
	}
	return identity, w.failure
}

func TestPartyCurrentApplyFailureRollsBackApprovalSnapshotAndCurrentIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	writer := bobdomain.NewPartyCurrentWriter(pool)
	service := newPartyIntegrationService(pool, writer)
	creatorID := ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	v1 := createPartyDraft(t, service, partyDeclarationData("失败主体", "91310000APPLYFAIL01"), creator("create"))
	v1, err := service.Submit(t.Context(), partyVersionInput(v1), creator("submit"))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	failure := errors.New("Party current apply failed")
	failing := newPartyIntegrationService(pool, failingPartyCurrentWriter{partyCurrentWriter: writer, failure: failure})
	_, err = failing.Approve(t.Context(), partyVersionInput(v1), dclActor(t, ulid.Make().String(), "approve"))
	if !errors.Is(err, failure) {
		t.Fatalf("approve error = %v, want current apply failure", err)
	}
	assertApprovalState(t, pool, v1.Approval.ApprovalEntryID, approval.StatusPending, v1.Approval.Revision)
	var snapshotCount, approvedEvents int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM dcl_party_versions WHERE approval_entry_id=$1`, v1.Approval.ApprovalEntryID).Scan(&snapshotCount); err != nil || snapshotCount != 1 {
		t.Fatalf("Party snapshot count = %d, err=%v, want 1", snapshotCount, err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_events WHERE entry_id=$1 AND action='APPROVED'`, v1.Approval.ApprovalEntryID).Scan(&approvedEvents); err != nil || approvedEvents != 0 {
		t.Fatalf("approved events = %d, err=%v, want none after rollback", approvedEvents, err)
	}
	assertPartyCurrent(t, pool, v1.PartyID, "", "")
	assertPartyClaims(t, pool, []partyClaim{{bobdomain.PartyIdentifierUnifiedSocialCreditCode, "91310000APPLYFAIL01", "", "", v1.PartyID, v1.Approval.ApprovalEntryID}})
}

func TestPartyMergeDeletesSourceCurrentRetainsClaimsAndBlocksOpenCandidateIntegration(t *testing.T) {
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

func newPartyIntegrationService(pool *pgxpool.Pool, current partyCurrentWriter) *PartyService {
	if current == nil {
		current = bobdomain.NewPartyCurrentWriter(pool)
	}
	return NewPartyService(pool, current, bobdomain.NewPartyCurrentReader(pool), bobdomain.NewPartyMergeEngine(pool), authorization.Func(nil), txevent.NewBus())
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
	err := pool.QueryRow(t.Context(), `SELECT source_approval_entry_id,display_name FROM bob_party_currents WHERE party_id=$1`, partyID).Scan(&gotEntry, &gotName)
	if entryID == "" {
		if !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("Party %s current = (%q,%q,%v), want absent", partyID, gotEntry, gotName, err)
		}
		var identifiers int
		if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM bob_party_identifiers WHERE party_id=$1`, partyID).Scan(&identifiers); err != nil || identifiers != 0 {
			t.Fatalf("Party %s current identifiers = %d, err=%v, want none", partyID, identifiers, err)
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
