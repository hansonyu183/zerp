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
	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
	"github.com/jackc/pgx/v5"
)

const (
	intermediaryCurrency               = "CNY"
	intermediarySourceSale             = "SALE"
	intermediarySourceReturnAdjustment = "RETURN_ADJUSTMENT"
)

type preparedIntermediaryCalculation struct {
	date, periodStart              time.Time
	sourceJSON, resultJSON         []byte
	lineJSON                       [][]byte
	lineEmployee, lineIntermediary []int64
	lineRebate                     []int64
	lineBillIDs                    [][]string
	lineSourceCalculations         []*string
	summaryAmounts                 []int64
	total                          int64
}

type intermediaryDocument struct {
	customerID, id, number string
	date                   time.Time
	amount                 int64
	rows                   []dbsqlc.ListIntermediarySignoffSourceRowsRow
	collectionDate         *time.Time
	hasRemainingQuantity   bool
}

type intermediaryReturnTimelineItem struct {
	documentID string
	amount     int64
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

func addSignedIntermediaryAmount(total, amount int64) (int64, bool) {
	if (amount > 0 && total > math.MaxInt64-amount) ||
		(amount < 0 && total < math.MinInt64-amount) {
		return 0, false
	}
	return total + amount, true
}

func proratedIntermediaryAmount(amount, quantity, totalQuantity int64) (int64, bool) {
	if amount < 0 || quantity < 0 || totalQuantity <= 0 || quantity > totalQuantity {
		return 0, false
	}
	product := new(big.Int).Mul(big.NewInt(amount), big.NewInt(quantity))
	quotient, remainder := new(big.Int), new(big.Int)
	quotient.QuoRem(product, big.NewInt(totalQuantity), remainder)
	if new(big.Int).Mul(remainder, big.NewInt(2)).Cmp(big.NewInt(totalQuantity)) >= 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	return quotient.Int64(), quotient.IsInt64()
}

func formatSignedMoney(value int64) string {
	return fixeddecimal.Format(value, 2, false)
}

func documentAmount(entity string, value int64) string {
	if entity == EntityIntermediaryCalculation {
		return formatSignedMoney(value)
	}
	return formatMoney(value)
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
	control, err := q.GetAccountingControlBookForVou(ctx)
	if err != nil {
		return IntermediarySourceView{}, domainError(ErrorConflict, "accounting control book is not ready", nil, err)
	}
	rows, err := q.ListIntermediarySignoffSourceRows(ctx, dbsqlc.ListIntermediarySignoffSourceRowsParams{
		CutoverDate: control.StartMonth, PeriodEnd: dateValue(periodEnd),
	})
	if err != nil {
		return IntermediarySourceView{}, s.internal("read intermediary source signoffs", err)
	}
	returnRows, err := q.ListIntermediarySignoffReturnTimelineRows(ctx, dbsqlc.ListIntermediarySignoffReturnTimelineRowsParams{
		CutoverDate: control.StartMonth, PeriodEnd: dateValue(periodEnd),
	})
	if err != nil {
		return IntermediarySourceView{}, s.internal("read intermediary source return timeline", err)
	}
	events, err := q.ListIntermediaryCustomerTradeEvents(ctx, dbsqlc.ListIntermediaryCustomerTradeEventsParams{
		CutoverDate: control.StartMonth, PeriodEnd: dateValue(periodEnd),
	})
	if err != nil {
		return IntermediarySourceView{}, s.internal("read customer collection events", err)
	}

	documents := make([]*intermediaryDocument, 0)
	byDocument := make(map[string]*intermediaryDocument)
	for _, row := range rows {
		if row.SignedQtyMicros < 0 || row.LineAmountCents < 0 {
			return IntermediarySourceView{}, domainError(ErrorConflict,
				"sale return exceeds its source signoff", map[string]any{"lineId": row.SourceSignoffLineID}, nil)
		}
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
		documentAmount, ok := addIntermediaryAmount(document.amount, row.FifoLineAmountCents)
		if !ok {
			return IntermediarySourceView{}, domainError(ErrorConflict,
				"intermediary FIFO amount is out of range", map[string]any{"documentId": row.SignoffDocumentID}, nil)
		}
		document.amount = documentAmount
		document.rows = append(document.rows, row)
		if row.SignedQtyMicros > 0 {
			document.hasRemainingQuantity = true
		}
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
		amount, ok := addSignedIntermediaryAmount(eventDates[event.CounterpartyObjectID][date], event.AmountDeltaCents)
		if !ok {
			return IntermediarySourceView{}, domainError(ErrorConflict,
				"intermediary FIFO balance is out of range", map[string]any{"customerId": event.CounterpartyObjectID}, nil)
		}
		eventDates[event.CounterpartyObjectID][date] = amount
	}
	documentsByCustomer := make(map[string][]*intermediaryDocument)
	for _, document := range documents {
		documentsByCustomer[document.customerID] = append(documentsByCustomer[document.customerID], document)
	}
	returnDates := make(map[string]map[time.Time][]intermediaryReturnTimelineItem)
	for _, row := range returnRows {
		document := byDocument[row.SignoffDocumentID]
		if document == nil || document.customerID != row.CustomerObjectID || !row.ReturnDate.Valid || row.AmountCents < 0 {
			return IntermediarySourceView{}, domainError(ErrorConflict,
				"sale return timeline is invalid", map[string]any{"documentId": row.SignoffDocumentID}, nil)
		}
		if row.AmountCents == 0 {
			continue
		}
		if returnDates[row.CustomerObjectID] == nil {
			returnDates[row.CustomerObjectID] = make(map[time.Time][]intermediaryReturnTimelineItem)
		}
		date := row.ReturnDate.Time
		returnDates[row.CustomerObjectID][date] = append(returnDates[row.CustomerObjectID][date], intermediaryReturnTimelineItem{
			documentID: row.SignoffDocumentID, amount: row.AmountCents,
		})
	}
	for customerID, customerDocuments := range documentsByCustomer {
		documentStarts := make(map[time.Time][]*intermediaryDocument)
		dateSet := make(map[time.Time]bool)
		for _, document := range customerDocuments {
			documentStarts[document.date] = append(documentStarts[document.date], document)
			dateSet[document.date] = true
		}
		for date := range eventDates[customerID] {
			dateSet[date] = true
		}
		for date := range returnDates[customerID] {
			dateSet[date] = true
		}
		dates := make([]time.Time, 0, len(dateSet))
		for date := range dateSet {
			dates = append(dates, date)
		}
		sort.Slice(dates, func(i, j int) bool { return dates[i].Before(dates[j]) })
		var balance, signedTotal, retiredCovered int64
		eligibleAmounts := make(map[string]int64, len(customerDocuments))
		coveredAmounts := make(map[string]int64, len(customerDocuments))
		for _, date := range dates {
			for _, document := range documentStarts[date] {
				eligibleAmounts[document.id] = document.amount
				var ok bool
				signedTotal, ok = addIntermediaryAmount(signedTotal, document.amount)
				if !ok {
					return IntermediarySourceView{}, domainError(ErrorConflict,
						"intermediary FIFO amount is out of range", map[string]any{"documentId": document.id}, nil)
				}
			}
			for _, returned := range returnDates[customerID][date] {
				eligible := eligibleAmounts[returned.documentID]
				if returned.amount > eligible {
					return IntermediarySourceView{}, domainError(ErrorConflict,
						"sale return exceeds its source signoff", map[string]any{"documentId": returned.documentID}, nil)
				}
				covered := min(coveredAmounts[returned.documentID], eligible)
				consumedReturn := max(returned.amount-(eligible-covered), int64(0))
				coveredAmounts[returned.documentID] = covered - consumedReturn
				var ok bool
				retiredCovered, ok = addIntermediaryAmount(retiredCovered, consumedReturn)
				if !ok {
					return IntermediarySourceView{}, domainError(ErrorConflict,
						"intermediary FIFO amount is out of range", map[string]any{"documentId": returned.documentID}, nil)
				}
				eligibleAmounts[returned.documentID] = eligible - returned.amount
				signedTotal -= returned.amount
				balance, ok = addSignedIntermediaryAmount(balance, -returned.amount)
				if !ok {
					return IntermediarySourceView{}, domainError(ErrorConflict,
						"intermediary FIFO balance is out of range", map[string]any{"customerId": customerID}, nil)
				}
			}
			var ok bool
			balance, ok = addSignedIntermediaryAmount(balance, eventDates[customerID][date])
			if !ok {
				return IntermediarySourceView{}, domainError(ErrorConflict,
					"intermediary FIFO balance is out of range", map[string]any{"customerId": customerID}, nil)
			}
			capacityValue := new(big.Int).Sub(big.NewInt(signedTotal), big.NewInt(balance))
			capacityValue.Sub(capacityValue, big.NewInt(retiredCovered))
			var capacity int64
			if capacityValue.Sign() > 0 {
				capacity = signedTotal
				if capacityValue.Cmp(big.NewInt(signedTotal)) < 0 {
					capacity = capacityValue.Int64()
				}
			}
			available := capacity
			for _, document := range customerDocuments {
				if document.date.After(date) {
					continue
				}
				amount := eligibleAmounts[document.id]
				if amount == 0 {
					if document.collectionDate == nil && document.hasRemainingQuantity {
						collected := date
						document.collectionDate = &collected
					}
					continue
				}
				covered := min(available, amount)
				available -= covered
				if covered > coveredAmounts[document.id] {
					coveredAmounts[document.id] = covered
				}
				if document.collectionDate == nil && covered == amount {
					collected := date
					document.collectionDate = &collected
				}
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
			if row.SignedQtyMicros == 0 {
				continue
			}
			pricingQuantity := new(big.Int).Mul(big.NewInt(row.SignedQtyMicros), big.NewInt(row.PricingQuantityPerInventoryUnitMicros))
			pricingQuantity.Quo(pricingQuantity, big.NewInt(1_000_000))
			if !pricingQuantity.IsInt64() || pricingQuantity.Sign() <= 0 {
				return IntermediarySourceView{}, domainError(ErrorConflict, "source pricing quantity is invalid", map[string]any{"lineId": row.SourceSignoffLineID}, nil)
			}
			line := IntermediarySourceLine{
				SourceSignoffLineID: row.SourceSignoffLineID,
				SourceKind:          intermediarySourceSale,
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
				SpecialApproval: row.SpecialApproval, AdjustmentEmployeeAmount: "0.00",
				AdjustmentIntermediaryAmount: "0.00", AdjustmentRebateAmount: "0.00",
			}
			if row.IntermediaryOtherPartyID != nil {
				if row.IntermediaryVersionID == nil || row.IntermediaryCode == nil || row.IntermediaryName == nil {
					return IntermediarySourceView{}, domainError(ErrorConflict, "customer intermediary is not effective", map[string]any{"customerCode": row.CustomerCode}, nil)
				}
				ref := intermediaryReference(*row.IntermediaryOtherPartyID, *row.IntermediaryVersionID, "other-unit", *row.IntermediaryCode, *row.IntermediaryName)
				line.Intermediary = &ref
			}
			source.Lines = append(source.Lines, line)
		}
	}
	if err = s.appendIntermediaryReturnAdjustments(
		ctx, q, control.StartMonth.Time, periodStart, periodEnd, &source,
	); err != nil {
		return IntermediarySourceView{}, err
	}

	bills, err := q.ListIntermediaryBillSourceRows(ctx, dbsqlc.ListIntermediaryBillSourceRowsParams{
		CutoverDate: control.StartMonth, PeriodEnd: dateValue(periodEnd),
	})
	if err != nil {
		return IntermediarySourceView{}, s.internal("read intermediary source bills", err)
	}
	for _, bill := range bills {
		if bill.CustomerObjectID == nil || bill.CustomerVersionID == nil || bill.CustomerCode == nil || bill.CustomerName == nil ||
			bill.SalespersonObjectID == nil || bill.SalespersonVersionID == nil || bill.SalespersonCode == nil || bill.SalespersonName == nil {
			return IntermediarySourceView{}, domainError(ErrorConflict, "bill receipt is missing customer salesperson", map[string]any{"documentNo": bill.ReceiptDocumentNo}, nil)
		}
		costDays := max(int(bill.MaturityDate.Time.Sub(bill.ReceiptDate.Time).Hours()/24), 0)
		source.Bills = append(source.Bills, IntermediarySourceBill{
			BillLineID: bill.BillLineID, ReceiptDocumentID: bill.ReceiptDocumentID, ReceiptDocumentNo: bill.ReceiptDocumentNo,
			ReceiptDate: formatDate(bill.ReceiptDate),
			Customer:    intermediaryReference(*bill.CustomerObjectID, *bill.CustomerVersionID, "customer", *bill.CustomerCode, *bill.CustomerName),
			Salesperson: intermediaryReference(*bill.SalespersonObjectID, *bill.SalespersonVersionID, "employee", *bill.SalespersonCode, *bill.SalespersonName),
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

type intermediaryReturnAdjustment struct {
	source                         IntermediarySourceLine
	originalResult                 IntermediaryResultLine
	originalQuantity               int64
	returnedBefore, returnedPeriod int64
	periodAmount                   int64
	returnDocumentNos              []string
	returnDocumentSet              map[string]bool
	lastReturnDate                 time.Time
}

func (s *Service) appendIntermediaryReturnAdjustments(
	ctx context.Context,
	q *dbsqlc.Queries,
	cutoverDate, periodStart, periodEnd time.Time,
	source *IntermediaryCalculationSource,
) error {
	rows, err := q.ListIntermediaryReturnAdjustmentRows(ctx, dbsqlc.ListIntermediaryReturnAdjustmentRowsParams{
		CutoverDate: dateValue(cutoverDate), PeriodEnd: dateValue(periodEnd),
	})
	if err != nil {
		return s.internal("read intermediary return adjustments", err)
	}
	groups := make(map[string]*intermediaryReturnAdjustment)
	ordered := make([]*intermediaryReturnAdjustment, 0)
	for _, row := range rows {
		group := groups[row.SourceSignoffLineID]
		if group == nil {
			var originalSource IntermediaryCalculationSource
			var originalResult IntermediaryResultLine
			if err = json.Unmarshal(row.SourceSnapshot, &originalSource); err != nil {
				return s.internal("decode original intermediary source", err)
			}
			if err = json.Unmarshal(row.OriginalResult, &originalResult); err != nil {
				return s.internal("decode original intermediary result", err)
			}
			var originalLine *IntermediarySourceLine
			for index := range originalSource.Lines {
				if originalSource.Lines[index].SourceSignoffLineID == row.SourceSignoffLineID {
					originalLine = &originalSource.Lines[index]
					break
				}
			}
			if originalLine == nil {
				return domainError(ErrorConflict, "original intermediary calculation source is incomplete",
					map[string]any{"lineId": row.SourceSignoffLineID}, nil)
			}
			originalQuantity, parseErr := quantityMicros(originalLine.BarrelQuantity, false)
			if parseErr != nil {
				return domainError(ErrorConflict, "original intermediary calculation quantity is invalid",
					map[string]any{"lineId": row.SourceSignoffLineID}, nil)
			}
			group = &intermediaryReturnAdjustment{
				source: *originalLine, originalResult: originalResult, originalQuantity: originalQuantity,
				returnDocumentSet: make(map[string]bool),
			}
			group.source.sourceCalculationDocumentID = row.CalculationDocumentID
			groups[row.SourceSignoffLineID] = group
			ordered = append(ordered, group)
		} else if group.source.sourceCalculationDocumentID != row.CalculationDocumentID {
			return domainError(ErrorConflict, "return adjustment source calculation changed",
				map[string]any{"lineId": row.SourceSignoffLineID}, nil)
		}
		if row.ReturnDate.Time.Before(periodStart) {
			group.returnedBefore += row.QuantityMicros
			continue
		}
		group.returnedPeriod += row.QuantityMicros
		group.periodAmount += row.LineAmountCents
		group.lastReturnDate = row.ReturnDate.Time
		if !group.returnDocumentSet[row.ReturnDocumentNo] {
			group.returnDocumentSet[row.ReturnDocumentNo] = true
			group.returnDocumentNos = append(group.returnDocumentNos, row.ReturnDocumentNo)
		}
	}
	for _, group := range ordered {
		if group.returnedPeriod == 0 {
			continue
		}
		totalReturned := group.returnedBefore + group.returnedPeriod
		if totalReturned > group.originalQuantity {
			return domainError(ErrorConflict, "intermediary return quantity exceeds its original calculation",
				map[string]any{"lineId": group.source.SourceSignoffLineID}, nil)
		}
		adjustments := make([]int64, 0, 3)
		for _, value := range []string{
			group.originalResult.EmployeeAmount,
			group.originalResult.IntermediaryAmount,
			group.originalResult.RebateAmount,
		} {
			originalAmount, parseErr := parseFixed(value, 2, true)
			if parseErr != nil {
				return domainError(ErrorConflict, "original intermediary calculation amount is invalid",
					map[string]any{"lineId": group.source.SourceSignoffLineID}, nil)
			}
			throughPeriod, ok := proratedIntermediaryAmount(originalAmount, totalReturned, group.originalQuantity)
			if !ok {
				return domainError(ErrorConflict, "intermediary return adjustment is out of range", nil, nil)
			}
			beforePeriod, ok := proratedIntermediaryAmount(originalAmount, group.returnedBefore, group.originalQuantity)
			if !ok {
				return domainError(ErrorConflict, "intermediary return adjustment is out of range", nil, nil)
			}
			adjustments = append(adjustments, throughPeriod-beforePeriod)
		}
		pricingQuantity, parseErr := quantityMicros(group.source.PricingQuantity, false)
		if parseErr != nil {
			return domainError(ErrorConflict, "original intermediary pricing quantity is invalid", nil, nil)
		}
		adjustmentPricing, ok := proratedIntermediaryAmount(pricingQuantity, group.returnedPeriod, group.originalQuantity)
		if !ok {
			return domainError(ErrorConflict, "intermediary return pricing quantity is out of range", nil, nil)
		}
		line := group.source
		line.SourceKind = intermediarySourceReturnAdjustment
		line.CollectionDate = group.lastReturnDate.Format(dateLayout)
		line.CollectionDelayDays = 0
		line.SignedQuantity = formatQuantity(group.returnedPeriod)
		line.BarrelQuantity = line.SignedQuantity
		line.PricingQuantity = formatQuantity(adjustmentPricing)
		line.LineAmount = formatMoney(group.periodAmount)
		line.ReturnDocumentNos = group.returnDocumentNos
		line.AdjustmentEmployeeAmount = formatMoney(adjustments[0])
		line.AdjustmentIntermediaryAmount = formatMoney(adjustments[1])
		line.AdjustmentRebateAmount = formatMoney(adjustments[2])
		source.Lines = append(source.Lines, line)
	}
	return nil
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
	if _, err := q.LockAccountingControlBookForVou(ctx); err != nil {
		return prepared, domainError(ErrorConflict, "accounting control book is not ready", nil, err)
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
	currentLineSources := make(map[string]IntermediarySourceLine, len(currentSource.Source.Lines))
	for _, line := range currentSource.Source.Lines {
		currentLineSources[line.SourceSignoffLineID] = line
	}
	if len(calculation.Result.Lines) != len(lineSources) {
		return prepared, domainError(ErrorValidation, "calculation result must contain one row per source line", nil, nil)
	}
	type summaryKey struct{ category, entity, objectID string }
	expected := make(map[summaryKey]int64)
	expectedPayees := make(map[summaryKey]IntermediaryReference)
	addExpected := func(key summaryKey, payee IntermediaryReference, amount int64) error {
		total, ok := addSignedIntermediaryAmount(expected[key], amount)
		if !ok {
			return domainError(ErrorValidation, "calculation summary is out of range", nil, nil)
		}
		expected[key] = total
		expectedPayees[key] = payee
		return nil
	}
	billSources := make(map[string]IntermediarySourceBill, len(calculation.Source.Bills))
	for _, bill := range calculation.Source.Bills {
		billSources[bill.BillLineID] = bill
	}
	allocatedBills := make(map[string]bool, len(calculation.Source.Bills))
	billCostGroups := make(map[string]bool)
	billAllocationGroups := make(map[string]bool)
	seenLines := make(map[string]bool, len(calculation.Result.Lines))
	for _, line := range calculation.Result.Lines {
		sourceLine, ok := lineSources[line.SourceSignoffLineID]
		if !ok || seenLines[line.SourceSignoffLineID] {
			return prepared, domainError(ErrorValidation, "calculation result line does not match its source", nil, nil)
		}
		currentSourceLine, currentSourceExists := currentLineSources[line.SourceSignoffLineID]
		if !currentSourceExists {
			return prepared, domainError(ErrorConflict, "calculation source changed; recalculate before saving", nil, nil)
		}
		seenLines[line.SourceSignoffLineID] = true
		amountFields := []string{line.BaseCommission, line.PremiumCommission, line.LowPriceCommission,
			line.MarketMaintenanceSubsidy, line.MarketDevelopmentSubsidy, line.BillCost,
			line.EmployeeAmount, line.IntermediaryAmount, line.RebateAmount}
		parsedAmounts := make([]int64, 0, len(amountFields))
		for _, value := range amountFields {
			var amount int64
			var parseErr error
			if sourceLine.SourceKind == intermediarySourceReturnAdjustment {
				amount, parseErr = fixeddecimal.ParseSigned(value, 2, true)
			} else {
				amount, parseErr = parseFixed(value, 2, true)
			}
			if parseErr != nil {
				return prepared, domainError(ErrorValidation, "calculation result contains an invalid amount", nil, nil)
			}
			parsedAmounts = append(parsedAmounts, amount)
		}
		if sourceLine.SourceKind != intermediarySourceSale && sourceLine.SourceKind != intermediarySourceReturnAdjustment {
			return prepared, domainError(ErrorValidation, "calculation source kind is invalid", nil, nil)
		}
		if sourceLine.SourceKind == intermediarySourceReturnAdjustment {
			if currentSourceLine.sourceCalculationDocumentID == "" {
				return prepared, domainError(ErrorConflict, "return adjustment source calculation is missing", nil, nil)
			}
			for index, amount := range parsedAmounts {
				if (index < 6 && amount != 0) || (index >= 6 && amount > 0) {
					return prepared, domainError(ErrorValidation, "return adjustment result has an invalid direction", nil, nil)
				}
			}
			if len(line.BillLineIDs) != 0 {
				return prepared, domainError(ErrorValidation, "return adjustment cannot allocate bill cost", nil, nil)
			}
			for index, value := range []string{
				sourceLine.AdjustmentEmployeeAmount,
				sourceLine.AdjustmentIntermediaryAmount,
				sourceLine.AdjustmentRebateAmount,
			} {
				expectedAmount, parseErr := parseFixed(value, 2, true)
				if parseErr != nil {
					return prepared, domainError(ErrorConflict, "return adjustment source amount is invalid", nil, nil)
				}
				if parsedAmounts[6+index] != -expectedAmount {
					return prepared, domainError(ErrorValidation, "return adjustment result amounts do not match its source", nil, nil)
				}
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
		employeeAmount := parsedAmounts[6]
		intermediaryAmount := parsedAmounts[7]
		rebateAmount := parsedAmounts[8]
		if employeeAmount != 0 {
			key := summaryKey{"COMMISSION", sourceLine.Salesperson.Entity, sourceLine.Salesperson.ObjectID}
			if err := addExpected(key, sourceLine.Salesperson, employeeAmount); err != nil {
				return prepared, err
			}
		}
		if intermediaryAmount != 0 {
			if sourceLine.Intermediary == nil {
				return prepared, domainError(ErrorValidation, "intermediary amount requires a source intermediary", nil, nil)
			}
			key := summaryKey{"INTERMEDIARY", sourceLine.Intermediary.Entity, sourceLine.Intermediary.ObjectID}
			if err := addExpected(key, *sourceLine.Intermediary, intermediaryAmount); err != nil {
				return prepared, err
			}
		}
		if rebateAmount != 0 {
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
		var sourceCalculationDocumentID *string
		if currentSourceLine.sourceCalculationDocumentID != "" {
			sourceCalculationDocumentID = stringPtr(currentSourceLine.sourceCalculationDocumentID)
		}
		prepared.lineSourceCalculations = append(prepared.lineSourceCalculations, sourceCalculationDocumentID)
		for _, billLineID := range line.BillLineIDs {
			bill, exists := billSources[billLineID]
			if !exists || allocatedBills[billLineID] || sourceLine.SourceKind != intermediarySourceSale ||
				bill.Customer.ObjectID != sourceLine.Customer.ObjectID ||
				bill.Salesperson.ObjectID != sourceLine.Salesperson.ObjectID {
				return prepared, domainError(ErrorValidation, "calculation bill allocation does not match its source", nil, nil)
			}
			allocatedBills[billLineID] = true
		}
		if parsedAmounts[5] > 0 {
			billCostGroups[sourceLine.Customer.ObjectID+":"+sourceLine.Salesperson.ObjectID] = true
		}
		if len(line.BillLineIDs) != 0 {
			billAllocationGroups[sourceLine.Customer.ObjectID+":"+sourceLine.Salesperson.ObjectID] = true
		}
		prepared.lineBillIDs = append(prepared.lineBillIDs, append([]string(nil), line.BillLineIDs...))
	}
	for key := range billCostGroups {
		if !billAllocationGroups[key] {
			return prepared, domainError(ErrorValidation, "bill cost requires its source bill allocation", nil, nil)
		}
	}
	for key := range billAllocationGroups {
		if !billCostGroups[key] {
			return prepared, domainError(ErrorValidation, "bill allocation requires a positive bill cost", nil, nil)
		}
	}
	for key, amount := range expected {
		if amount == 0 {
			delete(expected, key)
			delete(expectedPayees, key)
		}
	}
	seenSummaries := make(map[summaryKey]bool)
	for _, summary := range calculation.Result.Summaries {
		category := strings.TrimSpace(summary.Category)
		if category != "COMMISSION" && category != "INTERMEDIARY" && category != "REBATE" {
			return prepared, domainError(ErrorValidation, "calculation summary category is invalid", nil, nil)
		}
		key := summaryKey{category, summary.Payee.Entity, summary.Payee.ObjectID}
		amount, parseErr := fixeddecimal.ParseSigned(summary.Amount, 2, false)
		if parseErr != nil || amount == 0 || seenSummaries[key] || expected[key] != amount ||
			summary.Payee != expectedPayees[key] {
			return prepared, domainError(ErrorValidation, "calculation summary does not match detail results", nil, nil)
		}
		seenSummaries[key] = true
		total, ok := addSignedIntermediaryAmount(prepared.total, amount)
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

func (s *Service) validateStoredIntermediaryCalculation(
	ctx context.Context, q *dbsqlc.Queries, documentID string,
) error {
	if _, err := q.LockAccountingControlBookForVou(ctx); err != nil {
		return domainError(ErrorConflict, "accounting control book is not ready", nil, err)
	}
	detail, err := q.GetVouIntermediaryCalculationDetail(ctx, documentID)
	if err != nil {
		return s.internal("read intermediary calculation attributes", err)
	}
	current, err := s.intermediarySource(ctx, q, detail.PeriodStart.Time, detail.PeriodEnd.Time)
	if err != nil {
		return err
	}
	var stored IntermediaryCalculationSource
	if err = json.Unmarshal(detail.SourceSnapshot, &stored); err != nil {
		return s.internal("decode intermediary calculation source snapshot", err)
	}
	storedJSON, err := json.Marshal(stored)
	if err != nil {
		return s.internal("encode intermediary calculation source snapshot", err)
	}
	currentJSON, err := json.Marshal(current.Source)
	if err != nil {
		return s.internal("encode current intermediary calculation source", err)
	}
	if detail.SourceHash != current.SourceHash || intermediaryHash(storedJSON) != detail.SourceHash ||
		!bytes.Equal(storedJSON, currentJSON) {
		return domainError(ErrorConflict, "calculation source changed; recalculate before approval", nil, nil)
	}
	storedLines, err := q.ListVouIntermediaryCalculationLines(ctx, documentID)
	if err != nil {
		return s.internal("read intermediary calculation lines", err)
	}
	currentLines := make(map[string]IntermediarySourceLine, len(current.Source.Lines))
	for _, line := range current.Source.Lines {
		currentLines[line.SourceSignoffLineID] = line
	}
	if len(storedLines) != len(currentLines) {
		return domainError(ErrorConflict, "calculation source changed; recalculate before approval", nil, nil)
	}
	for _, line := range storedLines {
		currentLine, exists := currentLines[line.SourceSignoffLineID]
		if !exists || deref(line.SourceCalculationDocumentID) != currentLine.sourceCalculationDocumentID {
			return domainError(ErrorConflict, "calculation source changed; recalculate before approval", nil, nil)
		}
	}
	return nil
}

func (s *Service) ValidateIntermediaryCalculation(
	ctx context.Context, tx pgx.Tx, documentID string,
) error {
	if tx == nil {
		return domainError(ErrorValidation, "intermediary calculation validation transaction is required", nil, nil)
	}
	return s.validateStoredIntermediaryCalculation(ctx, s.queries.WithTx(tx), documentID)
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
		if err := q.DeleteVouIntermediaryCalculationBillAllocations(ctx, documentID); err != nil {
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
			SourceCalculationDocumentID: prepared.lineSourceCalculations[index],
			Result:                      prepared.lineJSON[index], EmployeeAmountCents: prepared.lineEmployee[index],
			IntermediaryAmountCents: prepared.lineIntermediary[index], RebateAmountCents: prepared.lineRebate[index],
		}); err != nil {
			return err
		}
		for _, billLineID := range prepared.lineBillIDs[index] {
			if err := q.InsertVouIntermediaryCalculationBillAllocation(
				ctx, dbsqlc.InsertVouIntermediaryCalculationBillAllocationParams{
					DocumentID: documentID, BillLineID: billLineID,
					SourceSignoffLineID: line.SourceSignoffLineID,
				},
			); err != nil {
				return err
			}
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
	if err = s.requireNoIntermediaryCalculationDependents(ctx, q, input.DocumentID); err != nil {
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

func (s *Service) requireNoIntermediaryCalculationDependents(
	ctx context.Context, q *dbsqlc.Queries, documentID string,
) error {
	if _, err := q.LockAccountingControlBookForVou(ctx); err != nil {
		return domainError(ErrorConflict, "accounting control book is not ready", nil, err)
	}
	hasDependents, err := q.HasIntermediaryCalculationDependents(ctx, stringPtr(documentID))
	if err != nil {
		return s.internal("read intermediary calculation mutation dependents", err)
	}
	if hasDependents {
		return domainError(ErrorConflict, "later intermediary calculations must be deleted first", nil, nil)
	}
	return nil
}
