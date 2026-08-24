//go:build integration

package bob

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestLifecycleIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	const lifecycleEntity = EntityWarehouse
	created, err := service.Create(t.Context(), lifecycleEntity, CreateInput{Data: CreateDetailInput{
		Name: "Integration Warehouse",
	}}, integrationActorOne, "integration-create")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.Status != StatusDraft || created.Revision != 1 || created.ObjectRevision != 1 {
		t.Fatalf("unexpected create result: %+v", created)
	}

	submitted, err := service.Submit(t.Context(), lifecycleEntity, VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, integrationActorOne, "integration-submit-1")
	if err != nil || submitted.Status != StatusPending || submitted.Revision != 2 {
		t.Fatalf("submit: result=%+v err=%v", submitted, err)
	}
	comment := "needs correction"
	rejected, err := service.Reject(t.Context(), lifecycleEntity, ReviewInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision, Comment: &comment,
	}, integrationActorTwo, "integration-reject")
	if err != nil || rejected.Status != StatusDraft || rejected.Revision != 3 {
		t.Fatalf("reject: result=%+v err=%v", rejected, err)
	}
	saved, err := service.Save(t.Context(), lifecycleEntity, SaveInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: rejected.Revision,
		Data: DetailInput{Name: "Integration Warehouse Corrected"},
	}, integrationActorOne, "integration-save")
	if err != nil || saved.Revision != 4 {
		t.Fatalf("save: result=%+v err=%v", saved, err)
	}
	if _, err = service.Save(t.Context(), lifecycleEntity, SaveInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: rejected.Revision,
		Data: DetailInput{Name: "Stale Save"},
	}, integrationActorOne, "integration-stale-save"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("stale save error = %v", err)
	}
	submitted, err = service.Submit(t.Context(), lifecycleEntity, VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: saved.Revision,
	}, integrationActorOne, "integration-submit-2")
	if err != nil || submitted.Revision != 5 {
		t.Fatalf("resubmit: result=%+v err=%v", submitted, err)
	}
	if _, err = service.Submit(t.Context(), lifecycleEntity, VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: saved.Revision,
	}, integrationActorOne, "integration-stale-submit"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("stale submit error = %v", err)
	}
	approved, err := service.Approve(t.Context(), lifecycleEntity, ReviewInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, "integration-approve")
	if err != nil || approved.Status != StatusEffective || approved.Revision != 6 || approved.ObjectRevision != 2 {
		t.Fatalf("approve: result=%+v err=%v", approved, err)
	}
	if _, err = service.Approve(t.Context(), lifecycleEntity, ReviewInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, "integration-stale-approve"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("stale approve error = %v", err)
	}

	view, err := service.Get(t.Context(), lifecycleEntity, GetInput{ObjectID: created.ObjectID})
	if err != nil || view.Data.Name != "Integration Warehouse Corrected" || view.Version.Status != StatusEffective {
		t.Fatalf("get effective: view=%+v err=%v", view, err)
	}
	page, err := service.Query(t.Context(), lifecycleEntity, QueryInput{
		Page: 1, PageSize: 20, Filters: QueryFilters{Keyword: view.Code}, Sort: []SortItem{},
	})
	if err != nil || page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("query: page=%+v err=%v", page, err)
	}
	history, err := service.AuditHistory(t.Context(), lifecycleEntity, HistoryInput{ObjectID: created.ObjectID, Page: 1, PageSize: 20})
	if err != nil || history.Total != 6 {
		t.Fatalf("audit history: total=%d err=%v", history.Total, err)
	}
	versions, err := service.Versions(t.Context(), lifecycleEntity, HistoryInput{ObjectID: created.ObjectID, Page: 1, PageSize: 20})
	if err != nil || versions.Total != 1 || len(versions.Items) != 1 || versions.Items[0].ReviewedBy == nil {
		t.Fatalf("versions: page=%+v err=%v", versions, err)
	}

	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin reference transaction: %v", err)
	}
	reference, err := service.ResolveEffectiveReference(t.Context(), tx, lifecycleEntity, created.ObjectID, created.VersionID)
	if err != nil || reference.Code != view.Code {
		t.Fatalf("resolve reference: reference=%+v err=%v", reference, err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit reference transaction: %v", err)
	}

	disabled, err := service.Disable(t.Context(), lifecycleEntity, ObjectRevisionInput{
		ObjectID: created.ObjectID, ObjectRevision: approved.ObjectRevision,
	}, integrationActorOne, "integration-disable")
	if err != nil || disabled.Enabled || disabled.ObjectRevision != 3 {
		t.Fatalf("disable: result=%+v err=%v", disabled, err)
	}
	tx, err = pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin disabled reference transaction: %v", err)
	}
	_, err = service.ResolveEffectiveReference(t.Context(), tx, lifecycleEntity, created.ObjectID, created.VersionID)
	_ = tx.Rollback(t.Context())
	if !errorIsKind(err, ErrorConflict) {
		t.Fatalf("disabled reference error = %v", err)
	}
	enabled, err := service.Enable(t.Context(), lifecycleEntity, ObjectRevisionInput{
		ObjectID: created.ObjectID, ObjectRevision: disabled.ObjectRevision,
	}, integrationActorOne, "integration-enable")
	if err != nil || !enabled.Enabled || enabled.ObjectRevision != 4 {
		t.Fatalf("enable: result=%+v err=%v", enabled, err)
	}
	unapproved, err := service.Unapprove(t.Context(), lifecycleEntity, ReverseInput{
		ObjectID: created.ObjectID, ObjectRevision: enabled.ObjectRevision,
		VersionID: created.VersionID, Revision: approved.Revision, Reason: "correct approved object",
	}, integrationActorOne, "integration-unapprove")
	if err != nil || unapproved.Status != StatusPending || unapproved.Version != 2 || unapproved.ObjectRevision != 5 {
		t.Fatalf("unapprove: result=%+v err=%v", unapproved, err)
	}
	edited, err := service.Unsubmit(t.Context(), lifecycleEntity, ReverseInput{
		ObjectID: created.ObjectID, ObjectRevision: unapproved.ObjectRevision,
		VersionID: unapproved.VersionID, Revision: unapproved.Revision, Reason: "return to draft",
	}, integrationActorOne, "integration-unsubmit")
	if err != nil || edited.Status != StatusDraft || edited.Version != 2 || edited.ObjectRevision != 5 {
		t.Fatalf("unsubmit: result=%+v err=%v", edited, err)
	}
	oldView, err := service.Get(t.Context(), lifecycleEntity, GetInput{ObjectID: created.ObjectID, VersionID: created.VersionID})
	wantOldStatus := StatusInvalid
	if continuousEffectiveEntity(lifecycleEntity) {
		wantOldStatus = StatusEffective
	}
	if err != nil || oldView.Version.Status != wantOldStatus {
		t.Fatalf("old version after edit: view=%+v err=%v", oldView, err)
	}
	tx, err = pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin invalid reference transaction: %v", err)
	}
	_, err = service.ResolveEffectiveReference(t.Context(), tx, lifecycleEntity, created.ObjectID, created.VersionID)
	_ = tx.Rollback(t.Context())
	if continuousEffectiveEntity(lifecycleEntity) {
		if err != nil {
			t.Fatalf("effective reference during candidate edit error = %v", err)
		}
	} else if !errorIsKind(err, ErrorConflict) {
		t.Fatalf("invalidated reference error = %v", err)
	}
	if _, err = service.Unapprove(t.Context(), lifecycleEntity, ReverseInput{
		ObjectID: created.ObjectID, ObjectRevision: enabled.ObjectRevision,
		VersionID: created.VersionID, Revision: approved.Revision, Reason: "repeat",
	}, integrationActorOne, "integration-unapprove-repeat"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("repeat unapprove error = %v", err)
	}
}

