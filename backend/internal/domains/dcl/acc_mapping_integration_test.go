//go:build integration

package dcl

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	accdomain "github.com/hansonyu183/zerp/backend/internal/domains/acc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type accMappingReferenceResolver struct{}

func (accMappingReferenceResolver) ValidateHistoricalReference(context.Context, pgx.Tx, string, string, string) (bobdomain.EffectiveReference, error) {
	return bobdomain.EffectiveReference{}, nil
}

const (
	accMappingCreatorID  = "01JDCM00000000000000000001"
	accMappingReviewerID = "01JDCM00000000000000000002"
)

func resetAccMappingIntegrationData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	truncate := func(ctx context.Context) error {
		_, err := pool.Exec(ctx, `
		TRUNCATE acc_period_balances, acc_inventory_cost_allocations,
			acc_opening_containers, acc_opening_bills, acc_opening_assets,
			acc_container_entries, acc_bill_book_values, acc_bills,
			acc_asset_book_values, acc_assets, acc_register_events,
			acc_periods, acc_inventory_entries, acc_voucher_lines,
			acc_opening_lines, acc_openings, acc_vouchers,
			dcl_acc_mapping_versions, acc_mappings, acc_subject_usages,
			acc_subject_dimensions, acc_subjects, acc_book_user_scopes,
			acc_books CASCADE
	`)
		return err
	}
	if err := truncate(t.Context()); err != nil {
		t.Fatalf("reset ACC mapping integration data: %v", err)
	}
	t.Cleanup(func() {
		if err := truncate(context.Background()); err != nil {
			t.Errorf("clean ACC mapping integration data: %v", err)
		}
	})
	if _, err := pool.Exec(t.Context(), `DELETE FROM app_users WHERE id IN ($1,$2)`, accMappingCreatorID, accMappingReviewerID); err != nil {
		t.Fatalf("reset ACC mapping integration users: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO app_users(id,username,display_name,password_hash,status,password_changed_at,created_by,updated_by)
		VALUES
			($1,'dcl-mapping-creator','映射申报人','hash','ENABLED',now(),$1,$1),
			($2,'dcl-mapping-reviewer','映射审核人','hash','ENABLED',now(),$1,$1)
	`, accMappingCreatorID, accMappingReviewerID); err != nil {
		t.Fatalf("seed ACC mapping integration users: %v", err)
	}
}

func accMappingTestData(t *testing.T) AccMappingData {
	t.Helper()
	definition, err := json.Marshal(accdomain.MappingDefinition{Rules: []accdomain.MappingRule{}, Templates: []accdomain.PostingTemplate{}})
	if err != nil {
		t.Fatal(err)
	}
	return AccMappingData{DefaultResult: accdomain.MappingResultUnpost, Definition: definition}
}

func invalidOverlappingAccMappingTestData(t *testing.T) AccMappingData {
	t.Helper()
	definition, err := json.Marshal(accdomain.MappingDefinition{
		Rules: []accdomain.MappingRule{
			{Conditions: []accdomain.MappingCondition{{Field: "currency", Operator: "EQ", Values: []string{"CNY"}}}, Result: accdomain.MappingResultUnpost},
			{Conditions: []accdomain.MappingCondition{{Field: "status", Operator: "EQ", Values: []string{"APPROVED"}}}, Result: accdomain.MappingResultUnpost},
		},
		Templates: []accdomain.PostingTemplate{},
	})
	if err != nil {
		t.Fatal(err)
	}
	return AccMappingData{DefaultResult: accdomain.MappingResultUnpost, Definition: definition}
}

func submitApproveAccMapping(t *testing.T, service *AccMappingService, mutation AccMappingMutation, actor approval.Actor, reviewer approval.Actor) AccMappingMutation {
	t.Helper()
	input := AccMappingVersionInput{BookID: mutation.BookID, VouEntity: mutation.VouEntity, ApprovalEntryID: mutation.Approval.ApprovalEntryID, ApprovalRevision: mutation.Approval.Revision}
	pending, err := service.Submit(t.Context(), input, actor)
	if err != nil {
		t.Fatalf("submit accounting mapping: %v", err)
	}
	input.ApprovalRevision = pending.Approval.Revision
	approved, err := service.Approve(t.Context(), input, reviewer)
	if err != nil {
		t.Fatalf("approve accounting mapping: %v", err)
	}
	return approved
}

func TestAccMappingDeclarationSwitchFallbackAndExactVoucherBlockerIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	resetAccMappingIntegrationData(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	accounting := accdomain.NewService(pool, accMappingReferenceResolver{}, authorizer, bus)
	service := NewAccMappingService(pool, accounting, authorizer, bus)
	creator := dclActor(t, accMappingCreatorID, "mapping-creator")
	reviewer := dclActor(t, accMappingReviewerID, "mapping-reviewer")
	book, err := accounting.CreateBook(t.Context(), accdomain.CreateBookInput{
		Name: "DCL 会计映射", StartMonth: "2026-08", BaseCurrency: "CNY",
		SubjectTemplate: accdomain.SubjectTemplateEmpty,
		QueryUserIDs:    []string{accMappingCreatorID, accMappingReviewerID},
		OperateUserIDs:  []string{accMappingCreatorID, accMappingReviewerID},
	}, accMappingCreatorID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Query(t.Context(), AccMappingQueryInput{BookID: book.ID, Page: 1, PageSize: 100, Filters: AccMappingQueryFilters{VouEntity: "sale-order"}}, creator); err != nil {
		var queryErr *DomainError
		if errors.As(err, &queryErr) {
			t.Fatalf("query empty accounting mappings: %v (cause: %v)", err, queryErr.Cause)
		}
		t.Fatalf("query empty accounting mappings: %v", err)
	}
	if _, err = service.Create(t.Context(), AccMappingCreateInput{BookID: book.ID, VouEntity: "sale-order", Data: invalidOverlappingAccMappingTestData(t)}, creator); err == nil {
		t.Fatal("create should reject an overlapping mapping definition")
	}

	v1, err := service.Create(t.Context(), AccMappingCreateInput{BookID: book.ID, VouEntity: "sale-order", Data: accMappingTestData(t)}, creator)
	if err != nil {
		t.Fatal(err)
	}
	v1 = submitApproveAccMapping(t, service, v1, creator, reviewer)
	v2, err := service.CreateNext(t.Context(), AccMappingVersionInput{BookID: book.ID, VouEntity: "sale-order", ApprovalEntryID: v1.Approval.ApprovalEntryID, ApprovalRevision: v1.Approval.Revision}, creator)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(t.Context(), `UPDATE dcl_acc_mapping_versions SET definition=$2 WHERE approval_entry_id=$1`, v2.Approval.ApprovalEntryID, invalidOverlappingAccMappingTestData(t).Definition); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Submit(t.Context(), AccMappingVersionInput{BookID: book.ID, VouEntity: "sale-order", ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision}, creator); err == nil {
		t.Fatal("submit should independently reject an invalid stored mapping definition")
	}
	v2, err = service.Save(t.Context(), AccMappingSaveInput{BookID: book.ID, VouEntity: "sale-order", ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Data: accMappingTestData(t)}, creator)
	if err != nil {
		t.Fatal(err)
	}
	v2 = submitApproveAccMapping(t, service, v2, creator, reviewer)
	current, err := accounting.GetMapping(t.Context(), book.ID, "sale-order", creator)
	if err != nil || current.Approval.ApprovalEntryID != v2.Approval.ApprovalEntryID {
		t.Fatalf("V2 current=%+v err=%v", current, err)
	}

	voucherV1 := ulid.Make().String()
	if _, err = pool.Exec(t.Context(), `INSERT INTO acc_vouchers(id,book_id,source_type,source_id,source_entity,source_revision,source_document_no,business_date,mapping_approval_entry_id,created_by) VALUES($1,$2,'VOU',$3,'sale-order',1,'SO-V1','2026-08-12',$4,$5)`, voucherV1, book.ID, ulid.Make().String(), v1.Approval.ApprovalEntryID, accMappingCreatorID); err != nil {
		t.Fatal(err)
	}
	unapproved, err := service.Unapprove(t.Context(), AccMappingReviewInput{BookID: book.ID, VouEntity: "sale-order", ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "回落 V1"}, reviewer)
	if err != nil {
		t.Fatalf("unapprove V2 with only V1 referenced: %v", err)
	}
	current, err = accounting.GetMapping(t.Context(), book.ID, "sale-order", creator)
	if err != nil || current.Approval.ApprovalEntryID != v1.Approval.ApprovalEntryID {
		t.Fatalf("V1 fallback=%+v err=%v", current, err)
	}
	var storedVoucherID string
	if err = pool.QueryRow(t.Context(), `SELECT id FROM acc_vouchers WHERE id=$1`, voucherV1).Scan(&storedVoucherID); err != nil || storedVoucherID != voucherV1 {
		t.Fatalf("voucher identity changed: id=%q err=%v", storedVoucherID, err)
	}

	v2, err = service.Approve(t.Context(), AccMappingVersionInput{BookID: book.ID, VouEntity: "sale-order", ApprovalEntryID: unapproved.Approval.ApprovalEntryID, ApprovalRevision: unapproved.Approval.Revision}, reviewer)
	if err != nil {
		t.Fatalf("reapprove V2: %v", err)
	}
	voucherV2 := ulid.Make().String()
	postingTx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer postingTx.Rollback(t.Context()) //nolint:errcheck
	if _, err = dbsqlc.New(postingTx).LockApprovedAccountingMappingVersion(t.Context(), v2.Approval.ApprovalEntryID); err != nil {
		t.Fatal(err)
	}
	unapproveResult := make(chan error, 1)
	go func() {
		_, unapproveErr := service.Unapprove(context.Background(), AccMappingReviewInput{BookID: book.ID, VouEntity: "sale-order", ApprovalEntryID: v2.Approval.ApprovalEntryID, ApprovalRevision: v2.Approval.Revision, Reason: "应被阻断"}, reviewer)
		unapproveResult <- unapproveErr
	}()
	select {
	case earlyErr := <-unapproveResult:
		t.Fatalf("unapprove escaped the posting mapping lock: %v", earlyErr)
	case <-time.After(100 * time.Millisecond):
	}
	if _, err = postingTx.Exec(t.Context(), `INSERT INTO acc_vouchers(id,book_id,source_type,source_id,source_entity,source_revision,source_document_no,business_date,mapping_approval_entry_id,created_by) VALUES($1,$2,'VOU',$3,'sale-order',1,'SO-V2','2026-08-13',$4,$5)`, voucherV2, book.ID, ulid.Make().String(), v2.Approval.ApprovalEntryID, accMappingCreatorID); err != nil {
		t.Fatal(err)
	}
	if err = postingTx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	err = <-unapproveResult
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.ErrorKey != "accounting_mapping_voucher_blocked" {
		t.Fatalf("exact V2 voucher blocker err=%v", err)
	}
}

type failingAccMappingHandler struct{ real *accdomain.Service }

func (h failingAccMappingHandler) CheckMappingAccess(ctx context.Context, tx pgx.Tx, bookID, actorID string, operate bool) (bool, error) {
	return h.real.CheckMappingAccess(ctx, tx, bookID, actorID, operate)
}

func (h failingAccMappingHandler) ValidateMapping(ctx context.Context, tx pgx.Tx, bookID, vouEntity, defaultResult string, definition json.RawMessage) error {
	return h.real.ValidateMapping(ctx, tx, bookID, vouEntity, defaultResult, definition)
}

func (failingAccMappingHandler) ValidateAndRegisterMapping(context.Context, pgx.Tx, string, string, string, string, json.RawMessage) error {
	return errors.New("forced ACC registration failure")
}

func (h failingAccMappingHandler) ReleaseMappingUsages(ctx context.Context, tx pgx.Tx, approvalEntryID string) error {
	return h.real.ReleaseMappingUsages(ctx, tx, approvalEntryID)
}

func TestAccMappingApprovalRollsBackWhenACCRegistrationFailsIntegration(t *testing.T) {
	pool := dclIntegrationPool(t)
	resetDCLIntegrationData(t, pool)
	resetAccMappingIntegrationData(t, pool)
	authorizer := authorization.Func(nil)
	bus := txevent.NewBus()
	accounting := accdomain.NewService(pool, accMappingReferenceResolver{}, authorizer, bus)
	service := NewAccMappingService(pool, failingAccMappingHandler{real: accounting}, authorizer, bus)
	creator := dclActor(t, accMappingCreatorID, "rollback-creator")
	reviewer := dclActor(t, accMappingReviewerID, "rollback-reviewer")
	book, err := accounting.CreateBook(t.Context(), accdomain.CreateBookInput{Name: "失败回滚账簿", StartMonth: "2026-08", BaseCurrency: "CNY", SubjectTemplate: accdomain.SubjectTemplateEmpty, QueryUserIDs: []string{accMappingCreatorID, accMappingReviewerID}, OperateUserIDs: []string{accMappingCreatorID, accMappingReviewerID}}, accMappingCreatorID)
	if err != nil {
		t.Fatal(err)
	}
	draft, err := service.Create(t.Context(), AccMappingCreateInput{BookID: book.ID, VouEntity: "purchase-order", Data: accMappingTestData(t)}, creator)
	if err != nil {
		t.Fatal(err)
	}
	pending, err := service.Submit(t.Context(), AccMappingVersionInput{BookID: book.ID, VouEntity: "purchase-order", ApprovalEntryID: draft.Approval.ApprovalEntryID, ApprovalRevision: draft.Approval.Revision}, creator)
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Approve(t.Context(), AccMappingVersionInput{BookID: book.ID, VouEntity: "purchase-order", ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, reviewer)
	if err == nil {
		t.Fatal("approve should fail")
	}
	var status string
	var revision int64
	if err = pool.QueryRow(t.Context(), `SELECT status,revision FROM approval_entries WHERE id=$1`, pending.Approval.ApprovalEntryID).Scan(&status, &revision); err != nil {
		t.Fatal(err)
	}
	if status != string(approval.StatusPending) || revision != pending.Approval.Revision {
		t.Fatalf("approval transaction did not roll back: status=%s revision=%d", status, revision)
	}
}
