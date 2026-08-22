//go:build integration

package bob

import (
	"testing"
)

var partyMergeAllRelationshipsVisible = PartyRelationshipVisibility{
	Customer: true, Supplier: true, Employment: true, OtherUnit: true, SalesPartner: true,
}

func TestPartyMergeTransfersNonConflictingRelationshipAndRetiresSourceIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	_, sourceOperating := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{Name: "合并来源经营主体"}, "party-merge-source-operating")
	_, targetOperating := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{Name: "合并目标经营主体"}, "party-merge-target-operating")

	source := createApprovedOtherUnitForPartyMerge(t, service, sourceOperating.ObjectID, "合并来源主体", "party-merge-source")
	target := createApprovedOtherUnitForPartyMerge(t, service, targetOperating.ObjectID, "合并保留主体", "party-merge-target")
	sourceParty, err := service.PartyGet(t.Context(), PartyGetInput{PartyID: source.PartyID}, PartyRelationshipVisibility{OtherUnit: true})
	if err != nil {
		t.Fatalf("get source Party: %v", err)
	}
	targetParty, err := service.PartyGet(t.Context(), PartyGetInput{PartyID: target.PartyID}, PartyRelationshipVisibility{OtherUnit: true})
	if err != nil {
		t.Fatalf("get target Party: %v", err)
	}
	preflight, err := service.PartyMergePreflight(t.Context(), PartyMergePreflightInput{
		SourcePartyID: source.PartyID, TargetPartyID: target.PartyID,
		SourceRevision: sourceParty.Revision, TargetRevision: targetParty.Revision,
	}, partyMergeAllRelationshipsVisible, integrationActorOne, "party-merge-preflight")
	if err != nil || !preflight.CanMerge || preflight.PreflightID == "" || len(preflight.RelationshipConflicts) != 0 {
		t.Fatalf("preflight = %#v, err=%v", preflight, err)
	}
	merged, err := service.PartyMergeConfirm(t.Context(), PartyMergeConfirmInput{
		PreflightID: preflight.PreflightID, SourcePartyID: source.PartyID, TargetPartyID: target.PartyID,
		SourceRevision: sourceParty.Revision, TargetRevision: targetParty.Revision,
	}, partyMergeAllRelationshipsVisible, integrationActorOne, "party-merge-confirm")
	if err != nil || merged.TransferredRelationships != 1 || merged.MergedRelationships != 0 {
		t.Fatalf("merge = %#v, err=%v", merged, err)
	}
	var mergedInto string
	if err = pool.QueryRow(t.Context(), `SELECT merged_into_party_id FROM bob_parties WHERE id=$1`, source.PartyID).Scan(&mergedInto); err != nil || mergedInto != target.PartyID {
		t.Fatalf("source Party merge state = %q, %v", mergedInto, err)
	}
	var relationshipPartyID string
	if err = pool.QueryRow(t.Context(), `SELECT party_id FROM bob_service_relationships WHERE object_id=$1`, source.ObjectID).Scan(&relationshipPartyID); err != nil || relationshipPartyID != target.PartyID {
		t.Fatalf("transferred relationship Party = %q, %v", relationshipPartyID, err)
	}
	if _, err = service.OtherUnitCreate(t.Context(), OtherUnitCreateInput{
		PartyID: source.PartyID, Data: OtherUnitData{OperatingEntityID: targetOperating.ObjectID},
	}, integrationActorOne, "party-merge-source-reuse", true); err == nil {
		t.Fatal("merged source Party was accepted for a new relationship")
	}
}

func TestPartyMergeConfirmRejectsStalePreflightIntegration(t *testing.T) {
	service := NewService(integrationPool(t))
	_, operatingOne := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{Name: "预检来源经营主体"}, "party-merge-stale-operating-one")
	_, operatingTwo := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{Name: "预检目标经营主体"}, "party-merge-stale-operating-two")
	source := createApprovedOtherUnitForPartyMerge(t, service, operatingOne.ObjectID, "预检来源主体", "party-merge-stale-source")
	target := createApprovedOtherUnitForPartyMerge(t, service, operatingTwo.ObjectID, "预检目标主体", "party-merge-stale-target")
	sourceParty, _ := service.PartyGet(t.Context(), PartyGetInput{PartyID: source.PartyID}, PartyRelationshipVisibility{OtherUnit: true})
	targetParty, _ := service.PartyGet(t.Context(), PartyGetInput{PartyID: target.PartyID}, PartyRelationshipVisibility{OtherUnit: true})
	preflight, err := service.PartyMergePreflight(t.Context(), PartyMergePreflightInput{
		SourcePartyID: source.PartyID, TargetPartyID: target.PartyID, SourceRevision: sourceParty.Revision, TargetRevision: targetParty.Revision,
	}, partyMergeAllRelationshipsVisible, integrationActorOne, "party-merge-stale-preflight")
	if err != nil || !preflight.CanMerge {
		t.Fatalf("preflight = %#v, err=%v", preflight, err)
	}
	if _, err = service.PartySave(t.Context(), PartySaveInput{PartyID: source.PartyID, Revision: sourceParty.Revision,
		Data: PartySaveData{DisplayName: Optional("预检已过期")}}, integrationActorOne, "party-merge-stale-save"); err != nil {
		t.Fatalf("change source Party after preflight: %v", err)
	}
	if _, err = service.PartyMergeConfirm(t.Context(), PartyMergeConfirmInput{
		PreflightID: preflight.PreflightID, SourcePartyID: source.PartyID, TargetPartyID: target.PartyID,
		SourceRevision: sourceParty.Revision, TargetRevision: targetParty.Revision,
	}, partyMergeAllRelationshipsVisible, integrationActorOne, "party-merge-stale-confirm"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("stale preflight error = %v", err)
	}
}