func TestProductEffectiveSaveCreatesApprovableCandidateIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	service.SetAuxiliaryResolver(integrationAuxiliaryResolver{})
	created, effective := createApprovedIntegration(t, service, EntityProduct, CreateDetailInput{
		Name: "Candidate Product " + newID(), DefaultPackagingSpec: "25",
	}, "product-candidate")
	current, err := service.Get(t.Context(), EntityProduct, GetInput{ObjectID: created.ObjectID})
	if err != nil {
		t.Fatalf("get effective product: %v", err)
	}
	returnable := current.Data.Returnable
	unitConversions := current.Data.UnitConversions

	candidate, err := service.Save(t.Context(), EntityProduct, SaveInput{
		ObjectID: created.ObjectID, VersionID: effective.VersionID, Revision: effective.Revision,
		Data: DetailInput{
			Name: current.Data.Name, ProductTypeID: Optional(current.Data.ProductTypeID),
			DefaultInputUnitID: Optional(current.Data.DefaultInputUnitID), PricingUnitID: Optional(current.Data.PricingUnitID),
			UnitConversions: &unitConversions, Returnable: &returnable, DefaultPackagingSpec: Optional("26"),
		},
	}, integrationActorOne, "product-candidate-save")
	if err != nil {
		t.Fatalf("save effective product: %v", err)
	}
	submitted, err := service.Submit(t.Context(), EntityProduct, VersionRevisionInput{
		ObjectID: candidate.ObjectID, VersionID: candidate.VersionID, Revision: candidate.Revision,
	}, integrationActorOne, "product-candidate-submit")
	if err != nil {
		t.Fatalf("submit product candidate: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntityProduct, ReviewInput{
		ObjectID: submitted.ObjectID, VersionID: submitted.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, "product-candidate-approve")
	if err != nil {
		t.Fatalf("approve product candidate: %v", err)
	}
	if approved.Status != StatusEffective || approved.VersionID != candidate.VersionID {
		t.Fatalf("approved product candidate = %+v", approved)
	}

	finishedData := CreateDetailInput{
		Name: "Candidate Finished Product " + newID(), ProductTypeID: "01JPTP00000000000000000003",
		DefaultInputUnitID: integrationKGUnitID, PricingUnitID: integrationKGUnitID,
		UnitConversions:      []ProductUnitConversion{{Unit: MeasurementUnitSnapshot{ObjectID: integrationKGUnitID}, Factor: "1"}},
		DefaultPackagingSpec: "20",
		Formula: &ProductFormula{
			Output: QuantitySnapshot{EnteredQuantity: "1", EnteredUnit: MeasurementUnitSnapshot{ObjectID: integrationKGUnitID}, BaseQuantity: "1"},
			Components: []ProductFormulaComponent{{
				Material:         FormulaMaterialReference{ObjectID: created.ObjectID, VersionID: approved.VersionID},
				Quantity:         QuantitySnapshot{EnteredQuantity: "2", EnteredUnit: MeasurementUnitSnapshot{ObjectID: integrationKGUnitID}, BaseQuantity: "2"},
				ResolutionStatus: "CURRENT",
			}},
		},
	}
	invalidMaterialUnit := finishedData
	invalidMaterialUnit.Name = "Invalid Formula Material Unit " + newID()
	invalidMaterialUnit.Formula = cloneProductFormula(finishedData.Formula)
	invalidMaterialUnit.Formula.Components[0].Quantity.EnteredUnit.ObjectID = "01JAVX00000000000000000013"
	if _, err = service.Create(t.Context(), EntityProduct, CreateInput{Data: invalidMaterialUnit}, integrationActorOne, "invalid-formula-material-unit"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("formula material unit outside material conversions error = %v", err)
	}
	finishedCreated, finishedEffective := createApprovedIntegration(t, service, EntityProduct, finishedData, "finished-candidate")
	explicitCreated, explicitEffective := createApprovedIntegration(t, service, EntityProduct, finishedData, "finished-explicit-formula-candidate")
	explicitCurrent, err := service.Get(t.Context(), EntityProduct, GetInput{ObjectID: explicitCreated.ObjectID})
	if err != nil {
		t.Fatalf("get explicit formula product: %v", err)
	}
	explicitReturnable := explicitCurrent.Data.Returnable
	explicitUnits := explicitCurrent.Data.UnitConversions
	explicitFormula := cloneProductFormula(explicitCurrent.Data.Formula)
	explicitCandidate, err := service.Save(t.Context(), EntityProduct, SaveInput{
		ObjectID: explicitCreated.ObjectID, VersionID: explicitEffective.VersionID, Revision: explicitEffective.Revision,
		Data: DetailInput{
			Name: explicitCurrent.Data.Name, ProductTypeID: Optional(explicitCurrent.Data.ProductTypeID),
			DefaultInputUnitID: Optional(explicitCurrent.Data.DefaultInputUnitID), PricingUnitID: Optional(explicitCurrent.Data.PricingUnitID),
			UnitConversions: &explicitUnits, Returnable: &explicitReturnable, DefaultPackagingSpec: Optional("22"), Formula: explicitFormula,
		},
	}, integrationActorOne, "finished-explicit-formula-candidate-save")
	if err != nil {
		t.Fatalf("save candidate with explicit formula: %v", err)
	}
	explicitCandidateView, err := service.Get(t.Context(), EntityProduct, GetInput{ObjectID: explicitCreated.ObjectID, VersionID: explicitCandidate.VersionID})
	if err != nil {
		t.Fatalf("get candidate with explicit formula: %v", err)
	}
	if explicitCandidateView.Data.Formula == nil || !explicitCandidateView.Data.Formula.Components[0].RequiresConfirmation {
		t.Fatalf("explicit candidate formula was not refreshed: %+v", explicitCandidateView.Data.Formula)
	}

	current, err = service.Get(t.Context(), EntityProduct, GetInput{ObjectID: created.ObjectID})
	if err != nil {
		t.Fatalf("get current raw product: %v", err)
	}
	returnable = false
	unitConversions = current.Data.UnitConversions
	packagingCandidate, err := service.Save(t.Context(), EntityProduct, SaveInput{
		ObjectID: created.ObjectID, VersionID: approved.VersionID, Revision: approved.Revision,
		Data: DetailInput{
			Name: current.Data.Name, ProductTypeID: Optional("01JPTP00000000000000000007"),
			DefaultInputUnitID: Optional(current.Data.DefaultInputUnitID), PricingUnitID: Optional(current.Data.PricingUnitID),
			UnitConversions: &unitConversions, Returnable: &returnable, DefaultPackagingSpec: Optional(""),
		},
	}, integrationActorOne, "raw-packaging-candidate-save")
	if err != nil {
		t.Fatalf("save raw packaging candidate: %v", err)
	}
	packagingSubmitted, err := service.Submit(t.Context(), EntityProduct, VersionRevisionInput{
		ObjectID: packagingCandidate.ObjectID, VersionID: packagingCandidate.VersionID, Revision: packagingCandidate.Revision,
	}, integrationActorOne, "raw-packaging-candidate-submit")
	if err != nil {
		t.Fatalf("submit raw packaging candidate: %v", err)
	}
	if _, err = service.Approve(t.Context(), EntityProduct, ReviewInput{
		ObjectID: packagingSubmitted.ObjectID, VersionID: packagingSubmitted.VersionID, Revision: packagingSubmitted.Revision,
	}, integrationActorTwo, "raw-packaging-candidate-approve"); err != nil {
		t.Fatalf("approve raw packaging candidate: %v", err)
	}

	finishedCurrent, err := service.Get(t.Context(), EntityProduct, GetInput{ObjectID: finishedCreated.ObjectID})
	if err != nil {
		t.Fatalf("get finished product: %v", err)
	}
	finishedReturnable := finishedCurrent.Data.Returnable
	finishedUnits := finishedCurrent.Data.UnitConversions
	refreshedCandidate, err := service.Save(t.Context(), EntityProduct, SaveInput{
		ObjectID: finishedCreated.ObjectID, VersionID: finishedEffective.VersionID, Revision: finishedEffective.Revision,
		Data: DetailInput{
			Name: finishedCurrent.Data.Name, ProductTypeID: Optional(finishedCurrent.Data.ProductTypeID),
			DefaultInputUnitID: Optional(finishedCurrent.Data.DefaultInputUnitID), PricingUnitID: Optional(finishedCurrent.Data.PricingUnitID),
			UnitConversions: &finishedUnits, Returnable: &finishedReturnable, DefaultPackagingSpec: Optional("21"),
		},
	}, integrationActorOne, "finished-refresh-candidate-save")
	if err != nil {
		t.Fatalf("save finished refresh candidate: %v", err)
	}
	refreshedView, err := service.Get(t.Context(), EntityProduct, GetInput{
		ObjectID: finishedCreated.ObjectID, VersionID: refreshedCandidate.VersionID,
	})
	if err != nil {
		t.Fatalf("get refreshed candidate: %v", err)
	}
	if refreshedView.Data.Formula == nil || len(refreshedView.Data.Formula.Components) != 1 ||
		refreshedView.Data.Formula.Components[0].ResolutionStatus != "UNRESOLVED" {
		t.Fatalf("refreshed formula = %+v", refreshedView.Data.Formula)
	}
	refreshedCandidate, err = service.Save(t.Context(), EntityProduct, SaveInput{
		ObjectID: refreshedCandidate.ObjectID, VersionID: refreshedCandidate.VersionID, Revision: refreshedCandidate.Revision,
		Data: DetailInput{Name: finishedCurrent.Data.Name + " Draft"},
	}, integrationActorOne, "finished-unresolved-candidate-save")
	if err != nil {
		t.Fatalf("save unresolved candidate without editing formula: %v", err)
	}
	refreshedView, err = service.Get(t.Context(), EntityProduct, GetInput{
		ObjectID: finishedCreated.ObjectID, VersionID: refreshedCandidate.VersionID,
	})
	if err != nil {
		t.Fatalf("get saved unresolved candidate: %v", err)
	}
	if refreshedView.Data.Name != finishedCurrent.Data.Name+" Draft" || refreshedView.Data.Formula == nil ||
		refreshedView.Data.Formula.Components[0].ResolutionStatus != "UNRESOLVED" {
		t.Fatalf("saved unresolved candidate = %+v", refreshedView.Data)
	}
	if _, err = service.Submit(t.Context(), EntityProduct, VersionRevisionInput{
		ObjectID: refreshedCandidate.ObjectID, VersionID: refreshedCandidate.VersionID, Revision: refreshedCandidate.Revision,
	}, integrationActorOne, "finished-unresolved-candidate-submit"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("submit unresolved candidate error = %v", err)
	}
}

