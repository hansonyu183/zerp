// Package dclapproval contains the typed central Approval event contract for
// DCL declarations. Each entity has a compile-time payload and topic.
package dclapproval

import "github.com/hansonyu183/zerp/backend/internal/platform/approval"

type OperatingEntityPayload struct {
	SubjectID string
	Code      string
	Enabled   bool
	Name      string
}

type WarehousePayload struct {
	SubjectID string
	Code      string
	Enabled   bool
	Name      string
}

var OperatingEntityTopic = approval.MustTopic[OperatingEntityPayload]("dcl.operating-entity.approval")
var WarehouseTopic = approval.MustTopic[WarehousePayload]("dcl.warehouse.approval")

type VehiclePayload struct {
	SubjectID, Code, Name string
	Enabled               bool
}

var VehicleTopic = approval.MustTopic[VehiclePayload]("dcl.vehicle.approval")

type FundAccountPayload struct {
	SubjectID, Code, Name string
	Enabled               bool
}

var FundAccountTopic = approval.MustTopic[FundAccountPayload]("dcl.fund-account.approval")

type ProductPayload struct {
	SubjectID, Code, Name string
	Enabled               bool
}

var ProductTopic = approval.MustTopic[ProductPayload]("dcl.product.approval")

type PartyPayload struct{ SubjectID, Name string }

var PartyTopic = approval.MustTopic[PartyPayload]("dcl.party.approval")

type EmployeePayload struct {
	SubjectID, Code, PartyID string
	Enabled                  bool
}

var EmployeeTopic = approval.MustTopic[EmployeePayload]("dcl.employee.approval")

type OtherUnitPayload struct {
	SubjectID, Code, PartyID string
	Enabled                  bool
}

var OtherUnitTopic = approval.MustTopic[OtherUnitPayload]("dcl.other-unit.approval")

type SalesPartnerPayload struct {
	SubjectID, Code, PartyID string
	Enabled                  bool
}

type SupplierPayload struct {
	SubjectID string `json:"subjectId"`
	Code      string `json:"code"`
	PartyID   string `json:"partyId"`
	Enabled   bool   `json:"enabled"`
}

var SupplierTopic = approval.MustTopic[SupplierPayload]("dcl.supplier.approval")

// Customer and Customer Account are separate DCL approval subjects.  Their
// shared Party-to-operating-entity and account-to-customer bindings remain
// stable BOB identities.
type CustomerPayload struct {
	SubjectID, Code, PartyID string
	Enabled                  bool
}

type CustomerAccountPayload struct {
	SubjectID, Code, CustomerRelationshipID, Name string
	Enabled                                       bool
}

var CustomerTopic = approval.MustTopic[CustomerPayload]("dcl.customer.approval")
var CustomerAccountTopic = approval.MustTopic[CustomerAccountPayload]("dcl.customer-account.approval")

var SalesPartnerTopic = approval.MustTopic[SalesPartnerPayload]("dcl.sales-partner.approval")

type AccMappingPayload struct {
	SubjectID string `json:"subjectId"`
	BookID    string `json:"bookId"`
	VouEntity string `json:"vouEntity"`
}

var AccMappingTopic = approval.MustTopic[AccMappingPayload]("dcl.acc-mapping.approval")

type RptDefinitionPayload struct {
	DefinitionID string `json:"definitionId"`
	Code         string `json:"code"`
}

var RptDefinitionTopic = approval.MustTopic[RptDefinitionPayload]("dcl.rpt-definition.approval")

type WflProcessDefinitionPayload struct {
	DefinitionID string `json:"definitionId"`
	Code         string `json:"code"`
}

var WflProcessDefinitionTopic = approval.MustTopic[WflProcessDefinitionPayload]("dcl.wfl-process-definition.approval")