func TestPartyMergeCanRetainSourceRelationshipDuringConflictIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	_, operating := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{Name: "冲突经营主体"}, "party-merge-conflict-operating")
	source := createApprovedOtherUnitForPartyMerge(t, service, operating.ObjectID, "冲突来源主体", "party-merge-conflict-source")
	target := createApprovedOtherUnitForPartyMerge(t, service, operating.ObjectID, "冲突保留主体", "party-merge-conflict-target")
	sourceParty, _ := service.PartyGet(t.Context(), PartyGetInput{PartyID: source.PartyID}, PartyRelationshipVisibility{OtherUnit: true})
	targetParty, _ := service.PartyGet(t.Context(), PartyGetInput{PartyID: target.PartyID}, PartyRelationshipVisibility{OtherUnit: true})
	preflight, err := service.PartyMergePreflight(t.Context(), PartyMergePreflightInput{
		SourcePartyID: source.PartyID, TargetPartyID: target.PartyID,
		SourceRevision: sourceParty.Revision, TargetRevision: targetParty.Revision,
	}, partyMergeAllRelationshipsVisible, integrationActorOne, "party-merge-conflict-preflight")
	if err != nil || !preflight.CanMerge || len(preflight.RelationshipConflicts) != 1 {
		t.Fatalf("preflight = %#v, err=%v", preflight, err)
	}
	conflict := preflight.RelationshipConflicts[0]
	merged, err := service.PartyMergeConfirm(t.Context(), PartyMergeConfirmInput{
		PreflightID: preflight.PreflightID, SourcePartyID: source.PartyID, TargetPartyID: target.PartyID,
		SourceRevision: sourceParty.Revision, TargetRevision: targetParty.Revision,
		ConflictResolutions: []PartyMergeConflictResolution{{
			RelationshipType: conflict.RelationshipType, OperatingEntityID: conflict.OperatingEntityID,
			RetainObjectID: conflict.SourceObjectID,
		}},
	}, partyMergeAllRelationshipsVisible, integrationActorOne, "party-merge-conflict-confirm")
	if err != nil || merged.MergedRelationships != 1 {
		t.Fatalf("merge = %#v, err=%v", merged, err)
	}
	var retainedPartyID string
	if err = pool.QueryRow(t.Context(), `SELECT party_id FROM bob_service_relationships WHERE object_id=$1`, source.ObjectID).Scan(&retainedPartyID); err != nil || retainedPartyID != target.PartyID {
		t.Fatalf("retained source relationship Party = %q, %v", retainedPartyID, err)
	}
	var mergedInto string
	var enabled bool
	if err = pool.QueryRow(t.Context(), `SELECT relation.merged_into_object_id,object.enabled FROM bob_service_relationships relation JOIN bob_objects object ON object.id=relation.object_id WHERE relation.object_id=$1`, target.ObjectID).Scan(&mergedInto, &enabled); err != nil || mergedInto != source.ObjectID || enabled {
		t.Fatalf("target relationship merge state = %q enabled=%t, %v", mergedInto, enabled, err)
	}
}

