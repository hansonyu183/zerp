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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

// TestTypedOtherUnitAndSalesPartnerLifecycleIntegration proves the DCL-owned
// typed identity lifecycle and the corresponding read-only BOB current view.
func TestTypedOtherUnitAndSalesPartnerLifecycleIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	authorizer, bus := authorization.Func(nil), txevent.NewBus()
	auxiliary := auxdomain.NewService(pool)
	business := bobdomain.NewService(pool, auxiliaryrefs.New(auxiliary))
	operating := NewOperatingEntityService(pool, business, authorizer, bus)
	archives := NewTypedArchiveService(pool, business, authorizer, bus)

	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }
	owner, err := operating.Create(t.Context(), OperatingEntityCreateInput{Data: bobdomain.OperatingEntityData{Name: "归属主体"}}, creator("owner-create"))
	if err != nil {
		t.Fatalf("create operating entity: %v", err)
	}
	owner = submitAndApproveOperatingEntity(t, operating, owner, creator("owner-submit"), reviewer("owner-approve"))
	if _, err = archives.CreateOtherUnit(t.Context(), OtherUnitCreateInput{Data: OtherUnitData{
		Kind: "ORGANIZATION", LegalName: "非法其他单位标识", StrongIdentifiers: []BusinessIdentifierInput{{Type: "BANK_ACCOUNT", Value: "other-invalid"}},
		Enabled: true, OperatingEntityIDs: []string{owner.ObjectID}, DefaultOperatingEntityID: owner.ObjectID,
	}}, creator("other-invalid-identifier")); err == nil {
		t.Fatal("Other Unit accepted an unsupported business identifier type")
	} else {
		assertDCLValidationFailure(t, err)
	}
	assertDCLSubjectCount(t, pool, EntityOtherUnit, 0)
	if _, err = archives.CreateSalesPartner(t.Context(), SalesPartnerCreateInput{Data: SalesPartnerData{
		Kind: "ORGANIZATION", LegalName: "非法销售合作方标识", StrongIdentifiers: []BusinessIdentifierInput{{Type: "BANK_ACCOUNT", Value: "sales-invalid"}},
		Enabled: true, OperatingEntityIDs: []string{owner.ObjectID}, DefaultOperatingEntityID: owner.ObjectID, Capabilities: []string{"CHANNEL_PARTNER"},
	}}, creator("sales-invalid-identifier")); err == nil {
		t.Fatal("Sales Partner accepted an unsupported business identifier type")
	} else {
		assertDCLValidationFailure(t, err)
	}
	assertDCLSubjectCount(t, pool, EntitySalesPartner, 0)

	otherInput := OtherUnitData{
		Kind: "ORGANIZATION", LegalName: "独立其他单位", DisplayName: "其他单位",
		StrongIdentifiers: []BusinessIdentifierInput{{Type: "UNIFIED_SOCIAL_CREDIT_CODE", Value: "91310000OTU345001"}},
		Enabled:           true, OperatingEntityIDs: []string{owner.ObjectID}, DefaultOperatingEntityID: owner.ObjectID,
	}
	other, err := archives.CreateOtherUnit(t.Context(), OtherUnitCreateInput{Data: otherInput}, creator("other-create"))
	if err != nil {
		t.Fatalf("create typed Other Unit: %v", err)
	}
	if _, err = archives.CreateOtherUnit(t.Context(), OtherUnitCreateInput{Data: otherInput}, creator("other-conflict")); err == nil {
		t.Fatal("Other Unit accepted same-type strong identifier while first draft is open")
	} else {
		var domainErr *DomainError
		if !errors.As(err, &domainErr) || domainErr.ErrorKey != "other_unit_identifier_claimed" {
			t.Fatalf("Other Unit strong identifier conflict = %v", err)
		}
	}
	otherView, err := archives.GetOtherUnit(t.Context(), TypedArchiveGetInput{ObjectID: other.ObjectID}, creator("other-get"))
	if err != nil {
		t.Fatalf("get typed Other Unit: %v", err)
	}
	assertOtherUnitData(t, otherView.Data, otherInput)
	other = submitAndApproveOtherUnit(t, archives, other, creator("other-submit"), reviewer("other-approve"))
	current, err := business.Get(t.Context(), bobdomain.EntityOtherUnit, bobdomain.GetInput{ObjectID: other.ObjectID})
	if err != nil || current.Data.Name != "其他单位" || current.SourceApprovalEntryID != other.Approval.ApprovalEntryID {
		t.Fatalf("BOB typed Other Unit current = %+v, err=%v", current, err)
	}
	otherV1 := other
	otherV2Input := otherInput
	otherV2Input.DisplayName = "其他单位二版"
	otherV2Input.StrongIdentifiers = []BusinessIdentifierInput{{Type: "UNIFIED_SOCIAL_CREDIT_CODE", Value: "91310000OTU345002"}}
	otherV2, err := archives.SaveOtherUnit(t.Context(), OtherUnitSaveInput{ObjectID: other.ObjectID, ApprovalEntryID: other.Approval.ApprovalEntryID, ApprovalRevision: other.Approval.Revision, Data: otherV2Input}, creator("other-save-v2"))
	if err != nil {
		t.Fatalf("save typed Other Unit V2: %v", err)
	}
	otherV2 = submitAndApproveOtherUnit(t, archives, otherV2, creator("other-submit-v2"), reviewer("other-approve-v2"))
	assertOtherIdentifierClaim(t, pool, "91310000OTU345001", "", "")
	assertOtherIdentifierClaim(t, pool, "91310000OTU345002", otherV2.Approval.ApprovalEntryID, "")
	otherV2, err = archives.UnapproveOtherUnit(t.Context(), TypedArchiveReviewInput{ObjectID: otherV2.ObjectID, ApprovalEntryID: otherV2.Approval.ApprovalEntryID, ApprovalRevision: otherV2.Approval.Revision, Reason: "验证标识回落"}, reviewer("other-unapprove-v2"))
	if err != nil {
		t.Fatalf("unapprove typed Other Unit V2: %v", err)
	}
	assertOtherIdentifierClaim(t, pool, "91310000OTU345001", otherV1.Approval.ApprovalEntryID, "")
	assertOtherIdentifierClaim(t, pool, "91310000OTU345002", "", otherV2.Approval.ApprovalEntryID)
	current, err = business.Get(t.Context(), bobdomain.EntityOtherUnit, bobdomain.GetInput{ObjectID: other.ObjectID})
	if err != nil || current.SourceApprovalEntryID != otherV1.Approval.ApprovalEntryID {
		t.Fatalf("BOB typed Other Unit fallback = %+v, err=%v", current, err)
	}

	salesInput := SalesPartnerData{
		Kind: "ORGANIZATION", LegalName: "独立销售合作方", DisplayName: "销售合作方",
		StrongIdentifiers: []BusinessIdentifierInput{{Type: "UNIFIED_SOCIAL_CREDIT_CODE", Value: "91310000OTU345001"}},
		Enabled:           true, OperatingEntityIDs: []string{owner.ObjectID}, DefaultOperatingEntityID: owner.ObjectID,
	}
	sales, err := archives.CreateSalesPartner(t.Context(), SalesPartnerCreateInput{Data: salesInput}, creator("sales-create"))
	if err != nil {
		t.Fatalf("create typed Sales Partner draft: %v", err)
	}
	if _, err = archives.SubmitSalesPartner(t.Context(), TypedArchiveVersionInput{ObjectID: sales.ObjectID, ApprovalEntryID: sales.Approval.ApprovalEntryID, ApprovalRevision: sales.Approval.Revision}, creator("sales-submit-empty")); err == nil {
		t.Fatal("submitted sales-partner draft without capability")
	}
	salesInput.Capabilities = []string{"CHANNEL_PARTNER"}
	sales, err = archives.SaveSalesPartner(t.Context(), SalesPartnerSaveInput{ObjectID: sales.ObjectID, ApprovalEntryID: sales.Approval.ApprovalEntryID, ApprovalRevision: sales.Approval.Revision, Data: salesInput}, creator("sales-save"))
	if err != nil {
		t.Fatalf("save typed Sales Partner capability: %v", err)
	}
	salesView, err := archives.GetSalesPartner(t.Context(), TypedArchiveGetInput{ObjectID: sales.ObjectID}, creator("sales-get"))
	if err != nil {
		t.Fatalf("get typed Sales Partner: %v", err)
	}
	assertSalesPartnerData(t, salesView.Data, salesInput)
	pending, err := archives.SubmitSalesPartner(t.Context(), TypedArchiveVersionInput{ObjectID: sales.ObjectID, ApprovalEntryID: sales.Approval.ApprovalEntryID, ApprovalRevision: sales.Approval.Revision}, creator("sales-submit"))
	if err != nil {
		t.Fatalf("submit typed Sales Partner: %v", err)
	}
	sales, err = archives.ApproveSalesPartner(t.Context(), TypedArchiveVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer("sales-approve"))
	if err != nil {
		t.Fatalf("approve typed Sales Partner: %v", err)
	}
	current, err = business.Get(t.Context(), bobdomain.EntitySalesPartner, bobdomain.GetInput{ObjectID: sales.ObjectID})
	if err != nil || current.Data.Name != "销售合作方" || current.SourceApprovalEntryID != sales.Approval.ApprovalEntryID {
		t.Fatalf("BOB typed Sales Partner current = %+v, err=%v", current, err)
	}
}