func TestContinuousEffectiveEntitiesKeepLastEffectiveVersionIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	fundOperating, _ := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{
		Name: "Continuous Fund Operating " + newID(), TaxNumber: "TAX" + newID()[3:],
	}, "continuous-fund-operating")
	cases := []struct {
		entity    string
		data      CreateDetailInput
		saveInput func(DetailView) DetailInput
		seeded    bool
	}{
		{entity: EntityOperatingEntity, data: CreateDetailInput{Name: "Continuous Operating " + newID(), TaxNumber: "TAX" + newID()[3:]}},
		{entity: EntityEmployee, data: CreateDetailInput{Name: "Continuous Employee " + newID()}},
		{entity: EntityFundAccount, data: CreateDetailInput{Name: "Continuous Fund " + newID(), Currency: "CNY", OperatingEntityID: fundOperating.ObjectID}},
		{entity: EntityCategory, data: CreateDetailInput{Name: "Continuous Category " + newID(), TargetEntity: EntityProduct}},
		{entity: EntityDepartment, data: CreateDetailInput{Name: "Continuous Department " + newID()}},
		{entity: EntityPosition, data: CreateDetailInput{Name: "Continuous Position " + newID()}},
		{entity: EntitySettlementMethod, data: CreateDetailInput{}, saveInput: func(current DetailView) DetailInput {
			surcharge := "0.01"
			return DetailInput{DefaultSalesSurcharge: &surcharge}
		}, seeded: true},
	}

	for _, test := range cases {
		t.Run(test.entity, func(t *testing.T) {
			var effective MutationResult
			if test.seeded {
				enabled := true
				page, queryErr := service.Query(t.Context(), test.entity, QueryInput{
					Page: 1, PageSize: 1, Filters: QueryFilters{Status: []string{StatusEffective}, Enabled: &enabled},
				})
				if queryErr != nil || len(page.Items) != 1 || page.Items[0].Effective == nil {
					t.Fatalf("query seeded effective version: page=%+v err=%v", page, queryErr)
				}
				version := page.Items[0].Effective
				effective = MutationResult{ObjectID: page.Items[0].ObjectID, ObjectRevision: page.Items[0].ObjectRevision,
					Enabled: page.Items[0].Enabled, VersionID: version.VersionID, Version: version.Version,
					Status: version.Status, Revision: version.Revision}
			} else {
				_, effective = createApprovedIntegration(t, service, test.entity, test.data, "continuous-"+test.entity)
			}
			current, err := service.Get(t.Context(), test.entity, GetInput{ObjectID: effective.ObjectID})
			if err != nil {
				t.Fatalf("get effective: %v", err)
			}
			saveInput := DetailInput{Name: current.Data.Name + " candidate", Currency: current.Data.Currency}
			if test.saveInput != nil {
				saveInput = test.saveInput(current.Data)
			}
			candidate, err := service.Save(t.Context(), test.entity, SaveInput{
				ObjectID: effective.ObjectID, VersionID: effective.VersionID, Revision: effective.Revision,
				Data: saveInput,
			}, integrationActorOne, "continuous-"+test.entity+"-save")
			if err != nil {
				t.Fatalf("save effective version: %v", err)
			}
			if candidate.VersionID == effective.VersionID || candidate.Status != StatusDraft {
				t.Fatalf("candidate = %+v, effective = %+v", candidate, effective)
			}
			retained, err := service.Get(t.Context(), test.entity, GetInput{
				ObjectID: effective.ObjectID, VersionID: effective.VersionID,
			})
			if err != nil || retained.Version.Status != StatusEffective {
				t.Fatalf("effective version during candidate = %+v, err=%v", retained, err)
			}

			tx, err := pool.Begin(t.Context())
			if err != nil {
				t.Fatalf("begin effective reference: %v", err)
			}
			reference, err := service.ResolveEffectiveReference(t.Context(), tx, test.entity, effective.ObjectID, effective.VersionID)
			if err != nil {
				_ = tx.Rollback(t.Context())
				t.Fatalf("resolve last effective during candidate: %v", err)
			}
			if reference.Data.Name != current.Data.Name {
				_ = tx.Rollback(t.Context())
				t.Fatalf("reference data = %+v, want last effective name %q", reference.Data, current.Data.Name)
			}
			if err = tx.Commit(t.Context()); err != nil {
				t.Fatalf("commit effective reference: %v", err)
			}
			if test.entity == EntityOperatingEntity {
				enabled := true
				page, queryErr := service.Query(t.Context(), test.entity, QueryInput{
					Page: 1, PageSize: 20,
					Filters: QueryFilters{Status: []string{StatusEffective}, Enabled: &enabled},
					Sort:    []SortItem{{Field: "code", Order: "asc"}},
				})
				if queryErr != nil || len(page.Items) == 0 || page.Items[0].Effective == nil {
					t.Fatalf("query operating entity during candidate: page=%+v err=%v", page, queryErr)
				}
			}

			submitted, err := service.Submit(t.Context(), test.entity, VersionRevisionInput{
				ObjectID: candidate.ObjectID, VersionID: candidate.VersionID, Revision: candidate.Revision,
			}, integrationActorOne, "continuous-"+test.entity+"-submit")
			if err != nil {
				t.Fatalf("submit candidate: %v", err)
			}
			approved, err := service.Approve(t.Context(), test.entity, ReviewInput{
				ObjectID: submitted.ObjectID, VersionID: submitted.VersionID, Revision: submitted.Revision,
			}, integrationActorTwo, "continuous-"+test.entity+"-approve")
			if err != nil {
				t.Fatalf("approve candidate: %v", err)
			}
			if approved.VersionID != candidate.VersionID || approved.Status != StatusEffective {
				t.Fatalf("approved candidate = %+v", approved)
			}

			old, err := service.Get(t.Context(), test.entity, GetInput{ObjectID: effective.ObjectID, VersionID: effective.VersionID})
			if err != nil || old.Version.Status != StatusInvalid {
				t.Fatalf("old effective after switch = %+v, err=%v", old, err)
			}
		})
	}
}