func TestPartyMergeTransfersServiceRelationshipWhileMergingSalesRelationshipIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	_, operating := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{Name: "多关系合并经营主体"}, "party-merge-multi-operating")
	sourceService := createApprovedOtherUnitForPartyMerge(t, service, operating.ObjectID, "多关系合并来源", "party-merge-multi-source")
	sourceSales := createApprovedSalesPartnerForPartyMerge(t, service, sourceService.PartyID, operating.ObjectID, "party-merge-multi-source-sales")
	targetSales := createApprovedSalesPartnerForPartyMerge(t, service, "", operating.ObjectID, "party-merge-multi-target-sales")

	sourceParty, _ := service.PartyGet(t.Context(), PartyGetInput{PartyID: sourceService.PartyID}, partyMergeAllRelationshipsVisible)
	targetParty, _ := service.PartyGet(t.Context(), PartyGetInput{PartyID: targetSales.PartyID}, partyMergeAllRelationshipsVisible)
	preflight, err := service.PartyMergePreflight(t.Context(), PartyMergePreflightInput{
		SourcePartyID: sourceParty.PartyID, TargetPartyID: targetParty.PartyID,
		SourceRevision: sourceParty.Revision, TargetRevision: targetParty.Revision,
	}, partyMergeAllRelationshipsVisible, integrationActorOne, "party-merge-multi-preflight")
	if err != nil || !preflight.CanMerge || len(preflight.RelationshipConflicts) != 1 {
		t.Fatalf("preflight = %#v, err=%v", preflight, err)
	}
	conflict := preflight.RelationshipConflicts[0]
	merged, err := service.PartyMergeConfirm(t.Context(), PartyMergeConfirmInput{
		PreflightID: preflight.PreflightID, SourcePartyID: sourceParty.PartyID, TargetPartyID: targetParty.PartyID,
		SourceRevision: sourceParty.Revision, TargetRevision: targetParty.Revision,
		ConflictResolutions: []PartyMergeConflictResolution{{
			RelationshipType: EntitySalesPartner, OperatingEntityID: operating.ObjectID, RetainObjectID: targetSales.ObjectID,
		}},
	}, partyMergeAllRelationshipsVisible, integrationActorOne, "party-merge-multi-confirm")
	if err != nil || merged.TransferredRelationships != 1 || merged.MergedRelationships != 1 {
		t.Fatalf("merge = %#v, err=%v", merged, err)
	}
	if conflict.SourceObjectID != sourceSales.ObjectID || conflict.TargetObjectID != targetSales.ObjectID {
		t.Fatalf("sales conflict = %#v", conflict)
	}
}

func TestPartyMergeCustomerConflictMovesEveryAccountToRetainedRelationshipIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	service.SetAuxiliaryResolver(customerAuxiliaryResolverStub{})
	_, operating := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{Name: "客户合并经营主体"}, "party-merge-customer-operating")
	_, employee := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{Name: "客户合并归属员工"}, "party-merge-customer-employee")
	source := createApprovedCustomerRelationshipForPartyMerge(t, service, operating.ObjectID, employee.ObjectID, "客户合并来源", "party-merge-customer-source")
	target := createApprovedCustomerRelationshipForPartyMerge(t, service, operating.ObjectID, employee.ObjectID, "客户合并目标", "party-merge-customer-target")
	if _, err := service.CustomerAccountAdd(t.Context(), CustomerAccountAddInput{
		CustomerRelationshipID: source.ObjectID,
		Data: CustomerAccountData{Name: "来源第二结算户", CustomerTypeCode: CustomerTypeEndUser,
			OperatingEntityID: operating.ObjectID, PricingPolicy: defaultPricingPolicy(), CreditLimits: []CustomerCreditLimit{},
			PrimarySalesAttribution: CustomerSalesAttributionInput{Type: SalesAttributionInternalEmployee, SubjectObjectID: employee.ObjectID}},
	}, integrationActorOne, "party-merge-customer-account-add"); err != nil {
		t.Fatalf("add source customer account: %v", err)
	}
	sourceParty, _ := service.PartyGet(t.Context(), PartyGetInput{PartyID: source.PartyID}, PartyRelationshipVisibility{Customer: true})
	targetParty, _ := service.PartyGet(t.Context(), PartyGetInput{PartyID: target.PartyID}, PartyRelationshipVisibility{Customer: true})
	preflight, err := service.PartyMergePreflight(t.Context(), PartyMergePreflightInput{
		SourcePartyID: source.PartyID, TargetPartyID: target.PartyID,
		SourceRevision: sourceParty.Revision, TargetRevision: targetParty.Revision,
	}, partyMergeAllRelationshipsVisible, integrationActorOne, "party-merge-customer-preflight")
	if err != nil || !preflight.CanMerge || len(preflight.RelationshipConflicts) != 1 {
		t.Fatalf("preflight = %#v, err=%v", preflight, err)
	}
	conflict := preflight.RelationshipConflicts[0]
	if _, err = service.PartyMergeConfirm(t.Context(), PartyMergeConfirmInput{
		PreflightID: preflight.PreflightID, SourcePartyID: source.PartyID, TargetPartyID: target.PartyID,
		SourceRevision: sourceParty.Revision, TargetRevision: targetParty.Revision,
		ConflictResolutions: []PartyMergeConflictResolution{{RelationshipType: EntityCustomer,
			OperatingEntityID: operating.ObjectID, RetainObjectID: conflict.TargetObjectID}},
	}, partyMergeAllRelationshipsVisible, integrationActorOne, "party-merge-customer-confirm"); err != nil {
		t.Fatalf("merge customer relationship conflict: %v", err)
	}
	var retainedCount, mergedCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM bob_customer_accounts WHERE customer_relationship_id=$1`, target.ObjectID).Scan(&retainedCount); err != nil {
		t.Fatalf("count retained accounts: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM bob_customer_accounts WHERE customer_relationship_id=$1`, source.ObjectID).Scan(&mergedCount); err != nil {
		t.Fatalf("count merged accounts: %v", err)
	}
	if retainedCount != 3 || mergedCount != 0 {
		t.Fatalf("retained accounts=%d merged accounts=%d, want 3/0", retainedCount, mergedCount)
	}
}

