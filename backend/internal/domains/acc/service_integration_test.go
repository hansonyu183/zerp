//go:build integration

package acc

import (
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	adminID    = "01JACC00000000000000000001"
	queryID    = "01JACC00000000000000000002"
	operatorID = "01JACC00000000000000000003"
	outsiderID = "01JACC00000000000000000004"
)

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

func seedUsers(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(t.Context(), `
		DELETE FROM acc_container_entries;
		DELETE FROM acc_bill_book_values;
		DELETE FROM acc_bills;
		DELETE FROM acc_asset_book_values;
		DELETE FROM acc_assets;
		DELETE FROM acc_register_events;
		DELETE FROM acc_openings;
		DELETE FROM acc_vouchers;
		DELETE FROM acc_subject_usages;
		DELETE FROM acc_mapping_versions;
		DELETE FROM acc_books;
		DELETE FROM object_number_counters WHERE domain = 'acc';
		DELETE FROM app_users WHERE username LIKE 'acc-%'
	`); err != nil {
		t.Fatalf("reset ACC users: %v", err)
	}
	_, err := pool.Exec(t.Context(), `
		INSERT INTO app_users (
			id, username, display_name, password_hash, status,
			password_changed_at, created_by, updated_by
		) VALUES
			($1, 'acc-admin', '账簿管理员', 'hash', 'ENABLED', now(), $1, $1),
			($2, 'acc-query', '查询人员', 'hash', 'ENABLED', now(), $1, $1),
			($3, 'acc-operator', '操作人员', 'hash', 'ENABLED', now(), $1, $1),
			($4, 'acc-outsider', '范围外人员', 'hash', 'ENABLED', now(), $1, $1)
	`, adminID, queryID, operatorID, outsiderID)
	if err != nil {
		t.Fatalf("seed ACC users: %v", err)
	}
}

func TestConcurrentFirstBookCreationKeepsOneControlBook(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := NewService(pool)

	results := make(chan BookView, 2)
	errors := make(chan error, 2)
	var wait sync.WaitGroup
	for _, name := range []string{"第一账簿", "第二账簿"} {
		wait.Add(1)
		go func(name string) {
			defer wait.Done()
			result, err := service.CreateBook(t.Context(), CreateBookInput{
				Name: name, StartMonth: "2026-08", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty,
			}, adminID)
			if err != nil {
				errors <- err
				return
			}
			results <- result
		}(name)
	}
	wait.Wait()
	close(results)
	close(errors)
	for err := range errors {
		t.Fatalf("concurrent create: %v", err)
	}
	controlCount := 0
	for result := range results {
		if result.ControlBook {
			controlCount++
		}
	}
	if controlCount != 1 {
		t.Fatalf("control book count = %d, want 1", controlCount)
	}
}

