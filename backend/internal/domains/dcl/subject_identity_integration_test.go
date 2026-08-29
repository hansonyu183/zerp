//go:build integration

package dcl

import (
	"errors"
	"testing"

	"github.com/oklog/ulid/v2"
)

func TestCoreSubjectCodeCapacityExhaustionIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)

	tests := []struct {
		entity string
		prefix string
	}{
		{entity: EntityOperatingEntity, prefix: "OPE"},
		{entity: EntityWarehouse, prefix: "WHS"},
		{entity: EntityVehicle, prefix: "VEH"},
		{entity: EntityFundAccount, prefix: "FAC"},
		{entity: EntityProduct, prefix: "PRD"},
	}
	for _, test := range tests {
		t.Run(test.entity, func(t *testing.T) {
			tx, err := pool.Begin(t.Context())
			if err != nil {
				t.Fatalf("begin transaction: %v", err)
			}
			defer tx.Rollback(t.Context())

			if _, err = tx.Exec(t.Context(), `
				INSERT INTO object_number_counters(domain,entity,last_value)
				VALUES('dcl',$1,9999)
			`, test.entity); err != nil {
				t.Fatalf("seed exhausted counter: %v", err)
			}

			_, err = reserveSubject(t.Context(), tx, test.entity, test.prefix, ulid.Make().String())
			var domainErr *DomainError
			if !errors.As(err, &domainErr) {
				t.Fatalf("reserve subject error = %v, want DomainError", err)
			}
			if domainErr.Kind != ErrorConflict || domainErr.ErrorKey != "dcl_subject_code_capacity_exhausted" {
				t.Fatalf("reserve subject error = %#v, want stable capacity conflict", domainErr)
			}
		})
	}
}