func TestEveryEntityUsesTheLifecycleContractIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	platform, _ := createApprovedIntegration(t, service, EntityOtherUnit, CreateDetailInput{
		Name: "Lifecycle Carrier",
	}, "contract-platform")
	_, operating := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{
		Name: "Lifecycle Operating Entity", TaxNumber: "TAX" + newID()[3:],
	}, "contract-operating")
	tests := []struct {
		entity string
		data   CreateDetailInput
	}{
		{EntityOtherUnit, CreateDetailInput{Name: "Other Party"}},
		{EntityProduct, CreateDetailInput{Name: "Product"}},
		{EntityWarehouse, CreateDetailInput{Name: "主仓"}},
		{EntityVehicle, CreateDetailInput{
			Name: "Vehicle", PlateNumber: "沪A" + newID(), VehicleType: "Truck",
			CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: platform.ObjectID},
		}},
		{EntityFundAccount, CreateDetailInput{Name: "Cash", Currency: "CNY"}},
		{EntityCategory, CreateDetailInput{Name: "Product Category", TargetEntity: EntityProduct}},
		{EntityDepartment, CreateDetailInput{Name: "Operations"}},
		{EntityPosition, CreateDetailInput{Name: "Operator"}},
	}
	for _, test := range tests {
		t.Run(test.entity, func(t *testing.T) {
			test.data.Code = "LC" + newID()
			if test.entity == EntityProduct {
				completeRawProductIntegration(service, &test.data)
				previousAuxiliaryResolver := service.auxiliaryResolver
				service.SetAuxiliaryResolver(integrationAuxiliaryResolver{})
				defer service.SetAuxiliaryResolver(previousAuxiliaryResolver)
			}
			if test.entity == EntityOtherUnit {
				test.data.OperatingEntityID = operating.ObjectID
			}
			if test.entity == EntityFundAccount {
				test.data.OperatingEntityID = operating.ObjectID
			}
			var created MutationResult
			var err error
			if test.entity == EntityOtherUnit {
				created = createOtherUnitDraftIntegration(t, service, test.data, "contract")
			} else {
				created, err = service.Create(t.Context(), test.entity, CreateInput{Data: test.data}, integrationActorOne, "contract-create")
			}
			if err != nil {
				t.Fatalf("create: %v", err)
			}
			submitted, err := service.Submit(t.Context(), test.entity, VersionRevisionInput{
				ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
			}, integrationActorOne, "contract-submit")
			if err != nil {
				t.Fatalf("submit: %v", err)
			}
			if _, err = service.Approve(t.Context(), test.entity, ReviewInput{
				ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision,
			}, integrationActorOne, "contract-self-approve"); !errorIsKind(err, ErrorConflict) {
				t.Fatalf("self approval error = %v", err)
			}
			approved, err := service.Approve(t.Context(), test.entity, ReviewInput{
				ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision,
			}, integrationActorTwo, "contract-approve")
			if err != nil {
				t.Fatalf("approve: %v", err)
			}
			tx, err := pool.Begin(t.Context())
			if err != nil {
				t.Fatalf("begin resolve: %v", err)
			}
			reference, err := service.ResolveEffectiveReference(t.Context(), tx, test.entity, created.ObjectID, created.VersionID)
			if err != nil {
				t.Fatalf("resolve: %v", err)
			}
			if reference.Data.Name != test.data.Name {
				t.Fatalf("reference name = %q, want %q", reference.Data.Name, test.data.Name)
			}
			if err = tx.Commit(t.Context()); err != nil {
				t.Fatalf("commit resolve: %v", err)
			}
			if test.entity == EntityOtherUnit {
				return
			}
			edited, err := service.Edit(t.Context(), test.entity, ObjectRevisionInput{
				ObjectID: created.ObjectID, ObjectRevision: approved.ObjectRevision,
			}, integrationActorOne, "contract-edit")
			if err != nil || edited.Version != 2 || edited.Status != StatusDraft {
				t.Fatalf("edit: result=%+v err=%v", edited, err)
			}
			oldVersion, err := service.Get(t.Context(), test.entity, GetInput{ObjectID: created.ObjectID, VersionID: created.VersionID})
			if err != nil {
				t.Fatalf("get prior version: %v", err)
			}
			if continuousEffectiveEntity(test.entity) {
				if oldVersion.Version.Status != StatusEffective {
					t.Fatalf("continuous effective version status = %s, want %s", oldVersion.Version.Status, StatusEffective)
				}
				tx, err := pool.Begin(t.Context())
				if err != nil {
					t.Fatalf("begin prior reference resolve: %v", err)
				}
				if _, err = service.ResolveEffectiveReference(t.Context(), tx, test.entity, created.ObjectID, created.VersionID); err != nil {
					t.Fatalf("resolve retained effective reference: %v", err)
				}
				if err = tx.Commit(t.Context()); err != nil {
					t.Fatalf("commit prior reference resolve: %v", err)
				}
				submittedCandidate, err := service.Submit(t.Context(), test.entity, VersionRevisionInput{
					ObjectID: edited.ObjectID, VersionID: edited.VersionID, Revision: edited.Revision,
				}, integrationActorOne, "contract-candidate-submit")
				if err != nil {
					t.Fatalf("submit candidate: %v", err)
				}
				approvedCandidate, err := service.Approve(t.Context(), test.entity, ReviewInput{
					ObjectID: edited.ObjectID, VersionID: edited.VersionID, Revision: submittedCandidate.Revision,
				}, integrationActorTwo, "contract-candidate-approve")
				if err != nil || approvedCandidate.Status != StatusEffective {
					t.Fatalf("approve candidate: result=%+v err=%v", approvedCandidate, err)
				}
				oldVersion, err = service.Get(t.Context(), test.entity, GetInput{
					ObjectID: created.ObjectID, VersionID: created.VersionID,
				})
				if err != nil || oldVersion.Version.Status != StatusInvalid {
					t.Fatalf("replaced effective version: view=%+v err=%v", oldVersion, err)
				}
			} else if oldVersion.Version.Status != StatusInvalid {
				t.Fatalf("invalidated version: view=%+v", oldVersion)
			}
		})
	}
}

