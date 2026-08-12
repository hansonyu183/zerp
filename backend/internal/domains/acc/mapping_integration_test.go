//go:build integration

package acc

import (
	"testing"

	"github.com/oklog/ulid/v2"
)

func TestAccountingMappingVersionsAndAccessScopes(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := NewService(pool)
	book, err := service.CreateBook(t.Context(), CreateBookInput{
		Name: "映射账簿", StartMonth: "2026-08", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty,
		QueryUserIDs: []string{queryID}, OperateUserIDs: []string{operatorID},
	}, adminID)
	if err != nil {
		t.Fatalf("create book: %v", err)
	}
	definition := MappingDefinition{Rules: []MappingRule{}, Templates: []PostingTemplate{}}
	if _, err = service.CreateMapping(t.Context(), CreateMappingInput{BookID: book.ID, VouEntity: "sale-order", DefaultResult: MappingResultUnpost, Definition: definition}, queryID); !IsKind(err, ErrorForbidden) {
		t.Fatalf("query user create error = %v, want forbidden", err)
	}
	created, err := service.CreateMapping(t.Context(), CreateMappingInput{BookID: book.ID, VouEntity: "sale-order", DefaultResult: MappingResultUnpost, Definition: definition}, operatorID)
	if err != nil || created.Version != 1 || created.State != MappingStateDraft {
		t.Fatalf("create mapping = %+v, err = %v", created, err)
	}
	if _, err = service.CreateMapping(t.Context(), CreateMappingInput{BookID: book.ID, VouEntity: "sale-order", DefaultResult: MappingResultUnpost, Definition: definition}, operatorID); !IsKind(err, ErrorConflict) {
		t.Fatalf("second draft error = %v, want conflict", err)
	}
	approved, err := service.ApproveMapping(t.Context(), book.ID, created.ID, created.Revision, operatorID)
	if err != nil || approved.State != MappingStateApproved || approved.Revision != created.Revision+1 {
		t.Fatalf("approve mapping = %+v, err = %v", approved, err)
	}
	page, err := service.QueryMappings(t.Context(), QueryMappingsInput{BookID: book.ID, Page: 1, PageSize: 20}, queryID)
	if err != nil || page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("query mapping = %+v, err = %v", page, err)
	}
	second, err := service.CreateMapping(t.Context(), CreateMappingInput{BookID: book.ID, VouEntity: "sale-order", DefaultResult: MappingResultUnpost, Definition: definition}, operatorID)
	if err != nil || second.Version != 2 {
		t.Fatalf("create next version = %+v, err = %v", second, err)
	}
	if _, err = pool.Exec(t.Context(), `
		INSERT INTO acc_vouchers (
			id, book_id, source_type, source_id, source_entity, source_revision,
			source_document_no, business_date, mapping_version_id, created_by
		) VALUES ($1, $2, 'VOU', $3, 'sale-order', 1, 'SO-1', '2026-08-12', $4, $5)
	`, ulid.Make().String(), book.ID, ulid.Make().String(), approved.ID, adminID); err != nil {
		t.Fatalf("reference approved mapping: %v", err)
	}
	if _, err = service.UnapproveMapping(t.Context(), book.ID, approved.ID, approved.Revision, operatorID); !IsKind(err, ErrorConflict) {
		t.Fatalf("referenced mapping unapprove error = %v, want conflict", err)
	}
}