func assertOtherIdentifierClaim(t *testing.T, pool *pgxpool.Pool, normalizedValue, approvedEntryID, openEntryID string) {
	t.Helper()
	var approved, open *string
	err := pool.QueryRow(t.Context(), `
		SELECT approved_approval_entry_id, open_approval_entry_id
		FROM dcl_other_unit_identifier_claims
		WHERE identifier_type='UNIFIED_SOCIAL_CREDIT_CODE' AND normalized_value=$1
	`, normalizedValue).Scan(&approved, &open)
	if approvedEntryID == "" && openEntryID == "" {
		if !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("Other Unit identifier claim %s still exists: approved=%v open=%v err=%v", normalizedValue, approved, open, err)
		}
		return
	}
	if err != nil {
		t.Fatalf("read Other Unit identifier claim %s: %v", normalizedValue, err)
	}
	if stringPointerValue(approved) != approvedEntryID || stringPointerValue(open) != openEntryID {
		t.Fatalf("Other Unit identifier claim %s = approved %q open %q, want approved %q open %q", normalizedValue, stringPointerValue(approved), stringPointerValue(open), approvedEntryID, openEntryID)
	}
}

func stringPointerValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func submitAndApproveOtherUnit(t *testing.T, service *TypedArchiveService, mutation TypedArchiveMutation, submitter, reviewer approval.Actor) TypedArchiveMutation {
	t.Helper()
	pending, err := service.SubmitOtherUnit(t.Context(), TypedArchiveVersionInput{ObjectID: mutation.ObjectID, ApprovalEntryID: mutation.Approval.ApprovalEntryID, ApprovalRevision: mutation.Approval.Revision}, submitter)
	if err != nil {
		t.Fatalf("submit Other Unit: %v", err)
	}
	approved, err := service.ApproveOtherUnit(t.Context(), TypedArchiveVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer)
	if err != nil {
		t.Fatalf("approve Other Unit: %v", err)
	}
	return approved
}

