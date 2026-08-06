package vou

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

const intermediaryCurrency = "CNY"

type preparedIntermediaryCalculation struct {
	date, periodStart              time.Time
	sourceJSON, resultJSON         []byte
	lineJSON                       [][]byte
	lineEmployee, lineIntermediary []int64
	lineRebate                     []int64
	summaryAmounts                 []int64
	total                          int64
}

type intermediaryDocument struct {
	customerID, id, number string
	date                   time.Time
	amount                 int64
	rows                   []dbsqlc.ListIntermediarySignoffSourceRowsRow
	cumulativeAmount       int64
	collectionDate         *time.Time
}

type intermediaryTimelinePoint struct {
	date     time.Time
	capacity int64
}

func monthRange(value time.Time) (time.Time, time.Time) {
	start := time.Date(value.Year(), value.Month(), 1, 0, 0, 0, 0, value.Location())
	return start, start.AddDate(0, 1, -1)
}

func validateIntermediaryBusinessDate(value string) (time.Time, time.Time, error) {
	parsed, err := time.Parse(dateLayout, strings.TrimSpace(value))
	if err != nil {
		return time.Time{}, time.Time{}, domainError(ErrorValidation, "invalid businessDate", nil, nil)
	}
	start, end := monthRange(parsed)
	if !parsed.Equal(end) {
		return time.Time{}, time.Time{}, domainError(ErrorValidation, "businessDate must be the calendar month end", nil, nil)
	}
	return parsed, start, nil
}

