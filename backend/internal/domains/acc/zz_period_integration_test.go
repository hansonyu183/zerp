//go:build integration

package acc

import (
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/oklog/ulid/v2"
)

func TestZZAccountingPeriodLockUnlockAndVOUDatabaseBoundaryIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := defaultIntegrationACCService(pool)
	book, err := service.CreateBook(t.Context(), CreateBookInput{Name: "期间测试账", StartMonth: "2025-07", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	createApprovedZeroOpening(t, service, book)
	mapping, err := service.CreateMapping(t.Context(), CreateMappingInput{
		BookID: book.ID, VouEntity: "other-income", DefaultResult: MappingResultUnpost,
		Definition: MappingDefinition{Rules: []MappingRule{}, Templates: []PostingTemplate{}},
	}, integrationACCActor(t, adminID, "acc-period-mapping-create"))
	if err != nil {
		t.Fatal(err)
	}
	approveIntegrationMapping(t, service, book.ID, "other-income", mapping)
	documentID, approvalEntryID := ulid.Make().String(), ulid.Make().String()
	attachedFileID, pendingFileID := ulid.Make().String(), ulid.Make().String()
	setupTx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	_, err = setupTx.Exec(t.Context(), `INSERT INTO approval_entries(
		id,domain,entity,subject_id,status,revision,created_by,created_at,updated_by,updated_at,
		submitted_by,submitted_at,approved_by,approved_at
	) VALUES($1,'vou','other-income',$2,'APPROVED',3,$3,now(),$4,now(),$3,now(),$4,now())`,
		approvalEntryID, documentID, adminID, operatorID)
	if err == nil {
		_, err = setupTx.Exec(t.Context(), `INSERT INTO vou_documents (
			id, entity, document_no, approval_entry_id, business_date, currency, total_amount_cents
		) VALUES ($1, 'other-income', $2, $3, DATE '2025-07-20', 'CNY', 100)`, documentID, "OIN-20250720-0000", approvalEntryID)
	}
	if err != nil {
		_ = setupTx.Rollback(t.Context())
		t.Fatal(err)
	}
	_, err = setupTx.Exec(t.Context(), `INSERT INTO vou_other_income_details(
		document_id,source_name,fund_account_object_id,fund_account_approval_entry_id,fund_account_code,fund_account_name
	) VALUES($1,'期间附件测试',$2,$3,'CASH','现金')`, documentID, ulid.Make().String(), ulid.Make().String())
	if err != nil {
		_ = setupTx.Rollback(t.Context())
		t.Fatal(err)
	}
	if err = setupTx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	for index, fileID := range []string{attachedFileID, pendingFileID} {
		letter := string(rune('a' + index))
		_, err = pool.Exec(t.Context(), `INSERT INTO vou_files(
			id,storage_key,original_name,content_type,declared_size,sha256_hex,upload_token_hash,upload_expires_at,created_by
		) VALUES($1,$2,$3,'application/pdf',1,$4,$5,now()+interval '1 hour',$6)`, fileID, "period-lock/"+fileID, "period.pdf", strings.Repeat(letter, 64), strings.Repeat(string(rune('c'+index)), 64), adminID)
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO vou_document_attachments(document_id,file_id,created_by) VALUES($1,$2,$3)`, documentID, attachedFileID, adminID); err != nil {
		t.Fatal(err)
	}

	locked, err := service.LockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2025-07", Revision: 0}, adminID)
	if err != nil || locked.State != PeriodStateLocked || locked.Revision != 1 {
		t.Fatalf("lock period = %+v, err=%v", locked, err)
	}
	periods, err := service.QueryPeriods(t.Context(), book.ID, adminID)
	if err != nil || len(periods) != 1 || periods[0].Month != "2025-07" {
		t.Fatalf("periods = %+v, err=%v", periods, err)
	}

	lockedDocumentID, lockedEntryID := ulid.Make().String(), ulid.Make().String()
	if _, err = pool.Exec(t.Context(), `INSERT INTO approval_entries(
		id,domain,entity,subject_id,status,revision,created_by,created_at,updated_by,updated_at
	) VALUES($1,'vou','other-income',$2,'DRAFT',1,$3,now(),$3,now())`, lockedEntryID, lockedDocumentID, adminID); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(t.Context(), `INSERT INTO vou_documents (
		id, entity, document_no, approval_entry_id, business_date, currency, total_amount_cents
	) VALUES ($1, 'other-income', $2, $3, DATE '2025-07-20', 'CNY', 100)`, lockedDocumentID, "OIN-20250720-0001", lockedEntryID)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Message != "accounting period is locked" {
		t.Fatalf("locked VOU write error = %#v", err)
	}
	_, err = pool.Exec(t.Context(), `INSERT INTO vou_document_attachments(document_id,file_id,created_by) VALUES($1,$2,$3)`, documentID, pendingFileID, adminID)
	if !errors.As(err, &pgErr) || pgErr.Message != "accounting period is locked" {
		t.Fatalf("locked VOU attachment insert error = %#v", err)
	}
	_, err = pool.Exec(t.Context(), `DELETE FROM vou_document_attachments WHERE document_id=$1 AND file_id=$2`, documentID, attachedFileID)
	if !errors.As(err, &pgErr) || pgErr.Message != "accounting period is locked" {
		t.Fatalf("locked VOU attachment delete error = %#v", err)
	}

	unlocked, err := service.UnlockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2025-07", Revision: locked.Revision}, adminID)
	if err != nil || unlocked.State != PeriodStateUnlocked || unlocked.Revision != 2 {
		t.Fatalf("unlock period = %+v, err=%v", unlocked, err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	unlockedDocumentID, unlockedEntryID := ulid.Make().String(), ulid.Make().String()
	_, err = tx.Exec(t.Context(), `INSERT INTO approval_entries(
		id,domain,entity,subject_id,status,revision,created_by,created_at,updated_by,updated_at
	) VALUES($1,'vou','other-income',$2,'DRAFT',1,$3,now(),$3,now())`, unlockedEntryID, unlockedDocumentID, adminID)
	if err == nil {
		_, err = tx.Exec(t.Context(), `INSERT INTO vou_documents (
		id, entity, document_no, approval_entry_id, business_date, currency, total_amount_cents
	) VALUES ($1, 'other-income', $2, $3, DATE '2025-07-20', 'CNY', 100)`, unlockedDocumentID, "OIN-20250720-0002", unlockedEntryID)
	}
	_ = tx.Rollback(t.Context())
	if err != nil {
		t.Fatalf("unlocked VOU write rejected: %v", err)
	}

	relocked, err := service.LockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2025-07", Revision: unlocked.Revision}, adminID)
	if err != nil || relocked.Revision != 3 {
		t.Fatalf("relock period = %+v, err=%v", relocked, err)
	}
	if _, err = service.LockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2026-09", Revision: 0}, adminID); !IsKind(err, ErrorConflict) {
		t.Fatalf("non-continuous lock error = %v", err)
	}
}
