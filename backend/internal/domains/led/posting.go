package led

import (
	"context"
	"errors"
	"fmt"
	"time"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	voudomain "github.com/hansonyu183/zerp-back/internal/domains/vou"
	"github.com/hansonyu183/zerp-back/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var vouEntities = [...]string{
	voudomain.EntitySaleOrder,
	voudomain.EntityPurchaseOrder,
	voudomain.EntityIntermediarySaleOrder,
	voudomain.EntityReceipt,
	voudomain.EntityPayment,
	voudomain.EntityExpenseReimbursement,
	voudomain.EntityOtherIncome,
}

func (s *Service) RegisterSubscriptions(bus *txevent.Bus) error {
	if bus == nil {
		return errors.New("LED event bus is required")
	}
	for _, entity := range vouEntities {
		if err := bus.Subscribe(voudomain.DocumentExecutedTopic(entity), "led-posting", s.HandleDocumentExecuted); err != nil {
			return err
		}
		if err := bus.Subscribe(voudomain.DocumentUnexecutedTopic(entity), "led-reversal", s.HandleDocumentUnexecuted); err != nil {
			return err
		}
	}
	for _, entity := range []string{voudomain.EntityGoodsReceipt, voudomain.EntitySignoffNote} {
		if err := bus.Subscribe(voudomain.ManagedDocumentFinalizedTopic(entity),
			"led-wfl-posting", s.HandleManagedDocument); err != nil {
			return err
		}
		if err := bus.Subscribe(voudomain.ManagedDocumentReversedTopic(entity),
			"led-wfl-reversal", s.HandleManagedDocument); err != nil {
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
	documents, err := q.ListExecutedVouDocumentsForLed(ctx)
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
	if err = s.replayManagedDocuments(ctx, tx, generationID, control.CutoverDate.Time, requestID); err != nil {
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

func (s *Service) HandleDocumentExecuted(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
	event, ok := raw.(voudomain.DocumentExecutedEvent)
	if !ok {
		return fmt.Errorf("unexpected LED executed event %T", raw)
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
		OccurredAt: document.ExecutedAt, ActorID: event.ActorID, RequestID: event.RequestID, Live: true,
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

func (s *Service) HandleDocumentUnexecuted(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
	event, ok := raw.(voudomain.DocumentUnexecutedEvent)
	if !ok {
		return fmt.Errorf("unexpected LED unexecuted event %T", raw)
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
		return txevent.Reject("document predates the active ledger cutover", nil)
	}
	var occurredAt pgtype.Timestamptz
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&occurredAt); err != nil {
		return err
	}
	if err = s.reverseDocumentEntries(ctx, tx, q, generationID, event, occurredAt); err != nil {
		return err
	}
	negative, err := q.HasNegativeLedInventoryTimeline(ctx, generationID)
	if err != nil {
		return err
	}
	if negative {
		return txevent.Reject("purchase reversal would make inventory negative", nil)
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
	case voudomain.EntitySaleOrder:
		return s.postSale(ctx, tx, q, posting)
	case voudomain.EntityPurchaseOrder:
		return s.postPurchase(ctx, tx, q, posting)
	case voudomain.EntityIntermediarySaleOrder:
		return s.postIntermediarySale(ctx, q, posting)
	case voudomain.EntityReceipt:
		return s.postReceipt(ctx, q, posting)
	case voudomain.EntityPayment:
		return s.postPayment(ctx, q, posting)
	case voudomain.EntityExpenseReimbursement:
		return s.postExpense(ctx, q, posting)
	case voudomain.EntityOtherIncome:
		return s.postOtherIncome(ctx, q, posting)
	default:
		return domainError(ErrorValidation, "unsupported VOU entity", nil, nil)
	}
}

func inventoryParams(
	posting postingContext, doc dbsqlc.VouDocument, line dbsqlc.VouProductLine, effectiveDate pgtype.Date,
	warehouseObjectID, warehouseVersionID, warehouseCode, warehouseName string, delta int64,
) dbsqlc.InsertLedInventoryEntryParams {
	return dbsqlc.InsertLedInventoryEntryParams{
		ID: newID(), GenerationID: posting.GenerationID, EntryType: posting.EntryType,
		SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceDocumentNo: doc.DocumentNo,
		SourceLineID: line.ID, SourceRevision: posting.SourceRevision, EffectiveDate: effectiveDate,
		OccurredAt: posting.OccurredAt, ActorID: posting.ActorID, RequestID: posting.RequestID,
		WarehouseObjectID: warehouseObjectID, WarehouseVersionID: warehouseVersionID,
		WarehouseCode: warehouseCode, WarehouseName: warehouseName,
		ProductObjectID: line.ProductObjectID, ProductVersionID: line.ProductVersionID,
		ProductCode: line.ProductCode, ProductName: line.ProductName, ProductUnit: line.ProductUnit,
		QuantityDeltaMicros: delta,
	}
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
		FundAccountObjectID: objectID, FundAccountVersionID: versionID,
		FundAccountCode: code, FundAccountName: name, Currency: doc.Currency, AmountDeltaCents: delta,
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
		CounterpartyEntity: entity, CounterpartyObjectID: objectID, CounterpartyVersionID: versionID,
		CounterpartyCode: code, CounterpartyName: name, Currency: doc.Currency, AmountDeltaCents: delta,
	}
}

func lockInventoryDimension(ctx context.Context, tx pgx.Tx, warehouseID, productID string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, warehouseID+"/"+productID)
	return err
}

func eventFailure(err error) error {
	var domainErr *DomainError
	if errors.As(err, &domainErr) && domainErr.Kind != ErrorInternal {
		return txevent.Reject(domainErr.Message, domainErr.Data)
	}
	return err
}
