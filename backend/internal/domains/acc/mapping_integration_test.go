//go:build integration

package acc

import (
	"errors"
	"testing"

	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/oklog/ulid/v2"
)

func TestAccountingMappingCentralVersioningCandidateAndExactBlockerIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := integrationACCService(pool, txevent.NewBus())
	dclService := testDCLAccMappingService(service)
	operator := integrationACCActor(t, operatorID, "acc-mapping-operator")
	reviewer := integrationACCActor(t, adminID, "acc-mapping-reviewer")
	book, err := service.CreateBook(t.Context(), CreateBookInput{Name: "中央版本映射", StartMonth: "2026-08", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty, QueryUserIDs: []string{operatorID}, OperateUserIDs: []string{operatorID}}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	definition := MappingDefinition{Rules: []MappingRule{}, Templates: []PostingTemplate{}}
	first, err := dclService.Create(t.Context(), dcldomain.AccMappingCreateInput{BookID: book.ID, VouEntity: "sale-order", Data: dclMappingData(t, MappingResultUnpost, definition)}, operator)
	if err != nil || first.Approval.VersionNo != 1 || first.Approval.Status != approval.StatusDraft {
		t.Fatalf("create=%+v err=%v", first, err)
	}
	firstInput := dcldomain.AccMappingVersionInput{BookID: book.ID, VouEntity: "sale-order", ApprovalEntryID: first.Approval.ApprovalEntryID, ApprovalRevision: first.Approval.Revision}
	first, err = dclService.Submit(t.Context(), firstInput, operator)
	if err != nil {
		t.Fatal(err)
	}
	firstInput.ApprovalRevision = first.Approval.Revision
	first, err = dclService.Approve(t.Context(), firstInput, reviewer)
	if err != nil || first.Approval.Status != approval.StatusApproved {
		t.Fatalf("approve=%+v err=%v", first, err)
	}

	second, err := dclService.CreateNext(t.Context(), dcldomain.AccMappingVersionInput{BookID: book.ID, VouEntity: "sale-order", ApprovalEntryID: first.Approval.ApprovalEntryID, ApprovalRevision: first.Approval.Revision}, operator)
	if err != nil || second.Approval.VersionNo != 2 || second.Approval.Status != approval.StatusDraft {
		t.Fatalf("next=%+v err=%v", second, err)
	}
	if _, err = dclService.CreateNext(t.Context(), dcldomain.AccMappingVersionInput{BookID: book.ID, VouEntity: "sale-order", ApprovalEntryID: first.Approval.ApprovalEntryID, ApprovalRevision: first.Approval.Revision}, operator); !isDCLMappingConflict(err) {
		t.Fatalf("second open candidate err=%v", err)
	}
	current, err := service.GetMapping(t.Context(), book.ID, "sale-order", operator)
	if err != nil || current.Approval.ApprovalEntryID != first.Approval.ApprovalEntryID {
		t.Fatalf("current=%+v err=%v", current, err)
	}
	if _, err = dclService.Unapprove(t.Context(), dcldomain.AccMappingReviewInput{BookID: book.ID, VouEntity: "sale-order", ApprovalEntryID: first.Approval.ApprovalEntryID, ApprovalRevision: first.Approval.Revision, Reason: "重开"}, reviewer); !isDCLMappingConflict(err) {
		t.Fatalf("unapprove with candidate err=%v", err)
	}

	if err = dclService.Delete(t.Context(), dcldomain.AccMappingDeleteInput{BookID: book.ID, VouEntity: "sale-order", ApprovalEntryID: second.Approval.ApprovalEntryID, ApprovalRevision: second.Approval.Revision}, operator); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO acc_vouchers(id,book_id,source_type,source_id,source_entity,source_revision,source_document_no,business_date,mapping_approval_entry_id,created_by) VALUES($1,$2,'VOU',$3,'sale-order',1,'SO-1','2026-08-12',$4,$5)`, ulid.Make().String(), book.ID, ulid.Make().String(), first.Approval.ApprovalEntryID, adminID); err != nil {
		t.Fatal(err)
	}
	if _, err = dclService.Unapprove(t.Context(), dcldomain.AccMappingReviewInput{BookID: book.ID, VouEntity: "sale-order", ApprovalEntryID: first.Approval.ApprovalEntryID, ApprovalRevision: first.Approval.Revision, Reason: "重开"}, reviewer); !isDCLMappingConflict(err) {
		t.Fatalf("referenced exact entry err=%v", err)
	}
}

func isDCLMappingConflict(err error) bool {
	var domainErr *dcldomain.DomainError
	return errors.As(err, &domainErr) && domainErr.Kind == dcldomain.ErrorConflict
}
