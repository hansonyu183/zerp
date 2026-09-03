//go:build integration

package acc

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/domains/wfl"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/integrations/workflowactions"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"
)

func TestZZLockedPeriodRejectsVOUPublicWritesAndUnlockRestoresIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	accounting := defaultIntegrationACCService(pool)
	book, err := accounting.CreateBook(t.Context(), CreateBookInput{
		Name: "VOU 锁月公共服务", StartMonth: "2025-07", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty,
	}, adminID)
	if err != nil {
		t.Fatalf("create accounting book: %v", err)
	}
	createApprovedZeroOpening(t, accounting, book)
	mapping, err := createDCLIntegrationMapping(t, accounting, dclMappingFixtureInput{
		BookID: book.ID, VouEntity: voudomain.EntityOtherIncome, DefaultResult: MappingResultUnpost,
		Definition: MappingDefinition{Rules: []MappingRule{}, Templates: []PostingTemplate{}},
	}, integrationACCActor(t, adminID, "acc-period-vou-mapping-create"))
	if err != nil {
		t.Fatalf("create other-income mapping: %v", err)
	}
	approveIntegrationMapping(t, accounting, book.ID, voudomain.EntityOtherIncome, mapping)

	bus := txevent.NewBus()
	business := newAccountingIntegrationBOBService(pool, bus)
	auxiliary := auxdomain.NewService(pool)
	operating := createApprovedAccountingReference(t, business, bobdomain.EntityOperatingEntity, bobdomain.CreateDetailInput{Name: "VOU 锁月经营主体"})
	handler := createApprovedAccountingEmployee(t, pool, business, bus, operating.ObjectID, "VOU 锁月经办人", "acc-period-vou-employee")
	fund := createApprovedAccountingReference(t, business, bobdomain.EntityFundAccount, bobdomain.CreateDetailInput{Name: "VOU 锁月账户", Currency: "CNY", OperatingEntityID: operating.ObjectID})
	vouchers, err := voudomain.NewService(pool, business, auxiliaryrefs.New(auxiliary), bus,
		voudomain.AttachmentOptions{Root: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)),
		voudomain.WithPeriodWriteControl(accounting), voudomain.WithApprovalAuthorizer(authorization.Func(nil)),
	)
	if err != nil {
		t.Fatalf("new VOU service: %v", err)
	}
	actor := trustedAccountingActor(t, "acc-period-vou-actor")
	draft := func(businessDate string) voudomain.DraftInput {
		return voudomain.DraftInput{
			BusinessDate: businessDate, Currency: "CNY", SourceName: "锁月收入",
			FundAccount: &fund, Handler: &handler, Amount: "60.00",
		}
	}
	created, err := vouchers.Create(t.Context(), voudomain.EntityOtherIncome, voudomain.CreateInput{Data: draft("2025-07-20")}, actor)
	if err != nil {
		t.Fatalf("create unlocked VOU draft: %v", err)
	}
	augustCreated, err := vouchers.Create(t.Context(), voudomain.EntityOtherIncome, voudomain.CreateInput{Data: draft("2025-08-02")}, actor)
	if err != nil {
		t.Fatalf("create unlocked August VOU draft: %v", err)
	}
	attachmentBody := []byte("%PDF-1.7\n")
	attachmentHash := sha256.Sum256(attachmentBody)
	readyAttachment, err := vouchers.InitiateAttachment(t.Context(), voudomain.EntityOtherIncome, voudomain.AttachmentInitiateInput{
		DocumentID: created.DocumentID, Revision: created.Approval.Revision, FileName: "before-lock.pdf", ContentType: "application/pdf",
		Size: int64(len(attachmentBody)), SHA256: hex.EncodeToString(attachmentHash[:]),
	}, actor)
	if err != nil {
		t.Fatalf("create attachment before lock: %v", err)
	}
	if err = vouchers.Upload(t.Context(), strings.TrimPrefix(readyAttachment.UploadURL, "/files/attachments/upload/"), bytes.NewReader(attachmentBody), int64(len(attachmentBody)), "application/pdf", ""); err != nil {
		t.Fatalf("upload attachment before lock: %v", err)
	}
	submitted, err := vouchers.Submit(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: readyAttachment.Revision,
	}, trustedAccountingActor(t, "acc-period-vou-submit"))
	if err != nil {
		t.Fatalf("submit July VOU before lock: %v", err)
	}
	approved, err := vouchers.Approve(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: submitted.Approval.Revision,
	}, trustedAccountingActor(t, "acc-period-vou-approve"))
	if err != nil {
		t.Fatalf("approve July VOU before lock: %v", err)
	}
	var documentsBeforeLock int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM vou_documents WHERE entity=$1`, voudomain.EntityOtherIncome).Scan(&documentsBeforeLock); err != nil {
		t.Fatalf("count VOU documents before lock: %v", err)
	}

	locked, err := accounting.LockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2025-07", Revision: 0}, adminID)
	if err != nil {
		t.Fatalf("lock July through ACC service: %v", err)
	}
	assertLocked := func(t *testing.T, err error) {
		t.Helper()
		var domainErr *voudomain.DomainError
		if !errors.As(err, &domainErr) || domainErr.Kind != voudomain.ErrorConflict ||
			domainErr.ErrorKey != "conflict" || domainErr.Message != "accounting period is locked" {
			t.Fatalf("locked VOU write error = %#v", err)
		}
		data, ok := domainErr.Data.(map[string]any)
		if !ok || data["locked"] != true {
			t.Fatalf("locked VOU error data = %#v", domainErr.Data)
		}
	}
	revision := approved.Approval.Revision
	lockedCases := []struct {
		name string
		call func() error
	}{
		{"create", func() error {
			_, callErr := vouchers.Create(t.Context(), voudomain.EntityOtherIncome, voudomain.CreateInput{Data: draft("2025-07-21")}, actor)
			return callErr
		}},
		{"save old to new month", func() error {
			_, callErr := vouchers.Save(t.Context(), voudomain.EntityOtherIncome, voudomain.SaveInput{DocumentID: created.DocumentID, Revision: revision, Data: draft("2025-08-01")}, actor)
			return callErr
		}},
		{"save new to old month", func() error {
			_, callErr := vouchers.Save(t.Context(), voudomain.EntityOtherIncome, voudomain.SaveInput{DocumentID: augustCreated.DocumentID, Revision: augustCreated.Approval.Revision, Data: draft("2025-07-01")}, actor)
			return callErr
		}},
		{"delete", func() error {
			_, callErr := vouchers.Delete(t.Context(), voudomain.EntityOtherIncome, voudomain.DeleteInput{DocumentID: created.DocumentID, Revision: revision, Reason: "锁月"}, actor)
			return callErr
		}},
		{"submit", func() error {
			_, callErr := vouchers.Submit(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{DocumentID: created.DocumentID, Revision: revision}, actor)
			return callErr
		}},
		{"reject", func() error {
			_, callErr := vouchers.Reject(t.Context(), voudomain.EntityOtherIncome, voudomain.ReverseInput{DocumentID: created.DocumentID, Revision: revision, Reason: "锁月"}, actor)
			return callErr
		}},
		{"approve", func() error {
			_, callErr := vouchers.Approve(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{DocumentID: created.DocumentID, Revision: revision}, actor)
			return callErr
		}},
		{"unsubmit", func() error {
			_, callErr := vouchers.Unsubmit(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{DocumentID: created.DocumentID, Revision: revision}, actor)
			return callErr
		}},
		{"unapprove", func() error {
			_, callErr := vouchers.Unapprove(t.Context(), voudomain.EntityOtherIncome, voudomain.ReverseInput{DocumentID: created.DocumentID, Revision: revision, Reason: "锁月"}, actor)
			return callErr
		}},
		{"attach final link", func() error {
			_, callErr := vouchers.InitiateAttachment(t.Context(), voudomain.EntityOtherIncome, voudomain.AttachmentInitiateInput{
				DocumentID: created.DocumentID, Revision: revision, FileName: "locked.pdf", ContentType: "application/pdf", Size: 1, SHA256: strings.Repeat("a", 64),
			}, actor)
			return callErr
		}},
		{"remove attachment", func() error {
			_, callErr := vouchers.RemoveAttachment(t.Context(), voudomain.EntityOtherIncome, voudomain.AttachmentRemoveInput{
				DocumentID: created.DocumentID, Revision: revision, FileID: readyAttachment.FileID,
			}, actor)
			return callErr
		}},
		{"workflow purchase inbound", func() error {
			tx, beginErr := pool.Begin(t.Context())
			if beginErr != nil {
				return beginErr
			}
			defer tx.Rollback(t.Context()) //nolint:errcheck
			_, callErr := workflowactions.New(vouchers).CreatePurchaseInbound(t.Context(), tx, wfl.WorkflowActionInput[wfl.PurchaseInboundInitial]{
				SourceDocumentID: ulid.Make().String(), RequestID: "acc-period-wfl-write",
				Initial: wfl.PurchaseInboundInitial{BusinessDate: "2025-07-22"},
			})
			return callErr
		}},
	}
	for _, testCase := range lockedCases {
		t.Run(testCase.name, func(t *testing.T) { assertLocked(t, testCase.call()) })
	}
	lockedView, err := vouchers.Get(t.Context(), voudomain.EntityOtherIncome, voudomain.GetInput{DocumentID: created.DocumentID})
	if err != nil || lockedView.Approval.Revision != revision {
		t.Fatalf("read locked document = %#v, err=%v", lockedView, err)
	}
	history, err := vouchers.AuditHistory(t.Context(), voudomain.EntityOtherIncome, voudomain.HistoryInput{DocumentID: created.DocumentID, Page: 1, PageSize: 20})
	if err != nil || history.Total == 0 {
		t.Fatalf("read locked document audit = %#v, err=%v", history, err)
	}
	download, err := vouchers.CreateDownload(t.Context(), voudomain.EntityOtherIncome, voudomain.AttachmentDownloadInput{DocumentID: created.DocumentID, FileID: readyAttachment.FileID}, adminID)
	if err != nil {
		t.Fatalf("create download while locked: %v", err)
	}
	opened, err := vouchers.OpenDownload(t.Context(), strings.TrimPrefix(download.DownloadURL, "/files/attachments/download/"))
	if err != nil {
		t.Fatalf("open download while locked: %v", err)
	}
	if err = opened.Reader.Close(); err != nil {
		t.Fatalf("close locked download: %v", err)
	}
	var lockedDocuments int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM vou_documents WHERE entity=$1`, voudomain.EntityOtherIncome).Scan(&lockedDocuments); err != nil || lockedDocuments != documentsBeforeLock {
		t.Fatalf("locked writes persisted documents=%d want=%d err=%v", lockedDocuments, documentsBeforeLock, err)
	}

	if _, err = accounting.UnlockPeriod(t.Context(), PeriodActionInput{
		BookID: book.ID, Month: "2025-07", Revision: locked.Revision,
	}, adminID); err != nil {
		t.Fatalf("unlock July through ACC service: %v", err)
	}
	pending, err := vouchers.Unapprove(t.Context(), voudomain.EntityOtherIncome, voudomain.ReverseInput{
		DocumentID: created.DocumentID, Revision: revision, Reason: "解锁后反批准",
	}, trustedAccountingActor(t, "acc-period-vou-unapprove"))
	if err != nil {
		t.Fatalf("unapprove after unlock: %v", err)
	}
	draftAgain, err := vouchers.Unsubmit(t.Context(), voudomain.EntityOtherIncome, voudomain.DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: pending.Approval.Revision,
	}, trustedAccountingActor(t, "acc-period-vou-unsubmit"))
	if err != nil {
		t.Fatalf("unsubmit after unlock: %v", err)
	}
	saved, err := vouchers.Save(t.Context(), voudomain.EntityOtherIncome, voudomain.SaveInput{
		DocumentID: created.DocumentID, Revision: draftAgain.Approval.Revision, Data: draft("2025-08-01"),
	}, actor)
	if err != nil {
		t.Fatalf("save old-to-new month after unlock: %v", err)
	}
	initialRemoved, err := vouchers.RemoveAttachment(t.Context(), voudomain.EntityOtherIncome, voudomain.AttachmentRemoveInput{
		DocumentID: created.DocumentID, Revision: saved.Approval.Revision, FileID: readyAttachment.FileID,
	}, actor)
	if err != nil {
		t.Fatalf("remove pre-lock attachment after unlock: %v", err)
	}
	attachment, err := vouchers.InitiateAttachment(t.Context(), voudomain.EntityOtherIncome, voudomain.AttachmentInitiateInput{
		DocumentID: created.DocumentID, Revision: initialRemoved.Approval.Revision, FileName: "unlocked.pdf", ContentType: "application/pdf", Size: 1, SHA256: strings.Repeat("b", 64),
	}, actor)
	if err != nil {
		t.Fatalf("attach after unlock: %v", err)
	}
	removed, err := vouchers.RemoveAttachment(t.Context(), voudomain.EntityOtherIncome, voudomain.AttachmentRemoveInput{
		DocumentID: created.DocumentID, Revision: attachment.Revision, FileID: attachment.FileID,
	}, actor)
	if err != nil {
		t.Fatalf("remove attachment after unlock: %v", err)
	}
	if _, err = vouchers.Delete(t.Context(), voudomain.EntityOtherIncome, voudomain.DeleteInput{
		DocumentID: created.DocumentID, Revision: removed.Approval.Revision, Reason: "解锁后删除",
	}, actor); err != nil {
		t.Fatalf("delete after unlock: %v", err)
	}
	restored, err := vouchers.Create(t.Context(), voudomain.EntityOtherIncome, voudomain.CreateInput{Data: draft("2025-07-23")}, actor)
	if err != nil {
		t.Fatalf("create after unlock: %v", err)
	}
	for _, document := range []voudomain.MutationResult{augustCreated, restored} {
		if _, err = vouchers.Delete(t.Context(), voudomain.EntityOtherIncome, voudomain.DeleteInput{
			DocumentID: document.DocumentID, Revision: document.Approval.Revision, Reason: "测试清理",
		}, actor); err != nil {
			t.Fatalf("delete test draft %s: %v", document.DocumentID, err)
		}
	}
}

