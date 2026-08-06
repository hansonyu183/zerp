package led

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var vouEntities = [...]string{
	voudomain.EntitySaleOutbound,
	voudomain.EntitySaleSignoff,
	voudomain.EntitySaleReturn,
	voudomain.EntityPurchaseInbound,
	voudomain.EntityPurchaseReturn,
	voudomain.EntityOrderProduction,
	voudomain.EntitySelfProduction,
	voudomain.EntityInventoryCount,
	voudomain.EntityCustomerReceipt,
	voudomain.EntitySupplierReceipt,
	voudomain.EntityOtherReceipt,
	voudomain.EntityCustomerPayment,
	voudomain.EntitySupplierPayment,
	voudomain.EntityOtherPayment,
	voudomain.EntityEmployeeLoan,
	voudomain.EntityEmployeeRepayment,
	voudomain.EntityEmployeeLoanWriteoff,
	voudomain.EntityExpenseReimbursement,
	voudomain.EntityExpensePayment,
	voudomain.EntityOtherIncome,
	voudomain.EntityAssetAcquisition,
	voudomain.EntityAssetDepreciation,
	voudomain.EntityAssetSale,
	voudomain.EntityAssetLiquidation,
	voudomain.EntityBillReceipt,
	voudomain.EntityBillPayment,
	voudomain.EntityBillIssue,
	voudomain.EntityBillDiscount,
	voudomain.EntityBillMaturity,
	voudomain.EntityIntermediaryCalculation,
}

