// Package bobapproval contains the cross-domain contract for BOB approval
// events. It intentionally contains no BOB service or database dependency.
package bobapproval

import "github.com/hansonyu183/zerp/backend/internal/platform/approval"

// Payload is the immutable BOB subject snapshot published with every central
// Approval transition. A consumer never has to read a BOB candidate after a
// transition to know which stable business subject was affected.
//
// Entity-specific detail is deliberately not a map or JSON blob: BOB has no
// lifecycle subscriber in this cutover and consumers must resolve a business
// reference before persisting their own snapshot. Adding a subscriber requires
// extending this typed contract with precisely the fields it consumes.
type Payload struct {
	ObjectID string
	Entity   string
	Code     string
	Enabled  bool
}

var entities = map[string]struct{}{
	"customer": {}, "customer-account": {}, "supplier": {}, "other-unit": {},
	"employee": {}, "sales-partner": {}, "product": {}, "warehouse": {},
	"vehicle": {}, "fund-account": {}, "operating-entity": {},
}

// Topic returns one closed, typed approval topic per public BOB entity.
func Topic(entity string) approval.Topic[Payload] {
	if _, ok := entities[entity]; !ok {
		panic("bobapproval: unsupported entity")
	}
	return approval.MustTopic[Payload]("bob." + entity + ".approval")
}
