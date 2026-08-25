package bobapproval

import "testing"

func TestTopicAcceptsExactlyPublicBobEntities(t *testing.T) {
	t.Parallel()
	for _, entity := range []string{
		"customer", "customer-account", "supplier", "other-unit", "employee", "sales-partner",
		"product", "warehouse", "vehicle", "fund-account", "operating-entity",
	} {
		if Topic(entity).Name() != "bob."+entity+".approval" {
			t.Fatalf("topic for %q is not stable", entity)
		}
	}
}

func TestTopicRejectsFormerInternalEntities(t *testing.T) {
	t.Parallel()
	defer func() {
		if recover() == nil {
			t.Fatal("expected unsupported BOB entity to panic")
		}
	}()
	Topic("category")
}
