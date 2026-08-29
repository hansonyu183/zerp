package bob

type PartyMergePreflightInput struct {
	SourcePartyID          string `json:"sourcePartyId"`
	TargetPartyID          string `json:"targetPartyId"`
	SourceApprovalEntryID  string `json:"sourceApprovalEntryId"`
	TargetApprovalEntryID  string `json:"targetApprovalEntryId"`
	SourceApprovalRevision int64  `json:"sourceApprovalRevision"`
	TargetApprovalRevision int64  `json:"targetApprovalRevision"`
}

type PartyMergeRelationshipConflict struct {
	RelationshipType    string `json:"relationshipType"`
	OperatingEntityID   string `json:"operatingEntityId"`
	OperatingEntityName string `json:"operatingEntityName"`
	SourceObjectID      string `json:"sourceObjectId"`
	SourceObjectCode    string `json:"sourceObjectCode"`
	TargetObjectID      string `json:"targetObjectId"`
	TargetObjectCode    string `json:"targetObjectCode"`
}

type PartyMergePreflightResult struct {
	PreflightID            string                           `json:"preflightId,omitempty"`
	CanMerge               bool                             `json:"canMerge"`
	SourcePartyID          string                           `json:"sourcePartyId"`
	TargetPartyID          string                           `json:"targetPartyId"`
	SourceApprovalEntryID  string                           `json:"sourceApprovalEntryId"`
	TargetApprovalEntryID  string                           `json:"targetApprovalEntryId"`
	SourceApprovalRevision int64                            `json:"sourceApprovalRevision"`
	TargetApprovalRevision int64                            `json:"targetApprovalRevision"`
	BlockReasons           []string                         `json:"blockReasons"`
	RelationshipConflicts  []PartyMergeRelationshipConflict `json:"relationshipConflicts"`
}

type PartyMergeConflictResolution struct {
	RelationshipType  string `json:"relationshipType"`
	OperatingEntityID string `json:"operatingEntityId"`
	RetainObjectID    string `json:"retainObjectId"`
}

type PartyMergeConfirmInput struct {
	PreflightID         string                         `json:"preflightId"`
	ConflictResolutions []PartyMergeConflictResolution `json:"conflictResolutions"`
}

type PartyMergeResult struct {
	MergeEventID             string `json:"mergeEventId"`
	SourcePartyID            string `json:"sourcePartyId"`
	TargetPartyID            string `json:"targetPartyId"`
	TransferredRelationships int    `json:"transferredRelationships"`
	MergedRelationships      int    `json:"mergedRelationships"`
}

func (visibility PartyRelationshipVisibility) Allows(entity string) bool {
	return visibility.allows(entity)
}
