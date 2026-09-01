package bob

import (
	"encoding/json"
	"time"
)

// BusinessIdentifier and BusinessArchiveSnapshot are BOB-local wire values.
// They deliberately mirror the DCL contract without importing DCL and creating
// a domain cycle.
type BusinessIdentifier struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

type BusinessArchiveSnapshot struct {
	SourceObjectID  string `json:"sourceObjectId"`
	ApprovalEntryID string `json:"approvalEntryId"`
	Code            string `json:"code"`
	Name            string `json:"name"`
}

type typedCurrentView struct {
	ObjectID              string    `json:"objectId"`
	Code                  string    `json:"code"`
	SourceApprovalEntryID string    `json:"sourceApprovalEntryId"`
	SourceVersionNo       int32     `json:"sourceVersionNo"`
	Data                  any       `json:"data"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type typedIdentityData struct {
	Kind              string               `json:"kind"`
	LegalName         string               `json:"legalName"`
	DisplayName       string               `json:"displayName,omitempty"`
	TaxNumber         string               `json:"taxNumber,omitempty"`
	StrongIdentifiers []BusinessIdentifier `json:"strongIdentifiers"`
	Enabled           bool                 `json:"enabled"`
}

type employeeCurrentData struct {
	typedIdentityData
	CurrentOperatingEntityID string                  `json:"currentOperatingEntityId"`
	CurrentOperatingEntity   BusinessArchiveSnapshot `json:"currentOperatingEntity"`
	EmployeeCategoryID       string                  `json:"employeeCategoryId,omitempty"`
	EmployeeCategoryCode     string                  `json:"employeeCategoryCode,omitempty"`
	EmployeeCategoryName     string                  `json:"employeeCategoryName,omitempty"`
	DepartmentID             string                  `json:"departmentId,omitempty"`
	DepartmentCode           string                  `json:"departmentCode,omitempty"`
	DepartmentName           string                  `json:"departmentName,omitempty"`
	PositionID               string                  `json:"positionId,omitempty"`
	PositionCode             string                  `json:"positionCode,omitempty"`
	PositionName             string                  `json:"positionName,omitempty"`
	Phone                    string                  `json:"phone,omitempty"`
	Email                    string                  `json:"email,omitempty"`
	HireDate                 string                  `json:"hireDate,omitempty"`
	Remark                   string                  `json:"remark,omitempty"`
}

type supplierCurrentData struct {
	typedIdentityData
	OperatingEntityIDs         []string                    `json:"operatingEntityIds"`
	DefaultOperatingEntityID   string                      `json:"defaultOperatingEntityId"`
	OperatingEntities          []BusinessArchiveSnapshot   `json:"operatingEntities"`
	ShortName                  string                      `json:"shortName,omitempty"`
	ContactName                string                      `json:"contactName,omitempty"`
	ContactPhone               string                      `json:"contactPhone,omitempty"`
	Email                      string                      `json:"email,omitempty"`
	Address                    string                      `json:"address,omitempty"`
	Remark                     string                      `json:"remark,omitempty"`
	SettlementMethodID         string                      `json:"settlementMethodId,omitempty"`
	DefaultPurchaserEmployeeID string                      `json:"defaultPurchaserEmployeeId,omitempty"`
	SettlementMethod           *SupplierSettlementSnapshot `json:"settlementMethod"`
	DefaultPurchaser           *SupplierPurchaserSnapshot  `json:"defaultPurchaser"`
}

type otherUnitCurrentData struct {
	typedIdentityData
	OperatingEntityIDs       []string                  `json:"operatingEntityIds"`
	DefaultOperatingEntityID string                    `json:"defaultOperatingEntityId"`
	OperatingEntities        []BusinessArchiveSnapshot `json:"operatingEntities"`
	ContactName              string                    `json:"contactName,omitempty"`
	ContactPhone             string                    `json:"contactPhone,omitempty"`
	Email                    string                    `json:"email,omitempty"`
	Address                  string                    `json:"address,omitempty"`
	SettlementMethodID       string                    `json:"settlementMethodId,omitempty"`
	Remark                   string                    `json:"remark,omitempty"`
	SettlementMethodCode     string                    `json:"settlementMethodCode,omitempty"`
	SettlementMethodName     string                    `json:"settlementMethodName,omitempty"`
	SettlementTermCode       string                    `json:"settlementTermCode,omitempty"`
	SettlementRuleType       string                    `json:"settlementRuleType,omitempty"`
	SettlementMonthOffset    int32                     `json:"settlementMonthOffset,omitempty"`
	SettlementDayOfMonth     int32                     `json:"settlementDayOfMonth,omitempty"`
	SettlementDayOffset      int32                     `json:"settlementDayOffset,omitempty"`
}

type salesPartnerCurrentData struct {
	typedIdentityData
	OperatingEntityIDs       []string                  `json:"operatingEntityIds"`
	DefaultOperatingEntityID string                    `json:"defaultOperatingEntityId"`
	OperatingEntities        []BusinessArchiveSnapshot `json:"operatingEntities"`
	Capabilities             []string                  `json:"capabilities,omitempty"`
	ContactName              string                    `json:"contactName,omitempty"`
	ContactPhone             string                    `json:"contactPhone,omitempty"`
	Email                    string                    `json:"email,omitempty"`
	Address                  string                    `json:"address,omitempty"`
	Remark                   string                    `json:"remark,omitempty"`
}

func nonNilIdentifiers(values []BusinessIdentifier) []BusinessIdentifier {
	if values == nil {
		return []BusinessIdentifier{}
	}
	return values
}

func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func nonNilSnapshots(values []BusinessArchiveSnapshot) []BusinessArchiveSnapshot {
	if values == nil {
		return []BusinessArchiveSnapshot{}
	}
	return values
}

func typedIdentity(data DetailView, enabled bool) typedIdentityData {
	return typedIdentityData{Kind: data.Kind, LegalName: data.LegalName, DisplayName: data.DisplayName, TaxNumber: data.TaxNumber, StrongIdentifiers: nonNilIdentifiers(data.StrongIdentifiers), Enabled: enabled}
}

func typedCurrentData(entity string, data DetailView, enabled bool) any {
	identity := typedIdentity(data, enabled)
	switch entity {
	case EntityEmployee:
		return employeeCurrentData{typedIdentityData: identity, CurrentOperatingEntityID: data.CurrentOperatingEntityID, CurrentOperatingEntity: data.CurrentOperatingEntity, EmployeeCategoryID: data.CategoryID, EmployeeCategoryCode: data.CategoryCode, EmployeeCategoryName: data.CategoryName, DepartmentID: data.DepartmentID, DepartmentCode: data.DepartmentCode, DepartmentName: data.DepartmentName, PositionID: data.PositionID, PositionCode: data.PositionCode, PositionName: data.PositionName, Phone: data.Phone, Email: data.Email, HireDate: data.HireDate, Remark: data.Remark}
	case EntitySupplier:
		return supplierCurrentData{typedIdentityData: identity, OperatingEntityIDs: nonNilStrings(data.OperatingEntityIDs), DefaultOperatingEntityID: data.DefaultOperatingEntityID, OperatingEntities: nonNilSnapshots(data.OperatingEntities), ShortName: data.ShortName, ContactName: data.ContactName, ContactPhone: data.ContactPhone, Email: data.Email, Address: data.Address, Remark: data.Remark, SettlementMethodID: data.SettlementMethodID, DefaultPurchaserEmployeeID: data.DefaultPurchaserEmployeeID, SettlementMethod: data.SettlementMethod, DefaultPurchaser: data.DefaultPurchaser}
	case EntityOtherUnit:
		day := int32(0)
		if data.DayOfMonth != nil {
			day = *data.DayOfMonth
		}
		return otherUnitCurrentData{typedIdentityData: identity, OperatingEntityIDs: nonNilStrings(data.OperatingEntityIDs), DefaultOperatingEntityID: data.DefaultOperatingEntityID, OperatingEntities: nonNilSnapshots(data.OperatingEntities), ContactName: data.ContactName, ContactPhone: data.ContactPhone, Email: data.Email, Address: data.Address, SettlementMethodID: data.SettlementMethodID, Remark: data.Remark, SettlementMethodCode: data.SettlementMethodCode, SettlementMethodName: data.SettlementMethodName, SettlementTermCode: data.TermCode, SettlementRuleType: data.RuleType, SettlementMonthOffset: data.MonthOffset, SettlementDayOfMonth: day, SettlementDayOffset: data.DayOffset}
	case EntitySalesPartner:
		return salesPartnerCurrentData{typedIdentityData: identity, OperatingEntityIDs: nonNilStrings(data.OperatingEntityIDs), DefaultOperatingEntityID: data.DefaultOperatingEntityID, OperatingEntities: nonNilSnapshots(data.OperatingEntities), Capabilities: data.SalesCapabilities, ContactName: data.ContactName, ContactPhone: data.ContactPhone, Email: data.Email, Address: data.Address, Remark: data.Remark}
	default:
		return data
	}
}

func isTypedBusinessArchive(entity string) bool {
	return entity == EntityEmployee || entity == EntitySupplier || entity == EntityOtherUnit || entity == EntitySalesPartner
}

func (view ObjectView) MarshalJSON() ([]byte, error) {
	if !isTypedBusinessArchive(view.Entity) {
		type alias ObjectView
		return json.Marshal(alias(view))
	}
	return json.Marshal(typedCurrentView{ObjectID: view.ObjectID, Code: view.Code, SourceApprovalEntryID: view.SourceApprovalEntryID, SourceVersionNo: view.SourceVersionNo, Data: typedCurrentData(view.Entity, view.Data, view.Enabled), UpdatedAt: view.UpdatedAt})
}

type employeeListItem struct {
	ObjectID               string                  `json:"objectId"`
	Code                   string                  `json:"code"`
	LegalName              string                  `json:"legalName"`
	DisplayName            string                  `json:"displayName,omitempty"`
	CurrentOperatingEntity BusinessArchiveSnapshot `json:"currentOperatingEntity"`
	Enabled                bool                    `json:"enabled"`
	SourceApprovalEntryID  string                  `json:"sourceApprovalEntryId"`
	SourceVersionNo        int32                   `json:"sourceVersionNo"`
	UpdatedAt              time.Time               `json:"updatedAt"`
}

type businessArchiveListItem struct {
	ObjectID               string                  `json:"objectId"`
	Code                   string                  `json:"code"`
	LegalName              string                  `json:"legalName"`
	DisplayName            string                  `json:"displayName,omitempty"`
	DefaultOperatingEntity BusinessArchiveSnapshot `json:"defaultOperatingEntity"`
	Enabled                bool                    `json:"enabled"`
	SourceApprovalEntryID  string                  `json:"sourceApprovalEntryId"`
	SourceVersionNo        int32                   `json:"sourceVersionNo"`
	UpdatedAt              time.Time               `json:"updatedAt"`
}

func (item QueryItem) MarshalJSON() ([]byte, error) {
	if !isTypedBusinessArchive(item.Entity) {
		type alias QueryItem
		return json.Marshal(alias(item))
	}
	if item.Entity == EntityEmployee {
		return json.Marshal(employeeListItem{ObjectID: item.ObjectID, Code: item.Code, LegalName: item.Data.LegalName, DisplayName: item.Data.DisplayName, CurrentOperatingEntity: item.Data.CurrentOperatingEntity, Enabled: item.Enabled, SourceApprovalEntryID: item.SourceApprovalEntryID, SourceVersionNo: item.SourceVersionNo, UpdatedAt: item.UpdatedAt})
	}
	defaultOperatingEntity := BusinessArchiveSnapshot{}
	for _, operating := range item.Data.OperatingEntities {
		if operating.SourceObjectID == item.Data.DefaultOperatingEntityID {
			defaultOperatingEntity = operating
			break
		}
	}
	return json.Marshal(businessArchiveListItem{ObjectID: item.ObjectID, Code: item.Code, LegalName: item.Data.LegalName, DisplayName: item.Data.DisplayName, DefaultOperatingEntity: defaultOperatingEntity, Enabled: item.Enabled, SourceApprovalEntryID: item.SourceApprovalEntryID, SourceVersionNo: item.SourceVersionNo, UpdatedAt: item.UpdatedAt})
}
