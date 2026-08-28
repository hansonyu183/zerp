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
) (ReferenceInput, *auxdomain.Service, auxdomain.MutationResult) {
	t.Helper()
	service := auxdomain.NewService(pool)
	created, err := service.Create(t.Context(), entity, auxdomain.CreateInput{
		Data: auxdomain.CreateData{Data: data},
	}, trustedIntegrationActor(t, label+"-create"))
	if err != nil {
		t.Fatalf("create %s: %v", label, err)
	}
	return ReferenceInput{ObjectID: created.ObjectID}, service, created
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
	department, _, _ := createApprovedAuxiliaryReference(t, pool, auxdomain.EntityDepartment, map[string]any{
		"name": "资产使用部门",
	}, "asset-department")
	draft := func(category ReferenceInput) DraftInput {
		return DraftInput{
			BusinessDate: "2026-08-28", Currency: "CNY", Supplier: &refs.supplier,
			AssetAcquisitionLines: []AssetAcquisitionLineInput{{
				AssetName: "快照试验设备", Category: category, OriginalValue: "12000.00",
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
		if line.Category.ObjectID != categoryV1.ObjectID ||
			line.Category.Name != "快照类别 V1" || line.CategoryDefaultUsefulLifeMonths != 60 ||
			line.CategoryDefaultResidualRate != "5.0" {
			t.Fatalf("stored category default snapshot = %+v", line)
		}
		if line.UsefulLifeMonths != 84 || line.ResidualRate != "1.25" {
			t.Fatalf("asset-specific depreciation values = %+v, want explicit overrides", line)
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
	assertV1Snapshot()

	if _, err = categories.Disable(t.Context(), auxdomain.EntityAssetCategory, auxdomain.ObjectRevisionInput{
		ObjectID: categoryV2.ObjectID, ObjectRevision: categoryV2.ObjectRevision,
	}, trustedIntegrationActor(t, "asset-category-disable")); err != nil {
		t.Fatalf("disable asset category: %v", err)
	}
	assertV1Snapshot()

	_, err = vouchers.Create(t.Context(), EntityAssetAcquisition, CreateInput{Data: draft(ReferenceInput{
		ObjectID: categoryV2.ObjectID,
	})}, integrationApprovalActor(t, integrationActorOne, "asset-snapshot-reject-disabled"))
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorConflict {
		t.Fatalf("create with disabled category error = %#v, want conflict", err)
	}
}
