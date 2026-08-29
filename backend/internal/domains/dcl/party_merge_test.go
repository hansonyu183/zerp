package dcl

import (
	"testing"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

func TestPartyMergeAssessmentFindsTypedOperatingEntityConflict(t *testing.T) {
	source := dbsqlc.LockPartyMergePartyRow{ID: newID(), Kind: bobdomain.PartyKindOrganization, Revision: 2}
	target := dbsqlc.LockPartyMergePartyRow{ID: newID(), Kind: bobdomain.PartyKindOrganization, Revision: 4}
	sourceRelationships := []partyMergeRelationship{{
		relationshipType: EntitySupplier, objectID: newID(), operatingEntityID: newID(), objectRevision: 1,
		enabled: true, latestApprovedID: "v1", visibleStatus: string(approval.StatusApproved), visibleRevision: 1,
	}}
	targetRelationships := []partyMergeRelationship{{
		relationshipType: EntitySupplier, objectID: newID(), operatingEntityID: sourceRelationships[0].operatingEntityID, objectRevision: 1,
		enabled: true, latestApprovedID: "v2", visibleStatus: string(approval.StatusApproved), visibleRevision: 1,
	}}
	assessment, _, _ := partyMergeAssessmentWithRelationships(source, target, sourceRelationships, targetRelationships)
	if len(assessment.BlockReasons) != 0 {
		t.Fatalf("unexpected blocks: %#v", assessment.BlockReasons)
	}
	if len(assessment.RelationshipConflicts) != 1 {
		t.Fatalf("conflicts = %#v", assessment.RelationshipConflicts)
	}
	conflict := assessment.RelationshipConflicts[0]
	if conflict.SourceObjectID != sourceRelationships[0].objectID || conflict.TargetObjectID != targetRelationships[0].objectID {
		t.Fatalf("wrong conflict: %#v", conflict)
	}
}

func TestPartyMergeAssessmentBlocksCandidateOrMergedParty(t *testing.T) {
	mergedInto := newID()
	source := dbsqlc.LockPartyMergePartyRow{ID: newID(), Kind: bobdomain.PartyKindPerson, Revision: 1, MergedIntoPartyID: &mergedInto}
	target := dbsqlc.LockPartyMergePartyRow{ID: newID(), Kind: bobdomain.PartyKindPerson, Revision: 1}
	relationships := []partyMergeRelationship{{
		relationshipType: EntityEmployee, objectID: newID(), operatingEntityID: newID(), objectRevision: 1,
		enabled: true, openApprovalEntryID: "candidate", latestApprovedID: "effective", visibleStatus: string(approval.StatusDraft), visibleRevision: 1,
	}}
	assessment, _, _ := partyMergeAssessmentWithRelationships(source, target, relationships, nil)
	if len(assessment.BlockReasons) < 2 {
		t.Fatalf("blocks = %#v, want merged Party and candidate blocks", assessment.BlockReasons)
	}
}

func TestPartyMergeAssessmentReturnsStructuredBlockForOpenPartyCandidate(t *testing.T) {
	source := dbsqlc.LockPartyMergePartyRow{ID: newID(), Kind: bobdomain.PartyKindPerson, Revision: 1, HasOpenCandidate: true}
	target := dbsqlc.LockPartyMergePartyRow{ID: newID(), Kind: bobdomain.PartyKindPerson, Revision: 1}

	assessment, _, _ := partyMergeAssessmentWithRelationships(source, target, nil, nil)

	if len(assessment.BlockReasons) != 1 || assessment.BlockReasons[0] != "存在主体候选版本，不能合并" {
		t.Fatalf("blocks = %#v", assessment.BlockReasons)
	}
}

func TestPartyMergeResolutionAcceptsEitherRelationshipInConflict(t *testing.T) {
	conflict := bobdomain.PartyMergeRelationshipConflict{
		RelationshipType: EntityOtherUnit, OperatingEntityID: newID(), SourceObjectID: newID(), TargetObjectID: newID(),
	}
	resolved, err := validatePartyMergeResolutions([]bobdomain.PartyMergeRelationshipConflict{conflict}, []bobdomain.PartyMergeConflictResolution{{
		RelationshipType: conflict.RelationshipType, OperatingEntityID: conflict.OperatingEntityID, RetainObjectID: conflict.TargetObjectID,
	}})
	if err != nil || resolved[partyMergeConflictKey(conflict)] != conflict.TargetObjectID {
		t.Fatalf("valid resolution = %#v, %v", resolved, err)
	}
	resolved, err = validatePartyMergeResolutions([]bobdomain.PartyMergeRelationshipConflict{conflict}, []bobdomain.PartyMergeConflictResolution{{
		RelationshipType: conflict.RelationshipType, OperatingEntityID: conflict.OperatingEntityID, RetainObjectID: conflict.SourceObjectID,
	}})
	if err != nil || resolved[partyMergeConflictKey(conflict)] != conflict.SourceObjectID {
		t.Fatalf("valid source resolution = %#v, %v", resolved, err)
	}
	if _, err = validatePartyMergeResolutions([]bobdomain.PartyMergeRelationshipConflict{conflict}, []bobdomain.PartyMergeConflictResolution{{
		RelationshipType: conflict.RelationshipType, OperatingEntityID: conflict.OperatingEntityID, RetainObjectID: newID(),
	}}); err == nil {
		t.Fatal("unrelated retain object accepted")
	}
}

func TestPartyMergeFingerprintChangesWithRelationshipState(t *testing.T) {
	source := dbsqlc.LockPartyMergePartyRow{ID: newID(), Kind: bobdomain.PartyKindOrganization, Revision: 1}
	target := dbsqlc.LockPartyMergePartyRow{ID: newID(), Kind: bobdomain.PartyKindOrganization, Revision: 1}
	relationships := []partyMergeRelationship{{
		relationshipType: EntitySupplier, objectID: newID(), operatingEntityID: newID(), objectRevision: 1,
		enabled: true, openApprovalEntryID: "effective", latestApprovedID: "effective", visibleStatus: string(approval.StatusApproved), visibleRevision: 1,
	}}
	before := partyMergeFingerprint(source, target, relationships, nil)
	relationships[0].visibleRevision++
	after := partyMergeFingerprint(source, target, relationships, nil)
	if before == after {
		t.Fatal("relationship state change did not invalidate fingerprint")
	}
}

func TestPartyMergeRedactsRelationshipConflictsWithoutGetPermission(t *testing.T) {
	result := bobdomain.PartyMergePreflightResult{RelationshipConflicts: []bobdomain.PartyMergeRelationshipConflict{
		{RelationshipType: EntitySupplier, SourceObjectID: newID(), TargetObjectID: newID()},
		{RelationshipType: EntitySalesPartner, SourceObjectID: newID(), TargetObjectID: newID()},
	}}

	redactHiddenPartyMergeConflicts(&result, bobdomain.PartyRelationshipVisibility{Supplier: true})

	if len(result.RelationshipConflicts) != 1 || result.RelationshipConflicts[0].RelationshipType != EntitySupplier {
		t.Fatalf("visible conflicts = %#v", result.RelationshipConflicts)
	}
	if len(result.BlockReasons) != 1 || result.BlockReasons[0] != "存在无权处理的关系冲突，请联系有权人员" {
		t.Fatalf("block reasons = %#v", result.BlockReasons)
	}
}