func TestVehicleCarrierAffiliationLifecycleIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	operating, _ := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{
		Name: "自有车经营主体", TaxNumber: "TAX" + newID()[3:],
	}, "internal-carrier")
	internalVehicle, _ := createApprovedIntegration(t, service, EntityVehicle, CreateDetailInput{
		Code: "IV" + newID(), Name: "自有配送车", PlateNumber: "粤I" + newID(), VehicleType: "厢式货车",
		CarrierAffiliation: &CarrierAffiliation{Type: "INTERNAL", OperatingEntityID: operating.ObjectID},
	}, "internal-vehicle")
	internalView, err := service.Get(t.Context(), EntityVehicle, GetInput{ObjectID: internalVehicle.ObjectID})
	if err != nil || internalView.Data.CarrierAffiliation == nil || internalView.Data.CarrierAffiliation.Type != "INTERNAL" || internalView.Data.CarrierAffiliation.OperatingEntityID != operating.ObjectID || internalView.Data.BulkLiquidCapable {
		t.Fatalf("internal vehicle affiliation: view=%+v err=%v", internalView, err)
	}
	generalSupplier, _ := createApprovedIntegration(t, service, EntitySupplier, CreateDetailInput{
		Code: "GS" + newID(), Name: "普通供应商",
	}, "general-supplier")
	if _, err := service.Create(t.Context(), EntityVehicle, CreateInput{Data: CreateDetailInput{
		Code: "GV" + newID(), Name: "错误归属车辆", PlateNumber: "粤A" + newID(),
		VehicleType: "厢式货车", CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: generalSupplier.ObjectID},
	}}, integrationActorOne, "general-supplier-vehicle"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("general supplier vehicle error = %v", err)
	}

	platformCreated, _ := createApprovedIntegration(t, service, EntityOtherUnit, CreateDetailInput{
		Name: "承运服务单位",
	}, "logistics-platform")
	vehiclePlate := "粤B" + newID()
	vehicleCreated, _ := createApprovedIntegration(t, service, EntityVehicle, CreateDetailInput{
		Code: "VH" + newID(), Name: "配送车", PlateNumber: vehiclePlate,
		VehicleType: "厢式货车", CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: platformCreated.ObjectID},
		BulkLiquidCapable: true,
	}, "logistics-vehicle")
	vehiclePage, err := service.Query(t.Context(), EntityVehicle, QueryInput{
		Page: 1, PageSize: 20, Filters: QueryFilters{Keyword: strings.ToLower(vehiclePlate)},
	})
	if err != nil || vehiclePage.Total != 1 || len(vehiclePage.Items) != 1 {
		t.Fatalf("query vehicle by plate: page=%+v err=%v", vehiclePage, err)
	}

	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin vehicle reference: %v", err)
	}
	reference, err := service.ResolveEffectiveReference(
		t.Context(), tx, EntityVehicle, vehicleCreated.ObjectID, vehicleCreated.VersionID,
	)
	if err != nil {
		t.Fatalf("resolve vehicle: %v", err)
	}
	if reference.Data.CarrierAffiliation == nil || reference.Data.CarrierAffiliation.ServiceRelationshipObjectID != platformCreated.ObjectID || reference.Data.VehicleType != "厢式货车" || !reference.Data.BulkLiquidCapable {
		t.Fatalf("vehicle reference = %+v", reference)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit vehicle reference: %v", err)
	}
}

