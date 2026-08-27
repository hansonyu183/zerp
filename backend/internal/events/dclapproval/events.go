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

var OperatingEntityTopic = approval.MustTopic[OperatingEntityPayload]("dcl.operating-entity.approval")
