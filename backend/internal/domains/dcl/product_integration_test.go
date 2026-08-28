//go:build integration

package dcl

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

const (
	productRawTypeID      = "01JPTP00000000000000000001"
	productFinishedTypeID = "01JPTP00000000000000000003"
	productKGUnitID       = "01JAVX00000000000000000011"
	productTonUnitID      = "01JAVX00000000000000000027"
	productCategoryID     = "01JPTP00000000000000000009"
)

func TestProductDeclarationPersistsCompleteSnapshotAndControlsBOBCurrentIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	ensureProductAuxiliaries(t, pool)
	business, service := newProductIntegrationServices(t, pool, txevent.NewBus(), nil)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(id string) approval.Actor { return dclActor(t, creatorID, id) }
	reviewer := func(id string) approval.Actor { return dclActor(t, reviewerID, id) }

	raw := approveProduct(t, service, mustCreateProduct(t, service, productData("快照原料", productRawTypeID, nil), creator("raw-create")), creator("raw-submit"), reviewer("raw-approve"))
	finishedData := productData("快照成品 V1", productFinishedTypeID, &raw)
	v1 := approveProduct(t, service, mustCreateProduct(t, service, finishedData, creator("finished-create")), creator("finished-submit"), reviewer("finished-approve"))

	assertProductCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "快照成品 V1")
	current, err := business.Get(t.Context(), bobdomain.EntityProduct, bobdomain.GetInput{ObjectID: v1.ObjectID})
	if err != nil {
		t.Fatalf("get BOB current product: %v", err)
	}
	if len(current.Data.UnitConversions) != 2 || current.Data.UnitConversions[0].Unit.ObjectID == "" ||
		current.Data.Formula == nil || len(current.Data.Formula.Components) != 1 ||
		current.Data.Formula.Output.EnteredUnit.ObjectID == "" ||
		current.Data.Formula.Components[0].Material.ApprovalEntryID != raw.Approval.ApprovalEntryID ||
		current.Data.Formula.Components[0].Quantity.BaseQuantity != "25500" {
		t.Fatalf("BOB product did not read the complete DCL source snapshot: %+v", current.Data)
	}

	v2Data := productData("快照成品 V2", productFinishedTypeID, &raw)
	v2View, err := service.Save(t.Context(), ProductSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Enabled: true, Data: v2Data}, creator("v2-save"))
	if err != nil {
		t.Fatalf("save V2: %v", err)
	}
	v2 := approveProduct(t, service, productMutationFromView(v2View), creator("v2-submit"), reviewer("v2-approve"))
	assertProductCurrent(t, business, v1.ObjectID, v2.Approval.ApprovalEntryID, "快照成品 V2")

	v2, err = service.Unapprove(t.Context(), ProductReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "回落 V1"}, reviewer("v2-unapprove"))
	if err != nil {
		t.Fatalf("unapprove V2: %v", err)
	}
	assertProductCurrent(t, business, v1.ObjectID, v1.Approval.ApprovalEntryID, "快照成品 V1")
	v2, err = service.Unsubmit(t.Context(), ProductReviewInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision}, creator("v2-unsubmit"))
	if err != nil {
		t.Fatalf("unsubmit V2: %v", err)
	}
	if err = service.Delete(t.Context(), ProductDeleteInput{ObjectID: v2.ObjectID, ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision}, creator("v2-delete")); err != nil {
		t.Fatalf("delete V2 draft: %v", err)
	}
	v1, err = service.Unapprove(t.Context(), ProductReviewInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Reason: "移除首版 current"}, reviewer("v1-unapprove"))
	if err != nil {
		t.Fatalf("unapprove V1: %v", err)
	}
	assertProductAbsent(t, business, v1.ObjectID)
}