func TestAccountingBooksAreIsolatedByQueryAndOperationScopes(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := NewService(pool)

	control, err := service.CreateBook(t.Context(), CreateBookInput{
		Name: "管理账簿", Description: "内部管理",
		StartMonth: "2026-08", BaseCurrency: "cny",
		SubjectTemplate: SubjectTemplateEmpty,
		QueryUserIDs:    []string{queryID}, OperateUserIDs: []string{operatorID},
	}, adminID)
	if err != nil {
		t.Fatalf("create first accounting book: %v", err)
	}
	if !control.ControlBook || control.Code != "ACC-0001" || control.BaseCurrency != "CNY" {
		t.Fatalf("first book = %+v, want normalized permanent control book", control)
	}

	queryPage, err := service.QueryBooks(t.Context(), QueryBooksInput{Page: 1, PageSize: 20}, queryID)
	if err != nil || len(queryPage.Items) != 1 || queryPage.Items[0].ID != control.ID {
		t.Fatalf("query scope page = %+v, err = %v", queryPage, err)
	}
	if queryPage.Items[0].QueryUserIDs == nil || queryPage.Items[0].OperateUserIDs == nil {
		t.Fatalf("query scope item access arrays = %#v, want JSON arrays", queryPage.Items[0])
	}
	outsidePage, err := service.QueryBooks(t.Context(), QueryBooksInput{Page: 1, PageSize: 20}, outsiderID)
	if err != nil || outsidePage.Total != 0 || len(outsidePage.Items) != 0 {
		t.Fatalf("outside page = %+v, err = %v", outsidePage, err)
	}
	if _, err = service.GetBook(t.Context(), control.ID, operatorID); !IsKind(err, ErrorForbidden) {
		t.Fatalf("operate-only user get error = %v, want forbidden", err)
	}
	if _, err = service.SaveBook(t.Context(), SaveBookInput{
		BookID: control.ID, Name: "越权修改", BaseCurrency: "CNY",
		Revision: control.Revision,
	}, queryID); !IsKind(err, ErrorForbidden) {
		t.Fatalf("query-only user save error = %v, want forbidden", err)
	}

	updated, err := service.SaveBook(t.Context(), SaveBookInput{
		BookID: control.ID, Name: "经营管理账簿",
		Description: "更新后", BaseCurrency: "cny", Revision: control.Revision,
		QueryUserIDs: []string{queryID}, OperateUserIDs: []string{operatorID},
	}, operatorID)
	if err != nil {
		t.Fatalf("operator saves accounting book: %v", err)
	}
	if updated.StartMonth != "2026-08" || !updated.ControlBook || updated.Revision != 2 {
		t.Fatalf("updated book = %+v", updated)
	}
	operatorPage, err := service.QueryBooks(t.Context(), QueryBooksInput{Page: 1, PageSize: 20}, operatorID)
	if err != nil || operatorPage.Total != 0 || len(operatorPage.Items) != 0 {
		t.Fatalf("operate-only user gained query access after save: page = %+v, err = %v", operatorPage, err)
	}

	second, err := service.CreateBook(t.Context(), CreateBookInput{
		Name: "税务口径", StartMonth: "2026-09", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty,
	}, adminID)
	if err != nil {
		t.Fatalf("create second accounting book: %v", err)
	}
	if second.ControlBook {
		t.Fatal("second book became a control book")
	}
	if err = service.DeleteBook(t.Context(), control.ID, updated.Revision, operatorID); !IsKind(err, ErrorConflict) {
		t.Fatalf("delete control book error = %v, want conflict", err)
	}
	if err = service.DeleteBook(t.Context(), second.ID, second.Revision, adminID); err != nil {
		t.Fatalf("delete unused non-control book: %v", err)
	}
}

func TestAccountingBookIdentityAndConcurrencyRules(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := NewService(pool)

	created, err := service.CreateBook(t.Context(), CreateBookInput{
		Name: "主账簿", StartMonth: "2026-08", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty,
	}, adminID)
	if err != nil {
		t.Fatalf("create accounting book: %v", err)
	}
	second, err := service.CreateBook(t.Context(), CreateBookInput{
		Name: "第二账簿", StartMonth: "2026-08", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty,
	}, adminID)
	if err != nil || created.Code != "ACC-0001" || second.Code != "ACC-0002" {
		t.Fatalf("generated codes = %q, %q, err = %v", created.Code, second.Code, err)
	}
	if _, err = service.SaveBook(t.Context(), SaveBookInput{
		BookID: created.ID, Name: "过期保存", BaseCurrency: "CNY",
		Revision: created.Revision + 1,
	}, adminID); !IsKind(err, ErrorConflict) {
		t.Fatalf("stale revision error = %v, want conflict", err)
	}
	if _, err = service.CreateBook(t.Context(), CreateBookInput{
		Name: "无效月份", StartMonth: "2026-8", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty,
	}, adminID); !IsKind(err, ErrorValidation) {
		t.Fatalf("invalid month error = %v, want validation", err)
	}
}