func TestVehiclePlateUniquenessAndHistoryIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	platform, _ := createApprovedIntegration(t, service, EntityOtherUnit, CreateDetailInput{
		Name: "Plate Carrier",
	}, "plate-platform")

	plate := "沪C" + newID()
	start := make(chan struct{})
	results := make(chan error, 2)
	for index := range 2 {
		go func(index int) {
			<-start
			_, createErr := service.Create(context.Background(), EntityVehicle, CreateInput{Data: CreateDetailInput{
				Code: "PC" + fmt.Sprint(index) + newID(), Name: "Concurrent Vehicle",
				PlateNumber: strings.ToLower(plate), VehicleType: "Truck", CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: platform.ObjectID},
			}}, integrationActorOne, fmt.Sprintf("plate-concurrent-%d", index))
			results <- createErr
		}(index)
	}
	close(start)
	successes, conflicts := 0, 0
	for range 2 {
		switch err := <-results; {
		case err == nil:
			successes++
		case errorIsKind(err, ErrorConflict):
			conflicts++
		default:
			t.Fatalf("concurrent plate error = %v", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("plate successes=%d conflicts=%d", successes, conflicts)
	}

	original, approved := createApprovedIntegration(t, service, EntityVehicle, CreateDetailInput{
		Code: "PR" + newID(), Name: "Reusable Plate Vehicle", PlateNumber: "沪D" + newID(),
		VehicleType: "Truck", CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: platform.ObjectID},
	}, "plate-release")
	originalView, err := service.Get(t.Context(), EntityVehicle, GetInput{ObjectID: original.ObjectID})
	if err != nil {
		t.Fatalf("get original vehicle: %v", err)
	}
	edited, err := service.Edit(t.Context(), EntityVehicle, ObjectRevisionInput{
		ObjectID: original.ObjectID, ObjectRevision: approved.ObjectRevision,
	}, integrationActorOne, "plate-release-edit")
	if err != nil {
		t.Fatalf("edit original vehicle: %v", err)
	}
	candidate, err := service.Save(t.Context(), EntityVehicle, SaveInput{
		ObjectID: edited.ObjectID, VersionID: edited.VersionID, Revision: edited.Revision,
		Data: DetailInput{
			Name: "Reusable Plate Vehicle", PlateNumber: "沪E" + newID(),
			VehicleType: "Truck", CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: platform.ObjectID},
		},
	}, integrationActorOne, "plate-release-save")
	if err != nil {
		t.Fatalf("save replacement plate: %v", err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin retained vehicle reference: %v", err)
	}
	retained, err := service.ResolveEffectiveReference(t.Context(), tx, EntityVehicle, original.ObjectID, original.VersionID)
	if err != nil {
		_ = tx.Rollback(t.Context())
		t.Fatalf("resolve retained vehicle reference: %v", err)
	}
	if retained.Data.PlateNumber != originalView.Data.PlateNumber {
		_ = tx.Rollback(t.Context())
		t.Fatalf("candidate changed effective vehicle plate: got %q want %q", retained.Data.PlateNumber, originalView.Data.PlateNumber)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit retained vehicle reference: %v", err)
	}
	if _, err = service.Create(t.Context(), EntityVehicle, CreateInput{Data: CreateDetailInput{
		Code: "PN" + newID(), Name: "Reused Plate Vehicle", PlateNumber: originalView.Data.PlateNumber,
		VehicleType: "Truck", CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: platform.ObjectID},
	}}, integrationActorOne, "plate-reuse-before-approval"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("reuse effective candidate plate error = %v, want conflict", err)
	}
	submitted, err := service.Submit(t.Context(), EntityVehicle, VersionRevisionInput{
		ObjectID: candidate.ObjectID, VersionID: candidate.VersionID, Revision: candidate.Revision,
	}, integrationActorOne, "plate-release-submit")
	if err != nil {
		t.Fatalf("submit replacement plate candidate: %v", err)
	}
	if _, err = service.Approve(t.Context(), EntityVehicle, ReviewInput{
		ObjectID: submitted.ObjectID, VersionID: submitted.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, "plate-release-approve"); err != nil {
		t.Fatalf("approve replacement plate candidate: %v", err)
	}
	if _, err = service.Create(t.Context(), EntityVehicle, CreateInput{Data: CreateDetailInput{
		Code: "PN" + newID(), Name: "Reused Plate Vehicle", PlateNumber: originalView.Data.PlateNumber,
		VehicleType: "Truck", CarrierAffiliation: &CarrierAffiliation{Type: "EXTERNAL", ServiceRelationshipObjectID: platform.ObjectID},
	}}, integrationActorOne, "plate-reuse-after-approval"); err != nil {
		t.Fatalf("reuse historical plate after candidate approval: %v", err)
	}
}
