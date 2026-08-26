//go:build integration

package acc

import (
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/oklog/ulid/v2"
)

func TestAccountingMappingCentralVersioningCandidateAndExactBlockerIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := integrationACCService(pool, txevent.NewBus())
	operator := integrationACCActor(t, operatorID, "acc-mapping-operator")
	reviewer := integrationACCActor(t, adminID, "acc-mapping-reviewer")
	book, err := service.CreateBook(t.Context(), CreateBookInput{Name: "中央版本映射", StartMonth: "2026-08", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty, QueryUserIDs: []string{operatorID}, OperateUserIDs: []string{operatorID}}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	definition := MappingDefinition{Rules: []MappingRule{}, Templates: []PostingTemplate{}}
	first, err := service.CreateMapping(t.Context(), CreateMappingInput{BookID: book.ID, VouEntity: "sale-order", DefaultResult: MappingResultUnpost, Definition: definition}, operator)
	if err != nil || first.Approval.VersionNo != 1 || first.Approval.Status != approval.StatusDraft {
		t.Fatalf("create=%+v err=%v", first, err)
	}
	first, err = service.SubmitMapping(t.Context(), mappingInput(book.ID, "sale-order", first), operator)
	if err != nil {
		t.Fatal(err)
	}
	first, err = service.ApproveMapping(t.Context(), mappingInput(book.ID, "sale-order", first), reviewer)
	if err != nil || first.Approval.Status != approval.StatusApproved {
		t.Fatalf("approve=%+v err=%v", first, err)
	}

	second, err := service.CreateNextMappingVersion(t.Context(), book.ID, "sale-order", operator)
	if err != nil || second.Approval.VersionNo != 2 || second.Approval.Status != approval.StatusDraft {
		t.Fatalf("next=%+v err=%v", second, err)
	}
	if _, err = service.CreateNextMappingVersion(t.Context(), book.ID, "sale-order", operator); !IsKind(err, ErrorConflict) {
		t.Fatalf("second open candidate err=%v", err)
	}
	preferred, err := service.GetMapping(t.Context(), book.ID, "sale-order", "", operator)
	if err != nil || preferred.Approval.ApprovalEntryID != second.Approval.ApprovalEntryID {
		t.Fatalf("preferred=%+v err=%v", preferred, err)
	}
	exactFirst, err := service.GetMapping(t.Context(), book.ID, "sale-order", first.Approval.ApprovalEntryID, operator)
	if err != nil || exactFirst.Approval.VersionNo != 1 {
		t.Fatalf("exact first=%+v err=%v", exactFirst, err)
	}
	if _, err = service.UnapproveMapping(t.Context(), MappingReasonInput{MappingVersionInput: mappingInput(book.ID, "sale-order", first), Reason: "重开"}, reviewer); !IsKind(err, ErrorConflict) {
		t.Fatalf("unapprove with candidate err=%v", err)
	}

	if err = service.DeleteMappingVersion(t.Context(), mappingInput(book.ID, "sale-order", second), operator); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO acc_vouchers(id,book_id,source_type,source_id,source_entity,source_revision,source_document_no,business_date,mapping_approval_entry_id,created_by) VALUES($1,$2,'VOU',$3,'sale-order',1,'SO-1','2026-08-12',$4,$5)`, ulid.Make().String(), book.ID, ulid.Make().String(), first.Approval.ApprovalEntryID, adminID); err != nil {
		t.Fatal(err)
	}
	if _, err = service.UnapproveMapping(t.Context(), MappingReasonInput{MappingVersionInput: mappingInput(book.ID, "sale-order", first), Reason: "重开"}, reviewer); !IsKind(err, ErrorConflict) {
		t.Fatalf("referenced exact entry err=%v", err)
	}
}

func mappingInput(bookID, entity string, view MappingView) MappingVersionInput {
	return MappingVersionInput{BookID: bookID, VouEntity: entity, ApprovalEntryID: view.Approval.ApprovalEntryID, Revision: view.Approval.Revision}
}
