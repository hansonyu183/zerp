package auxapproval

import "github.com/hansonyu183/zerp/backend/internal/platform/approval"

// Payload is the immutable AUX identity carried by Approval events. AUX has no
// lifecycle subscribers in PR3, so subscribers need no copy of the flexible
// entity payload.
type Payload struct {
	ObjectID string
	Entity   string
	Code     string
}

func Topic(entity string) approval.Topic[Payload] {
	return approval.MustTopic[Payload]("aux." + entity + ".approval")
}
