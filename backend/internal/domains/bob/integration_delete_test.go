//go:build integration

package bob

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestDeletePermissionCatalogIntegration(t *testing.T) {
	pool := integrationPool(t)
	rows, err := pool.Query(t.Context(), `
		SELECT id, entity, path, status
		FROM app_permissions
		WHERE domain = 'bob' AND action = 'delete'
		ORDER BY id
	`)
	if err != nil {
		t.Fatalf("query delete permissions: %v", err)
	}
	defer rows.Close()

	expected := []struct {
		entity   string
		sequence int
	}{
		{EntityCustomer, 81},
		{EntitySupplier, 82},
		{EntityEmployee, 83},
		{EntityProduct, 84},
		{EntityService, 85},
		{EntityWarehouse, 86},
		{EntityVehicle, 87},
		{EntityFundAccount, 88},
		{EntityCategory, 92},
		{EntityDepartment, 103},
		{EntityPosition, 114},
		{EntitySettlementMethod, 125},
	}
	index := 0
	for rows.Next() {
		var id, entity, path, status string
		if err = rows.Scan(&id, &entity, &path, &status); err != nil {
			t.Fatalf("scan delete permission: %v", err)
		}
		if index >= len(expected) {
			t.Fatalf("unexpected extra delete permission %q", path)
		}
		if id != fmt.Sprintf("01JBOB%020d", expected[index].sequence) ||
			entity != expected[index].entity ||
			path != "/bob/"+entity+"/delete" ||
			status != "ENABLED" {
			t.Fatalf("delete permission %d: id=%q entity=%q path=%q status=%q", index, id, entity, path, status)
		}
		index++
	}
	if err = rows.Err(); err != nil {
		t.Fatalf("iterate delete permissions: %v", err)
	}
	if index != len(expected) {
		t.Fatalf("delete permission count = %d, want %d", index, len(expected))
	}
}

func TestDeleteFirstDraftEveryEntityIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	_, salesperson := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Code: "DSE" + newID(), Name: "Delete Salesperson",
	}, "delete-salesperson")
	platform, _ := createApprovedIntegration(t, service, EntitySupplier, CreateDetailInput{
		Code:         "DP" + newID(),
		Name:         "Delete Vehicle Platform",
		SupplierType: stringIntegrationPointer(SupplierTypeLogisticsPlatform),
	}, "delete-platform")

	for _, entity := range entities {
		t.Run(entity, func(t *testing.T) {
			created, err := service.Create(
				t.Context(),
				entity,
				CreateInput{Data: deleteIntegrationData(entity, platform.ObjectID, salesperson.ObjectID)},
				integrationActorOne,
				"delete-create-"+entity,
			)
			if err != nil {
				t.Fatalf("create %s draft: %v", entity, err)
			}
			if entity == EntityCustomer {
				created, err = service.Save(t.Context(), entity, SaveInput{
					ObjectID:  created.ObjectID,
					VersionID: created.VersionID,
					Revision:  created.Revision,
					Data:      DetailInput{Name: "Saved Before Delete"},
				}, integrationActorOne, "delete-save-customer")
				if err != nil {
					t.Fatalf("save deletable draft: %v", err)
				}
			}
			if err = service.Delete(t.Context(), entity, DeleteInput{
				ObjectID:       created.ObjectID,
				ObjectRevision: created.ObjectRevision,
				VersionID:      created.VersionID,
				Revision:       created.Revision,
			}); err != nil {
				t.Fatalf("delete %s first draft: %v cause=%v", entity, err, errors.Unwrap(err))
			}
			assertBobAggregateCounts(t, pool, created.ObjectID, created.VersionID, 0, 0, 0, 0)
		})
	}
}