func createApprovedCustomerRelationshipForPartyMerge(t *testing.T, service *Service, operatingEntityID, employeeID, partyName, requestPrefix string) CustomerCreateResult {
	t.Helper()
	created, err := service.CustomerCreate(t.Context(), CustomerCreateInput{
		NewParty: &PartyCreateData{Kind: PartyKindOrganization, LegalName: partyName, StrongIdentifiers: []PartyIdentifierInput{}},
		Data: CustomerAccountData{Name: partyName + "结算户", CustomerTypeCode: CustomerTypeEndUser,
			OperatingEntityID: operatingEntityID, PricingPolicy: defaultPricingPolicy(), CreditLimits: []CustomerCreditLimit{},
			PrimarySalesAttribution: CustomerSalesAttributionInput{Type: SalesAttributionInternalEmployee, SubjectObjectID: employeeID}},
	}, integrationActorOne, requestPrefix+"-create", true)
	if err != nil {
		t.Fatalf("create customer relationship: %v", err)
	}
	submitted, err := service.Submit(t.Context(), EntityCustomer, VersionRevisionInput{ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision}, integrationActorOne, requestPrefix+"-submit")
	if err != nil {
		t.Fatalf("submit customer relationship: %v", err)
	}
	if _, err = service.Approve(t.Context(), EntityCustomer, ReviewInput{ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision}, integrationActorTwo, requestPrefix+"-approve"); err != nil {
		t.Fatalf("approve customer relationship: %v", err)
	}
	return created
}

func createApprovedOtherUnitForPartyMerge(t *testing.T, service *Service, operatingEntityID, partyName, requestPrefix string) OtherUnitCreateResult {
	t.Helper()
	created, err := service.OtherUnitCreate(t.Context(), OtherUnitCreateInput{
		NewParty: &PartyCreateData{Kind: PartyKindOrganization, LegalName: partyName},
		Data:     OtherUnitData{OperatingEntityID: operatingEntityID},
	}, integrationActorOne, requestPrefix+"-create", true)
	if err != nil {
		t.Fatalf("create other-unit: %v", err)
	}
	submitted, err := service.Submit(t.Context(), EntityOtherUnit, VersionRevisionInput{ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision}, integrationActorOne, requestPrefix+"-submit")
	if err != nil {
		t.Fatalf("submit other-unit: %v", err)
	}
	if _, err = service.Approve(t.Context(), EntityOtherUnit, ReviewInput{ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision}, integrationActorTwo, requestPrefix+"-approve"); err != nil {
		t.Fatalf("approve other-unit: %v", err)
	}
	return created
}

func createApprovedSalesPartnerForPartyMerge(t *testing.T, service *Service, partyID, operatingEntityID, requestPrefix string) SalesPartnerCreateResult {
	t.Helper()
	input := SalesPartnerCreateInput{PartyID: partyID, Data: SalesPartnerData{
		OperatingEntityID: operatingEntityID, Capabilities: []string{SalesCapabilityChannelPartner},
	}}
	if partyID == "" {
		input.NewParty = &PartyCreateData{Kind: PartyKindOrganization, LegalName: requestPrefix, StrongIdentifiers: []PartyIdentifierInput{}}
	}
	created, err := service.SalesPartnerCreate(t.Context(), input, integrationActorOne, requestPrefix+"-create", true)
	if err != nil {
		t.Fatalf("create sales partner: %v", err)
	}
	submitted, err := service.Submit(t.Context(), EntitySalesPartner, VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, integrationActorOne, requestPrefix+"-submit")
	if err != nil {
		t.Fatalf("submit sales partner: %v", err)
	}
	if _, err = service.Approve(t.Context(), EntitySalesPartner, ReviewInput{
		ObjectID: submitted.ObjectID, VersionID: submitted.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, requestPrefix+"-approve"); err != nil {
		t.Fatalf("approve sales partner: %v", err)
	}
	return created
}
