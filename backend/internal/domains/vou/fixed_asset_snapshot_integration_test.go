//go:build integration

package vou

import (
	"errors"
	"testing"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	"github.com/jackc/pgx/v5/pgxpool"
)

func createApprovedAuxiliaryReference(
	t *testing.T, pool *pgxpool.Pool, entity string, data map[string]any, label string,
) (AuxiliaryReferenceInput, *auxdomain.Service, auxdomain.MutationResult) {
	t.Helper()
	service := auxdomain.NewService(pool)
	created, err := service.Create(t.Context(), entity, auxdomain.CreateInput{
		Data: auxdomain.CreateData{Data: data},
	}, trustedIntegrationActor(t, label+"-create"))
	if err != nil {
		t.Fatalf("create %s: %v", label, err)
	}
	return AuxiliaryReferenceInput{ObjectID: created.ObjectID}, service, created
}

func TestAssetCategoryDefaultsAreAdoptedIntoImmutableAssetSnapshotsIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	vouchers := newIntegrationService(t, pool)

	categoryV1, categories, categoryApproved := createApprovedAuxiliaryReference(t, pool, auxdomain.EntityAssetCategory, map[string]any{
		"name": "快照类别 V1", "defaultUsefulLifeMonths": 60, "defaultResidualRate": "5.00",
	}, "asset-category-v1")
	department, departments, departmentCreated := createApprovedAuxiliaryReference(t, pool, auxdomain.EntityDepartment, map[string]any{
		"name": "资产使用部门",
	}, "asset-department")
	lineID := ""
	draft := func(category AuxiliaryReferenceInput) DraftInput {
		return DraftInput{
			BusinessDate: "2026-08-28", Currency: "CNY", Supplier: &refs.supplier,
			AssetAcquisitionLines: []AssetAcquisitionLineInput{{
				LineID: lineID, AssetName: "快照试验设备", Category: category, OriginalValue: "12000.00",
				UsefulLifeMonths: 84, ResidualRate: "1.25", Department: department,
			}},
		}
	}

	created, err := vouchers.Create(t.Context(), EntityAssetAcquisition, CreateInput{Data: draft(categoryV1)},
		integrationApprovalActor(t, integrationActorOne, "asset-snapshot-create"))
	if err != nil {
		t.Fatalf("create asset acquisition: %v", err)
	}
	assertV1Snapshot := func() {
		t.Helper()
		view, getErr := vouchers.Get(t.Context(), EntityAssetAcquisition, GetInput{DocumentID: created.DocumentID})
		if getErr != nil {
			t.Fatalf("get asset acquisition: %v", getErr)
		}
		if len(view.Data.AssetAcquisitionLines) != 1 {
			t.Fatalf("asset acquisition lines = %d, want 1", len(view.Data.AssetAcquisitionLines))
		}
		line := view.Data.AssetAcquisitionLines[0]
		if lineID == "" {
			lineID = line.LineID
		}
		if line.Category.ObjectID != categoryV1.ObjectID ||
			line.Category.Name != "快照类别 V1" || line.CategoryDefaultUsefulLifeMonths != 60 ||
			line.CategoryDefaultResidualRate != "5.0" {
			t.Fatalf("stored category default snapshot = %+v", line)
		}
		if line.UsefulLifeMonths != 84 || line.ResidualRate != "1.25" {
			t.Fatalf("asset-specific depreciation values = %+v, want explicit overrides", line)
		}
		if line.Department.ObjectID != department.ObjectID || line.Department.Name != "资产使用部门" {
			t.Fatalf("stored department snapshot = %+v", line.Department)
		}
	}
	assertV1Snapshot()

	categoryV2Draft, err := categories.Save(t.Context(), auxdomain.EntityAssetCategory, auxdomain.SaveInput{
		ObjectID: categoryV1.ObjectID, ObjectRevision: categoryApproved.ObjectRevision,
		Data: map[string]any{
			"name": "快照类别 V2", "defaultUsefulLifeMonths": 120, "defaultResidualRate": "10.00",
		},
	}, trustedIntegrationActor(t, "asset-category-v2-save"))
	if err != nil {
		t.Fatalf("save asset category V2: %v", err)
	}
	categoryV2 := categoryV2Draft
	savedAfterRename, err := vouchers.Save(t.Context(), EntityAssetAcquisition, SaveInput{
		DocumentID: created.DocumentID, Revision: created.Approval.Revision, Data: draft(categoryV1),
	}, integrationApprovalActor(t, integrationActorOne, "asset-snapshot-save-after-category-rename"))
	if err != nil {
		t.Fatalf("save existing acquisition after category rename: %v", err)
	}
	assertV1Snapshot()

	departmentRenamed, err := departments.Save(t.Context(), auxdomain.EntityDepartment, auxdomain.SaveInput{
		ObjectID: department.ObjectID, ObjectRevision: departmentCreated.ObjectRevision,
		Data: map[string]any{"name": "资产使用部门 V2"},
	}, trustedIntegrationActor(t, "asset-department-v2-save"))
	if err != nil {
		t.Fatalf("rename department: %v", err)
	}

	if _, err = categories.Disable(t.Context(), auxdomain.EntityAssetCategory, auxdomain.ObjectRevisionInput{
		ObjectID: categoryV2.ObjectID, ObjectRevision: categoryV2.ObjectRevision,
	}, trustedIntegrationActor(t, "asset-category-disable")); err != nil {
		t.Fatalf("disable asset category: %v", err)
	}
	if _, err = departments.Disable(t.Context(), auxdomain.EntityDepartment, auxdomain.ObjectRevisionInput{
		ObjectID: departmentRenamed.ObjectID, ObjectRevision: departmentRenamed.ObjectRevision,
	}, trustedIntegrationActor(t, "asset-department-disable")); err != nil {
		t.Fatalf("disable department: %v", err)
	}
	if _, err = vouchers.Save(t.Context(), EntityAssetAcquisition, SaveInput{
		DocumentID: created.DocumentID, Revision: savedAfterRename.Approval.Revision, Data: draft(categoryV1),
	}, integrationApprovalActor(t, integrationActorOne, "asset-snapshot-save-after-aux-disable")); err != nil {
		t.Fatalf("save existing acquisition after AUX disable: %v", err)
	}
	assertV1Snapshot()

	lineID = ""
	_, err = vouchers.Create(t.Context(), EntityAssetAcquisition, CreateInput{Data: draft(AuxiliaryReferenceInput{
		ObjectID: categoryV2.ObjectID,
	})}, integrationApprovalActor(t, integrationActorOne, "asset-snapshot-reject-disabled"))
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorConflict {
		t.Fatalf("create with disabled category error = %#v, want conflict", err)
	}
}

