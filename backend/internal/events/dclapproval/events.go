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