func TestProductUnapproveBlocksExactApprovedFormulaReferenceIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	ensureProductAuxiliaries(t, pool)
	business, service := newProductIntegrationServices(t, pool, txevent.NewBus(), nil)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(id string) approval.Actor { return dclActor(t, creatorID, id) }
	reviewer := func(id string) approval.Actor { return dclActor(t, reviewerID, id) }
	raw := approveProduct(t, service, mustCreateProduct(t, service, productData("被引用原料", productRawTypeID, nil), creator("raw-create")), creator("raw-submit"), reviewer("raw-approve"))
	finished := approveProduct(t, service, mustCreateProduct(t, service, productData("引用原料的正式成品", productFinishedTypeID, &raw), creator("finished-create")), creator("finished-submit"), reviewer("finished-approve"))
	finishedV2, saveErr := service.Save(t.Context(), ProductSaveInput{ObjectID: finished.ObjectID, ApprovalEntryID: finished.Approval.ApprovalEntryID, ApprovalRevision: finished.Approval.Revision, Enabled: true, Data: productData("引用原料的正式成品 V2", productFinishedTypeID, &raw)}, creator("finished-v2-save"))
	if saveErr != nil {
		t.Fatalf("save referencing Product V2: %v", saveErr)
	}
	_ = approveProduct(t, service, productMutationFromView(finishedV2), creator("finished-v2-submit"), reviewer("finished-v2-approve"))

	_, err := service.Unapprove(t.Context(), ProductReviewInput{ObjectID: raw.ObjectID, ApprovalEntryID: raw.Approval.ApprovalEntryID, ApprovalRevision: raw.Approval.Revision, Reason: "配方精确引用"}, reviewer("raw-unapprove"))
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "bob_unapprove_blocked" {
		t.Fatalf("unapprove referenced raw product error = %v", err)
	}
	assertApprovalState(t, pool, raw.Approval.ApprovalEntryID, approval.StatusApproved, raw.Approval.Revision)
	assertProductCurrent(t, business, raw.ObjectID, raw.Approval.ApprovalEntryID, "被引用原料")
}