func TestZZVOUCreateSerializesWithAccountingPeriodLockIntegration(t *testing.T) {
	pool := integrationPool(t)
	seedUsers(t, pool)
	accounting := defaultIntegrationACCService(pool)
	book, err := accounting.CreateBook(t.Context(), CreateBookInput{
		Name: "VOU 写入锁月串行", StartMonth: "2025-07", BaseCurrency: "CNY", SubjectTemplate: SubjectTemplateEmpty,
	}, adminID)
	if err != nil {
		t.Fatalf("create accounting book: %v", err)
	}
	createApprovedZeroOpening(t, accounting, book)
	mapping, err := createDCLIntegrationMapping(t, accounting, dclMappingFixtureInput{
		BookID: book.ID, VouEntity: voudomain.EntityOtherIncome, DefaultResult: MappingResultUnpost,
		Definition: MappingDefinition{Rules: []MappingRule{}, Templates: []PostingTemplate{}},
	}, integrationACCActor(t, adminID, "acc-period-concurrent-mapping-create"))
	if err != nil {
		t.Fatalf("create other-income mapping: %v", err)
	}
	approveIntegrationMapping(t, accounting, book.ID, voudomain.EntityOtherIncome, mapping)

	bus := txevent.NewBus()
	business := newAccountingIntegrationBOBService(pool, bus)
	auxiliary := auxdomain.NewService(pool)
	operating := createApprovedAccountingReference(t, business, bobdomain.EntityOperatingEntity, bobdomain.CreateDetailInput{Name: "VOU 写入锁月经营主体"})
	handler := createApprovedAccountingEmployee(t, pool, business, bus, operating.ObjectID, "VOU 写入锁月经办人", "acc-period-concurrent-employee")
	fund := createApprovedAccountingReference(t, business, bobdomain.EntityFundAccount, bobdomain.CreateDetailInput{Name: "VOU 写入锁月账户", Currency: "CNY", OperatingEntityID: operating.ObjectID})
	entered := make(chan struct{})
	release := make(chan struct{})
	createDone := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() {
		releaseOnce.Do(func() { close(release) })
		select {
		case <-createDone:
		case <-time.After(2 * time.Second):
			t.Error("VOU create did not finish after releasing transactional event barrier")
		}
	})
	if err = bus.Subscribe(voudomain.DocumentCreatedTopic(voudomain.EntityOtherIncome), "acc-period-create-barrier", func(context.Context, pgx.Tx, txevent.Event) error {
		close(entered)
		<-release
		return nil
	}); err != nil {
		t.Fatalf("subscribe VOU create barrier: %v", err)
	}
	vouchers, err := voudomain.NewService(pool, business, auxiliaryrefs.New(auxiliary), bus,
		voudomain.AttachmentOptions{Root: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)),
		voudomain.WithPeriodWriteControl(accounting), voudomain.WithApprovalAuthorizer(authorization.Func(nil)),
	)
	if err != nil {
		t.Fatalf("new VOU service: %v", err)
	}
	actor := trustedAccountingActor(t, "acc-period-concurrent-create")
	createResult := make(chan struct {
		mutation voudomain.MutationResult
		err      error
	}, 1)
	go func() {
		defer close(createDone)
		mutation, createErr := vouchers.Create(t.Context(), voudomain.EntityOtherIncome, voudomain.CreateInput{Data: voudomain.DraftInput{
			BusinessDate: "2025-07-20", Currency: "CNY", SourceName: "并发锁月收入", FundAccount: &fund, Handler: &handler, Amount: "60.00",
		}}, actor)
		createResult <- struct {
			mutation voudomain.MutationResult
			err      error
		}{mutation: mutation, err: createErr}
	}()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("VOU create did not reach the transactional event barrier")
	}
	lockContext, cancel := context.WithTimeout(t.Context(), 300*time.Millisecond)
	defer cancel()
	if _, err = accounting.LockPeriod(lockContext, PeriodActionInput{BookID: book.ID, Month: "2025-07", Revision: 0}, adminID); err == nil || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("lock period while VOU write holds month lock = %v, want context deadline", err)
	}
	releaseOnce.Do(func() { close(release) })
	created := <-createResult
	if created.err != nil {
		t.Fatalf("commit VOU create: %v", created.err)
	}
	if _, err = accounting.LockPeriod(t.Context(), PeriodActionInput{BookID: book.ID, Month: "2025-07", Revision: 0}, adminID); !IsKind(err, ErrorConflict) {
		t.Fatalf("lock period after committed VOU draft = %v, want unfinished-VOU conflict", err)
	}
	if _, err = vouchers.Delete(t.Context(), voudomain.EntityOtherIncome, voudomain.DeleteInput{
		DocumentID: created.mutation.DocumentID, Revision: created.mutation.Approval.Revision, Reason: "测试清理",
	}, actor); err != nil {
		t.Fatalf("delete concurrent VOU draft: %v", err)
	}
}
