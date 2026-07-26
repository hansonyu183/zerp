package vou

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	"github.com/hansonyu183/zerp-back/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type effectiveReferenceResolver interface {
	ResolveEffectiveReference(context.Context, pgx.Tx, string, string, string) (bobdomain.EffectiveReference, error)
	ResolveCurrentEffectiveReference(context.Context, pgx.Tx, string, string) (bobdomain.EffectiveReference, error)
}

type eventPublisher interface {
	Publish(context.Context, pgx.Tx, txevent.Event) error
}

type Service struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	resolver    effectiveReferenceResolver
	events      eventPublisher
	storage     *localStorage
	uploadTTL   time.Duration
	downloadTTL time.Duration
	logger      *slog.Logger
}

type AttachmentOptions struct {
	Root        string
	UploadTTL   time.Duration
	DownloadTTL time.Duration
}

func NewService(
	pool *pgxpool.Pool,
	resolver effectiveReferenceResolver,
	events eventPublisher,
	options AttachmentOptions,
	logger *slog.Logger,
) (*Service, error) {
	if pool == nil || resolver == nil || events == nil {
		return nil, errors.New("VOU pool, BOB resolver, and event publisher are required")
	}
	storage, err := newLocalStorage(options.Root)
	if err != nil {
		return nil, err
	}
	if options.UploadTTL <= 0 {
		options.UploadTTL = 15 * time.Minute
	}
	if options.DownloadTTL <= 0 {
		options.DownloadTTL = 5 * time.Minute
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		pool: pool, queries: dbsqlc.New(pool), resolver: resolver, events: events, storage: storage,
		uploadTTL: options.UploadTTL, downloadTTL: options.DownloadTTL, logger: logger,
	}, nil
}

func insertAudit(ctx context.Context, q *dbsqlc.Queries, input auditInput) error {
	if input.Summary == nil {
		input.Summary = map[string]any{}
	}
	encoded, err := json.Marshal(input.Summary)
	if err != nil {
		return err
	}
	return q.InsertVouAuditEvent(ctx, dbsqlc.InsertVouAuditEventParams{
		ID: newID(), DocumentID: input.DocumentID, Entity: input.Entity, EventType: input.Event,
		FromStatus: input.From, ToStatus: input.To, ActorID: input.ActorID, Reason: input.Reason,
		RequestID: input.RequestID, Summary: encoded,
	})
}

func documentWriteConflict(err error, actualRevision, expectedRevision int64, actualStatus, expectedStatus string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorValidation, "document not found", nil, nil)
	}
	if err != nil {
		return err
	}
	if actualRevision != expectedRevision || actualStatus != expectedStatus {
		return domainError(ErrorConflict, "document changed", map[string]any{
			"revision": actualRevision, "status": actualStatus,
		}, nil)
	}
	return nil
}

func mutation(document dbsqlc.VouDocument, status string, revision int64) MutationResult {
	return MutationResult{
		DocumentID: document.ID, DocumentNo: document.DocumentNo, Status: status, Revision: revision,
	}
}

func entityPrefix(entity string) string {
	return map[string]string{
		EntitySaleOrder: "SO", EntityPurchaseOrder: "PO", EntityIntermediarySaleOrder: "ISO",
		EntityReceipt: "REC", EntityPayment: "PAY", EntityExpenseReimbursement: "ER", EntityOtherIncome: "OI",
	}[entity]
}

func dateValue(value time.Time) pgtype.Date {
	return pgtype.Date{Time: value, Valid: true}
}

func optionalDate(value *time.Time) pgtype.Date {
	if value == nil {
		return pgtype.Date{}
	}
	return dateValue(*value)
}

func formatDate(value pgtype.Date) string {
	if !value.Valid {
		return ""
	}
	return value.Time.Format(dateLayout)
}

func stringPtr(value string) *string { return &value }
func int64Ptr(value int64) *int64    { return &value }

type settlementSnapshotFields struct {
	ObjectID, VersionID, Code, Name, RuleType, Description *string
	MonthOffset, DayOfMonth, DayOffset                     *int32
}

func settlementSnapshot(reference *bobdomain.EffectiveReference) settlementSnapshotFields {
	if reference == nil {
		return settlementSnapshotFields{}
	}
	return settlementSnapshotFields{
		ObjectID: stringPtr(reference.ObjectID), VersionID: stringPtr(reference.VersionID),
		Code: stringPtr(reference.Code), Name: stringPtr(reference.Data.Name),
		RuleType:    stringPtr(reference.Data.RuleType),
		MonthOffset: int32Ptr(reference.Data.MonthOffset),
		DayOfMonth:  reference.Data.DayOfMonth,
		DayOffset:   int32Ptr(reference.Data.DayOffset),
		Description: optionalText(reference.Data.Description),
	}
}

func int32Ptr(value int32) *int32 { return &value }
func newID() string               { return ulid.Make().String() }

func oneRow(rows int64, err error) error {
	if err != nil {
		return err
	}
	if rows != 1 {
		return domainError(ErrorConflict, "document detail changed", nil, nil)
	}
	return nil
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
