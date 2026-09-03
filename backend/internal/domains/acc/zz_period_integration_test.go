//go:build integration

package acc

import (
	"testing"
	"time"

	"github.com/oklog/ulid/v2"
)

func TestZZAccountingPeriodLockUnlockAndVOUWriteControlIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	service := defaultIntegrationACCService(pool)
	book, err := service.CreateBook(t.Context(), CreateBookInput{Name: "期间测试账", StartMonth: "2025-07", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty}, adminID)
	if err != nil {
		t.Fatal(err)
	}
	createApprovedZeroOpening(t, service, book)
	mapping, err := createDCLIntegrationMapping(t, service, dclMappingFixtureInput{
		BookID: book.ID, VouEntity: "other-income", DefaultResult: MappingResultUnpost,
		Definition: MappingDefinition{Rules: []MappingRule{}, Templates: []PostingTemplate{}},
	}, integrationACCActor(t, adminID, "acc-period-mapping-create"))
	if err != nil {
		t.Fatal(err)
	}
	approveIntegrationMapping(t, service, book.ID, "other-income", mapping)
	documentID, approvalEntryID := ulid.Make().String(), ulid.Make().String()
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
	locked, err := service.LockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2025-07", Revision: 0}, adminID)
	if err != nil || locked.State != PeriodStateLocked || locked.Revision != 1 {
		t.Fatalf("lock period = %+v, err=%v", locked, err)
	}
	periods, err := service.QueryPeriods(t.Context(), book.ID, adminID)
	if err != nil || len(periods) != 1 || periods[0].Month != "2025-07" {
		t.Fatalf("periods = %+v, err=%v", periods, err)
	}

	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	allowed, err := service.GuardVOUWrite(t.Context(), tx,
		time.Date(2025, time.August, 20, 0, 0, 0, 0, time.UTC),
		time.Date(2025, time.July, 20, 0, 0, 0, 0, time.UTC),
	)
	_ = tx.Rollback(t.Context())
	if err != nil || allowed {
		t.Fatalf("locked VOU write control = allowed:%v err:%v", allowed, err)
	}

	unlocked, err := service.UnlockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2025-07", Revision: locked.Revision}, adminID)
	if err != nil || unlocked.State != PeriodStateUnlocked || unlocked.Revision != 2 {
		t.Fatalf("unlock period = %+v, err=%v", unlocked, err)
	}
	tx, err = pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	allowed, err = service.GuardVOUWrite(t.Context(), tx, time.Date(2025, time.July, 20, 0, 0, 0, 0, time.UTC))
	_ = tx.Rollback(t.Context())
	if err != nil || !allowed {
		t.Fatalf("unlocked VOU write control = allowed:%v err:%v", allowed, err)
	}

	writer, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	allowed, err = service.GuardVOUWrite(t.Context(), writer, time.Date(2025, time.July, 20, 0, 0, 0, 0, time.UTC))
	if err != nil || !allowed {
		_ = writer.Rollback(t.Context())
		t.Fatalf("open VOU write guard = allowed:%v err:%v", allowed, err)
	}
	type lockResult struct {
		period PeriodView
		err    error
	}
	lockedResult := make(chan lockResult, 1)
	go func() {
		period, lockErr := service.LockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2025-07", Revision: unlocked.Revision}, adminID)
		lockedResult <- lockResult{period: period, err: lockErr}
	}()
	select {
	case result := <-lockedResult:
		_ = writer.Rollback(t.Context())
		t.Fatalf("period lock bypassed VOU write guard: %+v", result)
	case <-time.After(100 * time.Millisecond):
	}
	if err = writer.Rollback(t.Context()); err != nil {
		t.Fatal(err)
	}
	relocked := <-lockedResult
	if relocked.err != nil || relocked.period.Revision != 3 {
		t.Fatalf("relock period = %+v, err=%v", relocked.period, relocked.err)
	}
	if _, err = service.LockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2026-09", Revision: 0}, adminID); !IsKind(err, ErrorConflict) {
		t.Fatalf("non-continuous lock error = %v", err)
	}
}
