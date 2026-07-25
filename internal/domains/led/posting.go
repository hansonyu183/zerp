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
	for _, stage := range []string{"RECEIPT", "SIGNOFF"} {
		if err := bus.Subscribe(voudomain.IntermediaryStageTopic(stage, "CONFIRMED"),
			"led-intermediary-v2-posting", s.HandleIntermediaryStage); err != nil {
			return err
		}
		if err := bus.Subscribe(voudomain.IntermediaryStageTopic(stage, "UNCONFIRMED"),
			"led-intermediary-v2-reversal", s.HandleIntermediaryStage); err != nil {
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
	missingPrices := make([]string, 0)
	for _, document := range documents {
		if document.Entity != voudomain.EntityIntermediarySaleOrder ||
			document.BusinessDate.Time.Before(control.CutoverDate.Time) {
			continue
		}
		lines, lineErr := q.ListVouProductLines(ctx, document.ID)
		if lineErr != nil {
			return MutationResult{}, s.internal("preflight intermediary prices", lineErr)
		}
		for _, line := range lines {
			if line.PurchaseUnitPriceCents == nil {
				missingPrices = append(missingPrices, document.DocumentNo)
				break
			}
		}
	}
	if len(missingPrices) > 0 {
		return MutationResult{}, domainError(
			ErrorConflict, "executed intermediary documents are missing purchaseUnitPrice",
			map[string]any{"documentNos": missingPrices}, nil,
		)
	}

	generationID := newID()
	if err = q.InsertLedGeneration(ctx, dbsqlc.InsertLedGenerationParams{
		ID: generationID, CutoverDate: control.CutoverDate, ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("insert ledger generation", err)
	}
	if err = q.InsertLedOpeningInventoryFromDraft(ctx, generationID); err != nil {
		return MutationResult{}, s.writeError("copy inventory opening", err)
	}
	if err = q.InsertLedOpeningFundFromDraft(ctx, generationID); err != nil {
		return MutationResult{}, s.writeError("copy fund opening", err)
	}
	if err = q.InsertLedOpeningPartyFromDraft(ctx, generationID); err != nil {
		return MutationResult{}, s.writeError("copy party opening", err)
	}
	if err = q.InsertLedOpeningContainerFromDraft(ctx, generationID); err != nil {
		return MutationResult{}, s.writeError("copy container opening", err)
	}
	openingTime := time.Date(
		control.CutoverDate.Time.Year(), control.CutoverDate.Time.Month(), control.CutoverDate.Time.Day(),
		0, 0, 0, 0, time.UTC,
	)
	openingOccurredAt := pgtype.Timestamptz{Time: openingTime, Valid: true}
	if err = q.InsertLedOpeningInventoryEntries(ctx, dbsqlc.InsertLedOpeningInventoryEntriesParams{
		GenerationID: generationID, CutoverDate: control.CutoverDate, OccurredAt: openingOccurredAt,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("post inventory opening", err)
	}
	if err = q.InsertLedOpeningFundEntries(ctx, dbsqlc.InsertLedOpeningFundEntriesParams{
		GenerationID: generationID, CutoverDate: control.CutoverDate, OccurredAt: openingOccurredAt,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("post fund opening", err)
	}
	if err = q.InsertLedOpeningPartyEntries(ctx, dbsqlc.InsertLedOpeningPartyEntriesParams{
		GenerationID: generationID, CutoverDate: control.CutoverDate, OccurredAt: openingOccurredAt,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("post party opening", err)
	}
	if err = q.InsertLedOpeningContainerEntries(ctx, dbsqlc.InsertLedOpeningContainerEntriesParams{
		GenerationID: generationID, CutoverDate: control.CutoverDate, OccurredAt: openingOccurredAt,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("post container opening", err)
	}
	for _, document := range documents {
		postedBy := actorID
		if document.ExecutedBy != nil {
			postedBy = *document.ExecutedBy
		}
		occurredAt := document.ExecutedAt
		if !occurredAt.Valid {
			occurredAt = document.UpdatedAt
		}
		if err = s.postDocument(ctx, tx, q, postingContext{
			GenerationID: generationID, CutoverDate: control.CutoverDate.Time, Document: document,
			EntryType: "POSTING", SourceRevision: document.Revision, OccurredAt: occurredAt,
			ActorID: postedBy, RequestID: "led-rebuild/" + requestID, Live: false,
		}); err != nil {
			return MutationResult{}, err
		}
	}
	stageRows, err := tx.Query(ctx, `
		SELECT c.stage,c.document_id,d.document_no,d.revision,c.id,c.child_no,c.revision,
		       COALESCE(c.final_by,c.updated_by),c.final_at
		FROM vou_intermediary_children c
		JOIN vou_documents d ON d.id=c.document_id
		WHERE (c.stage='RECEIPT' AND c.status='CONFIRMED')
		   OR (c.stage='SIGNOFF' AND c.status='CONFIRMED')
		ORDER BY c.final_at,c.id`)
	if err != nil {
		return MutationResult{}, s.internal("list V2 intermediary stages", err)
	}
	for stageRows.Next() {
		var event voudomain.IntermediaryStageEvent
		var occurredAt pgtype.Timestamptz
		if err = stageRows.Scan(&event.Stage, &event.DocumentID, &event.DocumentNo,
			&event.RootRevision, &event.ChildID, &event.ChildNo, &event.ChildRevision,
			&event.ActorID, &occurredAt); err != nil {
			stageRows.Close()
			return MutationResult{}, err
		}
		event.Action, event.RequestID = "CONFIRMED", "led-rebuild/"+requestID
		if err = s.postV2Stage(ctx, tx, generationID, control.CutoverDate.Time, event, false); err != nil {
			stageRows.Close()
			return MutationResult{}, err
		}
	}
	if err = stageRows.Err(); err != nil {
		stageRows.Close()
		return MutationResult{}, err
	}
	stageRows.Close()
	negative, err := q.HasNegativeLedInventoryTimeline(ctx, generationID)
	if err != nil {
		return MutationResult{}, s.internal("validate rebuilt inventory", err)
	}
	if negative {
		return MutationResult{}, domainError(ErrorConflict, "inventory timeline would become negative", nil, nil)
	}
	if control.ActiveGenerationID != nil {
		if err = q.ArchiveActiveLedGeneration(ctx, *control.ActiveGenerationID); err != nil {
			return MutationResult{}, s.writeError("archive ledger generation", err)
		}
	}
	revision, err := q.ActivateLedControl(ctx, dbsqlc.ActivateLedControlParams{
		CutoverDate: control.CutoverDate, GenerationID: &generationID, ActorID: &actorID, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("activate ledger control", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		Event: "ACTIVATED", From: &control.Status, To: StatusActive, GenerationID: &generationID,
		Revision: revision, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"documentCount": len(documents), "cutoverDate": formatDate(control.CutoverDate)},
	}); err != nil {
		return MutationResult{}, s.writeError("audit activation", err)
	}
	if err = clearDraft(ctx, q); err != nil {
		return MutationResult{}, s.writeError("clear activated draft", err)
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
	inventory, err := q.ListLedInventoryEntriesBySource(ctx, dbsqlc.ListLedInventoryEntriesBySourceParams{
		GenerationID: generationID, SourceDocumentID: event.DocumentID,
	})
	if err != nil {
		return err
	}
	fund, err := q.ListLedFundEntriesBySource(ctx, dbsqlc.ListLedFundEntriesBySourceParams{
		GenerationID: generationID, SourceDocumentID: event.DocumentID,
	})
	if err != nil {
		return err
	}
	party, err := q.ListLedPartyEntriesBySource(ctx, dbsqlc.ListLedPartyEntriesBySourceParams{
		GenerationID: generationID, SourceDocumentID: event.DocumentID,
	})
	if err != nil {
		return err
	}
	maxRevision := int64(0)
	for _, row := range inventory {
		if row.SourceRevision > maxRevision {
			maxRevision = row.SourceRevision
		}
	}
	for _, row := range fund {
		if row.SourceRevision > maxRevision {
			maxRevision = row.SourceRevision
		}
	}
	for _, row := range party {
		if row.SourceRevision > maxRevision {
			maxRevision = row.SourceRevision
		}
	}
	var occurredAt pgtype.Timestamptz
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&occurredAt); err != nil {
		return err
	}
	for _, row := range inventory {
		if row.SourceRevision != maxRevision {
			continue
		}
		if err = lockInventoryDimension(ctx, tx, row.WarehouseObjectID, row.ProductObjectID); err != nil {
			return err
		}
		if err = q.InsertLedInventoryEntry(ctx, dbsqlc.InsertLedInventoryEntryParams{
			ID: newID(), GenerationID: generationID, EntryType: "REVERSAL",
			SourceEntity: row.SourceEntity, SourceDocumentID: row.SourceDocumentID,
			SourceDocumentNo: row.SourceDocumentNo, SourceLineID: row.SourceLineID,
			SourceRevision: event.Revision, EffectiveDate: row.EffectiveDate, OccurredAt: occurredAt,
			ActorID: event.ActorID, RequestID: event.RequestID, Reason: &event.Reason,
			WarehouseObjectID: row.WarehouseObjectID, WarehouseVersionID: row.WarehouseVersionID,
			WarehouseCode: row.WarehouseCode, WarehouseName: row.WarehouseName,
			ProductObjectID: row.ProductObjectID, ProductVersionID: row.ProductVersionID,
			ProductCode: row.ProductCode, ProductName: row.ProductName, ProductUnit: row.ProductUnit,
			QuantityDeltaMicros: -row.QuantityDeltaMicros,
		}); err != nil {
			return err
		}
	}
	for _, row := range fund {
		if row.SourceRevision != maxRevision {
			continue
		}
		if err = q.InsertLedFundEntry(ctx, dbsqlc.InsertLedFundEntryParams{
			ID: newID(), GenerationID: generationID, EntryType: "REVERSAL",
			SourceEntity: row.SourceEntity, SourceDocumentID: row.SourceDocumentID,
			SourceDocumentNo: row.SourceDocumentNo, SourceLineID: row.SourceLineID,
			SourceRevision: event.Revision, EffectiveDate: row.EffectiveDate, OccurredAt: occurredAt,
			ActorID: event.ActorID, RequestID: event.RequestID, Reason: &event.Reason,
			FundAccountObjectID: row.FundAccountObjectID, FundAccountVersionID: row.FundAccountVersionID,
			FundAccountCode: row.FundAccountCode, FundAccountName: row.FundAccountName,
			Currency: row.Currency, AmountDeltaCents: -row.AmountDeltaCents,
		}); err != nil {
			return err
		}
	}
	for _, row := range party {
		if row.SourceRevision != maxRevision {
			continue
		}
		if err = q.InsertLedPartyEntry(ctx, dbsqlc.InsertLedPartyEntryParams{
			ID: newID(), GenerationID: generationID, EntryType: "REVERSAL",
			SourceEntity: row.SourceEntity, SourceDocumentID: row.SourceDocumentID,
			SourceDocumentNo: row.SourceDocumentNo, SourceLineID: row.SourceLineID,
			SourceRevision: event.Revision, EffectiveDate: row.EffectiveDate, OccurredAt: occurredAt,
			ActorID: event.ActorID, RequestID: event.RequestID, Reason: &event.Reason,
			CounterpartyEntity: row.CounterpartyEntity, CounterpartyObjectID: row.CounterpartyObjectID,
			CounterpartyVersionID: row.CounterpartyVersionID, CounterpartyCode: row.CounterpartyCode,
			CounterpartyName: row.CounterpartyName, Currency: row.Currency,
			AmountDeltaCents: -row.AmountDeltaCents,
		}); err != nil {
			return err
		}
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
	doc := posting.Document
	if !posting.OccurredAt.Valid {
		posting.OccurredAt = pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	}
	requireDate := func(date pgtype.Date) (bool, error) {
		if !date.Valid {
			return false, domainError(ErrorConflict, "executed document is missing an effective date", map[string]any{"documentNo": doc.DocumentNo}, nil)
		}
		before := date.Time.Before(posting.CutoverDate)
		if posting.Live && before {
			return false, domainError(ErrorConflict, "document effect predates ledger cutover", map[string]any{"documentNo": doc.DocumentNo}, nil)
		}
		return !before, nil
	}
	switch doc.Entity {
	case voudomain.EntitySaleOrder:
		detail, err := q.GetVouSaleOrderDetail(ctx, doc.ID)
		if err != nil {
			return s.internal("read sale ledger detail", err)
		}
		includeInventory, err := requireDate(detail.OutboundDate)
		if err != nil {
			return err
		}
		includeParty, err := requireDate(doc.BusinessDate)
		if err != nil {
			return err
		}
		lines, err := q.ListVouProductLines(ctx, doc.ID)
		if err != nil {
			return s.internal("read sale ledger lines", err)
		}
		for _, line := range lines {
			if includeInventory {
				if line.OutboundQtyMicros == nil || detail.WarehouseObjectID == nil || detail.WarehouseVersionID == nil ||
					detail.WarehouseCode == nil || detail.WarehouseName == nil {
					return domainError(ErrorConflict, "executed sale is missing inventory data", map[string]any{"documentNo": doc.DocumentNo}, nil)
				}
				if err = lockInventoryDimension(ctx, tx, *detail.WarehouseObjectID, line.ProductObjectID); err != nil {
					return s.internal("lock sale inventory", err)
				}
				if err = q.InsertLedInventoryEntry(ctx, inventoryParams(posting, doc, line, detail.OutboundDate,
					*detail.WarehouseObjectID, *detail.WarehouseVersionID, *detail.WarehouseCode, *detail.WarehouseName,
					-*line.OutboundQtyMicros)); err != nil {
					return s.writeError("post sale inventory", err)
				}
			}
			if includeParty && line.SignedQtyMicros != nil && *line.SignedQtyMicros > 0 {
				amount, amountErr := lineAmountCents(*line.SignedQtyMicros, line.UnitPriceCents)
				if amountErr != nil {
					return domainError(ErrorConflict, "invalid sale ledger amount", map[string]any{"documentNo": doc.DocumentNo}, amountErr)
				}
				if err = q.InsertLedPartyEntry(ctx, partyParams(posting, doc, line.ID, doc.BusinessDate,
					detail.CustomerObjectID, detail.CustomerVersionID, detail.CustomerCode, detail.CustomerName, "customer", amount)); err != nil {
					return s.writeError("post sale receivable", err)
				}
			}
		}
	case voudomain.EntityPurchaseOrder:
		detail, err := q.GetVouPurchaseOrderDetail(ctx, doc.ID)
		if err != nil {
			return s.internal("read purchase ledger detail", err)
		}
		includeInventory, err := requireDate(detail.InboundDate)
		if err != nil {
			return err
		}
		includeParty, err := requireDate(doc.BusinessDate)
		if err != nil {
			return err
		}
		lines, err := q.ListVouProductLines(ctx, doc.ID)
		if err != nil {
			return s.internal("read purchase ledger lines", err)
		}
		for _, line := range lines {
			if line.InboundQtyMicros == nil {
				return domainError(ErrorConflict, "executed purchase is missing inbound quantity", map[string]any{"documentNo": doc.DocumentNo}, nil)
			}
			if includeInventory {
				if detail.WarehouseObjectID == nil || detail.WarehouseVersionID == nil ||
					detail.WarehouseCode == nil || detail.WarehouseName == nil {
					return domainError(ErrorConflict, "executed purchase is missing warehouse data", map[string]any{"documentNo": doc.DocumentNo}, nil)
				}
				if err = lockInventoryDimension(ctx, tx, *detail.WarehouseObjectID, line.ProductObjectID); err != nil {
					return s.internal("lock purchase inventory", err)
				}
				if err = q.InsertLedInventoryEntry(ctx, inventoryParams(posting, doc, line, detail.InboundDate,
					*detail.WarehouseObjectID, *detail.WarehouseVersionID, *detail.WarehouseCode, *detail.WarehouseName,
					*line.InboundQtyMicros)); err != nil {
					return s.writeError("post purchase inventory", err)
				}
			}
			if includeParty {
				amount, amountErr := lineAmountCents(*line.InboundQtyMicros, line.UnitPriceCents)
				if amountErr != nil {
					return domainError(ErrorConflict, "invalid purchase ledger amount", map[string]any{"documentNo": doc.DocumentNo}, amountErr)
				}
				if err = q.InsertLedPartyEntry(ctx, partyParams(posting, doc, line.ID, doc.BusinessDate,
					detail.SupplierObjectID, detail.SupplierVersionID, detail.SupplierCode, detail.SupplierName, "supplier", -amount)); err != nil {
					return s.writeError("post purchase payable", err)
				}
			}
		}
	case voudomain.EntityIntermediarySaleOrder:
		detail, err := q.GetVouIntermediarySaleOrderDetail(ctx, doc.ID)
		if err != nil {
			return s.internal("read intermediary ledger detail", err)
		}
		include, err := requireDate(doc.BusinessDate)
		if err != nil || !include {
			return err
		}
		lines, err := q.ListVouProductLines(ctx, doc.ID)
		if err != nil {
			return s.internal("read intermediary ledger lines", err)
		}
		for _, line := range lines {
			if line.SignedQtyMicros == nil || *line.SignedQtyMicros == 0 {
				continue
			}
			if line.PurchaseUnitPriceCents == nil {
				return domainError(ErrorConflict, "intermediary purchaseUnitPrice is missing", map[string]any{"documentNo": doc.DocumentNo}, nil)
			}
			saleAmount, amountErr := lineAmountCents(*line.SignedQtyMicros, line.UnitPriceCents)
			if amountErr != nil {
				return domainError(ErrorConflict, "invalid intermediary sale amount", nil, amountErr)
			}
			purchaseAmount, amountErr := lineAmountCents(*line.SignedQtyMicros, *line.PurchaseUnitPriceCents)
			if amountErr != nil {
				return domainError(ErrorConflict, "invalid intermediary purchase amount", nil, amountErr)
			}
			if err = q.InsertLedPartyEntry(ctx, partyParams(posting, doc, line.ID, doc.BusinessDate,
				detail.CustomerObjectID, detail.CustomerVersionID, detail.CustomerCode, detail.CustomerName, "customer", saleAmount)); err != nil {
				return s.writeError("post intermediary receivable", err)
			}
			if err = q.InsertLedPartyEntry(ctx, partyParams(posting, doc, line.ID, doc.BusinessDate,
				detail.SupplierObjectID, detail.SupplierVersionID, detail.SupplierCode, detail.SupplierName, "supplier", -purchaseAmount)); err != nil {
				return s.writeError("post intermediary payable", err)
			}
		}
	case voudomain.EntityReceipt:
		include, err := requireDate(doc.BusinessDate)
		if err != nil || !include {
			return err
		}
		detail, err := q.GetVouReceiptDetail(ctx, doc.ID)
		if err != nil {
			return s.internal("read receipt ledger detail", err)
		}
		if err = q.InsertLedFundEntry(ctx, fundParams(posting, doc, detail.FundAccountObjectID,
			detail.FundAccountVersionID, detail.FundAccountCode, detail.FundAccountName, doc.TotalAmountCents)); err != nil {
			return s.writeError("post receipt fund", err)
		}
		if err = q.InsertLedPartyEntry(ctx, partyParams(posting, doc, "", doc.BusinessDate,
			detail.CounterpartyObjectID, detail.CounterpartyVersionID, detail.CounterpartyCode,
			detail.CounterpartyName, detail.CounterpartyEntity, -doc.TotalAmountCents)); err != nil {
			return s.writeError("post receipt party", err)
		}
	case voudomain.EntityPayment:
		include, err := requireDate(doc.BusinessDate)
		if err != nil || !include {
			return err
		}
		detail, err := q.GetVouPaymentDetail(ctx, doc.ID)
		if err != nil {
			return s.internal("read payment ledger detail", err)
		}
		if err = q.InsertLedFundEntry(ctx, fundParams(posting, doc, detail.FundAccountObjectID,
			detail.FundAccountVersionID, detail.FundAccountCode, detail.FundAccountName, -doc.TotalAmountCents)); err != nil {
			return s.writeError("post payment fund", err)
		}
		if err = q.InsertLedPartyEntry(ctx, partyParams(posting, doc, "", doc.BusinessDate,
			detail.CounterpartyObjectID, detail.CounterpartyVersionID, detail.CounterpartyCode,
			detail.CounterpartyName, detail.CounterpartyEntity, doc.TotalAmountCents)); err != nil {
			return s.writeError("post payment party", err)
		}
	case voudomain.EntityExpenseReimbursement:
		include, err := requireDate(doc.BusinessDate)
		if err != nil || !include {
			return err
		}
		detail, err := q.GetVouExpenseReimbursementDetail(ctx, doc.ID)
		if err != nil {
			return s.internal("read expense ledger detail", err)
		}
		if err = q.InsertLedFundEntry(ctx, fundParams(posting, doc, detail.FundAccountObjectID,
			detail.FundAccountVersionID, detail.FundAccountCode, detail.FundAccountName, -doc.TotalAmountCents)); err != nil {
			return s.writeError("post expense fund", err)
		}
	case voudomain.EntityOtherIncome:
		include, err := requireDate(doc.BusinessDate)
		if err != nil || !include {
			return err
		}
		detail, err := q.GetVouOtherIncomeDetail(ctx, doc.ID)
		if err != nil {
			return s.internal("read other income ledger detail", err)
		}
		if err = q.InsertLedFundEntry(ctx, fundParams(posting, doc, detail.FundAccountObjectID,
			detail.FundAccountVersionID, detail.FundAccountCode, detail.FundAccountName, doc.TotalAmountCents)); err != nil {
			return s.writeError("post other income fund", err)
		}
	default:
		return domainError(ErrorValidation, "unsupported VOU entity", nil, nil)
	}
	return nil
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
