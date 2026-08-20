//go:build integration

package bob

import "testing"

func TestSupplierDraftSnapshotAndContinuousCandidateIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	service.SetAuxiliaryResolver(customerAuxiliaryResolverStub{})
	_, purchaser := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Name: "默认采购员",
	}, "supplier-master-purchaser")
	taxNumber := "TAX" + newID()[3:]

	created, err := service.SupplierCreate(t.Context(), SupplierCreateInput{Data: SupplierData{
		Name: "华东原料供应商", SupplierType: SupplierTypeGeneral, TaxNumber: taxNumber,
	}}, integrationActorOne, "supplier-master-create")
	if err != nil {
		t.Fatalf("create incomplete supplier draft: %v", err)
	}
	if _, err = service.Submit(t.Context(), EntitySupplier, VersionRevisionInput{ObjectID: created.ObjectID,
		VersionID: created.VersionID, Revision: created.Revision}, integrationActorOne, "supplier-master-submit-incomplete"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("incomplete supplier submit error = %v", err)
	}

	saved, err := service.SupplierSave(t.Context(), SupplierSaveInput{ObjectID: created.ObjectID,
		VersionID: created.VersionID, Revision: created.Revision, Data: SupplierData{
			Name: "华东原料供应商", SupplierType: SupplierTypeGeneral, TaxNumber: taxNumber,
			SettlementMethodID:         "01J00000000000000000000081",
			DefaultPurchaserEmployeeID: purchaser.ObjectID,
		}}, integrationActorOne, "supplier-master-save-complete")
	if err != nil {
		t.Fatalf("save complete supplier: %v", err)
	}
	pending, err := service.Submit(t.Context(), EntitySupplier, VersionRevisionInput{ObjectID: saved.ObjectID,
		VersionID: saved.VersionID, Revision: saved.Revision}, integrationActorOne, "supplier-master-submit")
	if err != nil {
		t.Fatalf("submit complete supplier: %v", err)
	}
	effective, err := service.Approve(t.Context(), EntitySupplier, ReviewInput{ObjectID: pending.ObjectID,
		VersionID: pending.VersionID, Revision: pending.Revision}, integrationActorTwo, "supplier-master-approve")
	if err != nil {
		t.Fatalf("approve supplier: %v", err)
	}
	detail, err := service.SupplierGet(t.Context(), GetInput{ObjectID: effective.ObjectID})
	if err != nil || detail.Effective == nil || detail.Candidate != nil {
		t.Fatalf("read effective supplier: detail=%#v err=%v", detail, err)
	}
	if snapshot := detail.Effective.Data.SettlementMethod; snapshot == nil || snapshot.TermCode != SettlementTermMonthly30 || snapshot.MonthOffset != 1 {
		t.Fatalf("supplier settlement snapshot = %#v", snapshot)
	}

	changed := detail.Effective.Data
	changed.Name = "华东原料供应商候选"
	candidate, err := service.SupplierSave(t.Context(), SupplierSaveInput{ObjectID: effective.ObjectID,
		VersionID: effective.VersionID, Revision: effective.Revision, Data: changed}, integrationActorOne, "supplier-master-candidate")
	if err != nil {
		t.Fatalf("create supplier candidate: %v", err)
	}
	detail, err = service.SupplierGet(t.Context(), GetInput{ObjectID: effective.ObjectID})
	if err != nil || detail.Effective == nil || detail.Candidate == nil || detail.Effective.Data.Name != "华东原料供应商" {
		t.Fatalf("supplier effective version was not preserved: detail=%#v err=%v", detail, err)
	}
	references, err := service.QueryReferenceCandidates(t.Context(), ReferenceQueryInput{
		Entity: EntitySupplier, SupplierType: SupplierTypeGeneral,
	})
	if err != nil {
		t.Fatalf("query effective supplier references: %v", err)
	}
	found := false
	for _, item := range references {
		if item.ObjectID == effective.ObjectID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("effective supplier %s missing while candidate exists", effective.ObjectID)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin supplier reference check: %v", err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	if _, err = service.ResolveCurrentEffectiveReference(t.Context(), tx, EntitySupplier, effective.ObjectID); err != nil {
		t.Fatalf("candidate blocked effective supplier reference: %v", err)
	}
	_ = tx.Rollback(t.Context())
	disabled, err := service.Disable(t.Context(), EntitySupplier, ObjectRevisionInput{
		ObjectID: candidate.ObjectID, ObjectRevision: candidate.ObjectRevision,
	}, integrationActorOne, "supplier-master-disable-candidate")
	if err != nil {
		t.Fatalf("disable supplier with candidate: %v", err)
	}
	tx, err = pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin disabled supplier reference check: %v", err)
	}
	if _, err = service.ResolveCurrentEffectiveReference(t.Context(), tx, EntitySupplier, effective.ObjectID); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("disabled supplier reference error = %v", err)
	}
	_ = tx.Rollback(t.Context())
	enabled, err := service.Enable(t.Context(), EntitySupplier, ObjectRevisionInput{
		ObjectID: candidate.ObjectID, ObjectRevision: disabled.ObjectRevision,
	}, integrationActorOne, "supplier-master-enable-candidate")
	if err != nil {
		t.Fatalf("enable supplier with candidate: %v", err)
	}
	if err = service.Delete(t.Context(), EntitySupplier, DeleteInput{ObjectID: candidate.ObjectID,
		ObjectRevision: enabled.ObjectRevision, VersionID: candidate.VersionID, Revision: candidate.Revision}); err != nil {
		t.Fatalf("delete supplier candidate: %v", err)
	}
	detail, err = service.SupplierGet(t.Context(), GetInput{ObjectID: effective.ObjectID})
	if err != nil || detail.Effective == nil || detail.Candidate != nil {
		t.Fatalf("supplier candidate delete did not restore effective: detail=%#v err=%v", detail, err)
	}
}
