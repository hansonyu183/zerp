//go:build integration

package dcl

import (
	"errors"
	"strings"
	"testing"

	"github.com/oklog/ulid/v2"
)

func TestDclSubjectCodeInvariantsIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)

	tests := []struct {
		entity      string
		validCode   string
		invalidCode string
	}{
		{entity: EntityOperatingEntity, validCode: "OPE-0001", invalidCode: "WHS-0001"},
		{entity: EntityWarehouse, validCode: "WHS-0001", invalidCode: "WAREHOUSE-1"},
		{entity: EntityVehicle, validCode: "VEH-0001", invalidCode: "veh-0001"},
		{entity: EntityFundAccount, validCode: "FAC-0001", invalidCode: "ACC-0001"},
		{entity: EntityProduct, validCode: "PRD-0001", invalidCode: "PRD-001"},
		{entity: EntityEmployee, validCode: "EMP-0001", invalidCode: "CUS-0001"},
		{entity: EntityCustomer, validCode: "CUS-0001", invalidCode: "ACC-0001"},
		{entity: EntitySupplier, validCode: "SUP-0001", invalidCode: "OTU-0001"},
		{entity: EntityOtherUnit, validCode: "OTU-0001", invalidCode: "SUP-0001"},
		{entity: EntitySalesPartner, validCode: "SLP-0001", invalidCode: "EMP-0001"},
		{entity: EntityRptDefinition, validCode: "rpt-000001", invalidCode: "RPT-0001"},
		{entity: EntityWflProcessDefinition, validCode: "sales-order-flow", invalidCode: "Sales-Order-Flow"},
	}

	for _, test := range tests {
		t.Run(test.entity, func(t *testing.T) {
			tx, err := pool.Begin(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(t.Context())

			if _, err = tx.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,$2,$3,$4)`,
				ulid.Make().String(), test.entity, test.validCode, "00000000000000000000000000"); err != nil {
				t.Fatalf("valid code %q rejected: %v", test.validCode, err)
			}
			if _, err = tx.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,$2,NULL,$3)`,
				ulid.Make().String(), test.entity, "00000000000000000000000000"); err == nil {
				t.Fatalf("coded entity accepted NULL code")
			}

			if err = tx.Rollback(t.Context()); err != nil {
				t.Fatal(err)
			}
			tx, err = pool.Begin(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(t.Context())
			if _, err = tx.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,$2,$3,$4)`,
				ulid.Make().String(), test.entity, test.invalidCode, "00000000000000000000000000"); err == nil {
				t.Fatalf("coded entity accepted invalid code %q", test.invalidCode)
			}
		})
	}

	for _, entity := range []string{EntityAccMapping} {
		if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,$2,NULL,$3)`,
			ulid.Make().String(), entity, "00000000000000000000000000"); err != nil {
			t.Fatalf("uncoded entity %q rejected NULL code: %v", entity, err)
		}
		if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,$2,$3,$4)`,
			ulid.Make().String(), entity, "PTY-0001", "00000000000000000000000000"); err == nil {
			t.Fatalf("uncoded entity %q accepted a non-NULL code", entity)
		}
	}

	var uniqueIndexDefinition string
	if err := pool.QueryRow(t.Context(), `SELECT pg_get_indexdef('dcl_subjects_entity_code_uq'::regclass)`).Scan(&uniqueIndexDefinition); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.ToLower(uniqueIndexDefinition), "upper((code)::text)") {
		t.Fatalf("subject code unique index is not case-insensitive: %s", uniqueIndexDefinition)
	}
	if _, err := pool.Exec(t.Context(), `SELECT dcl_require_subject_code(NULL)`); err == nil {
		t.Fatal("coded subject read guard accepted a NULL code")
	}
}

func TestWflRuntimeStateRejectsNonWorkflowSubjectIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)

	nonWorkflowID := ulid.Make().String()
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,'acc-mapping',NULL,$2)`,
		nonWorkflowID, "00000000000000000000000000"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO wfl_definition_runtime_states(subject_id,updated_by) VALUES($1,$2)`,
		nonWorkflowID, "00000000000000000000000000"); err == nil {
		t.Fatal("WFL runtime state accepted a non-workflow DCL subject")
	}
}

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
