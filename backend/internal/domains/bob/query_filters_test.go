package bob

import (
	"encoding/json"
	"errors"
	"testing"
)

const testOperatingEntityID = "01J00000000000000000000010"

func TestOperatingEntityQueryFilterIsLimitedToMultiEntityArchives(t *testing.T) {
	for _, entity := range []string{EntitySupplier, EntityOtherUnit, EntitySalesPartner} {
		t.Run(entity, func(t *testing.T) {
			var input QueryInput
			if err := json.Unmarshal([]byte(`{"page":1,"pageSize":20,"filters":{"operatingEntityId":"`+testOperatingEntityID+`"}}`), &input); err != nil {
				t.Fatalf("decode query: %v", err)
			}
			filters, err := validateQueryFilters(entity, input.Filters)
			if err != nil {
				t.Fatalf("validate query filter: %v", err)
			}
			if filters.OperatingEntityID != testOperatingEntityID {
				t.Fatalf("operating entity filter = %q", filters.OperatingEntityID)
			}
		})
	}
}

func TestEmployeeRejectsMultiEntityOperatingEntityQueryFilter(t *testing.T) {
	filters := QueryFilters{OperatingEntityID: testOperatingEntityID}
	_, err := validateQueryFilters(EntityEmployee, filters)
	if err == nil {
		t.Fatal("Employee accepted a multi-entity operating entity filter")
	}
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorValidation {
		t.Fatalf("error = %v, want validation_failed", err)
	}
}
