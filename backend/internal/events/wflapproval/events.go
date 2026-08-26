package wflapproval

import "github.com/hansonyu183/zerp/backend/internal/platform/approval"

// Payload is the immutable workflow-definition snapshot published with a
// central Approval transition. Consumers never query WFL to rebuild it.
type Payload struct {
	DefinitionID          string
	Code                  string
	Name                  string
	Enabled               bool
	Script                string
	Diagnostic            *string
	Compiled              []byte
	TrialApprovalRevision *int64
}

func Topic() approval.Topic[Payload] {
	return approval.MustTopic[Payload]("wfl.process-definition.approval")
}
