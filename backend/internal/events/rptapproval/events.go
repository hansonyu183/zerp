package rptapproval

import "github.com/hansonyu183/zerp/backend/internal/platform/approval"

// Payload identifies the immutable report-definition version affected by an
// Approval transition without requiring consumers to depend on the RPT domain.
type Payload struct {
	DefinitionID string
	Code         string
	Name         string
	Description  string
	Enabled      bool
	Validity     string
	SQLText      string
	Parameters   []byte
	Columns      []byte
}

func Topic() approval.Topic[Payload] {
	return approval.MustTopic[Payload]("rpt.definition.approval")
}