func TestProductSaveAllowsOnlyOneConcurrentCandidateIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	ensureProductAuxiliaries(t, pool)
	_, service := newProductIntegrationServices(t, pool, txevent.NewBus(), nil)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	v1 := approveProduct(t, service, mustCreateProduct(t, service, productData("并发候选原料", productRawTypeID, nil), dclActor(t, creatorID, "create")), dclActor(t, creatorID, "submit"), dclActor(t, reviewerID, "approve"))

	results := make(chan error, 2)
	var start sync.WaitGroup
	start.Add(2)
	for i := 0; i < 2; i++ {
		i := i
		go func() {
			start.Done()
			start.Wait()
			_, err := service.Save(t.Context(), ProductSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Enabled: true, Data: productData("并发候选原料", productRawTypeID, nil)}, dclActor(t, creatorID, "concurrent-save-"+string(rune('1'+i))))
			results <- err
		}()
	}
	var successes, conflicts int
	for range 2 {
		err := <-results
		if err == nil {
			successes++
			continue
		}
		var domainErr *DomainError
		if errors.As(err, &domainErr) && domainErr.ErrorKey == "approval_open_version_exists" {
			conflicts++
			continue
		}
		t.Fatalf("unexpected concurrent save error: %v", err)
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent product saves: successes=%d conflicts=%d", successes, conflicts)
	}
	var candidates int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=$1 AND version_no=2`, v1.ObjectID).Scan(&candidates); err != nil {
		t.Fatalf("count V2 product candidates: %v", err)
	}
	if candidates != 1 {
		t.Fatalf("V2 product candidate count = %d", candidates)
	}
}

func TestProductCandidateRebasesChangedFormulaMaterialIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	ensureProductAuxiliaries(t, pool)
	_, service := newProductIntegrationServices(t, pool, txevent.NewBus(), nil)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }
	rawV1 := approveProduct(t, service, mustCreateProduct(t, service, productData("漂移原料 V1", productRawTypeID, nil), creator("raw-v1-create")), creator("raw-v1-submit"), reviewer("raw-v1-approve"))
	finished := approveProduct(t, service, mustCreateProduct(t, service, productData("漂移成品", productFinishedTypeID, &rawV1), creator("finished-create")), creator("finished-submit"), reviewer("finished-approve"))
	rawV2View, err := service.Save(t.Context(), ProductSaveInput{ObjectID: rawV1.ObjectID, ApprovalEntryID: rawV1.Approval.ApprovalEntryID, ApprovalRevision: rawV1.Approval.Revision, Enabled: true, Data: productData("漂移原料 V2", productRawTypeID, nil)}, creator("raw-v2-save"))
	if err != nil {
		t.Fatalf("save raw V2: %v", err)
	}
	rawV2 := approveProduct(t, service, productMutationFromView(rawV2View), creator("raw-v2-submit"), reviewer("raw-v2-approve"))
	candidate, err := service.Save(t.Context(), ProductSaveInput{ObjectID: finished.ObjectID, ApprovalEntryID: finished.Approval.ApprovalEntryID, ApprovalRevision: finished.Approval.Revision, Enabled: true, Data: productData("漂移成品", productFinishedTypeID, &rawV1)}, creator("finished-v2-save"))
	if err != nil {
		t.Fatalf("save finished candidate: %v", err)
	}
	view, err := service.Get(t.Context(), ProductGetInput{ObjectID: candidate.ObjectID, ApprovalEntryID: candidate.Approval.ApprovalEntryID}, creator("candidate-get"))
	if err != nil || view.Data.Formula == nil || len(view.Data.Formula.Components) != 1 {
		t.Fatalf("get rebased candidate: %+v err=%v", view, err)
	}
	component := view.Data.Formula.Components[0]
	if component.Material.ApprovalEntryID != rawV2.Approval.ApprovalEntryID || !component.RequiresConfirmation || component.Quantity.BaseQuantity != "25500" {
		t.Fatalf("candidate did not retain quantity and flag material drift: %+v", component)
	}
}

func TestProductSubmitRejectsFormulaMaterialSourceDriftIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	ensureProductAuxiliaries(t, pool)
	_, service := newProductIntegrationServices(t, pool, txevent.NewBus(), nil)
	creatorID, reviewerID := ulid.Make().String(), ulid.Make().String()
	creator := func(requestID string) approval.Actor { return dclActor(t, creatorID, requestID) }
	reviewer := func(requestID string) approval.Actor { return dclActor(t, reviewerID, requestID) }

	rawV1 := approveProduct(t, service, mustCreateProduct(t, service, productData("提交漂移原料 V1", productRawTypeID, nil), creator("raw-v1-create")), creator("raw-v1-submit"), reviewer("raw-v1-approve"))
	finishedDraft := mustCreateProduct(t, service, productData("待提交漂移成品", productFinishedTypeID, &rawV1), creator("finished-create"))
	rawV2, err := service.Save(t.Context(), ProductSaveInput{ObjectID: rawV1.ObjectID, ApprovalEntryID: rawV1.Approval.ApprovalEntryID, ApprovalRevision: rawV1.Approval.Revision, Enabled: true, Data: productData("提交漂移原料 V2", productRawTypeID, nil)}, creator("raw-v2-save"))
	if err != nil {
		t.Fatalf("save raw V2: %v", err)
	}
	_ = approveProduct(t, service, productMutationFromView(rawV2), creator("raw-v2-submit"), reviewer("raw-v2-approve"))

	_, err = service.Submit(t.Context(), ProductVersionInput{ObjectID: finishedDraft.ObjectID, ApprovalEntryID: finishedDraft.Approval.ApprovalEntryID, ApprovalRevision: finishedDraft.Approval.Revision}, creator("finished-submit"))
	assertProductReferenceDrift(t, err)
	assertApprovalState(t, pool, finishedDraft.Approval.ApprovalEntryID, approval.StatusDraft, finishedDraft.Approval.Revision)
}

func TestProductAuxiliaryStableIdentityAllowsRenameIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	ensureProductAuxiliaries(t, pool)
	_, service := newProductIntegrationServices(t, pool, txevent.NewBus(), nil)
	creator := dclActor(t, ulid.Make().String(), "aux-drift-create")
	draft := mustCreateProduct(t, service, productData("待提交 AUX 漂移产品", productRawTypeID, nil), creator)
	original, err := service.Get(t.Context(), ProductGetInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID}, creator)
	if err != nil {
		t.Fatal(err)
	}
	insertApprovedProductAuxiliaryV2(t, pool, productRawTypeID, "product-type", `{"name":"原材料 V2","behaviorProfile":"RAW_MATERIAL"}`)
	savedDraft, err := service.Save(t.Context(), ProductSaveInput{
		ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID,
		ApprovalRevision: draft.Approval.Revision, Enabled: true,
		Data: productData("待提交 AUX 漂移产品（已保存）", productRawTypeID, nil),
	}, dclActor(t, creator.ID(), "aux-drift-save"))
	if err != nil {
		t.Fatalf("save draft with stale AUX source: %v", err)
	}
	saved, err := service.Get(t.Context(), ProductGetInput{ObjectID: savedDraft.ObjectID, ApprovalEntryID: savedDraft.Approval.ApprovalEntryID}, creator)
	if err != nil || saved.Data.ProductTypeID != original.Data.ProductTypeID || saved.Data.ProductTypeName != "原材料 V2" {
		t.Fatalf("stable AUX identity did not refresh current display snapshot: original=%+v saved=%+v err=%v", original.Data, saved.Data, err)
	}
	if _, err = pool.Exec(t.Context(), `UPDATE aux_objects SET enabled=false,revision=revision+1 WHERE id=$1 AND entity='product-type'`, productRawTypeID); err != nil {
		t.Fatalf("disable saved AUX reference: %v", err)
	}

	submitted, err := service.Submit(t.Context(), ProductVersionInput{ObjectID: savedDraft.ObjectID, ApprovalEntryID: savedDraft.Approval.ApprovalEntryID, ApprovalRevision: savedDraft.Approval.Revision}, dclActor(t, creator.ID(), "aux-stable-submit"))
	if err != nil {
		t.Fatalf("submit saved AUX snapshot after source disable: %v", err)
	}
	assertApprovalState(t, pool, submitted.Approval.ApprovalEntryID, approval.StatusPending, submitted.Approval.Revision)
	approved, err := service.Approve(t.Context(), ProductVersionInput{ObjectID: submitted.ObjectID, ApprovalEntryID: submitted.Approval.ApprovalEntryID, ApprovalRevision: submitted.Approval.Revision}, dclActor(t, ulid.Make().String(), "aux-stable-approve"))
	if err != nil {
		t.Fatalf("approve saved AUX snapshot after source disable: %v", err)
	}
	view, err := service.Get(t.Context(), ProductGetInput{ObjectID: approved.ObjectID}, creator)
	if err != nil || view.Data.ProductTypeID != productRawTypeID || view.Data.ProductTypeCode != "PTP-0001" || view.Data.ProductTypeName != "原材料 V2" {
		t.Fatalf("approved AUX snapshot changed after source disable: data=%+v err=%v", view.Data, err)
	}
}

func TestApprovedProductKeepsMeasurementUnitQuantityScaleSnapshotIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	ensureProductAuxiliaries(t, pool)
	_, service := newProductIntegrationServices(t, pool, txevent.NewBus(), nil)
	creator := dclActor(t, ulid.Make().String(), "quantity-scale-create")
	approved := approveProduct(
		t, service,
		mustCreateProduct(t, service, productData("计量精度快照产品", productRawTypeID, nil), creator),
		dclActor(t, creator.ID(), "quantity-scale-submit"),
		dclActor(t, ulid.Make().String(), "quantity-scale-approve"),
	)

	insertApprovedProductAuxiliaryV2(
		t, pool, productTonUnitID, "measurement-unit",
		`{"name":"吨（新精度）","symbol":"T","quantityScale":2}`,
	)
	view, err := service.Get(t.Context(), ProductGetInput{ObjectID: approved.ObjectID}, creator)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Data.UnitConversions) != 2 {
		t.Fatalf("unit conversions = %+v", view.Data.UnitConversions)
	}
	for _, conversion := range view.Data.UnitConversions {
		if conversion.Unit.QuantityScale != 6 {
			t.Fatalf("unit snapshot changed after AUX update: %+v", conversion.Unit)
		}
	}
}

func newProductIntegrationServices(t *testing.T, pool *pgxpool.Pool, bus *txevent.Bus, current productCurrentWriter) (*bobdomain.Service, *ProductService) {
	t.Helper()
	authorizer := authorization.Func(nil)
	auxiliary := auxdomain.NewService(pool)
	business := newDCLIntegrationBOBService(pool, auxiliary, authorizer, bus)
	if current == nil {
		current = business
	}
	return business, NewProductService(pool, current, authorizer, bus)
}

func ensureProductAuxiliaries(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	for _, fixture := range []struct {
		objectID, entity, code, data string
	}{
		{productRawTypeID, "product-type", "PTP-0001", `{"name":"原材料","behaviorProfile":"RAW_MATERIAL"}`},
		{productFinishedTypeID, "product-type", "PTP-0002", `{"name":"标准成品","behaviorProfile":"STANDARD_FINISHED"}`},
		{productKGUnitID, "measurement-unit", "UNT-0001", `{"name":"千克","symbol":"kg","quantityScale":6}`},
		{productTonUnitID, "measurement-unit", "UNT-0006", `{"name":"吨","symbol":"t","quantityScale":6}`},
		{productCategoryID, "product-category", "CAT-0001", `{"name":"测试分类"}`},
	} {
		if _, err := pool.Exec(t.Context(), `INSERT INTO aux_objects(id,entity,code,data,created_by,updated_by) VALUES($1,$2,$3,$4::jsonb,$5,$5) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`, fixture.objectID, fixture.entity, fixture.code, fixture.data, "01J00000000000000000000000"); err != nil {
			t.Fatalf("insert %s object fixture: %v", fixture.entity, err)
		}
	}
}

func insertApprovedProductAuxiliaryV2(t *testing.T, pool *pgxpool.Pool, objectID, entity, data string) string {
	t.Helper()
	if _, err := pool.Exec(t.Context(), `UPDATE aux_objects SET data=$3::jsonb,revision=revision+1 WHERE id=$1 AND entity=$2`, objectID, entity, data); err != nil {
		t.Fatalf("update %s current payload: %v", entity, err)
	}
	return ""
}

func assertProductReferenceDrift(t *testing.T, err error) {
	t.Helper()
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "product_reference_drift" {
		t.Fatalf("product reference drift error = %v", err)
	}
}

func TestProductBarcodeClaimConflictAndHistoricalReleaseIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	ensureProductAuxiliaries(t, pool)
	_, service := newProductIntegrationServices(t, pool, txevent.NewBus(), nil)
	actor := dclActor(t, ulid.Make().String(), "barcode")
	first := productData("条码 V1", productRawTypeID, nil)
	first.Barcode = " BC-01 "
	v1 := mustCreateProduct(t, service, first, actor)
	conflict := productData("冲突", productRawTypeID, nil)
	conflict.Barcode = "bc-01"
	if _, err := service.Create(t.Context(), ProductCreateInput{Data: conflict}, dclActor(t, actor.ID(), "conflict")); err == nil {
		t.Fatal("case-insensitive barcode conflict was accepted")
	} else if e := new(DomainError); !errors.As(err, &e) || e.ErrorKey != "product_barcode_conflict" {
		t.Fatalf("barcode error=%v", err)
	}
	approved := approveProduct(t, service, v1, dclActor(t, actor.ID(), "submit"), dclActor(t, ulid.Make().String(), "approve"))
	v2data := productData("条码 V2", productRawTypeID, nil)
	v2data.Barcode = "BC-02"
	v2, err := service.Save(t.Context(), ProductSaveInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID, ApprovalRevision: approved.Approval.Revision, Enabled: true, Data: v2data}, dclActor(t, actor.ID(), "v2-save"))
	if err != nil {
		t.Fatal(err)
	}
	_ = approveProduct(t, service, productMutationFromView(v2), dclActor(t, actor.ID(), "v2-submit"), dclActor(t, ulid.Make().String(), "v2-approve"))
	reused := productData("历史释放", productRawTypeID, nil)
	reused.Barcode = "bc-01"
	if _, err := service.Create(t.Context(), ProductCreateInput{Data: reused}, dclActor(t, actor.ID(), "reuse")); err != nil {
		t.Fatalf("historical barcode was not released: %v", err)
	}
}

type failingProductCurrentWriter struct {
	productCurrentWriter
	failure error
}

func (w failingProductCurrentWriter) ApplyProductCurrent(ctx context.Context, tx pgx.Tx, objectID, entryID string, enabled bool, data bobdomain.DetailView, actorID string) (bobdomain.ProductCurrent, error) {
	return bobdomain.ProductCurrent{}, w.failure
}

func TestProductCurrentProjectionFailureRollsBackApprovalAndCurrentIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	ensureProductAuxiliaries(t, pool)
	bus := txevent.NewBus()
	business, service := newProductIntegrationServices(t, pool, bus, nil)
	actorID := ulid.Make().String()
	draft := mustCreateProduct(t, service, productData("回滚产品", productRawTypeID, nil), dclActor(t, actorID, "create"))
	pending, err := service.Submit(t.Context(), ProductVersionInput{ObjectID: draft.ObjectID, ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision}, dclActor(t, actorID, "submit"))
	if err != nil {
		t.Fatal(err)
	}
	failure := errors.New("injected product projection failure")
	failing := NewProductService(pool, failingProductCurrentWriter{productCurrentWriter: business, failure: failure}, authorization.Func(nil), bus)
	if _, err = failing.Approve(t.Context(), ProductVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, dclActor(t, ulid.Make().String(), "approve")); !errors.Is(err, failure) {
		t.Fatalf("approve err=%v", err)
	}
	assertApprovalState(t, pool, pending.Approval.ApprovalEntryID, approval.StatusPending, pending.Approval.Revision)
	assertProductAbsent(t, business, pending.ObjectID)
}

func TestProductQueryFiltersProductTypeAndCategoryIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	ensureProductAuxiliaries(t, pool)
	_, service := newProductIntegrationServices(t, pool, txevent.NewBus(), nil)
	actor := dclActor(t, ulid.Make().String(), "query")
	a := productData("分类产品", productRawTypeID, nil)
	a.CategoryID = productCategoryID
	categorized := mustCreateProduct(t, service, a, actor)
	view, err := service.Get(t.Context(), ProductGetInput{ObjectID: categorized.ObjectID, ApprovalEntryID: categorized.Approval.ApprovalEntryID}, actor)
	if err != nil || view.Data.CategoryCode != "CAT-0001" || view.Data.CategoryName != "测试分类" {
		t.Fatalf("category snapshot=%+v err=%v", view.Data, err)
	}
	insertApprovedProductAuxiliaryV2(t, pool, productCategoryID, "product-category", `{"name":"测试分类 V2"}`)
	view, err = service.Get(t.Context(), ProductGetInput{ObjectID: categorized.ObjectID, ApprovalEntryID: categorized.Approval.ApprovalEntryID}, actor)
	if err != nil || view.Data.CategoryCode != "CAT-0001" || view.Data.CategoryName != "测试分类" {
		t.Fatalf("historical category snapshot changed=%+v err=%v", view.Data, err)
	}
	mustCreateProduct(t, service, productData("无分类成品", productFinishedTypeID, nil), dclActor(t, actor.ID(), "second"))
	page, err := service.Query(t.Context(), ProductQueryInput{Page: 1, PageSize: 10, Filters: ProductQueryFilters{ProductTypeID: productRawTypeID, CategoryID: productCategoryID}}, actor)
	if err != nil || len(page.Items) != 1 || page.Items[0].LatestApproved != nil || page.Items[0].OpenVersion.Data.CategoryID != productCategoryID {
		t.Fatalf("exact product filters page=%+v err=%v", page, err)
	}
}

func TestDisabledProductCurrentIsReadableButNotEffectiveReferenceIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	ensureProductAuxiliaries(t, pool)
	business, service := newProductIntegrationServices(t, pool, txevent.NewBus(), nil)
	actor := dclActor(t, ulid.Make().String(), "disabled")
	v1 := approveProduct(t, service, mustCreateProduct(t, service, productData("停用产品", productRawTypeID, nil), actor), dclActor(t, actor.ID(), "submit"), dclActor(t, ulid.Make().String(), "approve"))
	v2View, err := service.Save(t.Context(), ProductSaveInput{ObjectID: v1.ObjectID, ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision, Enabled: false, Data: productData("停用产品", productRawTypeID, nil)}, dclActor(t, actor.ID(), "save"))
	if err != nil {
		t.Fatal(err)
	}
	v2 := approveProduct(t, service, productMutationFromView(v2View), dclActor(t, actor.ID(), "submit2"), dclActor(t, ulid.Make().String(), "approve2"))
	if got, err := business.Get(t.Context(), bobdomain.EntityProduct, bobdomain.GetInput{ObjectID: v1.ObjectID}); err != nil || got.Enabled {
		t.Fatalf("disabled current get=%+v err=%v", got, err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context())
	if _, err = business.ResolveLatestApprovedReference(t.Context(), tx, bobdomain.EntityProduct, v1.ObjectID); err == nil {
		t.Fatal("disabled product resolved as effective reference")
	}
	_ = v2
}

func productData(name, productTypeID string, material *ProductMutation) ProductInput {
	data := ProductInput{Name: name, ProductTypeID: productTypeID, DefaultInputUnitID: productTonUnitID, PricingUnitID: productKGUnitID, UnitConversions: []bobdomain.ProductUnitConversion{
		{Unit: bobdomain.MeasurementUnitSnapshot{ObjectID: productKGUnitID}, Factor: "1"},
		{Unit: bobdomain.MeasurementUnitSnapshot{ObjectID: productTonUnitID}, Factor: "1000"},
	}, DefaultPackagingSpec: "10"}
	if material != nil {
		data.Formula = &bobdomain.ProductFormula{Output: bobdomain.QuantitySnapshot{EnteredQuantity: "100", EnteredUnit: bobdomain.MeasurementUnitSnapshot{ObjectID: productTonUnitID}, BaseQuantity: "100000"}, Components: []bobdomain.ProductFormulaComponent{{
			Material:         bobdomain.FormulaMaterialReference{ObjectID: material.ObjectID},
			Quantity:         bobdomain.QuantitySnapshot{EnteredQuantity: "25.5", EnteredUnit: bobdomain.MeasurementUnitSnapshot{ObjectID: productTonUnitID}, BaseQuantity: "25500"},
			ResolutionStatus: "CURRENT",
		}}}
	}
	return data
}

func mustCreateProduct(t *testing.T, service *ProductService, data ProductInput, actor approval.Actor) ProductMutation {
	t.Helper()
	created, err := service.Create(t.Context(), ProductCreateInput{Data: data}, actor)
	if err != nil {
		t.Fatalf("create product: %v", err)
	}
	return created
}

func productMutationFromView(view ProductView) ProductMutation {
	return ProductMutation{
		ObjectID:       view.ObjectID,
		ObjectRevision: view.ObjectRevision,
		Enabled:        view.Enabled,
		Approval:       view.Approval,
	}
}

func approveProduct(t *testing.T, service *ProductService, mutation ProductMutation, submitter, reviewer approval.Actor) ProductMutation {
	t.Helper()
	pending, err := service.Submit(t.Context(), ProductVersionInput{ObjectID: mutation.ObjectID, ApprovalEntryID: mutation.Approval.ApprovalEntryID, ApprovalRevision: mutation.Approval.Revision}, submitter)
	if err != nil {
		view, getErr := service.Get(t.Context(), ProductGetInput{ObjectID: mutation.ObjectID, ApprovalEntryID: mutation.Approval.ApprovalEntryID}, submitter)
		t.Fatalf("submit product: %v; stored=%+v getErr=%v", err, view.Data.Formula, getErr)
	}
	approved, err := service.Approve(t.Context(), ProductVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer)
	if err != nil {
		t.Fatalf("approve product: %v", err)
	}
	return approved
}

func assertProductCurrent(t *testing.T, business *bobdomain.Service, objectID, entryID, name string) {
	t.Helper()
	view, err := business.Get(t.Context(), bobdomain.EntityProduct, bobdomain.GetInput{ObjectID: objectID})
	if err != nil || view.SourceApprovalEntryID != entryID || view.Data.Name != name {
		t.Fatalf("BOB product current = %+v err=%v", view, err)
	}
}

func assertProductAbsent(t *testing.T, business *bobdomain.Service, objectID string) {
	t.Helper()
	if _, err := business.Get(t.Context(), bobdomain.EntityProduct, bobdomain.GetInput{ObjectID: objectID}); err == nil {
		t.Fatal("BOB product current remained after V1 unapprove")
	}
}

// Keep the imported pgx interface visible in this test file: failure writers below
// deliberately wrap the same transactional current seam as ProductService.
var _ pgx.Tx