func TestAssetAcquisitionLineIdentityPreservesSnapshotsAfterDeletingEarlierLineIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	vouchers := newIntegrationService(t, pool)

	categoryOne, _, _ := createApprovedAuxiliaryReference(t, pool, auxdomain.EntityAssetCategory, map[string]any{
		"name": "第一行类别", "defaultUsefulLifeMonths": 36, "defaultResidualRate": "3.00",
	}, "asset-line-one-category")
	categoryTwo, categories, categoryTwoCreated := createApprovedAuxiliaryReference(t, pool, auxdomain.EntityAssetCategory, map[string]any{
		"name": "第二行类别 V1", "defaultUsefulLifeMonths": 72, "defaultResidualRate": "6.00",
	}, "asset-line-two-category")
	departmentOne, _, _ := createApprovedAuxiliaryReference(t, pool, auxdomain.EntityDepartment, map[string]any{
		"name": "第一行部门",
	}, "asset-line-one-department")
	departmentTwo, departments, departmentTwoCreated := createApprovedAuxiliaryReference(t, pool, auxdomain.EntityDepartment, map[string]any{
		"name": "第二行部门 V1",
	}, "asset-line-two-department")

	created, err := vouchers.Create(t.Context(), EntityAssetAcquisition, CreateInput{Data: DraftInput{
		BusinessDate: "2026-08-28", Currency: "CNY", Supplier: &refs.supplier,
		AssetAcquisitionLines: []AssetAcquisitionLineInput{
			{AssetName: "第一台设备", Category: categoryOne, OriginalValue: "1000.00", UsefulLifeMonths: 36, ResidualRate: "3.00", Department: departmentOne},
			{AssetName: "第二台设备", Category: categoryTwo, OriginalValue: "2000.00", UsefulLifeMonths: 72, ResidualRate: "6.00", Department: departmentTwo},
		},
	}}, integrationApprovalActor(t, integrationActorOne, "asset-line-identity-create"))
	if err != nil {
		t.Fatalf("create asset acquisition: %v", err)
	}
	before, err := vouchers.Get(t.Context(), EntityAssetAcquisition, GetInput{DocumentID: created.DocumentID})
	if err != nil {
		t.Fatalf("get created asset acquisition: %v", err)
	}
	if len(before.Data.AssetAcquisitionLines) != 2 {
		t.Fatalf("asset acquisition lines = %d, want 2", len(before.Data.AssetAcquisitionLines))
	}
	firstLineID := before.Data.AssetAcquisitionLines[0].LineID
	secondLineID := before.Data.AssetAcquisitionLines[1].LineID
	firstLine := AssetAcquisitionLineInput{
		LineID: firstLineID, AssetName: "第一台设备", Category: categoryOne,
		OriginalValue: "1000.00", UsefulLifeMonths: 36, ResidualRate: "3.00", Department: departmentOne,
	}
	secondLine := AssetAcquisitionLineInput{
		LineID: secondLineID, AssetName: "第二台设备", Category: categoryTwo,
		OriginalValue: "2000.00", UsefulLifeMonths: 72, ResidualRate: "6.00", Department: departmentTwo,
	}
	for _, test := range []struct {
		name  string
		lines []AssetAcquisitionLineInput
	}{
		{name: "invalid", lines: []AssetAcquisitionLineInput{{
			LineID: "invalid", AssetName: firstLine.AssetName, Category: categoryOne,
			OriginalValue: firstLine.OriginalValue, UsefulLifeMonths: firstLine.UsefulLifeMonths,
			ResidualRate: firstLine.ResidualRate, Department: departmentOne,
		}}},
		{name: "unknown", lines: []AssetAcquisitionLineInput{{
			LineID: newID(), AssetName: firstLine.AssetName, Category: categoryOne,
			OriginalValue: firstLine.OriginalValue, UsefulLifeMonths: firstLine.UsefulLifeMonths,
			ResidualRate: firstLine.ResidualRate, Department: departmentOne,
		}}},
		{name: "duplicate", lines: []AssetAcquisitionLineInput{firstLine, {
			LineID: firstLineID, AssetName: secondLine.AssetName, Category: categoryTwo,
			OriginalValue: secondLine.OriginalValue, UsefulLifeMonths: secondLine.UsefulLifeMonths,
			ResidualRate: secondLine.ResidualRate, Department: departmentTwo,
		}}},
	} {
		t.Run(test.name+" lineId is rejected without mutation", func(t *testing.T) {
			_, saveErr := vouchers.Save(t.Context(), EntityAssetAcquisition, SaveInput{
				DocumentID: created.DocumentID, Revision: created.Approval.Revision,
				Data: DraftInput{
					BusinessDate: "2026-08-28", Currency: "CNY", Supplier: &refs.supplier,
					AssetAcquisitionLines: test.lines,
				},
			}, integrationApprovalActor(t, integrationActorOne, "asset-line-identity-reject-"+test.name))
			var domainErr *DomainError
			if !errors.As(saveErr, &domainErr) || domainErr.Kind != ErrorValidation {
				t.Fatalf("save error = %#v, want validation", saveErr)
			}
			unchanged, getErr := vouchers.Get(t.Context(), EntityAssetAcquisition, GetInput{DocumentID: created.DocumentID})
			if getErr != nil {
				t.Fatalf("get after rejected save: %v", getErr)
			}
			if unchanged.Approval.Revision != created.Approval.Revision ||
				len(unchanged.Data.AssetAcquisitionLines) != 2 ||
				unchanged.Data.AssetAcquisitionLines[0].LineID != firstLineID ||
				unchanged.Data.AssetAcquisitionLines[1].LineID != secondLineID {
				t.Fatalf("draft changed after rejected save: %+v", unchanged)
			}
		})
	}

	categoryTwoRenamed, err := categories.Save(t.Context(), auxdomain.EntityAssetCategory, auxdomain.SaveInput{
		ObjectID: categoryTwo.ObjectID, ObjectRevision: categoryTwoCreated.ObjectRevision,
		Data: map[string]any{
			"name": "第二行类别 V2", "defaultUsefulLifeMonths": 120, "defaultResidualRate": "10.00",
		},
	}, trustedIntegrationActor(t, "asset-line-two-category-rename"))
	if err != nil {
		t.Fatalf("rename second category: %v", err)
	}
	departmentTwoRenamed, err := departments.Save(t.Context(), auxdomain.EntityDepartment, auxdomain.SaveInput{
		ObjectID: departmentTwo.ObjectID, ObjectRevision: departmentTwoCreated.ObjectRevision,
		Data: map[string]any{"name": "第二行部门 V2"},
	}, trustedIntegrationActor(t, "asset-line-two-department-rename"))
	if err != nil {
		t.Fatalf("rename second department: %v", err)
	}
	if _, err = categories.Disable(t.Context(), auxdomain.EntityAssetCategory, auxdomain.ObjectRevisionInput{
		ObjectID: categoryTwoRenamed.ObjectID, ObjectRevision: categoryTwoRenamed.ObjectRevision,
	}, trustedIntegrationActor(t, "asset-line-two-category-disable")); err != nil {
		t.Fatalf("disable second category: %v", err)
	}
	if _, err = departments.Disable(t.Context(), auxdomain.EntityDepartment, auxdomain.ObjectRevisionInput{
		ObjectID: departmentTwoRenamed.ObjectID, ObjectRevision: departmentTwoRenamed.ObjectRevision,
	}, trustedIntegrationActor(t, "asset-line-two-department-disable")); err != nil {
		t.Fatalf("disable second department: %v", err)
	}

	if _, err = vouchers.Save(t.Context(), EntityAssetAcquisition, SaveInput{
		DocumentID: created.DocumentID, Revision: created.Approval.Revision,
		Data: DraftInput{
			BusinessDate: "2026-08-28", Currency: "CNY", Supplier: &refs.supplier,
			AssetAcquisitionLines: []AssetAcquisitionLineInput{secondLine},
		},
	}, integrationApprovalActor(t, integrationActorOne, "asset-line-identity-save")); err != nil {
		t.Fatalf("save after deleting earlier line: %v", err)
	}
	after, err := vouchers.Get(t.Context(), EntityAssetAcquisition, GetInput{DocumentID: created.DocumentID})
	if err != nil {
		t.Fatalf("get saved asset acquisition: %v", err)
	}
	if len(after.Data.AssetAcquisitionLines) != 1 {
		t.Fatalf("asset acquisition lines = %d, want 1", len(after.Data.AssetAcquisitionLines))
	}
	line := after.Data.AssetAcquisitionLines[0]
	if line.LineID != secondLineID || line.Category.Name != "第二行类别 V1" ||
		line.CategoryDefaultUsefulLifeMonths != 72 || line.CategoryDefaultResidualRate != "6.0" ||
		line.Department.Name != "第二行部门 V1" {
		t.Fatalf("preserved second line snapshot = %+v", line)
	}
}
