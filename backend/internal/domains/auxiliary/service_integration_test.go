//go:build integration

package aux

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

const integrationActor = "01J00000000000000000000000"

func integrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	databaseName := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if databaseURL == "" || !strings.HasSuffix(databaseName, "_test") {
		t.Fatal("safe TEST_DATABASE_URL and TEST_POSTGRES_DB ending in _test are required")
	}
	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect integration database: %v", err)
	}
	t.Cleanup(pool.Close)
	var currentDatabase string
	if err = pool.QueryRow(t.Context(), "select current_database()").Scan(&currentDatabase); err != nil {
		t.Fatalf("read integration database: %v", err)
	}
	if currentDatabase != databaseName {
		t.Fatalf("connected database %q does not match %q", currentDatabase, databaseName)
	}
	return pool
}

func TestAuxiliaryLifecycleReferencesAndValidationIntegration(t *testing.T) {
	service := NewService(integrationPool(t))
	suffix := ulidSuffix()

	root, err := service.Create(t.Context(), EntityDepartment, CreateInput{Data: CreateData{
		Code: "DEPT-" + suffix,
		Data: map[string]any{"name": "测试部门"},
	}}, integrationActor, "aux-create-root")
	if err != nil {
		t.Fatalf("create root department: %v", err)
	}
	child, err := service.Create(t.Context(), EntityDepartment, CreateInput{Data: CreateData{
		Code: "CHILD-" + suffix,
		Data: map[string]any{"name": "测试子部门", "parentId": root.ObjectID},
	}}, integrationActor, "aux-create-child")
	if err != nil {
		t.Fatalf("create child department: %v", err)
	}

	changedCode := "RENAMED-" + suffix
	if _, err = service.Save(t.Context(), EntityDepartment, SaveInput{
		ObjectID: root.ObjectID,
		Revision: root.ObjectRevision,
		Code:     &changedCode,
		Data:     map[string]any{"name": "测试部门"},
	}, integrationActor, "aux-save-referenced-code"); !errorKind(err, ErrorConflict) {
		t.Fatalf("referenced code change error = %v", err)
	}

	disabled, err := service.Disable(t.Context(), EntityDepartment, RevisionInput{
		ObjectID: child.ObjectID,
		Revision: child.ObjectRevision,
	}, integrationActor, "aux-disable-child")
	if err != nil || disabled.Enabled {
		t.Fatalf("disable child result=%+v err=%v", disabled, err)
	}
	if _, err = service.Resolve(t.Context(), nil, EntityDepartment, child.ObjectID, ""); err == nil {
		t.Fatal("disabled auxiliary object remained resolvable")
	}
	if _, err = service.Enable(t.Context(), EntityDepartment, RevisionInput{
		ObjectID: child.ObjectID,
		Revision: disabled.ObjectRevision,
	}, integrationActor, "aux-enable-child"); err != nil {
		t.Fatalf("enable child: %v", err)
	}

	category, err := service.Create(t.Context(), EntityProductCategory, CreateInput{Data: CreateData{
		Code: "CAT-" + suffix,
		Data: map[string]any{"name": "待删除分类"},
	}}, integrationActor, "aux-create-category")
	if err != nil {
		t.Fatalf("create category: %v", err)
	}
	if err = service.Delete(t.Context(), EntityProductCategory, DeleteInput{
		ObjectID: category.ObjectID,
		Revision: category.ObjectRevision,
	}); err != nil {
		t.Fatalf("delete unreferenced category: %v", err)
	}
	if _, err = service.Get(t.Context(), EntityProductCategory, GetInput{
		ObjectID: category.ObjectID,
	}); !errorKind(err, ErrorValidation) {
		t.Fatalf("deleted category get error = %v", err)
	}

	if _, err = service.Create(t.Context(), EntitySettlementMethod, CreateInput{Data: CreateData{
		Code: "BAD-SM-" + suffix,
		Data: map[string]any{
			"name": "无效月结", "ruleType": "MONTH_END", "cutoffDay": 32,
			"monthOffset": 1, "defaultSalesSurcharge": "1.00",
		},
	}}, integrationActor, "aux-invalid-settlement"); !errorKind(err, ErrorValidation) {
		t.Fatalf("invalid settlement error = %v", err)
	}
}

func TestAuxiliaryWritesUseTransactionDomainLockIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := NewService(pool)
	blocker, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin blocker transaction: %v", err)
	}
	defer blocker.Rollback(t.Context()) //nolint:errcheck
	if err = lockAuxiliaryWrites(t.Context(), blocker); err != nil {
		t.Fatalf("lock auxiliary writes: %v", err)
	}

	result := make(chan error, 1)
	go func() {
		_, createErr := service.Create(
			context.Background(),
			EntityPosition,
			CreateInput{Data: CreateData{
				Code: "LOCK-" + ulidSuffix(),
				Data: map[string]any{"name": "并发岗位"},
			}},
			integrationActor,
			"aux-domain-lock-create",
		)
		result <- createErr
	}()

	select {
	case createErr := <-result:
		t.Fatalf("concurrent AUX write bypassed transaction lock: %v", createErr)
	case <-time.After(100 * time.Millisecond):
	}

	if err = blocker.Rollback(t.Context()); err != nil {
		t.Fatalf("release blocker transaction: %v", err)
	}
	select {
	case createErr := <-result:
		if createErr != nil {
			t.Fatalf("create after lock release: %v", createErr)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("AUX write remained blocked after transaction ended")
	}
}

func errorKind(err error, kind ErrorKind) bool {
	var domainErr *DomainError
	return errors.As(err, &domainErr) && domainErr.Kind == kind
}

func ulidSuffix() string {
	value := ulid.Make().String()
	return value[len(value)-12:]
}
