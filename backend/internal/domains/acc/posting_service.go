package acc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/oklog/ulid/v2"
)

type postingSnapshot struct {
	header      map[string]string
	collections map[string][]map[string]string
}

type automaticPostingLine struct {
	subjectID, currency, sourceLineID string
	debitMinor, creditMinor           int64
	quantityMicros                    *int64
	quantityDeltaMicros               int64
	productID, productApprovalEntryID string
	productCode, productName          string
	warehouseID                       string
	dimensionsJSON                    []byte
	costCounterpartSubjectID          *string
	costCounterpartDimensionsJSON     []byte
	originSourceDocumentID            *string
	originSourceLineID                *string
}

type vouApprovalDelivery struct {
	Entity, DocumentID, DocumentNo string
	Revision                       int64
	Snapshot                       voudomain.ApprovalPayload
}

func (s *Service) RegisterSubscriptions(bus *txevent.Bus) error {
	if bus == nil {
		return errors.New("ACC event bus is required")
	}
	for _, entity := range SupportedMappingEntities() {
		if err := voudomain.ApprovalTopic(entity).Subscribe(bus, "acc-vou-approval", s.HandleApprovalEvent); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) HandleApprovalEvent(ctx context.Context, tx pgx.Tx, event approval.Event[voudomain.ApprovalPayload]) error {
	switch event.Action {
	case approval.ActionApproved:
		return s.HandleDocumentApproved(ctx, tx, event)
	case approval.ActionUnapproved:
		return s.HandleDocumentUnapproved(ctx, tx, event)
	default:
		return nil
	}
}

func approvedDelivery(event approval.Event[voudomain.ApprovalPayload]) (vouApprovalDelivery, bool) {
	snapshot := event.Payload
	if event.ToRevision == nil || event.ToStatus == nil || *event.ToStatus != approval.StatusApproved ||
		event.Entry.Domain != "vou" || snapshot.DocumentID != event.Entry.SubjectID || snapshot.Entity != event.Entry.Entity {
		return vouApprovalDelivery{}, false
	}
	return vouApprovalDelivery{Entity: snapshot.Entity, DocumentID: snapshot.DocumentID,
		DocumentNo: snapshot.DocumentNo, Revision: *event.ToRevision, Snapshot: snapshot}, true
}

func unapprovedDelivery(event approval.Event[voudomain.ApprovalPayload]) (vouApprovalDelivery, bool) {
	snapshot := event.Payload
	if event.FromRevision == nil || event.FromStatus == nil || *event.FromStatus != approval.StatusApproved ||
		event.Entry.Domain != "vou" || snapshot.DocumentID != event.Entry.SubjectID || snapshot.Entity != event.Entry.Entity {
		return vouApprovalDelivery{}, false
	}
	return vouApprovalDelivery{Entity: snapshot.Entity, DocumentID: snapshot.DocumentID,
		DocumentNo: snapshot.DocumentNo, Revision: *event.FromRevision, Snapshot: snapshot}, true
}

func (s *Service) HandleDocumentApproved(ctx context.Context, tx pgx.Tx, source approval.Event[voudomain.ApprovalPayload]) error {
	event, ok := approvedDelivery(source)
	if !ok {
		return txevent.Reject("invalid VOU approval snapshot", nil)
	}
	businessDate, err := time.Parse("2006-01-02", event.Snapshot.Data.BusinessDate)
	if err != nil {
		return txevent.Reject("invalid VOU accounting business date", nil)
	}
	snapshot, err := newPostingSnapshot(event.Snapshot, approval.StatusApproved, event.Revision)
	if err != nil {
		return err
	}
	q := s.queries.WithTx(tx)
	books, err := q.ListAccountingPostingBooks(ctx, pgtype.Date{Time: businessDate, Valid: true})
	if err != nil {
		return databaseError("list accounting posting books", err)
	}
	if err = s.applyGlobalRegisters(ctx, q, event, books, snapshot); err != nil {
		return postingDeliveryError(err)
	}
	for _, book := range books {
		if err = s.postSnapshotToBook(ctx, tx, q, book.ID, book.ControlBook, event, businessDate, snapshot); err != nil {
			return postingDeliveryError(err)
		}
	}
	return nil
}

func postingDeliveryError(err error) error {
	var domainErr *DomainError
	if errors.As(err, &domainErr) && (domainErr.Kind == ErrorValidation || domainErr.Kind == ErrorConflict) {
		return txevent.Reject(domainErr.Message, nil)
	}
	return err
}

func (s *Service) postSnapshotToBook(ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, bookID string, controlBook bool, event vouApprovalDelivery, businessDate time.Time, snapshot postingSnapshot) error {
	existing, err := q.GetAutomaticAccountingVoucher(ctx, dbsqlc.GetAutomaticAccountingVoucherParams{BookID: bookID, SourceEntity: &event.Entity, SourceID: event.DocumentID})
	if err == nil {
		if existing.SourceRevision != nil && *existing.SourceRevision == event.Revision {
			return nil
		}
		return domainError(ErrorConflict, "VOU source already has accounting facts from another revision", nil)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return databaseError("check automatic accounting voucher", err)
	}
	mapping, err := q.GetCurrentApprovedAccountingMapping(ctx, dbsqlc.GetCurrentApprovedAccountingMappingParams{BookID: bookID, VouEntity: event.Entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorConflict, "approved accounting mapping is missing", err)
	}
	if err != nil {
		return databaseError("get approved accounting mapping", err)
	}
	definition := MappingDefinition{}
	if err = json.Unmarshal(mapping.Definition, &definition); err != nil {
		return domainError(ErrorInternal, "invalid stored accounting mapping", err)
	}
	result, templateID, err := selectMappingResult(mapping.DefaultResult, definition, snapshot.header)
	if err != nil {
		return err
	}
	if result == MappingResultUnpost {
		return nil
	}
	template, ok := findPostingTemplate(definition.Templates, templateID)
	if !ok {
		return domainError(ErrorConflict, "posting template not found", nil)
	}
	lines, err := s.renderPostingTemplate(ctx, q, bookID, template, snapshot, event.DocumentID)
	if err != nil {
		return err
	}
	if err = validateAutomaticTrialBalance(lines); err != nil {
		return err
	}
	if controlBook {
		for _, line := range lines {
			if line.quantityMicros == nil {
				continue
			}
			lockKey := bookID + ":" + line.subjectID + ":" + line.warehouseID + ":" + line.productID
			if err = q.LockAccountingInventory(ctx, lockKey); err != nil {
				return databaseError("lock accounting inventory", err)
			}
		}
	}
	voucherID := ulid.Make().String()
	entity, revision, documentNo, mappingEntryID := event.Entity, event.Revision, event.DocumentNo, mapping.ApprovalEntryID
	if err = q.CreateAutomaticAccountingVoucher(ctx, dbsqlc.CreateAutomaticAccountingVoucherParams{
		ID: voucherID, BookID: bookID, SourceID: event.DocumentID,
		SourceEntity: &entity, SourceRevision: &revision, SourceDocumentNo: &documentNo,
		BusinessDate: pgtype.Date{Time: businessDate, Valid: true}, MappingApprovalEntryID: &mappingEntryID,
		ActorID: systemidentity.UserID,
	}); err != nil {
		return databaseError("create automatic accounting voucher", err)
	}
	controlDimensions := map[string]automaticPostingLine{}
	for index, line := range lines {
		lineID := ulid.Make().String()
		if err = q.InsertAccountingVoucherLine(ctx, dbsqlc.InsertAccountingVoucherLineParams{
			ID: lineID, BookID: bookID, VoucherID: voucherID, SubjectID: line.subjectID,
			Currency: line.currency, DebitMinor: line.debitMinor, CreditMinor: line.creditMinor,
			QuantityMicros: line.quantityMicros, Dimensions: line.dimensionsJSON,
			SourceLineID: line.sourceLineID, LineOrder: int32(index),
		}); err != nil {
			return databaseError("create automatic accounting voucher line", err)
		}
		if line.quantityMicros != nil {
			if err = q.InsertAccountingInventoryEntry(ctx, dbsqlc.InsertAccountingInventoryEntryParams{
				ID: ulid.Make().String(), BookID: bookID, VoucherID: voucherID, VoucherLineID: lineID,
				SubjectID: line.subjectID, ProductID: line.productID, WarehouseID: line.warehouseID,
				ProductApprovalEntryID: line.productApprovalEntryID,
				ProductCode:            line.productCode, ProductName: line.productName,
				BusinessDate: pgtype.Date{Time: businessDate, Valid: true}, QuantityDeltaMicros: line.quantityDeltaMicros, SourceLineID: line.sourceLineID,
				CostCounterpartSubjectID: line.costCounterpartSubjectID, CostCounterpartDimensions: line.costCounterpartDimensionsJSON,
				OriginSourceDocumentID: line.originSourceDocumentID, OriginSourceLineID: line.originSourceLineID,
			}); err != nil {
				return databaseError("create accounting inventory entry", err)
			}
			if controlBook {
				controlDimensions[line.subjectID+":"+line.warehouseID+":"+line.productID] = line
			}
		}
		if err = q.RegisterAccountingSubjectUsage(ctx, dbsqlc.RegisterAccountingSubjectUsageParams{SubjectID: line.subjectID, UsageType: "VOUCHER", UsageID: voucherID}); err != nil {
			return databaseError("register automatic voucher accounting subject", err)
		}
	}
	for _, line := range controlDimensions {
		balance, balanceErr := q.GetMinimumAccountingInventoryQuantity(ctx, dbsqlc.GetMinimumAccountingInventoryQuantityParams{
			BookID: bookID, SubjectID: line.subjectID, ProductID: line.productID,
			WarehouseID: line.warehouseID,
		})
		if balanceErr != nil {
			return databaseError("read accounting inventory balance", balanceErr)
		}
		if balance < 0 {
			return domainErrorWithKey(ErrorConflict, "inventory_insufficient", "insufficient control book inventory", nil)
		}
	}
	if controlBook {
		if err = validateControlBookFunds(ctx, tx, q, bookID, voucherID); err != nil {
			return err
		}
	}
	return nil
}

func validateControlBookFunds(ctx context.Context, _ pgx.Tx, q *dbsqlc.Queries, bookID, voucherID string) error {
	rows, err := q.ListAffectedAccountingFunds(ctx, dbsqlc.ListAffectedAccountingFundsParams{BookID: bookID, VoucherID: voucherID})
	if err != nil {
		return databaseError("list affected control book funds", err)
	}
	type affectedFund struct{ id, currency string }
	affected := make([]affectedFund, 0, len(rows))
	for _, row := range rows {
		affected = append(affected, affectedFund{id: row.FundAccountID, currency: row.Currency})
	}
	for _, fund := range affected {
		lockKey := "acc-fund:" + bookID + ":" + fund.id + ":" + fund.currency
		if err = q.LockAccountingInventory(ctx, lockKey); err != nil {
			return databaseError("lock control book fund", err)
		}
		minimum, err := q.GetMinimumAccountingFundBalance(ctx, dbsqlc.GetMinimumAccountingFundBalanceParams{
			BookID: bookID, Currency: fund.currency, FundAccountID: fund.id,
		})
		if err != nil {
			return databaseError("read control book fund balance", err)
		}
		if minimum < 0 {
			return domainErrorWithKey(ErrorConflict, "funds_insufficient", "insufficient control book funds", nil)
		}
	}
	return nil
}

func selectMappingResult(defaultResult string, definition MappingDefinition, header map[string]string) (string, string, error) {
	matched := make([]MappingRule, 0, 1)
	for _, rule := range definition.Rules {
		matches := true
		for _, condition := range rule.Conditions {
			if !conditionMatches(condition, header[condition.Field]) {
				matches = false
				break
			}
		}
		if matches {
			matched = append(matched, rule)
		}
	}
	if len(matched) > 1 {
		return "", "", domainError(ErrorConflict, "multiple accounting mapping rules matched", nil)
	}
	result := defaultResult
	templateID := definition.DefaultTemplateID
	if len(matched) == 1 {
		result, templateID = matched[0].Result, matched[0].TemplateID
	}
	if result == MappingResultPost && templateID == nil {
		return "", "", domainError(ErrorConflict, "POST result requires a posting template", nil)
	}
	if templateID == nil {
		return result, "", nil
	}
	return result, *templateID, nil
}

func conditionMatches(condition MappingCondition, actual string) bool {
	contains := func() bool {
		for _, value := range condition.Values {
			if actual == value {
				return true
			}
		}
		return false
	}
	switch condition.Operator {
	case "EQ", "IN":
		return contains()
	case "NE", "NOT_IN":
		return !contains()
	case "IS_EMPTY":
		return strings.TrimSpace(actual) == ""
	case "IS_NOT_EMPTY":
		return strings.TrimSpace(actual) != ""
	default:
		return false
	}
}

func findPostingTemplate(templates []PostingTemplate, id string) (PostingTemplate, bool) {
	for _, template := range templates {
		if template.ID == id {
			return template, true
		}
	}
	return PostingTemplate{}, false
}

func (s *Service) renderPostingTemplate(ctx context.Context, q *dbsqlc.Queries, bookID string, template PostingTemplate, snapshot postingSnapshot, documentID string) ([]automaticPostingLine, error) {
	items := []map[string]string{nil}
	if template.Collection != nil {
		items = snapshot.collections[*template.Collection]
	}
	result := make([]automaticPostingLine, 0, len(items)*len(template.Lines))
	for itemIndex, item := range items {
		for _, lineTemplate := range template.Lines {
			line, include, err := s.renderPostingLine(ctx, q, bookID, lineTemplate, snapshot.header, item, documentID, itemIndex)
			if err != nil {
				return nil, err
			}
			if include {
				result = append(result, line)
			}
		}
	}
	return result, nil
}

func mappingValue(header, item map[string]string, field string) string {
	if item != nil {
		if value, ok := item[field]; ok {
			return value
		}
	}
	return header[field]
}

func (s *Service) renderPostingLine(ctx context.Context, q *dbsqlc.Queries, bookID string, template PostingLineTemplate, header, item map[string]string, documentID string, itemIndex int) (automaticPostingLine, bool, error) {
	amount, err := fixeddecimal.ParsePositive(mappingValue(header, item, template.AmountField), 2, true)
	if err != nil {
		return automaticPostingLine{}, false, domainError(ErrorValidation, "invalid mapped accounting amount", err)
	}
	currency := strings.ToUpper(strings.TrimSpace(mappingValue(header, item, template.CurrencyField)))
	if !currencyPattern.MatchString(currency) {
		return automaticPostingLine{}, false, domainError(ErrorValidation, "invalid mapped accounting currency", nil)
	}
	subjectID := template.SubjectValue
	if template.SubjectSource == "FIELD" {
		subjectID = mappingValue(header, item, template.SubjectValue)
	}
	subject, err := loadSubject(ctx, q, bookID, subjectID)
	if err != nil || !subject.Enabled || !subject.Leaf {
		return automaticPostingLine{}, false, domainError(ErrorValidation, "mapped accounting subject is unavailable", err)
	}
	dimensions := make(map[string]string, len(template.Dimensions))
	for dimension, field := range template.Dimensions {
		dimensions[dimension] = mappingValue(header, item, field)
	}
	dimensions, _, err = normalizeOpeningDimensions(subject.RequiredDimensions, dimensions)
	if err != nil {
		return automaticPostingLine{}, false, domainError(ErrorValidation, "mapped accounting dimensions are incomplete", err)
	}
	dimensionsJSON, err := json.Marshal(dimensions)
	if err != nil {
		return automaticPostingLine{}, false, domainError(ErrorInternal, "encode mapped accounting dimensions", err)
	}
	var quantityMicros *int64
	if template.QuantityField != nil {
		quantity, parseErr := fixeddecimal.ParsePositive(mappingValue(header, item, *template.QuantityField), 6, false)
		if parseErr != nil || !subject.InventoryQuantity {
			return automaticPostingLine{}, false, domainError(ErrorValidation, "invalid mapped accounting quantity", parseErr)
		}
		quantityMicros = &quantity
	} else if subject.InventoryQuantity {
		return automaticPostingLine{}, false, domainError(ErrorValidation, "inventory accounting subject requires quantity", nil)
	}
	if amount == 0 && quantityMicros == nil {
		return automaticPostingLine{}, false, nil
	}
	sourceLineID := documentID
	if item != nil {
		sourceLineID = strings.TrimSpace(item["lineId"])
		if sourceLineID == "" {
			sourceLineID = documentID + ":" + strconv.Itoa(itemIndex)
		}
	}
	line := automaticPostingLine{subjectID: subject.ID, currency: currency, sourceLineID: sourceLineID, quantityMicros: quantityMicros, dimensionsJSON: dimensionsJSON}
	if quantityMicros != nil {
		line.productID, line.warehouseID = dimensions[DimensionProduct], dimensions[DimensionWarehouse]
		productField := template.Dimensions[DimensionProduct]
		productPrefix := strings.TrimSuffix(productField, ".objectId")
		if productPrefix == productField || productPrefix == "" {
			return automaticPostingLine{}, false, domainError(ErrorValidation, "inventory product snapshot is unavailable", nil)
		}
		line.productApprovalEntryID = strings.TrimSpace(mappingValue(header, item, productPrefix+".approvalEntryId"))
		line.productCode = strings.TrimSpace(mappingValue(header, item, productPrefix+".code"))
		line.productName = strings.TrimSpace(mappingValue(header, item, productPrefix+".name"))
		if line.productApprovalEntryID == "" || line.productCode == "" || line.productName == "" {
			return automaticPostingLine{}, false, domainError(ErrorValidation, "inventory product snapshot is unavailable", nil)
		}
		line.quantityDeltaMicros = *quantityMicros
		if template.Direction == BalanceDirectionCredit {
			line.quantityDeltaMicros = -line.quantityDeltaMicros
		}
		line.costCounterpartDimensionsJSON = []byte(`{}`)
		if template.CostCounterpartSubjectID != nil {
			counterpart := *template.CostCounterpartSubjectID
			line.costCounterpartSubjectID = &counterpart
			costDimensions := make(map[string]string, len(template.CostCounterpartDimensions))
			for dimension, field := range template.CostCounterpartDimensions {
				costDimensions[dimension] = mappingValue(header, item, field)
			}
			counterpartSubject, counterpartErr := loadSubject(ctx, q, bookID, counterpart)
			if counterpartErr != nil || !counterpartSubject.Enabled || !counterpartSubject.Leaf {
				return automaticPostingLine{}, false, domainError(ErrorValidation, "cost counterpart subject is unavailable", counterpartErr)
			}
			costDimensions, _, err = normalizeOpeningDimensions(counterpartSubject.RequiredDimensions, costDimensions)
			if err != nil {
				return automaticPostingLine{}, false, domainError(ErrorValidation, "cost counterpart dimensions are incomplete", err)
			}
			line.costCounterpartDimensionsJSON, err = json.Marshal(costDimensions)
			if err != nil {
				return automaticPostingLine{}, false, domainError(ErrorInternal, "encode cost counterpart dimensions", err)
			}
		}
		originDocumentID := strings.TrimSpace(mappingValue(header, item, "sourceDocumentId"))
		originLineID := strings.TrimSpace(mappingValue(header, item, "sourceLineId"))
		if originDocumentID != "" {
			line.originSourceDocumentID = &originDocumentID
		}
		if originLineID != "" {
			line.originSourceLineID = &originLineID
		}
	}
	if template.Direction == BalanceDirectionDebit {
		line.debitMinor = amount
	} else {
		line.creditMinor = amount
	}
	return line, true, nil
}

func validateAutomaticTrialBalance(lines []automaticPostingLine) error {
	type totals struct{ debit, credit int64 }
	byCurrency := map[string]totals{}
	nonzeroLines := 0
	for _, line := range lines {
		if line.debitMinor > 0 || line.creditMinor > 0 {
			nonzeroLines++
		}
		total := byCurrency[line.currency]
		if line.debitMinor > math.MaxInt64-total.debit || line.creditMinor > math.MaxInt64-total.credit {
			return domainError(ErrorValidation, "automatic accounting trial balance is out of range", nil)
		}
		total.debit += line.debitMinor
		total.credit += line.creditMinor
		byCurrency[line.currency] = total
	}
	if nonzeroLines != 0 && nonzeroLines < 2 {
		return domainError(ErrorConflict, "automatic accounting voucher requires at least two nonzero lines", nil)
	}
	if nonzeroLines == 0 && len(lines) == 0 {
		return domainError(ErrorConflict, "automatic accounting voucher has no facts", nil)
	}
	for _, total := range byCurrency {
		if total.debit != total.credit {
			return domainError(ErrorConflict, "automatic accounting voucher is not balanced by currency", nil)
		}
	}
	return nil
}

func newPostingSnapshot(document voudomain.ApprovalPayload, status approval.Status, revision int64) (postingSnapshot, error) {
	result := postingSnapshot{header: map[string]string{
		"documentId": document.DocumentID, "documentNo": document.DocumentNo, "entity": document.Entity,
		"status": string(status), "revision": strconv.FormatInt(revision, 10), "amount": document.Amount,
		"totalAmount": document.Amount, "parentEntity": document.ParentEntity, "parentDocumentId": document.ParentDocumentID,
	}, collections: map[string][]map[string]string{}}
	encoded, err := json.Marshal(document.Data)
	if err != nil {
		return postingSnapshot{}, fmt.Errorf("encode VOU accounting snapshot: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	var data map[string]any
	if err = decoder.Decode(&data); err != nil {
		return postingSnapshot{}, fmt.Errorf("decode VOU accounting snapshot: %w", err)
	}
	for key, value := range data {
		if collection, ok := value.([]any); ok {
			items := make([]map[string]string, 0, len(collection))
			for _, rawItem := range collection {
				item := map[string]string{}
				flattenSnapshotValue(item, "", rawItem)
				items = append(items, item)
			}
			result.collections[key] = items
			continue
		}
		flattenSnapshotValue(result.header, key, value)
	}
	if document.Entity == voudomain.EntityIntermediaryCalculation {
		calculation, _ := data["intermediaryCalculation"].(map[string]any)
		calculationResult, _ := calculation["result"].(map[string]any)
		if summaries, ok := calculationResult["summaries"].([]any); ok {
			items := make([]map[string]string, 0, len(summaries))
			for index, raw := range summaries {
				item := map[string]string{"lineId": document.DocumentID + ":summary:" + strconv.Itoa(index)}
				flattenSnapshotValue(item, "", raw)
				// Only the typed Sales Relationship fact can form the other
				// payable. Party identity is deliberately never exposed here.
				if (item["category"] == "EXTERNAL_PART_TIME" || item["category"] == "CHANNEL_PARTNER") &&
					item["payee.entity"] == "sales-partner" {
					items = append(items, item)
				}
			}
			result.collections["intermediarySalesPartnerPayables"] = items
		}
	}
	return result, nil
}

func flattenSnapshotValue(target map[string]string, prefix string, value any) {
	switch typed := value.(type) {
	case nil:
		target[prefix] = ""
	case string:
		target[prefix] = typed
	case json.Number:
		target[prefix] = typed.String()
	case bool:
		target[prefix] = strconv.FormatBool(typed)
	case map[string]any:
		for key, child := range typed {
			path := key
			if prefix != "" {
				path = prefix + "." + key
			}
			flattenSnapshotValue(target, path, child)
		}
	}
}

func (s *Service) HandleDocumentUnapproved(ctx context.Context, tx pgx.Tx, source approval.Event[voudomain.ApprovalPayload]) error {
	event, ok := unapprovedDelivery(source)
	if !ok {
		return txevent.Reject("invalid VOU unapproval snapshot", nil)
	}
	q := s.queries.WithTx(tx)
	if err := s.reverseGlobalRegisters(ctx, tx, event); err != nil {
		return postingDeliveryError(err)
	}
	entity, revision := event.Entity, event.Revision
	voucherIDs, err := q.DeleteAutomaticAccountingVoucher(ctx, dbsqlc.DeleteAutomaticAccountingVoucherParams{SourceEntity: &entity, SourceID: event.DocumentID, SourceRevision: &revision})
	if err != nil {
		return databaseError("delete automatic accounting vouchers", err)
	}
	for _, voucherID := range voucherIDs {
		if err = q.DeleteAccountingSubjectUsages(ctx, dbsqlc.DeleteAccountingSubjectUsagesParams{UsageType: "VOUCHER", UsageID: voucherID}); err != nil {
			return databaseError("release automatic voucher accounting subjects", err)
		}
	}
	return nil
}