func TestDeleteFirstDraftRejectsLifecycleAndIdentityConflictsIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	_, salesperson := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Code: "DCE" + newID(), Name: "Delete Conflict Salesperson",
	}, "delete-conflict-salesperson")

	newCustomer := func(prefix string) MutationResult {
		t.Helper()
		created, err := service.Create(t.Context(), EntityCustomer, CreateInput{Data: CreateDetailInput{
			Code:                  prefix + newID(),
			Name:                  prefix + " Customer",
			SalespersonEmployeeID: salesperson.ObjectID,
		}}, integrationActorOne, prefix+"-create")
		if err != nil {
			t.Fatalf("create %s customer: %v", prefix, err)
		}
		return created
	}
	deleteInput := func(result MutationResult) DeleteInput {
		return DeleteInput{
			ObjectID:       result.ObjectID,
			ObjectRevision: result.ObjectRevision,
			VersionID:      result.VersionID,
			Revision:       result.Revision,
		}
	}
	assertConflict := func(name, entity string, input DeleteInput) {
		t.Helper()
		if err := service.Delete(t.Context(), entity, input); !errorIsKind(err, ErrorConflict) {
			t.Fatalf("%s error = %v, want conflict", name, err)
		}
		assertBobAggregatePresent(t, pool, input.ObjectID, input.VersionID)
	}

	t.Run("object revision", func(t *testing.T) {
		created := newCustomer("DOR")
		input := deleteInput(created)
		input.ObjectRevision++
		assertConflict("object revision", EntityCustomer, input)
	})
	t.Run("version revision", func(t *testing.T) {
		created := newCustomer("DVR")
		input := deleteInput(created)
		input.Revision++
		assertConflict("version revision", EntityCustomer, input)
	})
	t.Run("object and version mismatch", func(t *testing.T) {
		first := newCustomer("DIM1")
		second := newCustomer("DIM2")
		input := deleteInput(first)
		input.VersionID = second.VersionID
		if err := service.Delete(t.Context(), EntityCustomer, input); !errorIsKind(err, ErrorValidation) {
			t.Fatalf("mismatched version error = %v", err)
		}
		assertBobAggregateCounts(t, pool, first.ObjectID, first.VersionID, 1, 1, 1, 1)
		assertBobAggregateCounts(t, pool, second.ObjectID, second.VersionID, 1, 1, 1, 1)
	})
	t.Run("entity mismatch", func(t *testing.T) {
		created := newCustomer("DEM")
		if err := service.Delete(t.Context(), EntitySupplier, deleteInput(created)); !errorIsKind(err, ErrorValidation) {
			t.Fatalf("entity mismatch error = %v", err)
		}
		assertBobAggregateCounts(t, pool, created.ObjectID, created.VersionID, 1, 1, 1, 1)
	})
	t.Run("pending after submit", func(t *testing.T) {
		created := newCustomer("DPN")
		submitted, err := service.Submit(t.Context(), EntityCustomer, VersionRevisionInput{
			ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
		}, integrationActorOne, "delete-pending-submit")
		if err != nil {
			t.Fatalf("submit pending delete case: %v", err)
		}
		assertConflict("pending", EntityCustomer, deleteInput(submitted))
	})
	t.Run("reviewed and rejected", func(t *testing.T) {
		created := newCustomer("DRJ")
		submitted, err := service.Submit(t.Context(), EntityCustomer, VersionRevisionInput{
			ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
		}, integrationActorOne, "delete-rejected-submit")
		if err != nil {
			t.Fatalf("submit rejected delete case: %v", err)
		}
		comment := "reject delete case"
		rejected, err := service.Reject(t.Context(), EntityCustomer, ReviewInput{
			ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision, Comment: &comment,
		}, integrationActorTwo, "delete-rejected-review")
		if err != nil {
			t.Fatalf("reject delete case: %v", err)
		}
		assertConflict("rejected", EntityCustomer, deleteInput(rejected))
	})
	t.Run("effective version", func(t *testing.T) {
		created, approved := createApprovedIntegration(t, service, EntityCustomer, CreateDetailInput{
			Code: "DEF" + newID(), Name: "Effective Delete Customer",
		}, "delete-effective")
		input := deleteInput(approved)
		input.VersionID = created.VersionID
		assertConflict("effective", EntityCustomer, input)
	})
	t.Run("multiple versions and version two", func(t *testing.T) {
		created, approved := createApprovedIntegration(t, service, EntityCustomer, CreateDetailInput{
			Code: "DMV" + newID(), Name: "Multiple Version Customer",
		}, "delete-multiple")
		edited, err := service.Edit(t.Context(), EntityCustomer, ObjectRevisionInput{
			ObjectID: created.ObjectID, ObjectRevision: approved.ObjectRevision,
		}, integrationActorOne, "delete-multiple-edit")
		if err != nil {
			t.Fatalf("edit multiple-version delete case: %v", err)
		}
		assertConflict("multiple versions", EntityCustomer, deleteInput(edited))
	})
}

