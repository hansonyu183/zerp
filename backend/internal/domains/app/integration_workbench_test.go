//go:build integration

package app

import (
	"fmt"
	"slices"
	"testing"
	"time"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/oklog/ulid/v2"
)

func TestWorkbenchQueryIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	bobService := bobdomain.NewService(pool)
	suffix := ulid.Make().String()[20:]
	draftName := "工作台草稿-" + suffix
	pendingName := "工作台待批准-" + suffix

	draft, err := bobService.Create(t.Context(), bobdomain.EntityWarehouse, bobdomain.CreateInput{
		Data: bobdomain.CreateDetailInput{Name: draftName},
	}, admin.ID, "workbench-create-draft")
	if err != nil {
		t.Fatalf("create draft object: %v", err)
	}
	pending, err := bobService.Create(t.Context(), bobdomain.EntityWarehouse, bobdomain.CreateInput{
		Data: bobdomain.CreateDetailInput{Name: pendingName},
	}, admin.ID, "workbench-create-pending")
	if err != nil {
		t.Fatalf("create pending object: %v", err)
	}
	if _, err = bobService.Submit(t.Context(), bobdomain.EntityWarehouse, bobdomain.VersionRevisionInput{
		ObjectID: pending.ObjectID, VersionID: pending.VersionID, Revision: pending.Revision,
	}, admin.ID, "workbench-submit-pending"); err != nil {
		t.Fatalf("submit pending object: %v", err)
	}
	fund, err := bobService.Create(t.Context(), bobdomain.EntityFundAccount, bobdomain.CreateInput{
		Data: bobdomain.CreateDetailInput{Name: "工作台资金账户-" + suffix, Currency: "CNY"},
	}, admin.ID, "workbench-create-fund")
	if err != nil {
		t.Fatalf("create fund account: %v", err)
	}
	fundSubmitted, err := bobService.Submit(t.Context(), bobdomain.EntityFundAccount, bobdomain.VersionRevisionInput{
		ObjectID: fund.ObjectID, VersionID: fund.VersionID, Revision: fund.Revision,
	}, admin.ID, "workbench-submit-fund")
	if err != nil {
		t.Fatalf("submit fund account: %v", err)
	}
	reviewerID := ulid.Make().String()
	if _, err = bobService.Approve(t.Context(), bobdomain.EntityFundAccount, bobdomain.ReviewInput{
		ObjectID: fund.ObjectID, VersionID: fund.VersionID, Revision: fundSubmitted.Revision,
	}, reviewerID, "workbench-approve-fund"); err != nil {
		t.Fatalf("approve fund account: %v", err)
	}
	fundView, err := bobService.Get(t.Context(), bobdomain.EntityFundAccount, bobdomain.GetInput{ObjectID: fund.ObjectID})
	if err != nil {
		t.Fatalf("get fund account: %v", err)
	}

	baseSequence := int(time.Now().UnixNano()%9000) + 1
	documentIDs := []string{ulid.Make().String(), ulid.Make().String(), ulid.Make().String()}
	documentNos := []string{
		fmt.Sprintf("OIN-20991231-%04d", baseSequence),
		fmt.Sprintf("OIN-20991231-%04d", baseSequence+1),
		fmt.Sprintf("OIN-20991231-%04d", baseSequence+2),
	}
	allObjectIDs := []string{draft.ObjectID, pending.ObjectID, fund.ObjectID}
	allVersionIDs := []string{draft.VersionID, pending.VersionID, fund.VersionID}
	t.Cleanup(func() {
		_, _ = pool.Exec(t.Context(), `DELETE FROM vou_other_income_details WHERE document_id=ANY($1::text[])`, documentIDs)
		_, _ = pool.Exec(t.Context(), `DELETE FROM vou_documents WHERE id=ANY($1::text[])`, documentIDs)
		tx, cleanupErr := pool.Begin(t.Context())
		if cleanupErr != nil {
			return
		}
		defer tx.Rollback(t.Context()) //nolint:errcheck
		_, _ = tx.Exec(t.Context(), `SET CONSTRAINTS ALL DEFERRED`)
		_, _ = tx.Exec(t.Context(), `DELETE FROM bob_audit_events WHERE object_id=ANY($1::text[])`, allObjectIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM bob_warehouse_versions WHERE version_id=ANY($1::text[])`, []string{draft.VersionID, pending.VersionID})
		_, _ = tx.Exec(t.Context(), `DELETE FROM bob_fund_account_versions WHERE version_id=$1`, fund.VersionID)
		_, _ = tx.Exec(t.Context(), `DELETE FROM bob_objects WHERE id=ANY($1::text[])`, allObjectIDs)
		_, _ = tx.Exec(t.Context(), `DELETE FROM bob_versions WHERE id=ANY($1::text[])`, allVersionIDs)
		_ = tx.Commit(t.Context())
	})

	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin voucher fixtures: %v", err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck
	if _, err = tx.Exec(t.Context(), `SET CONSTRAINTS ALL DEFERRED`); err != nil {
		t.Fatalf("defer voucher fixture constraints: %v", err)
	}
	if _, err = tx.Exec(t.Context(), `
		INSERT INTO vou_documents (
			id, entity, document_no, status, revision, business_date, currency,
			total_amount_cents, created_by, updated_by, reviewed_at, reviewed_by,
			approved_at, approved_by, updated_at
		) VALUES
			($1, 'other-income', $2, 'DRAFT', 1, '2099-12-31', 'CNY', 12345, $7, $7, NULL, NULL, NULL, NULL, now() - interval '2 seconds'),
			($3, 'other-income', $4, 'CHECKED', 2, '2099-12-31', 'CNY', 23456, $7, $7, now(), $7, NULL, NULL, now() - interval '1 second'),
			($5, 'other-income', $6, 'APPROVED', 3, '2099-12-31', 'CNY', 34567, $7, $7, now(), $7, now(), $7, now())
	`, documentIDs[0], documentNos[0], documentIDs[1], documentNos[1], documentIDs[2], documentNos[2], admin.ID); err != nil {
		t.Fatalf("insert workbench vouchers: %v", err)
	}
	if _, err = tx.Exec(t.Context(), `
		INSERT INTO vou_other_income_details (
			document_id, source_name, fund_account_object_id, fund_account_version_id,
			fund_account_code, fund_account_name
		) VALUES
			($1, '工作台待核对', $4, $5, $6, $7),
			($2, '工作台待批准', $4, $5, $6, $7),
			($3, '工作台待完成', $4, $5, $6, $7)
	`, documentIDs[0], documentIDs[1], documentIDs[2], fund.ObjectID, fund.VersionID, fundView.Code, fundView.Data.Name); err != nil {
		t.Fatalf("insert workbench voucher details: %v", err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit workbench vouchers: %v", err)
	}

	bobPrincipal := Principal{User: UserSummary{ID: reviewerID}, Permissions: []string{
		"/bob/warehouse/query", "/bob/warehouse/get", "/bob/warehouse/save",
		"/bob/warehouse/submit", "/bob/warehouse/approve", "/bob/warehouse/reject",
	}}
	bobPage, err := service.QueryWorkbench(t.Context(), bobPrincipal, WorkbenchQueryInput{
		Category: WorkbenchCategoryBob, Keyword: "工作台", Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatalf("query BOB workbench: %v", err)
	}
	byID := make(map[string]WorkbenchItem, len(bobPage.Items))
	for _, item := range bobPage.Items {
		byID[item.ObjectID] = item
	}
	if byID[draft.ObjectID].PendingStage != "CHECK" || byID[pending.ObjectID].PendingStage != "APPROVE" {
		t.Fatalf("unexpected BOB stages: %#v", byID)
	}
	if bobPage.Total < 2 {
		t.Fatalf("BOB total = %d, want at least 2", bobPage.Total)
	}
	bobApprovalPage, err := service.QueryWorkbench(t.Context(), bobPrincipal, WorkbenchQueryInput{
		Category: WorkbenchCategoryBob, Keyword: pendingName, Entities: []string{"warehouse"},
		PendingStages: []string{"APPROVE"}, Page: 1, PageSize: 20,
	})
	if err != nil || bobApprovalPage.Total != 1 || len(bobApprovalPage.Items) != 1 ||
		bobApprovalPage.Items[0].ObjectID != pending.ObjectID {
		t.Fatalf("filtered BOB workbench page = %+v, err = %v", bobApprovalPage, err)
	}
	selfApprovalPage, err := service.QueryWorkbench(t.Context(), Principal{
		User: UserSummary{ID: admin.ID}, Permissions: []string{
			"/bob/warehouse/query", "/bob/warehouse/approve", "/bob/warehouse/reject",
		},
	}, WorkbenchQueryInput{
		Category: WorkbenchCategoryBob, Keyword: pendingName,
		PendingStages: []string{"APPROVE"}, Page: 1, PageSize: 20,
	})
	if err != nil || selfApprovalPage.Total != 0 || len(selfApprovalPage.Items) != 0 {
		t.Fatalf("self-submitted BOB workbench page = %+v, err = %v", selfApprovalPage, err)
	}

	noActionPage, err := service.QueryWorkbench(t.Context(), Principal{Permissions: []string{
		"/bob/warehouse/query",
	}}, WorkbenchQueryInput{Category: WorkbenchCategoryBob, Keyword: suffix, Page: 1, PageSize: 20})
	if err != nil || noActionPage.Total != 0 {
		t.Fatalf("query-only workbench page = %+v, err = %v", noActionPage, err)
	}

	vouPage, err := service.QueryWorkbench(t.Context(), Principal{Permissions: []string{
		"/vou/other-income/query", "/vou/other-income/get", "/vou/other-income/save",
		"/vou/other-income/check", "/vou/other-income/approve", "/vou/other-income/finalize",
	}}, WorkbenchQueryInput{Category: WorkbenchCategoryVou, Keyword: "OIN-20991231", Page: 1, PageSize: 200})
	if err != nil {
		t.Fatalf("query VOU workbench: %v", err)
	}
	vouByID := make(map[string]WorkbenchItem, len(vouPage.Items))
	for _, item := range vouPage.Items {
		vouByID[item.DocumentID] = item
	}
	if vouByID[documentIDs[0]].PendingStage != "CHECK" || vouByID[documentIDs[0]].Amount != "123.45" ||
		vouByID[documentIDs[1]].PendingStage != "APPROVE" ||
		vouByID[documentIDs[2]].PendingStage != "FINALIZE" {
		t.Fatalf("unexpected VOU workbench items: %+v", vouByID)
	}
	if !slices.Contains(vouByID[documentIDs[0]].AvailableActions, "check") ||
		!slices.Contains(vouByID[documentIDs[0]].AvailableActions, "edit") {
		t.Fatalf("incomplete VOU draft actions = %v, want edit and check",
			vouByID[documentIDs[0]].AvailableActions)
	}
	vouApprovalPage, err := service.QueryWorkbench(t.Context(), Principal{Permissions: []string{
		"/vou/other-income/query", "/vou/other-income/approve",
	}}, WorkbenchQueryInput{
		Category: WorkbenchCategoryVou, Keyword: documentNos[1], Entities: []string{"other-income"},
		PendingStages: []string{"APPROVE"}, Page: 1, PageSize: 20,
	})
	if err != nil || vouApprovalPage.Total != 1 || len(vouApprovalPage.Items) != 1 ||
		vouApprovalPage.Items[0].DocumentID != documentIDs[1] {
		t.Fatalf("filtered VOU workbench page = %+v, err = %v", vouApprovalPage, err)
	}
}
