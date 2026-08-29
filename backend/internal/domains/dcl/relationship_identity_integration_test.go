//go:build integration

package dcl

import (
	"testing"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func TestTypedRelationshipDraftIdentityDeletionDoesNotReuseCodeIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	actorID, partyID, operatingID := ulid.Make().String(), ulid.Make().String(), ulid.Make().String()
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES
			($1,'party',NULL,$3),
			($2,'operating-entity','OPE-9000',$3)`, partyID, operatingID, actorID); err != nil {
		t.Fatalf("seed typed relationship endpoints: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_parties(id) VALUES($1)`, partyID); err != nil {
		t.Fatalf("seed Party root: %v", err)
	}

	for _, tc := range []struct {
		entity string
		prefix string
	}{
		{EntityCustomer, "CUS"},
		{EntitySupplier, "SUP"},
		{EntityOtherUnit, "OUT"},
		{EntitySalesPartner, "SLP"},
	} {
		t.Run(tc.entity, func(t *testing.T) {
			tx := beginIdentityTestTx(t, pool)
			first, err := reserveRelationshipIdentity(t.Context(), tx, tc.entity, tc.prefix, partyID, operatingID, actorID)
			if err != nil {
				t.Fatalf("reserve first identity: %v", err)
			}
			deleted, deleteErr := deleteRelationshipIdentityRoot(t, dbsqlc.New(tx), tc.entity, first.ObjectID)
			assertDeletedIdentityRoot(t, tx, tc.entity, first.ObjectID, deleted, deleteErr)
			second, err := reserveRelationshipIdentity(t.Context(), tx, tc.entity, tc.prefix, partyID, operatingID, actorID)
			if err != nil {
				t.Fatalf("reserve replacement identity: %v", err)
			}
			if second.Code == first.Code {
				t.Fatalf("deleted draft code was reused: %s", first.Code)
			}
			deleted, deleteErr = deleteRelationshipIdentityRoot(t, dbsqlc.New(tx), tc.entity, second.ObjectID)
			assertDeletedIdentityRoot(t, tx, tc.entity, second.ObjectID, deleted, deleteErr)
			if err = tx.Commit(t.Context()); err != nil {
				t.Fatalf("commit identity replacement: %v", err)
			}
		})
	}

	t.Run(EntityEmployee, func(t *testing.T) {
		tx := beginIdentityTestTx(t, pool)
		first, err := reserveEmployeeIdentity(t.Context(), tx, partyID, operatingID, actorID)
		if err != nil {
			t.Fatalf("reserve first identity: %v", err)
		}
		deleted, deleteErr := dbsqlc.New(tx).DeleteDCLEmployeeRelationship(t.Context(), first.ObjectID)
		assertDeletedIdentityRoot(t, tx, EntityEmployee, first.ObjectID, deleted, deleteErr)
		second, err := reserveEmployeeIdentity(t.Context(), tx, partyID, operatingID, actorID)
		if err != nil {
			t.Fatalf("reserve replacement identity: %v", err)
		}
		if second.Code == first.Code {
			t.Fatalf("deleted draft code was reused: %s", first.Code)
		}
		deleted, deleteErr = dbsqlc.New(tx).DeleteDCLEmployeeRelationship(t.Context(), second.ObjectID)
		assertDeletedIdentityRoot(t, tx, EntityEmployee, second.ObjectID, deleted, deleteErr)
		if err = tx.Commit(t.Context()); err != nil {
			t.Fatalf("commit identity replacement: %v", err)
		}
	})

	t.Run(EntityCustomerAccount, func(t *testing.T) {
		tx := beginIdentityTestTx(t, pool)
		customer, err := reserveRelationshipIdentity(t.Context(), tx, EntityCustomer, "CUS", partyID, operatingID, actorID)
		if err != nil {
			t.Fatalf("reserve account owner: %v", err)
		}
		first, err := reserveCustomerAccountIdentity(t.Context(), tx, customer.ObjectID, actorID)
		if err != nil {
			t.Fatalf("reserve first account identity: %v", err)
		}
		deleted, deleteErr := dbsqlc.New(tx).DeleteDCLCustomerAccountRoot(t.Context(), first.ObjectID)
		assertDeletedIdentityRoot(t, tx, EntityCustomerAccount, first.ObjectID, deleted, deleteErr)
		second, err := reserveCustomerAccountIdentity(t.Context(), tx, customer.ObjectID, actorID)
		if err != nil {
			t.Fatalf("reserve replacement account identity: %v", err)
		}
		if second.Code == first.Code {
			t.Fatalf("deleted draft code was reused: %s", first.Code)
		}
		if err = tx.Commit(t.Context()); err != nil {
			t.Fatalf("commit account identity replacement: %v", err)
		}
	})

	t.Run("merged-party-guard", func(t *testing.T) {
		targetPartyID := ulid.Make().String()
		if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_subjects(id,entity,code,created_by) VALUES($1,'party',NULL,$2)`, targetPartyID, actorID); err != nil {
			t.Fatalf("seed merge target subject: %v", err)
		}
		if _, err := pool.Exec(t.Context(), `INSERT INTO dcl_parties(id) VALUES($1)`, targetPartyID); err != nil {
			t.Fatalf("seed merge target root: %v", err)
		}
		if _, err := pool.Exec(t.Context(), `UPDATE dcl_parties SET merged_into_party_id=$2,merged_at=now() WHERE id=$1`, partyID, targetPartyID); err != nil {
			t.Fatalf("mark source Party merged: %v", err)
		}
		tx := beginIdentityTestTx(t, pool)
		if _, err := reserveEmployeeIdentity(t.Context(), tx, partyID, operatingID, actorID); err == nil {
			t.Fatal("created a relationship for a merged Party")
		}
	})
}

func deleteRelationshipIdentityRoot(t *testing.T, q *dbsqlc.Queries, entity, objectID string) (int64, error) {
	t.Helper()
	switch entity {
	case EntityCustomer:
		return q.DeleteDCLCustomerRelationship(t.Context(), objectID)
	case EntitySupplier:
		return q.DeleteDCLSupplierRelationship(t.Context(), objectID)
	case EntityOtherUnit:
		return q.DeleteDCLOtherUnitRelationship(t.Context(), objectID)
	case EntitySalesPartner:
		return q.DeleteDCLSalesPartnerRelationship(t.Context(), objectID)
	default:
		t.Fatalf("unsupported relationship entity %s", entity)
		return 0, nil
	}
}

func beginIdentityTestTx(t *testing.T, pool *pgxpool.Pool) pgx.Tx {
	t.Helper()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(t.Context()) })
	return tx
}

func assertDeletedIdentityRoot(t *testing.T, tx pgx.Tx, entity, objectID string, deleted int64, err error) {
	t.Helper()
	if err != nil || deleted != 1 {
		t.Fatalf("delete %s typed root: rows=%d err=%v", entity, deleted, err)
	}
	deleted, err = dbsqlc.New(tx).DeleteDCLSubject(t.Context(), dbsqlc.DeleteDCLSubjectParams{ID: objectID, Entity: entity})
	if err != nil || deleted != 1 {
		t.Fatalf("delete %s subject: rows=%d err=%v", entity, deleted, err)
	}
}