func TestDeleteFirstDraftRejectsVOUReferenceAndPreservesDataIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	_, salesperson := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Code: "DRE" + newID(), Name: "Referenced Draft Salesperson",
	}, "delete-reference-salesperson")
	created, err := service.Create(t.Context(), EntityCustomer, CreateInput{Data: CreateDetailInput{
		Code:                  "DREF" + newID(),
		Name:                  "Referenced Draft Customer",
		SalespersonEmployeeID: salesperson.ObjectID,
	}}, integrationActorOne, "delete-reference-create")
	if err != nil {
		t.Fatalf("create referenced draft: %v", err)
	}
	documentID := insertSaleOrderReferenceIntegration(t, pool, created)
	t.Cleanup(func() {
		deleteVOUTestDocument(t, pool, documentID)
	})

	err = service.Delete(t.Context(), EntityCustomer, DeleteInput{
		ObjectID:       created.ObjectID,
		ObjectRevision: created.ObjectRevision,
		VersionID:      created.VersionID,
		Revision:       created.Revision,
	})
	if !errorIsKind(err, ErrorConflict) {
		t.Fatalf("delete referenced draft error = %v", err)
	}
	assertBobAggregateCounts(t, pool, created.ObjectID, created.VersionID, 1, 1, 1, 1)
	var references int
	if err = pool.QueryRow(t.Context(), `
		SELECT count(*) FROM vou_sale_order_details WHERE document_id = $1
	`, documentID).Scan(&references); err != nil || references != 1 {
		t.Fatalf("VOU reference count=%d err=%v", references, err)
	}
}

func TestDeleteFirstDraftRollbackAfterPartialWorkIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	_, salesperson := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Code: "DRBE" + newID(), Name: "Rollback Salesperson",
	}, "delete-rollback-salesperson")
	created, err := service.Create(t.Context(), EntityCustomer, CreateInput{Data: CreateDetailInput{
		Code:                  "DRB" + newID(),
		Name:                  "Rollback Delete Customer",
		SalespersonEmployeeID: salesperson.ObjectID,
	}}, integrationActorOne, "delete-rollback-create")
	if err != nil {
		t.Fatalf("create rollback draft: %v", err)
	}
	service.afterDeleteDetailsHook = func() error {
		return errors.New("injected delete failure")
	}
	err = service.Delete(t.Context(), EntityCustomer, DeleteInput{
		ObjectID:       created.ObjectID,
		ObjectRevision: created.ObjectRevision,
		VersionID:      created.VersionID,
		Revision:       created.Revision,
	})
	if !errorIsKind(err, ErrorInternal) {
		t.Fatalf("injected delete error = %v", err)
	}
	assertBobAggregateCounts(t, pool, created.ObjectID, created.VersionID, 1, 1, 1, 1)
}

func TestDeleteFirstDraftConcurrencyIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	_, salesperson := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Code: "DCCE" + newID(), Name: "Delete Concurrency Salesperson",
	}, "delete-concurrency-salesperson")
	tests := []struct {
		name   string
		action func(MutationResult) error
	}{
		{
			name: "save",
			action: func(created MutationResult) error {
				_, err := service.Save(context.Background(), EntityCustomer, SaveInput{
					ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
					Data: DetailInput{Name: "Concurrent Save"},
				}, integrationActorOne, "delete-concurrent-save")
				return err
			},
		},
		{
			name: "submit",
			action: func(created MutationResult) error {
				_, err := service.Submit(context.Background(), EntityCustomer, VersionRevisionInput{
					ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
				}, integrationActorOne, "delete-concurrent-submit")
				return err
			},
		},
		{
			name: "edit",
			action: func(created MutationResult) error {
				_, err := service.Edit(context.Background(), EntityCustomer, ObjectRevisionInput{
					ObjectID: created.ObjectID, ObjectRevision: created.ObjectRevision,
				}, integrationActorOne, "delete-concurrent-edit")
				return err
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			created, err := service.Create(t.Context(), EntityCustomer, CreateInput{Data: CreateDetailInput{
				Code:                  "DC" + newID(),
				Name:                  "Concurrent Delete Customer",
				SalespersonEmployeeID: salesperson.ObjectID,
			}}, integrationActorOne, "delete-concurrent-create")
			if err != nil {
				t.Fatalf("create concurrent delete draft: %v", err)
			}
			start := make(chan struct{})
			results := make(chan error, 2)
			go func() {
				<-start
				results <- service.Delete(context.Background(), EntityCustomer, DeleteInput{
					ObjectID:       created.ObjectID,
					ObjectRevision: created.ObjectRevision,
					VersionID:      created.VersionID,
					Revision:       created.Revision,
				})
			}()
			go func() {
				<-start
				results <- test.action(created)
			}()
			close(start)
			successes := 0
			for range 2 {
				if resultErr := <-results; resultErr == nil {
					successes++
				} else if !errorIsKind(resultErr, ErrorConflict) && !errorIsKind(resultErr, ErrorValidation) {
					t.Fatalf("unexpected concurrent error: %v", resultErr)
				}
			}
			if successes != 1 {
				t.Fatalf("concurrent successes = %d, want 1", successes)
			}
			var objectCount int
			if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM bob_objects WHERE id = $1`, created.ObjectID).Scan(&objectCount); err != nil {
				t.Fatalf("count concurrent object: %v", err)
			}
			if objectCount == 0 {
				assertBobAggregateCounts(t, pool, created.ObjectID, created.VersionID, 0, 0, 0, 0)
			} else {
				var versionCount, detailCount int
				if err = pool.QueryRow(t.Context(), `
					SELECT
						(SELECT count(*) FROM bob_versions WHERE object_id = $1),
						(SELECT count(*) FROM bob_customer_versions WHERE version_id = $2)
				`, created.ObjectID, created.VersionID).Scan(&versionCount, &detailCount); err != nil {
					t.Fatalf("count concurrent aggregate: %v", err)
				}
				if versionCount != 1 || detailCount != 1 {
					t.Fatalf("concurrent aggregate version=%d detail=%d", versionCount, detailCount)
				}
			}
		})
	}
}

func TestConcurrentEditAllowsOneWinnerIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	_, salesperson := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Code: "CCE" + newID(), Name: "Concurrent Edit Salesperson",
	}, "concurrent-salesperson")
	created, err := service.Create(t.Context(), EntityCustomer, CreateInput{Data: CreateDetailInput{
		Code: "CC" + newID(), Name: "Concurrent Customer",
		SalespersonEmployeeID: salesperson.ObjectID,
	}}, integrationActorOne, "concurrent-create")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	submitted, err := service.Submit(t.Context(), EntityCustomer, VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, integrationActorOne, "concurrent-submit")
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntityCustomer, ReviewInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, "concurrent-approve")
	if err != nil {
		t.Fatalf("approve: %v", err)
	}

	start := make(chan struct{})
	errorsChannel := make(chan error, 2)
	for index := 0; index < 2; index++ {
		go func() {
			<-start
			_, editErr := service.Edit(context.Background(), EntityCustomer, ObjectRevisionInput{
				ObjectID: created.ObjectID, ObjectRevision: approved.ObjectRevision,
			}, integrationActorOne, "concurrent-edit")
			errorsChannel <- editErr
		}()
	}
	close(start)
	successes, conflicts := 0, 0
	for range 2 {
		editErr := <-errorsChannel
		switch {
		case editErr == nil:
			successes++
		case errorIsKind(editErr, ErrorConflict):
			conflicts++
		default:
			t.Fatalf("unexpected edit error: %v", editErr)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("successes=%d conflicts=%d", successes, conflicts)
	}
}

func TestEffectiveReferenceLockBlocksEditIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	_, salesperson := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Code: "RLE" + newID(), Name: "Reference Lock Salesperson",
	}, "lock-salesperson")
	created, err := service.Create(t.Context(), EntityCustomer, CreateInput{Data: CreateDetailInput{
		Code: "RL" + newID(), Name: "Reference Lock Customer",
		SalespersonEmployeeID: salesperson.ObjectID,
	}}, integrationActorOne, "lock-create")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	submitted, err := service.Submit(t.Context(), EntityCustomer, VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, integrationActorOne, "lock-submit")
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntityCustomer, ReviewInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, "lock-approve")
	if err != nil {
		t.Fatalf("approve: %v", err)
	}

	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin reference transaction: %v", err)
	}
	if _, err = service.ResolveEffectiveReference(t.Context(), tx, EntityCustomer, created.ObjectID, created.VersionID); err != nil {
		t.Fatalf("resolve reference: %v", err)
	}
	editResult := make(chan error, 1)
	editContext, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	go func() {
		_, editErr := service.Edit(editContext, EntityCustomer, ObjectRevisionInput{
			ObjectID: created.ObjectID, ObjectRevision: approved.ObjectRevision,
		}, integrationActorOne, "lock-edit")
		editResult <- editErr
	}()
	select {
	case editErr := <-editResult:
		_ = tx.Rollback(t.Context())
		t.Fatalf("edit completed while reference lock was held: %v", editErr)
	case <-time.After(150 * time.Millisecond):
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit reference transaction: %v", err)
	}
	select {
	case editErr := <-editResult:
		if editErr != nil {
			t.Fatalf("edit after reference commit: %v", editErr)
		}
	case <-editContext.Done():
		t.Fatalf("edit remained blocked after reference commit: %v", editContext.Err())
	}
}

func TestDatabaseRejectsVersionWithoutTypedDetail(t *testing.T) {
	pool := integrationPool(t)
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	queries := dbsqlc.New(pool).WithTx(tx)
	objectID, versionID := newID(), newID()
	if err = queries.InsertBobObject(t.Context(), dbsqlc.InsertBobObjectParams{
		ID: objectID, Entity: EntityCustomer, Code: "MISSING" + newID(), CurrentVersionID: versionID, ActorID: integrationActorOne,
	}); err != nil {
		t.Fatalf("insert object: %v", err)
	}
	if err = queries.InsertBobVersion(t.Context(), dbsqlc.InsertBobVersionParams{
		ID: versionID, ObjectID: objectID, Entity: EntityCustomer, VersionNo: 1, ActorID: integrationActorOne,
	}); err != nil {
		t.Fatalf("insert version: %v", err)
	}
	err = tx.Commit(t.Context())
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
		t.Fatalf("commit error = %v, want check violation", err)
	}
}

func TestDuplicateCodeReturnsConflictAndRollsBackIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	_, salesperson := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Code: "DUE" + newID(), Name: "Duplicate Code Salesperson",
	}, "duplicate-salesperson")
	code := "DU" + newID()
	if _, err := service.Create(t.Context(), EntityCustomer, CreateInput{Data: CreateDetailInput{
		Code: code, Name: "Original", SalespersonEmployeeID: salesperson.ObjectID,
	}}, integrationActorOne, "duplicate-create-original"); err != nil {
		t.Fatalf("create original: %v", err)
	}
	if _, err := service.Create(t.Context(), EntityCustomer, CreateInput{Data: CreateDetailInput{
		Code: code, Name: "Duplicate", SalespersonEmployeeID: salesperson.ObjectID,
	}}, integrationActorOne, "duplicate-create-conflict"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("duplicate create error = %v", err)
	}

	var objects, versions int
	if err := pool.QueryRow(t.Context(), `
		SELECT count(DISTINCT o.id), count(v.id)
		FROM bob_objects o
		JOIN bob_versions v ON v.object_id = o.id
		WHERE o.entity = $1 AND o.code = $2
	`, EntityCustomer, code).Scan(&objects, &versions); err != nil {
		t.Fatalf("count duplicate code rows: %v", err)
	}
	if objects != 1 || versions != 1 {
		t.Fatalf("objects=%d versions=%d, want one committed aggregate", objects, versions)
	}
}
