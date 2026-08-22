package vou

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type effectiveReferenceResolver interface {
	ResolveEffectiveReference(context.Context, pgx.Tx, string, string, string) (bobdomain.EffectiveReference, error)
	ResolveCurrentEffectiveReference(context.Context, pgx.Tx, string, string) (bobdomain.EffectiveReference, error)
}

type auxiliaryReferenceResolver interface {
	ResolveAuxiliaryReference(context.Context, pgx.Tx, string, string, string) (bobdomain.AuxiliaryReference, error)
}

type eventPublisher interface {
	Publish(context.Context, pgx.Tx, txevent.Event) error
}

// AccountingControl is the narrow business-control view exposed by ACC to VOU.
// Balances are read inside the caller transaction so approval and accounting
// facts share one atomic decision boundary.
type AccountingControl interface {
	PartyBalance(context.Context, pgx.Tx, PartyBalanceQuery) (int64, error)
}

type PartyBalanceQuery struct {
	CounterpartyDimension string
	CounterpartyObjectID  string
	Currency              string
	SettlementPurpose     string
	AsOfDate              time.Time
	SourceDocumentIDs     []string
}

type Service struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	resolver    effectiveReferenceResolver
	auxResolver auxiliaryReferenceResolver
	events      eventPublisher
	accounting  AccountingControl
	storage     *localStorage
	uploadTTL   time.Duration
	downloadTTL time.Duration
	logger      *slog.Logger
}

type ServiceOption func(*Service)

func WithAccountingControl(control AccountingControl) ServiceOption {
	return func(service *Service) { service.accounting = control }
}

type AttachmentOptions struct {
	Root        string
	UploadTTL   time.Duration
	DownloadTTL time.Duration
}

type auditInput struct {
	DocumentID, Entity, Event, To, ActorID, RequestID string
	From, Reason                                      *string
	Summary                                           map[string]any
}

func NewService(
	pool *pgxpool.Pool,
	resolver effectiveReferenceResolver,
	auxResolver auxiliaryReferenceResolver,
	events eventPublisher,
	options AttachmentOptions,
	logger *slog.Logger,
	serviceOptions ...ServiceOption,
) (*Service, error) {
	if pool == nil || resolver == nil || auxResolver == nil || events == nil {
		return nil, errors.New("VOU pool, BOB/AUX resolvers, and event publisher are required")
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
	service := &Service{
		pool: pool, queries: dbsqlc.New(pool), resolver: resolver, auxResolver: auxResolver, events: events, storage: storage,
		uploadTTL: options.UploadTTL, downloadTTL: options.DownloadTTL, logger: logger,
	}
	for _, option := range serviceOptions {
		if option != nil {
			option(service)
		}
	}
	return service, nil
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
		EntitySalePricing: "SPR", EntityPurchaseInquiry: "PIQ",
		EntitySaleOrder: "SOR", EntitySaleOutbound: "SOB", EntitySaleDelivery: "SDL",
		EntitySaleSignoff: "SSF", EntityPurchaseOrder: "POR", EntityPurchaseInbound: "PIN",
		EntitySaleReturn:      "SRT",
		EntityPurchaseReturn:  "PRT",
		EntityOrderProduction: "MTO",
		EntitySelfProduction:  "MTS",
		EntityInventoryCount:  "IVC",
		EntitySalesReceipt:    "SRC", EntityPurchaseRefund: "PRF", EntityOtherReceipt: "ORC",
		EntitySalesRefund: "SRF", EntityPurchasePayment: "PPY", EntityOtherPayment: "OPY",
		EntityEmployeeLoan: "ELN", EntityEmployeeRepayment: "ERP", EntityEmployeeLoanWriteoff: "ELW",
		EntityExpenseReimbursement: "EXR",
		EntityExpensePayment:       "EXP", EntityOtherIncome: "OIN",
		EntityAssetAcquisition: "ACQ",
		EntityAssetSale:        "DSL", EntityAssetLiquidation: "LIQ",
		EntityBillReceipt: "BRE", EntityBillPayment: "BLP", EntityBillIssue: "BLI",
		EntityBillDiscount:            "BLD",
		EntityBillMaturity:            "BLM",
		EntityIntermediaryCalculation: "ICL",
		EntityServiceContract:         "SCT",
		EntityServiceAcceptance:       "SAC",
	}[entity]
}

func numberingEntity(entity string) string {
	return entity
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

type settlementSnapshotFields struct {
	ObjectID, VersionID, Code, Name, TermCode, RuleType, Description *string
	MonthOffset, DayOfMonth, DayOffset, DueDays, CutoffDay           *int32
	DefaultSalesSurchargeCents                                       int64
}

func settlementSnapshot(
	reference *bobdomain.EffectiveReference,
	monthlyClosingDay int32,
) settlementSnapshotFields {
	if reference == nil {
		return settlementSnapshotFields{}
	}
	surcharge, _ := parseFixed(reference.Data.DefaultSalesSurcharge, 2, true)
	result := settlementSnapshotFields{
		ObjectID: stringPtr(reference.ObjectID),
		Code:     stringPtr(reference.Code), Name: stringPtr(reference.Data.Name),
		TermCode:                   stringPtr(reference.Data.TermCode),
		RuleType:                   stringPtr(reference.Data.RuleType),
		MonthOffset:                int32Ptr(reference.Data.MonthOffset),
		DayOfMonth:                 reference.Data.DayOfMonth,
		DayOffset:                  int32Ptr(reference.Data.DayOffset),
		DefaultSalesSurchargeCents: surcharge,
		Description:                optionalText(reference.Data.Description),
	}
	if reference.VersionID != "" {
		result.VersionID = stringPtr(reference.VersionID)
	}
	if reference.Data.RuleType == bobdomain.SettlementRuleRelativeDays {
		result.DueDays = int32Ptr(reference.Data.DayOffset)
	}
	if reference.Data.RuleType == bobdomain.SettlementRuleMonthEnd {
		if monthlyClosingDay < 1 || monthlyClosingDay > 31 {
			monthlyClosingDay = 31
		}
		result.CutoffDay = int32Ptr(monthlyClosingDay)
	}
	return result
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
