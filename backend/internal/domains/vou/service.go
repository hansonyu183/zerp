package vou

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type effectiveReferenceResolver interface {
	ResolveLatestApprovedReference(context.Context, pgx.Tx, string, string) (bobdomain.EffectiveReference, error)
	ValidateApprovedSnapshotReference(context.Context, pgx.Tx, string, string, string) (bobdomain.EffectiveReference, error)
}

type auxiliaryReferenceResolver interface {
	ResolveLatestApprovedAuxiliaryReference(context.Context, pgx.Tx, string, string) (bobdomain.AuxiliaryReference, error)
	ValidateApprovedAuxiliarySnapshotReference(context.Context, pgx.Tx, string, string, string) (bobdomain.AuxiliaryReference, error)
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

// documentRecord combines the VOU business payload with its single central
// Approval entry. Lifecycle fields are projected from approval_entries and are
// never persisted on vou_documents.
type documentRecord struct {
	ID, Entity, DocumentNo, ApprovalEntryID string
	BusinessDate                            pgtype.Date
	Currency                                *string
	TotalAmountCents                        int64
	Remark                                  *string
	ParentDocumentID, ParentEntity          *string
	DueDate                                 pgtype.Date
	Status                                  string
	Revision                                int64
	CreatedAt, UpdatedAt                    pgtype.Timestamptz
	CreatedBy, UpdatedBy                    string
	ReviewedAt, ApprovedAt, PostedAt        pgtype.Timestamptz
	ReviewedBy, ApprovedBy, PostedBy        *string
}

func scanDocument(row pgx.Row) (documentRecord, error) {
	var document documentRecord
	err := row.Scan(
		&document.ID, &document.Entity, &document.DocumentNo, &document.ApprovalEntryID,
		&document.BusinessDate, &document.Currency, &document.TotalAmountCents, &document.Remark,
		&document.ParentDocumentID, &document.ParentEntity, &document.DueDate,
		&document.Status, &document.Revision,
		&document.CreatedAt, &document.CreatedBy, &document.UpdatedAt, &document.UpdatedBy,
		&document.ReviewedAt, &document.ReviewedBy, &document.ApprovedAt, &document.ApprovedBy,
	)
	document.PostedAt, document.PostedBy = document.ApprovedAt, document.ApprovedBy
	return document, err
}

const documentSelect = `SELECT document.id,document.entity,document.document_no,document.approval_entry_id,
	document.business_date,document.currency,document.total_amount_cents,document.remark,
	document.parent_document_id,document.parent_entity,document.due_date,
	approval.status,approval.revision,
	approval.created_at,approval.created_by,approval.updated_at,approval.updated_by,
	approval.submitted_at,approval.submitted_by,approval.approved_at,approval.approved_by
	FROM vou_documents document
	JOIN approval_entries approval ON approval.id=document.approval_entry_id
	WHERE document.id=$1 AND document.entity=$2
	  AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id`

func (s *Service) getDocument(ctx context.Context, id, entity string) (documentRecord, error) {
	return scanDocument(s.pool.QueryRow(ctx, documentSelect, id, entity))
}

func lockDocument(ctx context.Context, tx pgx.Tx, id, entity string) (documentRecord, error) {
	return scanDocument(tx.QueryRow(ctx, documentSelect+` FOR UPDATE OF document,approval`, id, entity))
}

func (d documentRecord) approvalEntry() approval.Entry {
	return approval.Entry{
		EntryRef: approval.EntryRef{ID: d.ApprovalEntryID, Domain: "vou", Entity: d.Entity, SubjectID: d.ID},
		Status:   approval.Status(d.Status), Revision: d.Revision,
		CreatedBy: d.CreatedBy, CreatedAt: d.CreatedAt.Time,
		UpdatedBy: d.UpdatedBy, UpdatedAt: d.UpdatedAt.Time,
		SubmittedBy: d.ReviewedBy, SubmittedAt: timestampPointer(d.ReviewedAt),
		ApprovedBy: d.ApprovedBy, ApprovedAt: timestampPointer(d.ApprovedAt),
	}
}

func (s *Service) coordinator(entity string) (*approval.Coordinator[ApprovalPayload], error) {
	coordinator := s.approvals[entity]
	if coordinator == nil {
		return nil, domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	return coordinator, nil
}

func (s *Service) createDocumentApproval(
	ctx context.Context, tx pgx.Tx, entity, documentID string, actor approval.Actor,
) (approval.Entry, error) {
	coordinator, err := s.coordinator(entity)
	if err != nil {
		return approval.Entry{}, err
	}
	entry, err := coordinator.CreateSubject(ctx, tx, documentID, actor, ApprovalPayload{})
	if err != nil {
		return approval.Entry{}, mapApprovalError(err)
	}
	return entry, nil
}

func (s *Service) prepareDraftSave(
	ctx context.Context, tx pgx.Tx, document documentRecord, expectedRevision int64, actor approval.Actor,
) (*approval.Coordinator[ApprovalPayload], approval.Prepared, error) {
	coordinator, err := s.coordinator(document.Entity)
	if err != nil {
		return nil, approval.Prepared{}, err
	}
	prepared, err := coordinator.Prepare(ctx, tx, approval.ActionSaved, document.ApprovalEntryID, expectedRevision, actor, "")
	if err != nil {
		return nil, approval.Prepared{}, mapApprovalError(err)
	}
	return coordinator, prepared, nil
}

func (s *Service) commitDraftSave(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	document documentRecord,
	coordinator *approval.Coordinator[ApprovalPayload],
	prepared approval.Prepared,
) (approval.Entry, error) {
	updated, err := scanDocument(tx.QueryRow(ctx, documentSelect, document.ID, document.Entity))
	if err != nil {
		return approval.Entry{}, s.internal("read saved document", err)
	}
	payload, err := s.eventSnapshot(ctx, q, updated)
	if err != nil {
		return approval.Entry{}, err
	}
	entry, err := coordinator.Commit(ctx, tx, prepared, payload)
	if err != nil {
		return approval.Entry{}, mapApprovalError(err)
	}
	return entry, nil
}

func timestampPointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	result := value.Time
	return &result
}

type Service struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	resolver    effectiveReferenceResolver
	auxResolver auxiliaryReferenceResolver
	events      *txevent.Bus
	approvals   map[string]*approval.Coordinator[ApprovalPayload]
	authorizer  approval.Authorizer
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

func WithApprovalAuthorizer(authorizer approval.Authorizer) ServiceOption {
	return func(service *Service) { service.authorizer = authorizer }
}

type AttachmentOptions struct {
	Root        string
	UploadTTL   time.Duration
	DownloadTTL time.Duration
}

func NewService(
	pool *pgxpool.Pool,
	resolver effectiveReferenceResolver,
	auxResolver auxiliaryReferenceResolver,
	events *txevent.Bus,
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
	if service.authorizer == nil {
		return nil, errors.New("VOU Approval authorizer is required")
	}
	service.approvals = make(map[string]*approval.Coordinator[ApprovalPayload], len(entities))
	for _, entity := range entities {
		coordinator, coordinatorErr := approval.NewCoordinator("vou", entity, service.authorizer, events, ApprovalTopic(entity))
		if coordinatorErr != nil {
			return nil, coordinatorErr
		}
		service.approvals[entity] = coordinator
	}
	return service, nil
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

func mutation(document documentRecord, entry approval.Entry) MutationResult {
	return MutationResult{
		DocumentID: document.ID, DocumentNo: document.DocumentNo, Approval: approval.MetaFromEntry(entry),
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
	ObjectID, ApprovalEntryID, Code, Name, TermCode, RuleType, Description *string
	MonthOffset, DayOfMonth, DayOffset, DueDays, CutoffDay                 *int32
	DefaultSalesSurchargeCents                                             int64
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
	if reference.ApprovalEntryID != "" {
		result.ApprovalEntryID = stringPtr(reference.ApprovalEntryID)
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