func assertOtherUnitData(t *testing.T, got, want OtherUnitData) {
	t.Helper()
	if got.Kind != want.Kind || got.LegalName != want.LegalName || got.DisplayName != want.DisplayName || got.Enabled != want.Enabled || got.DefaultOperatingEntityID != want.DefaultOperatingEntityID || len(got.StrongIdentifiers) != 1 || got.StrongIdentifiers[0] != want.StrongIdentifiers[0] || len(got.OperatingEntityIDs) != 1 || got.OperatingEntityIDs[0] != want.OperatingEntityIDs[0] {
		t.Fatalf("Other Unit data = %+v, want identity=%+v", got, want)
	}
}

func assertSalesPartnerData(t *testing.T, got, want SalesPartnerData) {
	t.Helper()
	if got.Kind != want.Kind || got.LegalName != want.LegalName || got.DisplayName != want.DisplayName || got.Enabled != want.Enabled || got.DefaultOperatingEntityID != want.DefaultOperatingEntityID || len(got.StrongIdentifiers) != 1 || got.StrongIdentifiers[0] != want.StrongIdentifiers[0] || len(got.OperatingEntityIDs) != 1 || got.OperatingEntityIDs[0] != want.OperatingEntityIDs[0] || len(got.Capabilities) != 1 || got.Capabilities[0] != want.Capabilities[0] {
		t.Fatalf("Sales Partner data = %+v, want identity=%+v", got, want)
	}
}
