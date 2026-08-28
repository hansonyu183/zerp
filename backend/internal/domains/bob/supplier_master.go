package bob

// SupplierSettlementSnapshot is immutable business context copied into a DCL
// Supplier version. AUX objects have stable identity and no approval entry.
type SupplierSettlementSnapshot struct {
	SourceObjectID string `json:"sourceObjectId"`
	Code           string `json:"code"`
	Name           string `json:"name"`
	TermCode       string `json:"termCode"`
	RuleType       string `json:"ruleType"`
	MonthOffset    int32  `json:"monthOffset"`
	DayOfMonth     int32  `json:"dayOfMonth"`
	DayOffset      int32  `json:"dayOffset"`
}

// SupplierPurchaserSnapshot points at an exact DCL Employee version because
// Employee remains an approval-owned declaration.
type SupplierPurchaserSnapshot struct {
	SourceObjectID  string `json:"sourceObjectId"`
	ApprovalEntryID string `json:"approvalEntryId"`
	Code            string `json:"code"`
	Name            string `json:"name"`
}