func intermediaryHash(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func addIntermediaryAmount(total, amount int64) (int64, bool) {
	if total < 0 || amount < 0 || total > math.MaxInt64-amount {
		return 0, false
	}
	return total + amount, true
}

func intermediaryReference(objectID, versionID, entity, code, name string) IntermediaryReference {
	return IntermediaryReference{ObjectID: objectID, VersionID: versionID, Entity: entity, Code: code, Name: name}
}

func (s *Service) IntermediarySource(ctx context.Context, input IntermediarySourceInput) (IntermediarySourceView, error) {
	periodEnd, periodStart, err := validateIntermediaryBusinessDate(input.BusinessDate)
	if err != nil {
		return IntermediarySourceView{}, err
	}
	return s.intermediarySource(ctx, s.queries, periodStart, periodEnd)
}

func (s *Service) intermediarySource(
	ctx context.Context, q *dbsqlc.Queries, periodStart, periodEnd time.Time,
) (IntermediarySourceView, error) {
	control, err := q.GetLedControl(ctx)
	if err != nil {
		return IntermediarySourceView{}, s.internal("read ledger control", err)
	}
	if control.Status != "ACTIVE" || control.ActiveGenerationID == nil {
		return IntermediarySourceView{}, domainError(ErrorConflict, "ledger must be active before calculation", nil, nil)
	}
	rows, err := q.ListIntermediarySignoffSourceRows(ctx, dateValue(periodEnd))
	if err != nil {
		return IntermediarySourceView{}, s.internal("read intermediary source signoffs", err)
	}
	events, err := q.ListIntermediaryCustomerTradeEvents(ctx, dbsqlc.ListIntermediaryCustomerTradeEventsParams{
		PeriodEnd: dateValue(periodEnd), GenerationID: *control.ActiveGenerationID,
	})
	if err != nil {
		return IntermediarySourceView{}, s.internal("read customer collection events", err)
	}

	documents := make([]*intermediaryDocument, 0)
	byDocument := make(map[string]*intermediaryDocument)
	for _, row := range rows {
		if row.SalespersonObjectID == nil || row.SalespersonVersionID == nil ||
			row.SalespersonCode == nil || row.SalespersonName == nil {
			return IntermediarySourceView{}, domainError(ErrorConflict,
				"sale signoff is missing its order salesperson snapshot", map[string]any{"documentNo": row.SignoffDocumentNo}, nil)
		}
		document := byDocument[row.SignoffDocumentID]
		if document == nil {
			document = &intermediaryDocument{
				customerID: row.CustomerObjectID, id: row.SignoffDocumentID,
				number: row.SignoffDocumentNo, date: row.SignoffDate.Time,
			}
			byDocument[row.SignoffDocumentID] = document
			documents = append(documents, document)
		}
		document.amount += row.LineAmountCents
		document.rows = append(document.rows, row)
	}
	sort.Slice(documents, func(i, j int) bool {
		if documents[i].customerID != documents[j].customerID {
			return documents[i].customerID < documents[j].customerID
		}
		if !documents[i].date.Equal(documents[j].date) {
			return documents[i].date.Before(documents[j].date)
		}
		if documents[i].number != documents[j].number {
			return documents[i].number < documents[j].number
		}
		return documents[i].id < documents[j].id
	})

	eventDates := make(map[string]map[time.Time]int64)
	for _, event := range events {
		if !event.EffectiveDate.Valid {
			continue
		}
		if eventDates[event.CounterpartyObjectID] == nil {
			eventDates[event.CounterpartyObjectID] = make(map[time.Time]int64)
		}
		date := event.EffectiveDate.Time
		eventDates[event.CounterpartyObjectID][date] += event.AmountDeltaCents
	}
	documentsByCustomer := make(map[string][]*intermediaryDocument)
	for _, document := range documents {
		documentsByCustomer[document.customerID] = append(documentsByCustomer[document.customerID], document)
	}
	for customerID, customerDocuments := range documentsByCustomer {
		var cumulative int64
		docAmounts := make(map[time.Time]int64)
		dateSet := make(map[time.Time]bool)
		for _, document := range customerDocuments {
			cumulative += document.amount
			document.cumulativeAmount = cumulative
			docAmounts[document.date] += document.amount
			dateSet[document.date] = true
		}
		for date := range eventDates[customerID] {
			dateSet[date] = true
		}
		dates := make([]time.Time, 0, len(dateSet))
		for date := range dateSet {
			dates = append(dates, date)
		}
		sort.Slice(dates, func(i, j int) bool { return dates[i].Before(dates[j]) })
		var balance, signedTotal int64
		timeline := make([]intermediaryTimelinePoint, 0, len(dates))
		for _, date := range dates {
			signedTotal += docAmounts[date]
			balance += eventDates[customerID][date]
			capacity := signedTotal - max(balance, int64(0))
			capacity = max(capacity, int64(0))
			capacity = min(capacity, signedTotal)
			timeline = append(timeline, intermediaryTimelinePoint{date: date, capacity: capacity})
		}
		for _, document := range customerDocuments {
			for _, point := range timeline {
				if point.date.Before(document.date) || point.capacity < document.cumulativeAmount {
					continue
				}
				collected := point.date
				document.collectionDate = &collected
				break
			}
		}
	}

	source := IntermediaryCalculationSource{
		PeriodStart: periodStart.Format(dateLayout), PeriodEnd: periodEnd.Format(dateLayout),
		Currency: intermediaryCurrency, Lines: make([]IntermediarySourceLine, 0), Bills: make([]IntermediarySourceBill, 0),
	}
	for _, document := range documents {
		if document.collectionDate == nil || document.collectionDate.Before(periodStart) || document.collectionDate.After(periodEnd) {
			continue
		}
		for _, row := range document.rows {
			pricingQuantity := new(big.Int).Mul(big.NewInt(row.SignedQtyMicros), big.NewInt(row.PricingQuantityPerInventoryUnitMicros))
			pricingQuantity.Quo(pricingQuantity, big.NewInt(1_000_000))
			if !pricingQuantity.IsInt64() || pricingQuantity.Sign() <= 0 {
				return IntermediarySourceView{}, domainError(ErrorConflict, "source pricing quantity is invalid", map[string]any{"lineId": row.SourceSignoffLineID}, nil)
			}
			line := IntermediarySourceLine{
				SourceSignoffLineID: row.SourceSignoffLineID,
				SignoffDocumentID:   row.SignoffDocumentID, SignoffDocumentNo: row.SignoffDocumentNo,
				SignoffDate: formatDate(row.SignoffDate), DueDate: formatDate(row.DueDate),
				CollectionDate:      document.collectionDate.Format(dateLayout),
				CollectionDelayDays: max(int(document.collectionDate.Sub(row.DueDate.Time).Hours()/24), 0),
				OrderDocumentID:     row.OrderDocumentID, OrderDocumentNo: row.OrderDocumentNo,
				OrderDate:   formatDate(row.OrderDate),
				Customer:    intermediaryReference(row.CustomerObjectID, row.CustomerVersionID, "customer", row.CustomerCode, row.CustomerName),
				Salesperson: intermediaryReference(*row.SalespersonObjectID, *row.SalespersonVersionID, "employee", *row.SalespersonCode, *row.SalespersonName),
				Product:     intermediaryReference(row.ProductObjectID, row.ProductVersionID, "product", row.ProductCode, row.ProductName),
				ProductKind: row.ProductKind, SignedQuantity: formatQuantity(row.SignedQtyMicros),
				PricingQuantity: formatQuantity(pricingQuantity.Int64()), BarrelQuantity: formatQuantity(row.SignedQtyMicros),
				UnitPrice: formatMoney(row.UnitPriceCents), ReferenceUnitPrice: formatMoney(row.ReferenceUnitPriceCents),
				SettlementSurcharge: formatMoney(row.SettlementSurchargeCents), RebateUnitPrice: formatMoney(row.RebateUnitPriceCents),
				LineAmount: formatMoney(row.LineAmountCents), SettlementTermCode: row.SettlementTermCode,
				SpecialApproval: row.SpecialApproval,
			}
			if row.IntermediaryOtherPartyID != nil {
				if row.IntermediaryVersionID == nil || row.IntermediaryCode == nil || row.IntermediaryName == nil {
					return IntermediarySourceView{}, domainError(ErrorConflict, "customer intermediary is not effective", map[string]any{"customerCode": row.CustomerCode}, nil)
				}
				ref := intermediaryReference(*row.IntermediaryOtherPartyID, *row.IntermediaryVersionID, "other-party", *row.IntermediaryCode, *row.IntermediaryName)
				line.Intermediary = &ref
			}
			source.Lines = append(source.Lines, line)
		}
	}

	bills, err := q.ListIntermediaryBillSourceRows(ctx, dbsqlc.ListIntermediaryBillSourceRowsParams{
		PeriodStart: dateValue(periodStart), PeriodEnd: dateValue(periodEnd),
	})
	if err != nil {
		return IntermediarySourceView{}, s.internal("read intermediary source bills", err)
	}
	for _, bill := range bills {
		if bill.CustomerObjectID == nil || bill.CustomerVersionID == nil || bill.CustomerCode == nil || bill.CustomerName == nil ||
			bill.SalespersonVersionID == nil {
			return IntermediarySourceView{}, domainError(ErrorConflict, "bill receipt is missing customer salesperson", map[string]any{"documentNo": bill.ReceiptDocumentNo}, nil)
		}
		costDays := max(int(bill.MaturityDate.Time.Sub(bill.ReceiptDate.Time).Hours()/24), 0)
		source.Bills = append(source.Bills, IntermediarySourceBill{
			BillLineID: bill.BillLineID, ReceiptDocumentID: bill.ReceiptDocumentID, ReceiptDocumentNo: bill.ReceiptDocumentNo,
			ReceiptDate: formatDate(bill.ReceiptDate),
			Customer:    intermediaryReference(*bill.CustomerObjectID, *bill.CustomerVersionID, "customer", *bill.CustomerCode, *bill.CustomerName),
			Salesperson: intermediaryReference(bill.SalespersonObjectID, *bill.SalespersonVersionID, "employee", bill.SalespersonCode, bill.SalespersonName),
			BillType:    bill.BillType, FaceAmount: formatMoney(bill.FaceAmountCents),
			IssueDate: formatDate(bill.IssueDate), MaturityDate: formatDate(bill.MaturityDate), CostDays: costDays,
		})
	}
	encoded, err := json.Marshal(source)
	if err != nil {
		return IntermediarySourceView{}, s.internal("encode intermediary source", err)
	}
	return IntermediarySourceView{Source: source, SourceHash: intermediaryHash(encoded)}, nil
}

func (s *Service) GetIntermediaryScript(ctx context.Context) (IntermediaryScriptSnapshot, error) {
	row, err := s.queries.GetVouIntermediaryScript(ctx)
	if err != nil {
		return IntermediaryScriptSnapshot{}, s.internal("read intermediary script", err)
	}
	return intermediaryScriptView(row), nil
}

func intermediaryScriptView(row dbsqlc.VouIntermediaryScript) IntermediaryScriptSnapshot {
	return IntermediaryScriptSnapshot{ScriptID: row.ID, Revision: row.Revision, Name: row.Name, Source: row.Source, Hash: row.SourceHash}
}

func (s *Service) SaveIntermediaryScript(
	ctx context.Context, input IntermediaryScriptSaveInput, actorID string,
) (IntermediaryScriptSnapshot, error) {
	name := strings.TrimSpace(input.Name)
	source := strings.TrimSpace(input.Source)
	if input.Revision < 1 || name == "" || utf8.RuneCountInString(name) > 200 || source == "" || len(source) > 100000 {
		return IntermediaryScriptSnapshot{}, domainError(ErrorValidation, "invalid calculation script", nil, nil)
	}
	if !validID(actorID) {
		return IntermediaryScriptSnapshot{}, domainError(ErrorValidation, "invalid actor", nil, nil)
	}
	row, err := s.queries.UpdateVouIntermediaryScript(ctx, dbsqlc.UpdateVouIntermediaryScriptParams{
		Name: name, Source: source, SourceHash: intermediaryHash([]byte(source)), UpdatedBy: actorID, Revision: input.Revision,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return IntermediaryScriptSnapshot{}, domainError(ErrorConflict, "calculation script changed", nil, nil)
	}
	if err != nil {
		return IntermediaryScriptSnapshot{}, s.writeError("save intermediary script", err)
	}
	return intermediaryScriptView(row), nil
}

func (s *Service) prepareIntermediaryCalculation(
	ctx context.Context, q *dbsqlc.Queries, input DraftInput,
) (preparedIntermediaryCalculation, error) {
	var prepared preparedIntermediaryCalculation
	date, periodStart, err := validateIntermediaryBusinessDate(input.BusinessDate)
	if err != nil {
		return prepared, err
	}
	if strings.ToUpper(strings.TrimSpace(input.Currency)) != intermediaryCurrency || input.IntermediaryCalculation == nil {
		return prepared, domainError(ErrorValidation, "intermediary calculation must use CNY and include its calculation draft", nil, nil)
	}
	if _, err := q.LockLedControl(ctx); err != nil {
		return prepared, s.internal("lock ledger control for intermediary calculation", err)
	}
	calculation := input.IntermediaryCalculation
	currentSource, err := s.intermediarySource(ctx, q, periodStart, date)
	if err != nil {
		return prepared, err
	}
	sourceJSON, err := json.Marshal(calculation.Source)
	if err != nil {
		return prepared, domainError(ErrorValidation, "invalid calculation source", nil, err)
	}
	currentSourceJSON, _ := json.Marshal(currentSource.Source)
	if calculation.SourceHash != currentSource.SourceHash || intermediaryHash(sourceJSON) != calculation.SourceHash || !bytes.Equal(sourceJSON, currentSourceJSON) {
		return prepared, domainError(ErrorConflict, "calculation source changed; recalculate before saving", nil, nil)
	}
	currentScript, err := q.LockVouIntermediaryScript(ctx)
	if err != nil {
		return prepared, s.internal("read intermediary script", err)
	}
	script := calculation.Script
	if script.ScriptID != currentScript.ID || script.Revision != currentScript.Revision || script.Name != currentScript.Name ||
		script.Source != currentScript.Source || script.Hash != currentScript.SourceHash || intermediaryHash([]byte(script.Source)) != script.Hash {
		return prepared, domainError(ErrorConflict, "calculation script changed; recalculate before saving", nil, nil)
	}

	lineSources := make(map[string]IntermediarySourceLine, len(calculation.Source.Lines))
	for _, line := range calculation.Source.Lines {
		lineSources[line.SourceSignoffLineID] = line
	}
	if len(calculation.Result.Lines) != len(lineSources) {
		return prepared, domainError(ErrorValidation, "calculation result must contain one row per source line", nil, nil)
	}
	type summaryKey struct{ category, entity, objectID string }
	expected := make(map[summaryKey]int64)
	expectedPayees := make(map[summaryKey]IntermediaryReference)
	addExpected := func(key summaryKey, payee IntermediaryReference, amount int64) error {
		total, ok := addIntermediaryAmount(expected[key], amount)
		if !ok {
			return domainError(ErrorValidation, "calculation summary is out of range", nil, nil)
		}
		expected[key] = total
		expectedPayees[key] = payee
		return nil
	}
	seenLines := make(map[string]bool, len(calculation.Result.Lines))
	for _, line := range calculation.Result.Lines {
		sourceLine, ok := lineSources[line.SourceSignoffLineID]
		if !ok || seenLines[line.SourceSignoffLineID] {
			return prepared, domainError(ErrorValidation, "calculation result line does not match its source", nil, nil)
		}
		seenLines[line.SourceSignoffLineID] = true
		amountFields := []string{line.BaseCommission, line.PremiumCommission, line.LowPriceCommission,
			line.MarketMaintenanceSubsidy, line.MarketDevelopmentSubsidy, line.BillCost,
			line.EmployeeAmount, line.IntermediaryAmount, line.RebateAmount}
		for _, value := range amountFields {
			if _, parseErr := parseFixed(value, 2, true); parseErr != nil {
				return prepared, domainError(ErrorValidation, "calculation result contains an invalid amount", nil, nil)
			}
		}
		premium := strings.TrimPrefix(strings.TrimSpace(line.PremiumUnitPrice), "-")
		if _, parseErr := parseFixed(premium, 2, true); parseErr != nil {
			return prepared, domainError(ErrorValidation, "calculation result contains an invalid premium price", nil, nil)
		}
		if _, parseErr := quantityMicros(line.BarrelQuantity, true); parseErr != nil {
			return prepared, domainError(ErrorValidation, "calculation result contains an invalid barrel quantity", nil, nil)
		}
		if line.BarrelQuantity != sourceLine.BarrelQuantity {
			return prepared, domainError(ErrorValidation, "calculation result barrel quantity does not match its source", nil, nil)
		}
		if line.Note != nil && utf8.RuneCountInString(*line.Note) > 1000 {
			return prepared, domainError(ErrorValidation, "calculation result note is too long", nil, nil)
		}
		employeeAmount, _ := parseFixed(line.EmployeeAmount, 2, true)
		intermediaryAmount, _ := parseFixed(line.IntermediaryAmount, 2, true)
		rebateAmount, _ := parseFixed(line.RebateAmount, 2, true)
		if employeeAmount > 0 {
			key := summaryKey{"COMMISSION", sourceLine.Salesperson.Entity, sourceLine.Salesperson.ObjectID}
			if err := addExpected(key, sourceLine.Salesperson, employeeAmount); err != nil {
				return prepared, err
			}
		}
		if intermediaryAmount > 0 {
			if sourceLine.Intermediary == nil {
				return prepared, domainError(ErrorValidation, "intermediary amount requires a source intermediary", nil, nil)
			}
			key := summaryKey{"INTERMEDIARY", sourceLine.Intermediary.Entity, sourceLine.Intermediary.ObjectID}
			if err := addExpected(key, *sourceLine.Intermediary, intermediaryAmount); err != nil {
				return prepared, err
			}
		}
		if rebateAmount > 0 {
			key := summaryKey{"REBATE", sourceLine.Customer.Entity, sourceLine.Customer.ObjectID}
			if err := addExpected(key, sourceLine.Customer, rebateAmount); err != nil {
				return prepared, err
			}
		}
		encoded, marshalErr := json.Marshal(line)
		if marshalErr != nil {
			return prepared, domainError(ErrorValidation, "invalid calculation result", nil, marshalErr)
		}
		prepared.lineJSON = append(prepared.lineJSON, encoded)
		prepared.lineEmployee = append(prepared.lineEmployee, employeeAmount)
		prepared.lineIntermediary = append(prepared.lineIntermediary, intermediaryAmount)
		prepared.lineRebate = append(prepared.lineRebate, rebateAmount)
	}
	seenSummaries := make(map[summaryKey]bool)
	for _, summary := range calculation.Result.Summaries {
		category := strings.TrimSpace(summary.Category)
		if category != "COMMISSION" && category != "INTERMEDIARY" && category != "REBATE" {
			return prepared, domainError(ErrorValidation, "calculation summary category is invalid", nil, nil)
		}
		key := summaryKey{category, summary.Payee.Entity, summary.Payee.ObjectID}
		amount, parseErr := moneyCents(summary.Amount)
		if parseErr != nil || seenSummaries[key] || expected[key] != amount ||
			summary.Payee != expectedPayees[key] {
			return prepared, domainError(ErrorValidation, "calculation summary does not match detail results", nil, nil)
		}
		seenSummaries[key] = true
		total, ok := addIntermediaryAmount(prepared.total, amount)
		if !ok {
			return prepared, domainError(ErrorValidation, "calculation total is out of range", nil, nil)
		}
		prepared.total = total
		prepared.summaryAmounts = append(prepared.summaryAmounts, amount)
	}
	if len(seenSummaries) != len(expected) {
		return prepared, domainError(ErrorValidation, "calculation summaries are incomplete", nil, nil)
	}
	resultJSON, err := json.Marshal(calculation.Result)
	if err != nil {
		return prepared, domainError(ErrorValidation, "invalid calculation result", nil, err)
	}
	prepared.date, prepared.periodStart = date, periodStart
	prepared.sourceJSON, prepared.resultJSON = sourceJSON, resultJSON
	return prepared, nil
}

func (s *Service) writeIntermediaryCalculation(
	ctx context.Context, q *dbsqlc.Queries, documentID string,
	calculation *IntermediaryCalculationInput, prepared preparedIntermediaryCalculation, update bool,
) error {
	detail := dbsqlc.InsertVouIntermediaryCalculationDetailParams{
		DocumentID: documentID, PeriodStart: dateValue(prepared.periodStart), PeriodEnd: dateValue(prepared.date),
		SourceHash: calculation.SourceHash, SourceSnapshot: prepared.sourceJSON,
		ScriptID: calculation.Script.ScriptID, ScriptRevision: calculation.Script.Revision,
		ScriptName: calculation.Script.Name, ScriptSource: calculation.Script.Source,
		ScriptHash: calculation.Script.Hash, ResultSnapshot: prepared.resultJSON,
	}
	if update {
		rows, err := q.UpdateVouIntermediaryCalculationDetail(ctx, dbsqlc.UpdateVouIntermediaryCalculationDetailParams{
			PeriodStart: detail.PeriodStart, PeriodEnd: detail.PeriodEnd, SourceHash: detail.SourceHash,
			SourceSnapshot: detail.SourceSnapshot, ScriptID: detail.ScriptID, ScriptRevision: detail.ScriptRevision,
			ScriptName: detail.ScriptName, ScriptSource: detail.ScriptSource, ScriptHash: detail.ScriptHash,
			ResultSnapshot: detail.ResultSnapshot, DocumentID: documentID,
		})
		if err := oneRow(rows, err); err != nil {
			return err
		}
		if err := q.DeleteVouIntermediaryCalculationLines(ctx, documentID); err != nil {
			return err
		}
		if err := q.DeleteVouIntermediaryCalculationSummaries(ctx, documentID); err != nil {
			return err
		}
	} else if err := q.InsertVouIntermediaryCalculationDetail(ctx, detail); err != nil {
		return err
	}
	for index, line := range calculation.Result.Lines {
		if err := q.InsertVouIntermediaryCalculationLine(ctx, dbsqlc.InsertVouIntermediaryCalculationLineParams{
			ID: newID(), DocumentID: documentID, LineNo: int32(index + 1), SourceSignoffLineID: line.SourceSignoffLineID,
			Result: prepared.lineJSON[index], EmployeeAmountCents: prepared.lineEmployee[index],
			IntermediaryAmountCents: prepared.lineIntermediary[index], RebateAmountCents: prepared.lineRebate[index],
		}); err != nil {
			return err
		}
	}
	for index, summary := range calculation.Result.Summaries {
		if err := q.InsertVouIntermediaryCalculationSummary(ctx, dbsqlc.InsertVouIntermediaryCalculationSummaryParams{
			ID: newID(), DocumentID: documentID, LineNo: int32(index + 1), Category: strings.ToUpper(summary.Category),
			PayeeEntity: summary.Payee.Entity, PayeeObjectID: summary.Payee.ObjectID,
			PayeeVersionID: summary.Payee.VersionID, PayeeCode: summary.Payee.Code, PayeeName: summary.Payee.Name,
			AmountCents: prepared.summaryAmounts[index],
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) CreateIntermediaryCalculation(
	ctx context.Context, input CreateInput, actorID, requestID string,
) (MutationResult, error) {
	if !validID(actorID) || input.ParentEntity != "" || input.ParentDocumentID != "" {
		return MutationResult{}, domainError(ErrorValidation, "invalid intermediary calculation create", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin intermediary calculation create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	prepared, err := s.prepareIntermediaryCalculation(ctx, q, input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	counter, err := q.NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{
		Entity: EntityIntermediaryCalculation, BusinessDate: dateValue(prepared.date),
	})
	if err != nil {
		return MutationResult{}, s.writeError("allocate intermediary calculation number", err)
	}
	documentID := newID()
	documentNo := fmt.Sprintf("%s-%s-%04d", entityPrefix(EntityIntermediaryCalculation), prepared.date.Format("20060102"), counter)
	if err = q.InsertVouDocument(ctx, dbsqlc.InsertVouDocumentParams{
		ID: documentID, Entity: EntityIntermediaryCalculation, DocumentNo: documentNo,
		BusinessDate: dateValue(prepared.date), Currency: stringPtr(intermediaryCurrency),
		TotalAmountCents: prepared.total, Remark: optionalText(input.Data.Remark), ActorID: actorID,
	}); err != nil {
		return MutationResult{}, s.writeError("insert intermediary calculation", err)
	}
	if err = s.writeIntermediaryCalculation(ctx, q, documentID, input.Data.IntermediaryCalculation, prepared, false); err != nil {
		return MutationResult{}, s.writeError("insert intermediary calculation draft", err)
	}
	if err = insertAudit(ctx, q, auditInput{DocumentID: documentID, Entity: EntityIntermediaryCalculation,
		Event: "CREATED", To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"documentNo": documentNo, "periodEnd": prepared.date.Format(dateLayout)}}); err != nil {
		return MutationResult{}, s.writeError("audit intermediary calculation create", err)
	}
	if err = s.events.Publish(ctx, tx, DocumentCreatedEvent{Entity: EntityIntermediaryCalculation,
		DocumentID: documentID, DocumentNo: documentNo, Revision: 1, ActorID: actorID, RequestID: requestID}); err != nil {
		return MutationResult{}, s.eventError("publish intermediary calculation created", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit intermediary calculation create", err)
	}
	return MutationResult{DocumentID: documentID, DocumentNo: documentNo, Status: StatusDraft, Revision: 1}, nil
}

func (s *Service) SaveIntermediaryCalculation(
	ctx context.Context, input SaveInput, actorID, requestID string,
) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	if !validID(actorID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid actor", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin intermediary calculation save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: EntityIntermediaryCalculation})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	prepared, err := s.prepareIntermediaryCalculation(ctx, q, input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	if err = s.writeIntermediaryCalculation(ctx, q, input.DocumentID, input.Data.IntermediaryCalculation, prepared, true); err != nil {
		return MutationResult{}, s.writeError("save intermediary calculation draft", err)
	}
	revision, err := q.UpdateVouDraft(ctx, dbsqlc.UpdateVouDraftParams{
		BusinessDate: dateValue(prepared.date), Currency: stringPtr(intermediaryCurrency), TotalAmountCents: prepared.total,
		Remark: optionalText(input.Data.Remark), ActorID: actorID, ID: input.DocumentID,
		Entity: EntityIntermediaryCalculation, Revision: input.Revision,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorConflict, "document changed", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.writeError("update intermediary calculation", err)
	}
	if err = insertAudit(ctx, q, auditInput{DocumentID: input.DocumentID, Entity: EntityIntermediaryCalculation,
		Event: "SAVED", From: stringPtr(StatusDraft), To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"revision": revision}}); err != nil {
		return MutationResult{}, s.writeError("audit intermediary calculation save", err)
	}
	if err = s.events.Publish(ctx, tx, DocumentChangedEvent{Action: "SAVED", Entity: EntityIntermediaryCalculation,
		DocumentID: document.ID, DocumentNo: document.DocumentNo, Status: StatusDraft, Revision: revision,
		ActorID: actorID, RequestID: requestID}); err != nil {
		return MutationResult{}, s.eventError("publish intermediary calculation saved", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit intermediary calculation save", err)
	}
	return MutationResult{DocumentID: document.ID, DocumentNo: document.DocumentNo, Status: StatusDraft, Revision: revision}, nil
}
