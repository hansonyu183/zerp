package led

import (
	"context"
	"errors"
	"math/big"
	"strings"
	"time"
	"unicode/utf8"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type inventoryCostBalance struct {
	warehouseObjectID, warehouseVersionID, warehouseCode, warehouseName      string
	productObjectID, productVersionID, productCode, productName, productUnit string
	quantity, amount                                                         int64
}

type inventoryCostEntry struct {
	id, sourceEntity, sourceDocumentID, sourceLineID string
	effectiveDate, occurredAt                        time.Time
	warehouseObjectID, warehouseVersionID            string
	warehouseCode, warehouseName                     string
	productObjectID, productVersionID                string
	productCode, productName, productUnit            string
	quantity                                         int64
	currency                                         *string
	amount                                           *int64
}

type outboundCostAllocation struct {
	quantity int64
	amount   int64
}

func (s *Service) EnsureReady(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return s.internal("begin ledger initialization", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	var rebuild bool
	var previousGenerationID *string
	err = tx.QueryRow(ctx, `SELECT rebuild_required,active_generation_id
		FROM led_control WHERE singleton=true FOR UPDATE`).Scan(&rebuild, &previousGenerationID)
	if err != nil {
		return s.internal("lock ledger initialization", err)
	}
	if !rebuild {
		return tx.Commit(ctx)
	}
	generationID := newID()
	cutoverDate := time.Date(1, 1, 1, 0, 0, 0, 0, time.UTC)
	if previousGenerationID == nil {
		if err = q.InsertLedGeneration(ctx, dbsqlc.InsertLedGenerationParams{
			ID: generationID, CutoverDate: pgtype.Date{Time: cutoverDate, Valid: true},
			ActorID: systemidentity.UserID, RequestID: "approved-posting-rebuild",
		}); err != nil {
			return s.writeError("create rebuilt ledger generation", err)
		}
	} else {
		if err = tx.QueryRow(ctx, `SELECT cutover_date FROM led_generations
			WHERE id=$1 AND status='ACTIVE'`, *previousGenerationID).Scan(&cutoverDate); err != nil {
			return s.internal("get active ledger cutover", err)
		}
		if err = clearDraft(ctx, q); err != nil {
			return s.writeError("clear approved-posting rebuild draft", err)
		}
		if err = q.CopyLedOpeningToDraftInventory(ctx, *previousGenerationID); err != nil {
			return s.writeError("copy inventory opening for approved-posting rebuild", err)
		}
		if err = q.CopyLedOpeningToDraftFund(ctx, *previousGenerationID); err != nil {
			return s.writeError("copy fund opening for approved-posting rebuild", err)
		}
		if err = q.CopyLedOpeningToDraftParty(ctx, *previousGenerationID); err != nil {
			return s.writeError("copy party opening for approved-posting rebuild", err)
		}
		if err = q.CopyLedOpeningToDraftContainer(ctx, *previousGenerationID); err != nil {
			return s.writeError("copy container opening for approved-posting rebuild", err)
		}
		if err = s.createOpeningGeneration(
			ctx, q, generationID, pgtype.Date{Time: cutoverDate, Valid: true},
			systemidentity.UserID, "approved-posting-rebuild",
		); err != nil {
			return err
		}
		if err = clearDraft(ctx, q); err != nil {
			return s.writeError("clear approved-posting rebuild draft", err)
		}
	}
	documents, err := q.ListPostedVouDocumentsForLed(ctx)
	if err != nil {
		return s.internal("list documents for approved-posting rebuild", err)
	}
	if err = s.replayVouDocuments(
		ctx, tx, q, generationID, cutoverDate,
		documents, systemidentity.UserID, "approved-posting-rebuild",
	); err != nil {
		return err
	}
	negative, err := q.HasNegativeLedInventoryTimeline(ctx, generationID)
	if err != nil {
		return s.internal("validate approved-posting rebuild", err)
	}
	if negative {
		return domainError(
			ErrorConflict,
			"approved posting rebuild would create negative inventory",
			nil,
			nil,
		)
	}
	if err = s.rebuildClosingSnapshots(ctx, tx, generationID, cutoverDate); err != nil {
		return err
	}
	if previousGenerationID != nil {
		if err = q.ArchiveActiveLedGeneration(ctx, *previousGenerationID); err != nil {
			return s.writeError("archive previous ledger generation", err)
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE led_control SET status='ACTIVE',rebuild_required=false,
		cutover_date=$2,active_generation_id=$1,revision=revision+1,
		updated_at=now(),updated_by=$3 WHERE singleton=true`, generationID, cutoverDate, systemidentity.UserID); err != nil {
		return s.writeError("finish ledger initialization", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return s.writeError("commit ledger initialization", err)
	}
	return nil
}

func (s *Service) rebuildClosingSnapshots(
	ctx context.Context,
	tx pgx.Tx,
	generationID string,
	cutoverDate time.Time,
) error {
	rows, err := tx.Query(ctx, `SELECT id,closing_date
		FROM led_closings WHERE status='ACTIVE'
		ORDER BY closing_date,id`)
	if err != nil {
		return s.internal("list closings for ledger rebuild", err)
	}
	type closingPeriod struct {
		id   string
		date time.Time
	}
	closings := make([]closingPeriod, 0)
	for rows.Next() {
		var closing closingPeriod
		if err = rows.Scan(&closing.id, &closing.date); err != nil {
			rows.Close()
			return s.internal("scan closing for ledger rebuild", err)
		}
		closings = append(closings, closing)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return s.internal("read closings for ledger rebuild", err)
	}
	rows.Close()
	for _, closing := range closings {
		for _, table := range []string{
			"led_inventory_cost_allocations", "led_closing_inventory", "led_closing_fund",
			"led_closing_party", "led_closing_container",
		} {
			if _, err = tx.Exec(ctx, "DELETE FROM "+table+" WHERE closing_id=$1", closing.id); err != nil {
				return s.writeError("clear closing snapshot for ledger rebuild", err)
			}
		}
	}
	periodStart := cutoverDate
	var previousClosingID *string
	for _, closing := range closings {
		if err = s.calculateInventoryClosing(
			ctx, tx, generationID, previousClosingID, closing.id, periodStart, closing.date,
		); err != nil {
			return err
		}
		if err = s.snapshotNonInventoryBalances(ctx, tx, generationID, closing.id, closing.date); err != nil {
			return err
		}
		id := closing.id
		previousClosingID = &id
		periodStart = closing.date.AddDate(0, 0, 1)
	}
	return nil
}

func (s *Service) GetClosing(ctx context.Context) (ClosingView, error) {
	view := ClosingView{
		Inventory: make([]InventoryOpeningView, 0),
		Fund:      make([]FundOpeningView, 0),
		Party:     make([]PartyOpeningView, 0),
		Container: make([]ContainerOpeningView, 0),
	}
	var closingID *string
	var closingDate *time.Time
	var openingDate *time.Time
	err := s.pool.QueryRow(ctx, `SELECT control.revision,control.last_closing_id,
		closing.closing_date,closing.opening_date
		FROM led_control control
		LEFT JOIN led_closings closing ON closing.id=control.last_closing_id
		WHERE control.singleton=true`).Scan(
		&view.Revision, &closingID, &closingDate, &openingDate,
	)
	if err != nil {
		return ClosingView{}, s.internal("get closing control", err)
	}
	if closingID == nil {
		return view, nil
	}
	view.LatestClosingDate = closingDate.Format(dateLayout)
	view.OpeningDate = openingDate.Format(dateLayout)
	if err = s.loadClosingInventory(ctx, *closingID, &view); err != nil {
		return ClosingView{}, err
	}
	if err = s.loadClosingFund(ctx, *closingID, &view); err != nil {
		return ClosingView{}, err
	}
	if err = s.loadClosingParty(ctx, *closingID, &view); err != nil {
		return ClosingView{}, err
	}
	if err = s.loadClosingContainer(ctx, *closingID, &view); err != nil {
		return ClosingView{}, err
	}
	return view, nil
}

func (s *Service) Close(
	ctx context.Context,
	input ClosingInput,
	actorID, requestID string,
) (ClosingMutationResult, error) {
	closingDate, err := validateClosingInput(input, actorID)
	if err != nil {
		return ClosingMutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ClosingMutationResult{}, s.internal("begin month-end close", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var revision int64
	var lastClosingID, generationID *string
	var rebuildRequired bool
	var cutoverDate time.Time
	err = tx.QueryRow(ctx, `SELECT revision,last_closing_id,active_generation_id,rebuild_required,cutover_date
		FROM led_control WHERE singleton=true FOR UPDATE`).
		Scan(&revision, &lastClosingID, &generationID, &rebuildRequired, &cutoverDate)
	if err != nil {
		return ClosingMutationResult{}, s.internal("lock closing control", err)
	}
	if revision != input.Revision || rebuildRequired || generationID == nil {
		return ClosingMutationResult{}, domainError(ErrorConflict, "ledger closing changed", nil, nil)
	}
	if closingDate.Before(cutoverDate) {
		return ClosingMutationResult{}, domainError(
			ErrorValidation, "closingDate cannot predate the ledger cutover", nil, nil,
		)
	}
	var periodStart = time.Date(1, 1, 1, 0, 0, 0, 0, time.UTC)
	if lastClosingID != nil {
		var previousDate time.Time
		if err = tx.QueryRow(ctx, `SELECT closing_date FROM led_closings
			WHERE id=$1 AND status='ACTIVE'`, *lastClosingID).Scan(&previousDate); err != nil {
			return ClosingMutationResult{}, s.internal("get previous closing", err)
		}
		if !closingDate.After(previousDate) {
			return ClosingMutationResult{}, domainError(
				ErrorValidation, "closingDate must be after the latest closing", nil, nil,
			)
		}
		periodStart = previousDate.AddDate(0, 0, 1)
	}
	var pendingCount int64
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM vou_documents
		WHERE business_date <= $1 AND status <> 'FINALIZED'`, closingDate).Scan(&pendingCount); err != nil {
		return ClosingMutationResult{}, s.internal("check unfinished documents", err)
	}
	if pendingCount != 0 {
		return ClosingMutationResult{}, domainError(
			ErrorConflict,
			"unfinished documents exist on or before the closing date",
			map[string]any{"count": pendingCount, "closingDate": closingDate.Format(dateLayout)},
			nil,
		)
	}
	calculationStart := periodStart
	if lastClosingID == nil {
		calculationStart = time.Date(cutoverDate.Year(), cutoverDate.Month(), 1, 0, 0, 0, 0, cutoverDate.Location())
		if cutoverDate.Year() == 1 {
			var firstActivityDate pgtype.Date
			if err = tx.QueryRow(ctx, `SELECT min(business_date) FROM vou_documents
				WHERE status='FINALIZED' AND business_date <= $1`, closingDate).Scan(&firstActivityDate); err != nil {
				return ClosingMutationResult{}, s.internal("find first document month for closing", err)
			}
			if firstActivityDate.Valid {
				calculationStart = time.Date(firstActivityDate.Time.Year(), firstActivityDate.Time.Month(), 1,
					0, 0, 0, 0, firstActivityDate.Time.Location())
			} else {
				calculationStart = time.Date(closingDate.Year(), closingDate.Month(), 1,
					0, 0, 0, 0, closingDate.Location())
			}
		}
	}
	var missingCalculationCount int64
	var firstMissingCalculationDate pgtype.Date
	if err = tx.QueryRow(ctx, `WITH required_months AS (
		SELECT (month_start + interval '1 month - 1 day')::date AS month_end
		FROM generate_series(date_trunc('month',$1::date),date_trunc('month',$2::date),interval '1 month') month_start
	)
	SELECT count(*),min(month_end) FROM required_months
	WHERE NOT EXISTS (
		SELECT 1 FROM vou_documents document
		WHERE document.entity='intermediary-calculation'
		  AND document.business_date=required_months.month_end
		  AND document.status='FINALIZED'
	)`, calculationStart, closingDate).Scan(&missingCalculationCount, &firstMissingCalculationDate); err != nil {
		return ClosingMutationResult{}, s.internal("check intermediary calculations", err)
	}
	if missingCalculationCount != 0 {
		firstMissing := ""
		if firstMissingCalculationDate.Valid {
			firstMissing = firstMissingCalculationDate.Time.Format(dateLayout)
		}
		return ClosingMutationResult{}, domainError(ErrorConflict,
			"every unclosed month must have an approved intermediary calculation before closing",
			map[string]any{"count": missingCalculationCount, "firstMissingDate": firstMissing,
				"closingDate": closingDate.Format(dateLayout)}, nil)
	}
	calculationRows, err := tx.Query(ctx, `SELECT id,document_no,business_date
		FROM vou_documents
		WHERE entity='intermediary-calculation' AND status='FINALIZED'
		  AND business_date BETWEEN date_trunc('month',$1::date)::date AND $2::date
		ORDER BY business_date,document_no`, calculationStart, closingDate)
	if err != nil {
		return ClosingMutationResult{}, s.internal("list intermediary calculations for closing validation", err)
	}
	type calculationForClosing struct {
		id, number string
		date       time.Time
	}
	calculations := make([]calculationForClosing, 0)
	for calculationRows.Next() {
		var calculation calculationForClosing
		if err = calculationRows.Scan(&calculation.id, &calculation.number, &calculation.date); err != nil {
			calculationRows.Close()
			return ClosingMutationResult{}, s.internal("scan intermediary calculation for closing validation", err)
		}
		calculations = append(calculations, calculation)
	}
	if err = calculationRows.Err(); err != nil {
		calculationRows.Close()
		return ClosingMutationResult{}, s.internal("read intermediary calculations for closing validation", err)
	}
	calculationRows.Close()
	for _, calculation := range calculations {
		if err = s.intermediaryValidator.ValidateIntermediaryCalculation(ctx, tx, calculation.id); err != nil {
			return ClosingMutationResult{}, domainError(
				ErrorConflict,
				"intermediary calculation source changed; recalculate before closing",
				map[string]any{
					"documentId": calculation.id, "documentNo": calculation.number,
					"businessDate": calculation.date.Format(dateLayout),
				},
				err,
			)
		}
	}
	closingID := newID()
	nextRevision := revision + 1
	if _, err = tx.Exec(ctx, `INSERT INTO led_closings(
		id,closing_date,opening_date,revision,closed_by,request_id
	) VALUES($1,$2,$3,$4,$5,$6)`,
		closingID, closingDate, closingDate.AddDate(0, 0, 1), nextRevision, actorID, requestID,
	); err != nil {
		return ClosingMutationResult{}, s.writeError("insert month-end closing", err)
	}
	if err = s.calculateInventoryClosing(
		ctx, tx, *generationID, lastClosingID, closingID, periodStart, closingDate,
	); err != nil {
		return ClosingMutationResult{}, err
	}
	if err = s.snapshotNonInventoryBalances(ctx, tx, *generationID, closingID, closingDate); err != nil {
		return ClosingMutationResult{}, err
	}
	var updatedRevision int64
	err = tx.QueryRow(ctx, `UPDATE led_control SET last_closing_id=$1,revision=revision+1,
		updated_at=now(),updated_by=$2 WHERE singleton=true AND revision=$3
		RETURNING revision`, closingID, actorID, revision).Scan(&updatedRevision)
	if errors.Is(err, pgx.ErrNoRows) {
		return ClosingMutationResult{}, domainError(ErrorConflict, "ledger closing changed", nil, err)
	}
	if err != nil {
		return ClosingMutationResult{}, s.writeError("advance closing control", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return ClosingMutationResult{}, s.writeError("commit month-end closing", err)
	}
	return ClosingMutationResult{
		Revision:          updatedRevision,
		LatestClosingDate: closingDate.Format(dateLayout),
		OpeningDate:       closingDate.AddDate(0, 0, 1).Format(dateLayout),
	}, nil
}

func (s *Service) Unclose(
	ctx context.Context,
	input UncloseInput,
	actorID, requestID string,
) (ClosingMutationResult, error) {
	reason := strings.TrimSpace(input.Reason)
	if input.Revision < 1 || !validID(actorID) ||
		utf8.RuneCountInString(reason) < 1 || utf8.RuneCountInString(reason) > 1000 {
		return ClosingMutationResult{}, domainError(ErrorValidation, "invalid unclose request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ClosingMutationResult{}, s.internal("begin unclose", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var revision int64
	var closingID *string
	err = tx.QueryRow(ctx, `SELECT revision,last_closing_id FROM led_control
		WHERE singleton=true FOR UPDATE`).Scan(&revision, &closingID)
	if err != nil {
		return ClosingMutationResult{}, s.internal("lock unclose control", err)
	}
	if revision != input.Revision || closingID == nil {
		return ClosingMutationResult{}, domainError(ErrorConflict, "ledger closing changed", nil, nil)
	}
	var closingDate time.Time
	if err = tx.QueryRow(ctx, `UPDATE led_closings SET status='REVERSED',
		reversed_at=now(),reversed_by=$2,reverse_reason=$3,reverse_request_id=$4
		WHERE id=$1 AND status='ACTIVE' RETURNING closing_date`,
		*closingID, actorID, reason, requestID).Scan(&closingDate); err != nil {
		return ClosingMutationResult{}, s.writeError("reverse latest closing", err)
	}
	for _, table := range []string{
		"led_inventory_cost_allocations", "led_closing_inventory", "led_closing_fund",
		"led_closing_party", "led_closing_container",
	} {
		if _, err = tx.Exec(ctx, "DELETE FROM "+table+" WHERE closing_id=$1", *closingID); err != nil {
			return ClosingMutationResult{}, s.writeError("clear reversed closing snapshot", err)
		}
	}
	var previousID *string
	var previousDate *time.Time
	err = tx.QueryRow(ctx, `SELECT id,closing_date FROM led_closings
		WHERE status='ACTIVE' AND closing_date < $1
		ORDER BY closing_date DESC LIMIT 1`, closingDate).Scan(&previousID, &previousDate)
	if errors.Is(err, pgx.ErrNoRows) {
		previousID, previousDate, err = nil, nil, nil
	}
	if err != nil {
		return ClosingMutationResult{}, s.internal("find previous closing", err)
	}
	var updatedRevision int64
	err = tx.QueryRow(ctx, `UPDATE led_control SET last_closing_id=$1,revision=revision+1,
		updated_at=now(),updated_by=$2 WHERE singleton=true AND revision=$3
		RETURNING revision`, previousID, actorID, revision).Scan(&updatedRevision)
	if err != nil {
		return ClosingMutationResult{}, s.writeError("retreat closing control", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return ClosingMutationResult{}, s.writeError("commit unclose", err)
	}
	result := ClosingMutationResult{Revision: updatedRevision}
	if previousDate != nil {
		result.LatestClosingDate = previousDate.Format(dateLayout)
		result.OpeningDate = previousDate.AddDate(0, 0, 1).Format(dateLayout)
	}
	return result, nil
}

func (s *Service) ClosingHistory(
	ctx context.Context,
	input HistoryInput,
) (Page[ClosingHistoryView], error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 100 {
		return Page[ClosingHistoryView]{}, domainError(ErrorValidation, "invalid history page", nil, nil)
	}
	page := Page[ClosingHistoryView]{
		Items: make([]ClosingHistoryView, 0), Page: input.Page, PageSize: input.PageSize,
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM led_closings`).Scan(&page.Total); err != nil {
		return Page[ClosingHistoryView]{}, s.internal("count closing history", err)
	}
	rows, err := s.pool.Query(ctx, `SELECT id,closing_date,opening_date,status,revision,
		closed_at,closed_by,request_id,reversed_at,reversed_by,reverse_reason,reverse_request_id
		FROM led_closings ORDER BY closed_at DESC,id DESC LIMIT $1 OFFSET $2`,
		input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return Page[ClosingHistoryView]{}, s.internal("list closing history", err)
	}
	defer rows.Close()
	for rows.Next() {
		var item ClosingHistoryView
		var closingDate, openingDate time.Time
		var reversedAt *time.Time
		var reversedBy, reverseReason, reverseRequestID *string
		if err = rows.Scan(
			&item.ID, &closingDate, &openingDate, &item.Status, &item.Revision,
			&item.ClosedAt, &item.ClosedBy, &item.RequestID, &reversedAt,
			&reversedBy, &reverseReason, &reverseRequestID,
		); err != nil {
			return Page[ClosingHistoryView]{}, s.internal("scan closing history", err)
		}
		item.ClosingDate, item.OpeningDate = closingDate.Format(dateLayout), openingDate.Format(dateLayout)
		item.ReversedAt = reversedAt
		item.ReversedBy, item.ReverseReason, item.ReverseRequestID =
			deref(reversedBy), deref(reverseReason), deref(reverseRequestID)
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return Page[ClosingHistoryView]{}, s.internal("read closing history", err)
	}
	return page, nil
}

func validateClosingInput(input ClosingInput, actorID string) (time.Time, error) {
	if input.Revision < 1 || !validID(actorID) {
		return time.Time{}, domainError(ErrorValidation, "invalid closing request", nil, nil)
	}
	value, err := time.Parse(dateLayout, strings.TrimSpace(input.ClosingDate))
	if err != nil {
		return time.Time{}, domainError(ErrorValidation, "invalid closingDate", nil, err)
	}
	nextDay := value.AddDate(0, 0, 1)
	now := time.Now().In(time.Local)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	if nextDay.Day() != 1 || !value.Before(today) {
		return time.Time{}, domainError(
			ErrorValidation, "closingDate must be a past calendar month end", nil, nil,
		)
	}
	return value, nil
}

func (s *Service) calculateInventoryClosing(
	ctx context.Context,
	tx pgx.Tx,
	generationID string,
	previousClosingID *string,
	closingID string,
	periodStart, closingDate time.Time,
) error {
	balances := make(map[string]*inventoryCostBalance)
	if previousClosingID == nil {
		rows, err := tx.Query(ctx, `SELECT warehouse_object_id,warehouse_version_id,
			warehouse_code,warehouse_name,product_object_id,product_version_id,
			product_code,product_name,product_unit,quantity_micros,currency,amount_cents
			FROM led_opening_inventory WHERE generation_id=$1`, generationID)
		if err != nil {
			return s.internal("load inventory opening for closing", err)
		}
		for rows.Next() {
			balance := &inventoryCostBalance{}
			var currency *string
			var amount *int64
			if err = rows.Scan(
				&balance.warehouseObjectID, &balance.warehouseVersionID,
				&balance.warehouseCode, &balance.warehouseName,
				&balance.productObjectID, &balance.productVersionID,
				&balance.productCode, &balance.productName, &balance.productUnit,
				&balance.quantity, &currency, &amount,
			); err != nil {
				rows.Close()
				return s.internal("scan inventory opening for closing", err)
			}
			if currency == nil || *currency != "CNY" || amount == nil {
				rows.Close()
				return domainError(
					ErrorConflict, "inventory opening cost must be complete and use CNY", nil, nil,
				)
			}
			balance.amount = *amount
			balances[inventoryCostKey(balance.warehouseObjectID, balance.productObjectID)] = balance
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			return s.internal("read inventory opening for closing", err)
		}
		rows.Close()
	} else {
		rows, err := tx.Query(ctx, `SELECT warehouse_object_id,warehouse_version_id,
			warehouse_code,warehouse_name,product_object_id,product_version_id,
			product_code,product_name,product_unit,quantity_micros,cost_amount_cents
			FROM led_closing_inventory WHERE closing_id=$1`, *previousClosingID)
		if err != nil {
			return s.internal("load previous inventory closing", err)
		}
		for rows.Next() {
			balance := &inventoryCostBalance{}
			if err = rows.Scan(
				&balance.warehouseObjectID, &balance.warehouseVersionID,
				&balance.warehouseCode, &balance.warehouseName,
				&balance.productObjectID, &balance.productVersionID,
				&balance.productCode, &balance.productName, &balance.productUnit,
				&balance.quantity, &balance.amount,
			); err != nil {
				rows.Close()
				return s.internal("scan previous inventory closing", err)
			}
			balances[inventoryCostKey(balance.warehouseObjectID, balance.productObjectID)] = balance
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			return s.internal("read previous inventory closing", err)
		}
		rows.Close()
	}
	entries, err := loadInventoryCostEntries(ctx, tx, generationID, periodStart, closingDate)
	if err != nil {
		return s.internal("load inventory movements for closing", err)
	}
	returnLineSource, err := loadSaleReturnCostSources(ctx, tx)
	if err != nil {
		return s.internal("load sale return cost sources", err)
	}
	materialOutput, err := loadProductionMaterialOutputs(ctx, tx)
	if err != nil {
		return s.internal("load production cost relations", err)
	}
	outboundCosts, err := loadPriorOutboundCosts(ctx, tx)
	if err != nil {
		return s.internal("load prior outbound costs", err)
	}
	for index := 0; index < len(entries); {
		entry := entries[index]
		if entry.sourceEntity == "order-production" || entry.sourceEntity == "self-production" {
			end := index + 1
			for end < len(entries) && entries[end].sourceDocumentID == entry.sourceDocumentID {
				end++
			}
			if err = s.costProductionGroup(
				ctx, tx, closingID, entries[index:end], balances, materialOutput,
			); err != nil {
				return err
			}
			index = end
			continue
		}
		var cost int64
		var costErr error
		if entry.sourceEntity == "inventory-count" && entry.quantity > 0 {
			cost, costErr = costInventoryCountGain(ctx, tx, generationID, entry, balances)
		} else {
			cost, costErr = costRegularInventoryEntry(entry, balances, returnLineSource, outboundCosts)
		}
		if costErr != nil {
			return domainError(
				ErrorConflict, costErr.Error(),
				map[string]any{"documentId": entry.sourceDocumentID, "lineId": entry.sourceLineID},
				costErr,
			)
		}
		if entry.sourceEntity == "sale-outbound" && entry.quantity < 0 {
			outboundCosts[entry.sourceLineID] = outboundCostAllocation{
				quantity: -entry.quantity,
				amount:   cost,
			}
		}
		if err = insertCostAllocation(ctx, tx, closingID, entry, cost); err != nil {
			return s.writeError("save inventory cost allocation", err)
		}
		index++
	}
	for _, balance := range balances {
		if balance.quantity < 0 || balance.amount < 0 {
			return domainError(ErrorConflict, "inventory cost balance became negative", nil, nil)
		}
		if balance.quantity == 0 {
			if balance.amount != 0 {
				return domainError(ErrorConflict, "zero inventory retained a cost balance", nil, nil)
			}
			continue
		}
		_, err = tx.Exec(ctx, `INSERT INTO led_closing_inventory(
			closing_id,warehouse_object_id,warehouse_version_id,warehouse_code,warehouse_name,
			product_object_id,product_version_id,product_code,product_name,product_unit,
			quantity_micros,currency,cost_amount_cents
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'CNY',$12)`,
			closingID, balance.warehouseObjectID, balance.warehouseVersionID,
			balance.warehouseCode, balance.warehouseName, balance.productObjectID,
			balance.productVersionID, balance.productCode, balance.productName,
			balance.productUnit, balance.quantity, balance.amount,
		)
		if err != nil {
			return s.writeError("save inventory closing balance", err)
		}
	}
	return nil
}

func costInventoryCountGain(
	ctx context.Context, tx pgx.Tx, generationID string, entry inventoryCostEntry,
	balances map[string]*inventoryCostBalance,
) (int64, error) {
	balance := ensureInventoryCostBalance(balances, entry)
	var cost int64
	if balance.quantity > 0 {
		cost = roundedRatio(balance.amount, entry.quantity, balance.quantity)
	} else {
		var unitPrice int64
		err := tx.QueryRow(ctx, `SELECT unit_price_cents FROM led_inventory_entries
			WHERE generation_id=$1 AND entry_type='POSTING'
			AND source_entity='purchase-inbound' AND product_object_id=$2
			AND effective_date <= $3 AND unit_price_cents IS NOT NULL
			ORDER BY effective_date DESC,occurred_at DESC,id DESC LIMIT 1`,
			generationID, entry.productObjectID, entry.effectiveDate).Scan(&unitPrice)
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, errors.New("inventory count gain purchase price is unavailable")
		}
		if err != nil {
			return 0, err
		}
		cost = roundedRatio(unitPrice, entry.quantity, 1_000_000)
	}
	balance.quantity += entry.quantity
	balance.amount += cost
	return cost, nil
}

func loadInventoryCostEntries(
	ctx context.Context,
	tx pgx.Tx,
	generationID string,
	periodStart, closingDate time.Time,
) ([]inventoryCostEntry, error) {
	rows, err := tx.Query(ctx, `SELECT id,source_entity,source_document_id,source_line_id,
		effective_date,occurred_at,warehouse_object_id,warehouse_version_id,
		warehouse_code,warehouse_name,product_object_id,product_version_id,
		product_code,product_name,product_unit,quantity_delta_micros,currency,amount_cents
		FROM led_inventory_entries
		WHERE generation_id=$1 AND entry_type='POSTING'
		  AND effective_date >= $2 AND effective_date <= $3
		ORDER BY effective_date,occurred_at,source_document_id,
		  CASE WHEN quantity_delta_micros < 0 THEN 0 ELSE 1 END,id`,
		generationID, periodStart, closingDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := make([]inventoryCostEntry, 0)
	for rows.Next() {
		var entry inventoryCostEntry
		if err = rows.Scan(
			&entry.id, &entry.sourceEntity, &entry.sourceDocumentID, &entry.sourceLineID,
			&entry.effectiveDate, &entry.occurredAt, &entry.warehouseObjectID,
			&entry.warehouseVersionID, &entry.warehouseCode, &entry.warehouseName,
			&entry.productObjectID, &entry.productVersionID, &entry.productCode,
			&entry.productName, &entry.productUnit, &entry.quantity,
			&entry.currency, &entry.amount,
		); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func costRegularInventoryEntry(
	entry inventoryCostEntry,
	balances map[string]*inventoryCostBalance,
	returnLineSource map[string]string,
	outboundCosts map[string]outboundCostAllocation,
) (int64, error) {
	balance := ensureInventoryCostBalance(balances, entry)
	if entry.quantity < 0 {
		cost, err := consumeInventoryCost(balance, -entry.quantity)
		if err != nil {
			return 0, err
		}
		return cost, nil
	}
	var cost int64
	switch entry.sourceEntity {
	case "purchase-inbound":
		if entry.currency == nil || *entry.currency != "CNY" || entry.amount == nil {
			return 0, errors.New("inventory purchase cost must be complete and use CNY")
		}
		cost = *entry.amount
	case "sale-return":
		sourceLineID := returnLineSource[entry.sourceLineID]
		sourceCost, ok := outboundCosts[sourceLineID]
		if !ok {
			return 0, errors.New("sale return source outbound cost is unavailable")
		}
		if entry.quantity > sourceCost.quantity {
			return 0, errors.New("sale return quantity exceeds source outbound cost")
		}
		if entry.quantity == sourceCost.quantity {
			cost = sourceCost.amount
		} else {
			cost = roundedRatio(sourceCost.amount, entry.quantity, sourceCost.quantity)
		}
	case "inventory-count":
		return 0, errors.New("inventory count gain cost was not prepared")
	default:
		return 0, errors.New("inventory inbound cost source is unsupported")
	}
	balance.quantity += entry.quantity
	balance.amount += cost
	return cost, nil
}

func (s *Service) costProductionGroup(
	ctx context.Context,
	tx pgx.Tx,
	closingID string,
	entries []inventoryCostEntry,
	balances map[string]*inventoryCostBalance,
	materialOutput map[string]string,
) error {
	outputCosts := make(map[string]int64)
	for _, entry := range entries {
		if entry.quantity >= 0 {
			continue
		}
		balance := ensureInventoryCostBalance(balances, entry)
		cost, err := consumeInventoryCost(balance, -entry.quantity)
		if err != nil {
			return domainError(
				ErrorConflict, "production material cost is unavailable",
				map[string]any{"documentId": entry.sourceDocumentID, "lineId": entry.sourceLineID},
				err,
			)
		}
		outputLineID := materialOutput[entry.sourceLineID]
		if outputLineID == "" {
			return domainError(ErrorConflict, "production material output is unavailable", nil, nil)
		}
		outputCosts[outputLineID] += cost
		if err = insertCostAllocation(ctx, tx, closingID, entry, cost); err != nil {
			return s.writeError("save production material cost", err)
		}
	}
	for _, entry := range entries {
		if entry.quantity <= 0 {
			continue
		}
		cost, ok := outputCosts[entry.sourceLineID]
		if !ok {
			return domainError(
				ErrorConflict, "production output has no material cost",
				map[string]any{"documentId": entry.sourceDocumentID, "lineId": entry.sourceLineID},
				nil,
			)
		}
		balance := ensureInventoryCostBalance(balances, entry)
		balance.quantity += entry.quantity
		balance.amount += cost
		if err := insertCostAllocation(ctx, tx, closingID, entry, cost); err != nil {
			return s.writeError("save production output cost", err)
		}
	}
	return nil
}

func ensureInventoryCostBalance(
	balances map[string]*inventoryCostBalance,
	entry inventoryCostEntry,
) *inventoryCostBalance {
	key := inventoryCostKey(entry.warehouseObjectID, entry.productObjectID)
	balance := balances[key]
	if balance == nil {
		balance = &inventoryCostBalance{}
		balances[key] = balance
	}
	balance.warehouseObjectID, balance.warehouseVersionID =
		entry.warehouseObjectID, entry.warehouseVersionID
	balance.warehouseCode, balance.warehouseName = entry.warehouseCode, entry.warehouseName
	balance.productObjectID, balance.productVersionID = entry.productObjectID, entry.productVersionID
	balance.productCode, balance.productName, balance.productUnit =
		entry.productCode, entry.productName, entry.productUnit
	return balance
}

func consumeInventoryCost(balance *inventoryCostBalance, quantity int64) (int64, error) {
	if quantity <= 0 || balance.quantity < quantity || balance.quantity <= 0 {
		return 0, errors.New("inventory quantity is insufficient for costing")
	}
	var cost int64
	if quantity == balance.quantity {
		cost = balance.amount
	} else {
		cost = roundedRatio(balance.amount, quantity, balance.quantity)
	}
	balance.quantity -= quantity
	balance.amount -= cost
	return cost, nil
}

func roundedRatio(amount, numerator, denominator int64) int64 {
	product := new(big.Int).Mul(big.NewInt(amount), big.NewInt(numerator))
	quotient, remainder := new(big.Int), new(big.Int)
	quotient.QuoRem(product, big.NewInt(denominator), remainder)
	if new(big.Int).Lsh(remainder, 1).Cmp(big.NewInt(denominator)) >= 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	return quotient.Int64()
}

func insertCostAllocation(
	ctx context.Context,
	tx pgx.Tx,
	closingID string,
	entry inventoryCostEntry,
	cost int64,
) error {
	_, err := tx.Exec(ctx, `INSERT INTO led_inventory_cost_allocations(
		closing_id,entry_id,source_document_id,source_line_id,
		quantity_micros,cost_amount_cents,currency
	) VALUES($1,$2,$3,$4,$5,$6,'CNY')`,
		closingID, entry.id, entry.sourceDocumentID, entry.sourceLineID, entry.quantity, cost)
	return err
}

func loadSaleReturnCostSources(ctx context.Context, tx pgx.Tx) (map[string]string, error) {
	rows, err := tx.Query(ctx, `SELECT return_line.id,signoff_line.source_outbound_line_id
		FROM vou_sale_return_lines return_line
		JOIN vou_sale_signoff_lines signoff_line
		  ON signoff_line.id=return_line.source_signoff_line_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]string)
	for rows.Next() {
		var returnLineID, outboundLineID string
		if err = rows.Scan(&returnLineID, &outboundLineID); err != nil {
			return nil, err
		}
		result[returnLineID] = outboundLineID
	}
	return result, rows.Err()
}

func loadProductionMaterialOutputs(ctx context.Context, tx pgx.Tx) (map[string]string, error) {
	rows, err := tx.Query(ctx, `SELECT id,output_line_id FROM vou_production_material_lines`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]string)
	for rows.Next() {
		var materialID, outputID string
		if err = rows.Scan(&materialID, &outputID); err != nil {
			return nil, err
		}
		result[materialID] = outputID
	}
	return result, rows.Err()
}

func loadPriorOutboundCosts(
	ctx context.Context,
	tx pgx.Tx,
) (map[string]outboundCostAllocation, error) {
	rows, err := tx.Query(ctx, `SELECT allocation.source_line_id,
		abs(allocation.quantity_micros),allocation.cost_amount_cents
		FROM led_inventory_cost_allocations allocation
		JOIN led_closings closing ON closing.id=allocation.closing_id
		JOIN led_inventory_entries entry ON entry.id=allocation.entry_id
		WHERE closing.status='ACTIVE' AND entry.source_entity='sale-outbound'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]outboundCostAllocation)
	for rows.Next() {
		var lineID string
		var allocation outboundCostAllocation
		if err = rows.Scan(&lineID, &allocation.quantity, &allocation.amount); err != nil {
			return nil, err
		}
		result[lineID] = allocation
	}
	return result, rows.Err()
}

func inventoryCostKey(warehouseID, productID string) string {
	return warehouseID + "/" + productID
}

func (s *Service) snapshotNonInventoryBalances(
	ctx context.Context,
	tx pgx.Tx,
	generationID, closingID string,
	closingDate time.Time,
) error {
	statements := []string{
		`INSERT INTO led_closing_fund(
			closing_id,fund_account_object_id,fund_account_version_id,fund_account_code,
			fund_account_name,currency,amount_cents
		)
		SELECT $1,fund_account_object_id,
			(array_agg(fund_account_version_id ORDER BY effective_date DESC,occurred_at DESC,id DESC))[1],
			max(fund_account_code),
			(array_agg(fund_account_name ORDER BY effective_date DESC,occurred_at DESC,id DESC))[1],
			currency,sum(amount_delta_cents)
		FROM led_fund_entries WHERE generation_id=$2 AND effective_date <= $3
		GROUP BY fund_account_object_id,currency HAVING sum(amount_delta_cents) <> 0`,
		`INSERT INTO led_closing_party(
			closing_id,account_type,counterparty_entity,counterparty_object_id,counterparty_version_id,
			counterparty_code,counterparty_name,currency,amount_cents
		)
		SELECT $1,account_type,counterparty_entity,counterparty_object_id,
			(array_agg(counterparty_version_id ORDER BY effective_date DESC,occurred_at DESC,id DESC))[1],
			max(counterparty_code),
			(array_agg(counterparty_name ORDER BY effective_date DESC,occurred_at DESC,id DESC))[1],
			currency,sum(amount_delta_cents)
		FROM led_party_entries WHERE generation_id=$2 AND effective_date <= $3
		GROUP BY account_type,counterparty_entity,counterparty_object_id,currency
		HAVING sum(amount_delta_cents) <> 0`,
		`INSERT INTO led_closing_container(
			closing_id,customer_object_id,customer_version_id,customer_code,
			customer_name,container_type,quantity
		)
		SELECT $1,customer_object_id,
			(array_agg(customer_version_id ORDER BY effective_date DESC,occurred_at DESC,id DESC))[1],
			max(customer_code),
			(array_agg(customer_name ORDER BY effective_date DESC,occurred_at DESC,id DESC))[1],
			container_type,sum(quantity_delta)
		FROM led_container_entries WHERE generation_id=$2 AND effective_date <= $3
		GROUP BY customer_object_id,container_type HAVING sum(quantity_delta) <> 0`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement, closingID, generationID, closingDate); err != nil {
			return s.writeError("save non-inventory closing balance", err)
		}
	}
	return nil
}

func (s *Service) loadClosingInventory(ctx context.Context, closingID string, view *ClosingView) error {
	rows, err := s.pool.Query(ctx, `SELECT warehouse_object_id,warehouse_version_id,
		warehouse_code,warehouse_name,product_object_id,product_version_id,
		product_code,product_name,product_unit,quantity_micros,currency,cost_amount_cents
		FROM led_closing_inventory WHERE closing_id=$1
		ORDER BY warehouse_code,product_code`, closingID)
	if err != nil {
		return s.internal("list closing inventory", err)
	}
	defer rows.Close()
	for rows.Next() {
		var item InventoryOpeningView
		var quantity, cost int64
		if err = rows.Scan(
			&item.Warehouse.ObjectID, &item.Warehouse.VersionID, &item.Warehouse.Code,
			&item.Warehouse.Name, &item.Product.ObjectID, &item.Product.VersionID,
			&item.Product.Code, &item.Product.Name, &item.Product.Unit,
			&quantity, &item.Currency, &cost,
		); err != nil {
			return s.internal("scan closing inventory", err)
		}
		item.ID = item.Warehouse.ObjectID + "/" + item.Product.ObjectID
		item.Warehouse.Entity, item.Product.Entity = bobdomain.EntityWarehouse, bobdomain.EntityProduct
		item.Quantity, item.CostAmount = formatQuantity(quantity), formatMoney(cost)
		view.Inventory = append(view.Inventory, item)
	}
	if err = rows.Err(); err != nil {
		return s.internal("read closing inventory", err)
	}
	return nil
}

func (s *Service) loadClosingFund(ctx context.Context, closingID string, view *ClosingView) error {
	rows, err := s.pool.Query(ctx, `SELECT fund_account_object_id,fund_account_version_id,
		fund_account_code,fund_account_name,currency,amount_cents
		FROM led_closing_fund WHERE closing_id=$1 ORDER BY fund_account_code,currency`, closingID)
	if err != nil {
		return s.internal("list closing fund", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, version, code, name, currency string
		var amount int64
		if err = rows.Scan(&id, &version, &code, &name, &currency, &amount); err != nil {
			return s.internal("scan closing fund", err)
		}
		view.Fund = append(view.Fund, openingFundView(id, id, version, code, name, currency, amount))
	}
	return rows.Err()
}

func (s *Service) loadClosingParty(ctx context.Context, closingID string, view *ClosingView) error {
	rows, err := s.pool.Query(ctx, `SELECT account_type,counterparty_entity,counterparty_object_id,
		counterparty_version_id,counterparty_code,counterparty_name,currency,amount_cents
		FROM led_closing_party WHERE closing_id=$1
		ORDER BY account_type,counterparty_entity,counterparty_code,currency`, closingID)
	if err != nil {
		return s.internal("list closing party", err)
	}
	defer rows.Close()
	for rows.Next() {
		var accountType, entity, id, version, code, name, currency string
		var amount int64
		if err = rows.Scan(&accountType, &entity, &id, &version, &code, &name, &currency, &amount); err != nil {
			return s.internal("scan closing party", err)
		}
		view.Party = append(
			view.Party, openingPartyView(closingPartyRowID(accountType, entity, id, currency),
				accountType, entity, id, version, code, name, currency, amount),
		)
	}
	return rows.Err()
}

func closingPartyRowID(accountType, entity, objectID, currency string) string {
	return accountType + "/" + entity + "/" + objectID + "/" + currency
}

func (s *Service) loadClosingContainer(ctx context.Context, closingID string, view *ClosingView) error {
	rows, err := s.pool.Query(ctx, `SELECT customer_object_id,customer_version_id,
		customer_code,customer_name,container_type,quantity
		FROM led_closing_container WHERE closing_id=$1 ORDER BY customer_code,container_type`, closingID)
	if err != nil {
		return s.internal("list closing container", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, version, code, name, containerType string
		var quantity int64
		if err = rows.Scan(&id, &version, &code, &name, &containerType, &quantity); err != nil {
			return s.internal("scan closing container", err)
		}
		view.Container = append(
			view.Container, containerOpeningView(id, id, version, code, name, containerType, quantity),
		)
	}
	return rows.Err()
}
