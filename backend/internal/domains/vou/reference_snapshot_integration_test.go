//go:build integration

package vou

import (
	"errors"
	"testing"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
)

func TestVOUReferenceSelectionSeparatesLatestFromSavedSnapshotIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	vouchers := newIntegrationService(t, pool)
	business := newBOBIntegrationService(pool)

	draft := func(fund ReferenceInput) DraftInput {
		return DraftInput{
			BusinessDate: "2026-08-20", Currency: "CNY", SourceName: "快照语义集成测试",
			FundAccount: &fund, Handler: &refs.employee, Amount: "88.00",
		}
	}
	versionOne := refs.fundAccount
	created, err := vouchers.Create(t.Context(), EntityOtherIncome, CreateInput{Data: draft(versionOne)},
		integrationApprovalActor(t, integrationActorOne, "snapshot-vou-create-v1"))
	if err != nil {
		t.Fatalf("create VOU with fund V1: %v", err)
	}
	assertFundSnapshot := func(want ReferenceInput) {
		t.Helper()
		view, getErr := vouchers.Get(t.Context(), EntityOtherIncome, GetInput{DocumentID: created.DocumentID})
		if getErr != nil {
			t.Fatalf("get VOU fund snapshot: %v", getErr)
		}
		if view.Data.FundAccount == nil || view.Data.FundAccount.ObjectID != want.ObjectID ||
			view.Data.FundAccount.ApprovalEntryID != want.ApprovalEntryID {
			t.Fatalf("stored fund snapshot = %+v, want %+v", view.Data.FundAccount, want)
		}
	}
	assertFundSnapshot(versionOne)

	versionOneView, err := business.Get(t.Context(), bobdomain.EntityFundAccount, bobdomain.GetInput{
		ObjectID: versionOne.ObjectID, ApprovalEntryID: versionOne.ApprovalEntryID,
	})
	if err != nil {
		t.Fatalf("get fund V1: %v", err)
	}
	versionTwoDraft, err := business.Save(t.Context(), bobdomain.EntityFundAccount, bobdomain.SaveInput{
		ObjectID: versionOne.ObjectID, ApprovalEntryID: versionOne.ApprovalEntryID,
		ApprovalRevision: versionOneView.Approval.Revision,
		Data: bobdomain.DetailInput{
			Name: versionOneView.Data.Name, Currency: versionOneView.Data.Currency,
			OperatingEntityID: bobdomain.Optional(versionOneView.Data.OperatingEntityID),
			Remark:            bobdomain.Optional("VOU 快照资金账户 V2"),
		},
	}, trustedIntegrationActor(t, "snapshot-fund-v2-save"))
	if err != nil {
		t.Fatalf("create fund V2: %v", err)
	}
	versionTwoSubmitted, err := business.Submit(t.Context(), bobdomain.EntityFundAccount, bobdomain.VersionRevisionInput{
		ObjectID: versionTwoDraft.ObjectID, ApprovalEntryID: versionTwoDraft.Approval.ApprovalEntryID,
		ApprovalRevision: versionTwoDraft.Approval.Revision,
	}, trustedIntegrationActor(t, "snapshot-fund-v2-submit"))
	if err != nil {
		t.Fatalf("submit fund V2: %v", err)
	}
	versionTwoApproved, err := business.Approve(t.Context(), bobdomain.EntityFundAccount, bobdomain.ReviewInput{
		ObjectID: versionTwoSubmitted.ObjectID, ApprovalEntryID: versionTwoSubmitted.Approval.ApprovalEntryID,
		ApprovalRevision: versionTwoSubmitted.Approval.Revision,
	}, trustedIntegrationActor(t, "snapshot-fund-v2-approve"))
	if err != nil {
		t.Fatalf("approve fund V2: %v", err)
	}
	versionTwo := ReferenceInput{ObjectID: versionTwoApproved.ObjectID, ApprovalEntryID: versionTwoApproved.Approval.ApprovalEntryID}

	saved, err := vouchers.Save(t.Context(), EntityOtherIncome, SaveInput{
		DocumentID: created.DocumentID, Revision: created.Approval.Revision, Data: draft(versionOne),
	}, integrationApprovalActor(t, integrationActorOne, "snapshot-vou-save-preserved-v1"))
	if err != nil {
		t.Fatalf("save unchanged VOU snapshot after fund V2 approval: %v", err)
	}
	assertFundSnapshot(versionOne)

	latestCreated, err := vouchers.Create(t.Context(), EntityOtherIncome, CreateInput{Data: draft(versionTwo)},
		integrationApprovalActor(t, integrationActorOne, "snapshot-vou-create-v2"))
	if err != nil {
		t.Fatalf("create VOU with latest fund V2: %v", err)
	}
	latestView, err := vouchers.Get(t.Context(), EntityOtherIncome, GetInput{DocumentID: latestCreated.DocumentID})
	if err != nil || latestView.Data.FundAccount == nil || latestView.Data.FundAccount.ApprovalEntryID != versionTwo.ApprovalEntryID {
		t.Fatalf("new VOU latest snapshot = %+v, err=%v", latestView.Data.FundAccount, err)
	}

	if _, err = vouchers.Save(t.Context(), EntityOtherIncome, SaveInput{
		DocumentID: created.DocumentID, Revision: saved.Approval.Revision, Data: draft(versionTwo),
	}, integrationApprovalActor(t, integrationActorOne, "snapshot-vou-reselect-v2")); err != nil {
		t.Fatalf("actively reselect fund V2: %v", err)
	}
	assertFundSnapshot(versionTwo)

	assertRejectedReference := func(name string, reference ReferenceInput) {
		t.Helper()
		_, createErr := vouchers.Create(t.Context(), EntityOtherIncome, CreateInput{Data: draft(reference)},
			integrationApprovalActor(t, integrationActorOne, "snapshot-reject-"+name))
		var domainErr *DomainError
		if !errors.As(createErr, &domainErr) || domainErr.Kind != ErrorConflict {
			t.Fatalf("%s reference error = %#v, want conflict", name, createErr)
		}
	}
	assertRejectedReference("foreign-entry", ReferenceInput{
		ObjectID: versionTwo.ObjectID, ApprovalEntryID: refs.employee.ApprovalEntryID,
	})
	assertRejectedReference("forged-entry", ReferenceInput{
		ObjectID: versionTwo.ObjectID, ApprovalEntryID: newID(),
	})

	versionThreeDraft, err := business.Save(t.Context(), bobdomain.EntityFundAccount, bobdomain.SaveInput{
		ObjectID: versionTwo.ObjectID, ApprovalEntryID: versionTwo.ApprovalEntryID,
		ApprovalRevision: versionTwoApproved.Approval.Revision,
		Data: bobdomain.DetailInput{
			Name: versionOneView.Data.Name, Currency: versionOneView.Data.Currency,
			OperatingEntityID: bobdomain.Optional(versionOneView.Data.OperatingEntityID),
			Remark:            bobdomain.Optional("VOU 快照资金账户 V3 草稿"),
		},
	}, trustedIntegrationActor(t, "snapshot-fund-v3-save"))
	if err != nil {
		t.Fatalf("create unapproved fund V3: %v", err)
	}
	assertRejectedReference("unapproved-entry", ReferenceInput{
		ObjectID: versionThreeDraft.ObjectID, ApprovalEntryID: versionThreeDraft.Approval.ApprovalEntryID,
	})
}
