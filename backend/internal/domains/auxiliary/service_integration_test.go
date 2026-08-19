//go:build integration

package aux

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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

	root, err := service.Create(t.Context(), EntityDepartment, CreateInput{Data: CreateData{
		Data: map[string]any{"name": "测试部门"},
	}}, integrationActor, "aux-create-root")
	if err != nil {
		t.Fatalf("create root department: %v", err)
	}
	child, err := service.Create(t.Context(), EntityDepartment, CreateInput{Data: CreateData{
		Data: map[string]any{"name": "测试子部门", "parentId": root.ObjectID},
	}}, integrationActor, "aux-create-child")
	if err != nil {
		t.Fatalf("create child department: %v", err)
	}

	if _, err = service.Save(t.Context(), EntityDepartment, SaveInput{
		ObjectID: root.ObjectID,
		Revision: root.ObjectRevision,
		Data:     map[string]any{"name": "测试部门", "code": "DEP-9999"},
	}, integrationActor, "aux-save-code"); !errorKind(err, ErrorValidation) {
		t.Fatalf("code save error = %v", err)
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
		Data: map[string]any{
			"name": "无效月结", "ruleType": "MONTH_END", "monthOffset": 1,
			"defaultSalesSurcharge": "1.00",
		},
	}}, integrationActor, "aux-removed-settlement-field"); !errorKind(err, ErrorValidation) {
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

func TestAuxiliaryCreateRejectsExhaustedObjectNumberIntegration(t *testing.T) {
	pool := integrationPool(t)
	var previous int32
	err := pool.QueryRow(t.Context(), `
		SELECT last_value FROM object_number_counters
		WHERE domain = 'aux' AND entity = $1
	`, EntityPosition).Scan(&previous)
	existed := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("read object counter: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `
		INSERT INTO object_number_counters(domain, entity, last_value)
		VALUES ('aux', $1, 9999)
		ON CONFLICT(domain, entity) DO UPDATE SET last_value = 9999
	`, EntityPosition); err != nil {
		t.Fatalf("exhaust object counter: %v", err)
	}
	t.Cleanup(func() {
		var cleanupErr error
		if existed {
			_, cleanupErr = pool.Exec(context.Background(), `
				UPDATE object_number_counters SET last_value = $1
				WHERE domain = 'aux' AND entity = $2
			`, previous, EntityPosition)
		} else {
			_, cleanupErr = pool.Exec(context.Background(), `
				DELETE FROM object_number_counters WHERE domain = 'aux' AND entity = $1
			`, EntityPosition)
		}
		if cleanupErr != nil {
			t.Errorf("restore object counter: %v", cleanupErr)
		}
	})

	_, err = NewService(pool).Create(t.Context(), EntityPosition, CreateInput{
		Data: CreateData{Data: map[string]any{"name": "编号溢出岗位"}},
	}, integrationActor, "aux-number-exhausted")
	if !errorKind(err, ErrorConflict) {
		t.Fatalf("exhausted object counter error = %v", err)
	}
}

func errorKind(err error, kind ErrorKind) bool {
	var domainErr *DomainError
	return errors.As(err, &domainErr) && domainErr.Kind == kind
}

func TestSettlementAndPaymentMethodsIntegration(t *testing.T) {
	service := NewService(integrationPool(t))

	if _, err := service.Create(t.Context(), EntitySettlementMethod, CreateInput{Data: CreateData{Data: map[string]any{
		"name": "自定义结算", "termCode": "PREPAID", "ruleType": "RELATIVE_DAYS",
		"monthOffset": 0, "dayOfMonth": 0, "dayOffset": 0, "defaultSalesSurcharge": "0.00", "description": "",
	}}}, integrationActor, "settlement-create"); !errorKind(err, ErrorValidation) {
		t.Fatalf("create fixed settlement method error = %v", err)
	}

	settlement, err := service.Query(t.Context(), EntitySettlementMethod, QueryInput{Page: 1, PageSize: 20})
	if err != nil || settlement.Total != 11 {
		t.Fatalf("list fixed settlement methods total=%d err=%v", settlement.Total, err)
	}
	var monthly30 ObjectView
	for _, item := range settlement.Items {
		if item.CurrentVersion.Data["termCode"] == "MONTHLY_30" {
			monthly30 = item
			break
		}
	}
	if monthly30.ObjectID == "" {
		t.Fatal("MONTHLY_30 settlement method is missing")
	}
	updated := cloneData(monthly30.CurrentVersion.Data)
	updated["defaultSalesSurcharge"] = "0.25"
	updated["description"] = "集成测试说明"
	saved, err := service.Save(t.Context(), EntitySettlementMethod, SaveInput{
		ObjectID: monthly30.ObjectID, Revision: monthly30.ObjectRevision, Data: updated,
	}, integrationActor, "settlement-save")
	if err != nil || saved.Version != monthly30.CurrentVersion.Version+1 {
		t.Fatalf("save settlement method result=%+v err=%v", saved, err)
	}
	immutable := cloneData(updated)
	immutable["name"] = "不可改名"
	if _, err = service.Save(t.Context(), EntitySettlementMethod, SaveInput{
		ObjectID: monthly30.ObjectID, Revision: saved.ObjectRevision, Data: immutable,
	}, integrationActor, "settlement-rename"); !errorKind(err, ErrorValidation) {
		t.Fatalf("rename settlement method error = %v", err)
	}
	if err = service.Delete(t.Context(), EntitySettlementMethod, DeleteInput{
		ObjectID: monthly30.ObjectID, Revision: saved.ObjectRevision,
	}); !errorKind(err, ErrorValidation) {
		t.Fatalf("delete fixed settlement method error = %v", err)
	}

	payment, err := service.Create(t.Context(), EntityPaymentMethod, CreateInput{Data: CreateData{Data: map[string]any{
		"name": "集成测试收款方式",
	}}}, integrationActor, "payment-create")
	if err != nil {
		t.Fatalf("create payment method: %v", err)
	}
	paymentView, err := service.Get(t.Context(), EntityPaymentMethod, GetInput{ObjectID: payment.ObjectID})
	if err != nil || paymentView.CurrentVersion.Data["defaultSalesSurcharge"] != "0.00" {
		t.Fatalf("get payment method view=%+v err=%v", paymentView, err)
	}
	paymentData := cloneData(paymentView.CurrentVersion.Data)
	paymentData["defaultSalesSurcharge"] = "0.15"
	paymentSaved, err := service.Save(t.Context(), EntityPaymentMethod, SaveInput{
		ObjectID: payment.ObjectID, Revision: payment.ObjectRevision, Data: paymentData,
	}, integrationActor, "payment-save")
	if err != nil {
		t.Fatalf("save payment method: %v", err)
	}
	if err = service.Delete(t.Context(), EntityPaymentMethod, DeleteInput{
		ObjectID: payment.ObjectID, Revision: paymentSaved.ObjectRevision,
	}); err != nil {
		t.Fatalf("delete unreferenced payment method: %v", err)
	}
}
