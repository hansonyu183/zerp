//go:build integration

package bob

import (
	"context"
	"errors"
	"testing"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
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

	expected := map[string]bool{
		EntityCustomer: true, EntityCustomerAccount: true, EntitySupplier: true,
		EntityEmployee: true, EntitySalesPartner: true, EntityProduct: true,
		EntityWarehouse: true, EntityVehicle: true,
		EntityFundAccount: true, EntityOperatingEntity: true, EntityOtherUnit: true,
	}
	seen := make(map[string]bool, len(expected))
	for rows.Next() {
		var id, entity, path, status string
		if err = rows.Scan(&id, &entity, &path, &status); err != nil {
			t.Fatalf("scan delete permission: %v", err)
		}
		if !expected[entity] || seen[entity] {
			t.Fatalf("unexpected or duplicate delete permission %q", path)
		}
		if id == "" || path != "/bob/"+entity+"/delete" ||
			status != "ENABLED" {
			t.Fatalf("delete permission: id=%q entity=%q path=%q status=%q", id, entity, path, status)
		}
		seen[entity] = true
	}
	if err = rows.Err(); err != nil {
		t.Fatalf("iterate delete permissions: %v", err)
	}
	if len(seen) != len(expected) {
		t.Fatalf("delete permission entities = %v, want %v", seen, expected)
	}
}

func TestDeleteFirstDraftEveryEntityIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	platform, _ := createApprovedIntegration(t, service, EntityOtherUnit, CreateDetailInput{
		Name: "Delete Vehicle Carrier",
	}, "delete-platform")
	_, operating := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{
		Name: "Delete Operating Entity", TaxNumber: "TAX" + newID()[3:],
	}, "delete-operating")

	for _, entity := range entities {
		if entity == EntitySettlementMethod || entity == EntityCustomer || entity == EntityCustomerAccount ||
			entity == EntitySupplier || entity == EntityEmployee || entity == EntitySalesPartner {
			continue
		}
		t.Run(entity, func(t *testing.T) {
			data := deleteIntegrationData(entity, platform.ObjectID, "", operating.ObjectID)
			var created MutationResult
			var err error
			if entity == EntityOtherUnit {
				created = createOtherUnitDraftIntegration(t, service, data, "delete-create-"+entity)
			} else {
				created, err = service.Create(
					t.Context(), entity, CreateInput{Data: data}, integrationActorOne, "delete-create-"+entity,
				)
			}
			if err != nil {
				t.Fatalf("create %s draft: %v (cause: %v)", entity, err, errors.Unwrap(err))
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

	newProduct := func(prefix string) MutationResult {
		t.Helper()
		data := CreateDetailInput{Name: prefix + " Product"}
		completeRawProductIntegration(service, &data)
		service.SetAuxiliaryResolver(integrationAuxiliaryResolver{})
		created, err := service.Create(t.Context(), EntityProduct, CreateInput{Data: data}, integrationActorOne, prefix+"-create")
		if err != nil {
			t.Fatalf("create %s product: %v", prefix, err)
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
		created := newProduct("DOR")
		input := deleteInput(created)
		input.ObjectRevision++
		assertConflict("object revision", EntityProduct, input)
	})
	t.Run("version revision", func(t *testing.T) {
		created := newProduct("DVR")
		input := deleteInput(created)
		input.Revision++
		assertConflict("version revision", EntityProduct, input)
	})
	t.Run("object and version mismatch", func(t *testing.T) {
		first := newProduct("DIM1")
		second := newProduct("DIM2")
		input := deleteInput(first)
		input.VersionID = second.VersionID
		if err := service.Delete(t.Context(), EntityProduct, input); !errorIsKind(err, ErrorValidation) {
			t.Fatalf("mismatched version error = %v", err)
		}
		assertBobAggregateCounts(t, pool, first.ObjectID, first.VersionID, 1, 1, 1, 1)
		assertBobAggregateCounts(t, pool, second.ObjectID, second.VersionID, 1, 1, 1, 1)
	})
	t.Run("entity mismatch", func(t *testing.T) {
		created := newProduct("DEM")
		if err := service.Delete(t.Context(), EntitySupplier, deleteInput(created)); !errorIsKind(err, ErrorValidation) {
			t.Fatalf("entity mismatch error = %v", err)
		}
		assertBobAggregateCounts(t, pool, created.ObjectID, created.VersionID, 1, 1, 1, 1)
	})
	t.Run("pending after submit", func(t *testing.T) {
		created := newProduct("DPN")
		submitted, err := service.Submit(t.Context(), EntityProduct, VersionRevisionInput{
			ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
		}, integrationActorOne, "delete-pending-submit")
		if err != nil {
			t.Fatalf("submit pending delete case: %v", err)
		}
		assertConflict("pending", EntityProduct, deleteInput(submitted))
	})
	t.Run("reviewed and rejected", func(t *testing.T) {
		created := newProduct("DRJ")
		submitted, err := service.Submit(t.Context(), EntityProduct, VersionRevisionInput{
			ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
		}, integrationActorOne, "delete-rejected-submit")
		if err != nil {
			t.Fatalf("submit rejected delete case: %v", err)
		}
		comment := "reject delete case"
		rejected, err := service.Reject(t.Context(), EntityProduct, ReviewInput{
			ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision, Comment: &comment,
		}, integrationActorTwo, "delete-rejected-review")
		if err != nil {
			t.Fatalf("reject delete case: %v", err)
		}
		assertConflict("rejected", EntityProduct, deleteInput(rejected))
	})
	t.Run("effective version", func(t *testing.T) {
		created, approved := createApprovedIntegration(t, service, EntityProduct, CreateDetailInput{
			Name: "Effective Delete Product",
		}, "delete-effective")
		input := deleteInput(approved)
		input.VersionID = created.VersionID
		assertConflict("effective", EntityProduct, input)
	})
	t.Run("multiple versions and version two", func(t *testing.T) {
		created, approved := createApprovedIntegration(t, service, EntityProduct, CreateDetailInput{
			Name: "Multiple Version Product",
		}, "delete-multiple")
		edited, err := service.Edit(t.Context(), EntityProduct, ObjectRevisionInput{
			ObjectID: created.ObjectID, ObjectRevision: approved.ObjectRevision,
		}, integrationActorOne, "delete-multiple-edit")
		if err != nil {
			t.Fatalf("edit multiple-version delete case: %v", err)
		}
		if err = service.Delete(t.Context(), EntityProduct, deleteInput(edited)); err != nil {
			t.Fatalf("delete effective candidate: %v", err)
		}
		view, getErr := service.Get(t.Context(), EntityProduct, GetInput{ObjectID: created.ObjectID})
		if getErr != nil {
			t.Fatalf("get product after candidate delete: %v", getErr)
		}
		if view.Version.VersionID != approved.VersionID || view.Version.Status != StatusEffective {
			t.Fatalf("product after candidate delete = %+v, want effective version %+v", view.Version, approved)
		}
		reedited, editErr := service.Edit(t.Context(), EntityProduct, ObjectRevisionInput{
			ObjectID: created.ObjectID, ObjectRevision: view.ObjectRevision,
		}, integrationActorOne, "delete-multiple-reedit")
		if editErr != nil {
			t.Fatalf("edit after candidate delete: %v", editErr)
		}
		if reedited.Version <= edited.Version {
			t.Fatalf("version number was reused after candidate delete: deleted=%d new=%d", edited.Version, reedited.Version)
		}
	})
	t.Run("vehicle candidate restores the effective version", func(t *testing.T) {
		vehicleService := NewService(pool)
		operating, _ := createApprovedIntegration(t, vehicleService, EntityOperatingEntity, CreateDetailInput{
			Name: "Vehicle Delete Operating", TaxNumber: "TAX" + newID()[3:],
		}, "delete-vehicle-operating")
		created, approved := createApprovedIntegration(t, vehicleService, EntityVehicle, CreateDetailInput{
			Name: "Candidate Delete Vehicle", PlateNumber: "粤D" + newID(), VehicleType: "厢式货车",
			CarrierAffiliation: &CarrierAffiliation{Type: "INTERNAL", OperatingEntityID: operating.ObjectID},
		}, "delete-vehicle")
		edited, err := vehicleService.Edit(t.Context(), EntityVehicle, ObjectRevisionInput{
			ObjectID: created.ObjectID, ObjectRevision: approved.ObjectRevision,
		}, integrationActorOne, "delete-vehicle-edit")
		if err != nil {
			t.Fatalf("edit vehicle candidate: %v", err)
		}
		if err = vehicleService.Delete(t.Context(), EntityVehicle, deleteInput(edited)); err != nil {
			t.Fatalf("delete vehicle candidate: %v", err)
		}
		view, err := vehicleService.Get(t.Context(), EntityVehicle, GetInput{ObjectID: created.ObjectID})
		if err != nil || view.Version.VersionID != approved.VersionID || view.Version.Status != StatusEffective {
			t.Fatalf("vehicle after candidate delete = %+v, err=%v", view.Version, err)
		}
	})
}

func TestDeleteFirstDraftRollbackAfterPartialWorkIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	created, err := service.Create(t.Context(), EntityProduct, CreateInput{Data: CreateDetailInput{
		Name: "Rollback Delete Product", DefaultPackagingSpec: "1",
	}}, integrationActorOne, "delete-rollback-create")
	if err != nil {
		t.Fatalf("create rollback draft: %v", err)
	}
	service.afterDeleteDetailsHook = func() error {
		return errors.New("injected delete failure")
	}
	err = service.Delete(t.Context(), EntityProduct, DeleteInput{
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
	tests := []struct {
		name   string
		action func(MutationResult) error
	}{
		{
			name: "save",
			action: func(created MutationResult) error {
				_, err := service.Save(context.Background(), EntityProduct, SaveInput{
					ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
					Data: DetailInput{Name: "Concurrent Save"},
				}, integrationActorOne, "delete-concurrent-save")
				return err
			},
		},
		{
			name: "submit",
			action: func(created MutationResult) error {
				_, err := service.Submit(context.Background(), EntityProduct, VersionRevisionInput{
					ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
				}, integrationActorOne, "delete-concurrent-submit")
				return err
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			created, err := service.Create(t.Context(), EntityProduct, CreateInput{Data: CreateDetailInput{
				Name: "Concurrent Delete Product", DefaultPackagingSpec: "1",
			}}, integrationActorOne, "delete-concurrent-create")
			if err != nil {
				t.Fatalf("create concurrent delete draft: %v", err)
			}
			start := make(chan struct{})
			results := make(chan error, 2)
			go func() {
				<-start
				results <- service.Delete(context.Background(), EntityProduct, DeleteInput{
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
						(SELECT count(*) FROM bob_product_versions WHERE version_id = $2)
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
	data := CreateDetailInput{Name: "Concurrent Product"}
	completeRawProductIntegration(service, &data)
	service.SetAuxiliaryResolver(integrationAuxiliaryResolver{})
	created, err := service.Create(t.Context(), EntityProduct, CreateInput{Data: data}, integrationActorOne, "concurrent-create")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	submitted, err := service.Submit(t.Context(), EntityProduct, VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, integrationActorOne, "concurrent-submit")
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntityProduct, ReviewInput{
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
			_, editErr := service.Edit(context.Background(), EntityProduct, ObjectRevisionInput{
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
	data := CreateDetailInput{Name: "Reference Lock Product"}
	completeRawProductIntegration(service, &data)
	service.SetAuxiliaryResolver(integrationAuxiliaryResolver{})
	created, err := service.Create(t.Context(), EntityProduct, CreateInput{Data: data}, integrationActorOne, "lock-create")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	submitted, err := service.Submit(t.Context(), EntityProduct, VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, integrationActorOne, "lock-submit")
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntityProduct, ReviewInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision,
	}, integrationActorTwo, "lock-approve")
	if err != nil {
		t.Fatalf("approve: %v", err)
	}

	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin reference transaction: %v", err)
	}
	if _, err = service.ResolveEffectiveReference(t.Context(), tx, EntityProduct, created.ObjectID, created.VersionID); err != nil {
		t.Fatalf("resolve reference: %v", err)
	}
	editResult := make(chan error, 1)
	editContext, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	go func() {
		_, editErr := service.Edit(editContext, EntityProduct, ObjectRevisionInput{
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
		ID: objectID, Entity: EntityCustomer, Code: "CUS-9999", CurrentVersionID: versionID, ActorID: integrationActorOne,
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

func TestCreateAllocatesDistinctObjectCodesIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	first, err := service.Create(t.Context(), EntityProduct, CreateInput{Data: CreateDetailInput{
		Name: "Original", DefaultPackagingSpec: "1",
	}}, integrationActorOne, "duplicate-create-original")
	if err != nil {
		t.Fatalf("create original: %v", err)
	}
	second, err := service.Create(t.Context(), EntityProduct, CreateInput{Data: CreateDetailInput{
		Name: "Second", DefaultPackagingSpec: "1",
	}}, integrationActorOne, "duplicate-create-second")
	if err != nil {
		t.Fatalf("create second: %v", err)
	}
	var firstCode, secondCode string
	if err := pool.QueryRow(t.Context(), `
		SELECT first.code, second.code
		FROM bob_objects first, bob_objects second
		WHERE first.id=$1 AND second.id=$2
	`, first.ObjectID, second.ObjectID).Scan(&firstCode, &secondCode); err != nil {
		t.Fatalf("read generated codes: %v", err)
	}
	if len(firstCode) != 8 || len(secondCode) != 8 ||
		firstCode[:4] != "PRD-" || secondCode[:4] != "PRD-" ||
		firstCode == secondCode {
		t.Fatalf("generated codes = %q, %q", firstCode, secondCode)
	}
}

func TestCreateRejectsExhaustedObjectNumberIntegration(t *testing.T) {
	pool := integrationPool(t)
	var previous int32
	err := pool.QueryRow(t.Context(), `
		SELECT last_value FROM object_number_counters
		WHERE domain = 'bob' AND entity = $1
	`, EntityWarehouse).Scan(&previous)
	existed := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("read object counter: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `
		INSERT INTO object_number_counters(domain, entity, last_value)
		VALUES ('bob', $1, 9999)
		ON CONFLICT(domain, entity) DO UPDATE SET last_value = 9999
	`, EntityWarehouse); err != nil {
		t.Fatalf("exhaust object counter: %v", err)
	}
	t.Cleanup(func() {
		var cleanupErr error
		if existed {
			_, cleanupErr = pool.Exec(context.Background(), `
				UPDATE object_number_counters SET last_value = $1
				WHERE domain = 'bob' AND entity = $2
			`, previous, EntityWarehouse)
		} else {
			_, cleanupErr = pool.Exec(context.Background(), `
				DELETE FROM object_number_counters WHERE domain = 'bob' AND entity = $1
			`, EntityWarehouse)
		}
		if cleanupErr != nil {
			t.Errorf("restore object counter: %v", cleanupErr)
		}
	})

	_, err = NewService(pool).Create(t.Context(), EntityWarehouse, CreateInput{
		Data: CreateDetailInput{Name: "编号溢出仓库"},
	}, integrationActorOne, "object-number-exhausted")
	if !errorIsKind(err, ErrorConflict) {
		t.Fatalf("exhausted object counter error = %v", err)
	}
}