func (s *Service) RegisterSubscriptions(bus *txevent.Bus) error {
	if bus == nil {
		return errors.New("LED event bus is required")
	}
	for _, entity := range vouEntities {
		if err := bus.Subscribe(voudomain.DocumentApprovedTopic(entity), "led-posting", s.HandleDocumentApproved); err != nil {
			return err
		}
		if err := bus.Subscribe(voudomain.DocumentUnapprovedTopic(entity), "led-reversal", s.HandleDocumentUnapproved); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) Activate(
	ctx context.Context, input RevisionInput, actorID, requestID string,
) (MutationResult, error) {
	if input.Revision < 1 || !validID(actorID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid activation request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin ledger activation", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	control, err := q.LockLedControl(ctx)
	if err != nil {
		return MutationResult{}, s.internal("lock ledger control", err)
	}
	if control.Revision != input.Revision ||
		(control.Status != StatusDraft && control.Status != StatusReopening) ||
		!control.CutoverDate.Valid {
		return MutationResult{}, domainError(ErrorConflict, "ledger cannot be activated", nil, nil)
	}
	documents, err := q.ListPostedVouDocumentsForLed(ctx)
	if err != nil {
		return MutationResult{}, s.internal("list executed documents", err)
	}
	if err = s.preflightActivation(ctx, q, documents, control.CutoverDate.Time); err != nil {
		return MutationResult{}, err
	}
	generationID := newID()
	if err = s.createOpeningGeneration(ctx, q, generationID, control.CutoverDate, actorID, requestID); err != nil {
		return MutationResult{}, err
	}
	if err = s.replayVouDocuments(
		ctx, tx, q, generationID, control.CutoverDate.Time, documents, actorID, requestID,
	); err != nil {
		return MutationResult{}, err
	}
	revision, err := s.finalizeActivation(
		ctx, q, control, input.Revision, generationID, actorID, requestID, len(documents),
	)
	if err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit ledger activation", err)
	}
	return MutationResult{Status: StatusActive, Revision: revision, GenerationID: generationID}, nil
}

func (s *Service) HandleDocumentApproved(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
	event, ok := raw.(voudomain.DocumentApprovedEvent)
	if !ok {
		return fmt.Errorf("unexpected LED approved event %T", raw)
	}
	q := s.queries.WithTx(tx)
	control, err := q.LockLedControl(ctx)
	if err != nil {
		return err
	}
	if control.Status != StatusActive || control.ActiveGenerationID == nil || !control.CutoverDate.Valid {
		return txevent.Reject("ledger is not active", map[string]any{"status": control.Status})
	}
	document, err := q.GetVouDocument(ctx, dbsqlc.GetVouDocumentParams{ID: event.DocumentID, Entity: event.Entity})
	if err != nil {
		return err
	}
	err = s.postDocument(ctx, tx, q, postingContext{
		GenerationID: *control.ActiveGenerationID, CutoverDate: control.CutoverDate.Time,
		Document: document, EntryType: "POSTING", SourceRevision: event.Revision,
		OccurredAt: document.PostedAt, ActorID: systemidentity.UserID, RequestID: event.RequestID, Live: true,
	})
	if err != nil {
		return eventFailure(err)
	}
	negative, err := q.HasNegativeLedInventoryTimeline(ctx, *control.ActiveGenerationID)
	if err != nil {
		return err
	}
	if negative {
		return txevent.Reject("inventory timeline would become negative", nil)
	}
	return nil
}

func (s *Service) HandleDocumentUnapproved(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
	event, ok := raw.(voudomain.DocumentUnapprovedEvent)
	if !ok {
		return fmt.Errorf("unexpected LED unapproved event %T", raw)
	}
	q := s.queries.WithTx(tx)
	control, err := q.LockLedControl(ctx)
	if err != nil {
		return err
	}
	if control.Status == StatusDraft && control.ActiveGenerationID == nil {
		return nil
	}
	if control.Status != StatusActive || control.ActiveGenerationID == nil {
		return txevent.Reject("ledger is in maintenance mode", map[string]any{"status": control.Status})
	}
	generationID := *control.ActiveGenerationID
	exists, err := q.HasLedEntriesForSource(ctx, dbsqlc.HasLedEntriesForSourceParams{
		TargetGenerationID: generationID, TargetDocumentID: event.DocumentID,
	})
	if err != nil {
		return err
	}
	if !exists {
		if event.Entity == voudomain.EntityInventoryCount || event.Entity == voudomain.EntityIntermediaryCalculation {
			return nil
		}
		return txevent.Reject("document predates the active ledger cutover", nil)
	}
	if event.Entity == voudomain.EntityBillReceipt || event.Entity == voudomain.EntityBillPayment || event.Entity == voudomain.EntityBillIssue || event.Entity == voudomain.EntityBillDiscount || event.Entity == voudomain.EntityBillMaturity {
		count, countErr := q.CountLedBillDownstreamEntries(ctx, event.DocumentID)
		if countErr != nil {
			return countErr
		}
		if count != 0 {
			return txevent.Reject("downstream bill operation blocks reversal", nil)
		}
	}
	if event.Entity == voudomain.EntityAssetAcquisition || event.Entity == voudomain.EntityAssetDepreciation ||
		event.Entity == voudomain.EntityAssetSale || event.Entity == voudomain.EntityAssetLiquidation {
		if err = s.reverseAssetDocument(ctx, q, generationID, event.Entity, event.DocumentID); err != nil {
			return eventFailure(err)
		}
	}
	if event.Entity == voudomain.EntityBillReceipt || event.Entity == voudomain.EntityBillPayment || event.Entity == voudomain.EntityBillIssue || event.Entity == voudomain.EntityBillDiscount || event.Entity == voudomain.EntityBillMaturity {
		if err = q.DeleteLedBillEntriesBySource(ctx, dbsqlc.DeleteLedBillEntriesBySourceParams{GenerationID: generationID, SourceDocumentID: event.DocumentID}); err != nil {
			return err
		}
	}
	if event.Entity == voudomain.EntityBillReceipt || event.Entity == voudomain.EntityBillIssue {
		if err = q.DeleteLedBillsBySource(ctx, event.DocumentID); err != nil {
			return err
		}
	}
	if err = s.deleteDocumentEntries(ctx, tx, q, generationID, event.DocumentID); err != nil {
		return err
	}
	negative, err := q.HasNegativeLedInventoryTimeline(ctx, generationID)
	if err != nil {
		return err
	}
	if negative {
		return txevent.Reject("purchase reversal would make inventory negative", nil)
	}
	if event.Entity == voudomain.EntityEmployeeLoan {
		invalidWriteoff, queryErr := q.HasInvalidEmployeeWriteoffTimeline(ctx, generationID)
		if queryErr != nil {
			return queryErr
		}
		if invalidWriteoff {
			return txevent.Reject("employee loan reversal would invalidate a later writeoff", nil)
		}
	}
	return nil
}

type postingContext struct {
	GenerationID, EntryType, ActorID, RequestID string
	CutoverDate                                 time.Time
	Document                                    dbsqlc.VouDocument
	SourceRevision                              int64
	OccurredAt                                  pgtype.Timestamptz
	Live                                        bool
}

func (s *Service) postDocument(
	ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, posting postingContext,
) error {
	if !posting.OccurredAt.Valid {
		posting.OccurredAt = pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	}
	switch posting.Document.Entity {
	case voudomain.EntitySaleOrder, voudomain.EntitySaleDelivery:
		return nil
	case voudomain.EntitySaleOutbound:
		return s.postSaleOutbound(ctx, tx, q, posting)
	case voudomain.EntitySaleSignoff:
		return s.postSaleSignoff(ctx, tx, q, posting)
	case voudomain.EntitySaleReturn:
		return s.postSaleReturn(ctx, tx, q, posting)
	case voudomain.EntityPurchaseInbound:
		return s.postPurchase(ctx, tx, q, posting)
	case voudomain.EntityPurchaseReturn:
		return s.postPurchaseReturn(ctx, tx, q, posting)
	case voudomain.EntityOrderProduction, voudomain.EntitySelfProduction:
		return s.postProduction(ctx, tx, q, posting)
	case voudomain.EntityInventoryCount:
		return s.postInventoryCount(ctx, tx, q, posting)
	case voudomain.EntityReceipt, voudomain.EntityCustomerReceipt, voudomain.EntitySupplierReceipt, voudomain.EntityOtherReceipt, voudomain.EntityEmployeeRepayment:
		return s.postReceipt(ctx, q, posting)
	case voudomain.EntityPayment, voudomain.EntityCustomerPayment, voudomain.EntitySupplierPayment, voudomain.EntityOtherPayment, voudomain.EntityEmployeeLoan:
		return s.postPayment(ctx, q, posting)
	case voudomain.EntityEmployeeLoanWriteoff:
		return s.postEmployeeLoanWriteoff(ctx, tx, q, posting)
	case voudomain.EntityExpenseReimbursement:
		return s.postExpense(ctx, q, posting)
	case voudomain.EntityExpensePayment:
		return s.postExpensePayment(ctx, q, posting)
	case voudomain.EntityOtherIncome:
		return s.postOtherIncome(ctx, q, posting)
	case voudomain.EntityBillReceipt:
		return s.postBillReceipt(ctx, tx, q, posting)
	case voudomain.EntityBillPayment:
		return s.postBillPayment(ctx, tx, q, posting)
	case voudomain.EntityBillIssue:
		return s.postBillIssue(ctx, tx, q, posting)
	case voudomain.EntityBillDiscount:
		return s.postBillDiscount(ctx, tx, q, posting)
	case voudomain.EntityBillMaturity:
		return s.postBillMaturity(ctx, tx, q, posting)
	case voudomain.EntityIntermediaryCalculation:
		return s.postIntermediaryCalculation(ctx, q, posting)
	case voudomain.EntityAssetAcquisition, voudomain.EntityAssetDepreciation,
		voudomain.EntityAssetSale, voudomain.EntityAssetLiquidation:
		return s.postAssetDocument(ctx, tx, q, posting)
	default:
		return domainError(ErrorValidation, "unsupported VOU entity", nil, nil)
	}
}

func (s *Service) postIntermediaryCalculation(
	ctx context.Context, q *dbsqlc.Queries, posting postingContext,
) error {
	include, err := requireEffectiveDate(posting, posting.Document.BusinessDate)
	if err != nil || !include {
		return err
	}
	summaries, err := q.ListVouIntermediaryCalculationSummaries(ctx, posting.Document.ID)
	if err != nil {
		return err
	}
	for _, summary := range summaries {
		category := summary.Category
		if err = q.InsertLedOtherPayableEntry(ctx, dbsqlc.InsertLedOtherPayableEntryParams{
			ID: newID(), GenerationID: posting.GenerationID, EntryType: posting.EntryType,
			SourceEntity: posting.Document.Entity, SourceDocumentID: posting.Document.ID,
			SourceDocumentNo: posting.Document.DocumentNo, SourceLineID: summary.ID,
			SourceRevision: posting.SourceRevision, EffectiveDate: posting.Document.BusinessDate,
			OccurredAt: posting.OccurredAt, ActorID: posting.ActorID, RequestID: posting.RequestID,
			Remark: posting.Document.Remark, CounterpartyEntity: summary.PayeeEntity,
			CounterpartyObjectID: summary.PayeeObjectID, CounterpartyVersionID: summary.PayeeVersionID,
			CounterpartyCode: summary.PayeeCode, CounterpartyName: summary.PayeeName,
			Currency: "CNY", AmountDeltaCents: -summary.AmountCents,
			PayableCategory: &category,
		}); err != nil {
			return err
		}
	}
	return nil
}

func fundParams(
	posting postingContext, doc dbsqlc.VouDocument,
	objectID, versionID, code, name string, delta int64,
) dbsqlc.InsertLedFundEntryParams {
	return dbsqlc.InsertLedFundEntryParams{
		ID: newID(), GenerationID: posting.GenerationID, EntryType: posting.EntryType,
		SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceDocumentNo: doc.DocumentNo,
		SourceRevision: posting.SourceRevision, EffectiveDate: doc.BusinessDate, OccurredAt: posting.OccurredAt,
		ActorID: posting.ActorID, RequestID: posting.RequestID,
		Remark:              preferredRemark(nil, doc.Remark),
		FundAccountObjectID: objectID, FundAccountVersionID: versionID,
		FundAccountCode: code, FundAccountName: name, Currency: deref(doc.Currency), AmountDeltaCents: delta,
	}
}

func partyParams(
	posting postingContext, doc dbsqlc.VouDocument, lineID string, effectiveDate pgtype.Date,
	objectID, versionID, code, name, entity string, delta int64,
) dbsqlc.InsertLedPartyEntryParams {
	return dbsqlc.InsertLedPartyEntryParams{
		ID: newID(), GenerationID: posting.GenerationID, EntryType: posting.EntryType,
		SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceDocumentNo: doc.DocumentNo,
		SourceLineID: lineID, SourceRevision: posting.SourceRevision, EffectiveDate: effectiveDate,
		OccurredAt: posting.OccurredAt, ActorID: posting.ActorID, RequestID: posting.RequestID,
		Remark:             preferredRemark(nil, doc.Remark),
		CounterpartyEntity: entity, CounterpartyObjectID: objectID, CounterpartyVersionID: versionID,
		CounterpartyCode: code, CounterpartyName: name, Currency: deref(doc.Currency), AmountDeltaCents: delta,
	}
}

func lockInventoryDimension(ctx context.Context, tx pgx.Tx, warehouseID, productID string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, warehouseID+"/"+productID)
	return err
}

func lockPartyDimension(ctx context.Context, tx pgx.Tx, entity, objectID, currency string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, entity+"/"+objectID+"/"+currency)
	return err
}

func preferredRemark(line, document *string) *string {
	for _, value := range []*string{line, document} {
		if value == nil {
			continue
		}
		trimmed := strings.TrimSpace(*value)
		if trimmed != "" {
			return &trimmed
		}
	}
	return nil
}

func eventFailure(err error) error {
	var domainErr *DomainError
	if errors.As(err, &domainErr) && domainErr.Kind != ErrorInternal {
		return txevent.Reject(domainErr.Message, domainErr.Data)
	}
	return err
}
