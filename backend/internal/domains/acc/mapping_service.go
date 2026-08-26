package acc

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/events/accapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/oklog/ulid/v2"
)

var supportedMappingEntitySet = func() map[string]struct{} {
	entities := []string{
		"sale-pricing", "sale-order", "sale-outbound", "sale-delivery", "sale-signoff", "sale-return",
		"purchase-order", "purchase-inbound", "purchase-return", "purchase-inquiry",
		"order-production", "self-production", "inventory-count",
		"sales-receipt", "purchase-refund", "other-receipt", "sales-refund", "purchase-payment", "other-payment",
		"employee-loan", "employee-repayment", "employee-loan-writeoff", "expense-reimbursement", "expense-payment", "other-income",
		"asset-acquisition", "asset-sale", "asset-liquidation",
		"bill-receipt", "bill-payment", "bill-issue", "bill-discount", "bill-maturity", "intermediary-calculation",
		"service-contract", "service-acceptance",
	}
	result := make(map[string]struct{}, len(entities))
	for _, entity := range entities {
		result[entity] = struct{}{}
	}
	return result
}()

var mappingCommonHeaderFields = []string{
	"amount", "businessDate", "currency", "documentId", "documentNo", "entity",
	"parentDocumentId", "parentEntity", "remark", "revision", "status", "totalAmount",
}

var mappingEntityHeaderFields = map[string][]string{
	"purchase-inquiry":       {"supplier.objectId"},
	"sale-order":             {"customer.objectId", "fulfillmentStatus", "salesperson.objectId", "specialApproval", "warehouse.objectId"},
	"purchase-order":         {"purchaser.objectId", "supplier.objectId", "warehouse.objectId"},
	"purchase-inbound":       {"dueDate", "supplier.objectId", "warehouse.objectId"},
	"sale-outbound":          {"customer.objectId", "warehouse.objectId"},
	"sale-delivery":          {"customer.objectId", "platform.objectId", "vehicle.objectId"},
	"sale-signoff":           {"customer.objectId", "dueDate", "warehouse.objectId"},
	"sale-return":            {"customer.objectId", "returnKind", "returnReason", "warehouse.objectId"},
	"purchase-return":        {"returnReason", "supplier.objectId", "warehouse.objectId"},
	"order-production":       {"finishedWarehouse.objectId", "materialWarehouse.objectId"},
	"self-production":        {"finishedWarehouse.objectId", "materialWarehouse.objectId"},
	"inventory-count":        {"warehouse.objectId"},
	"sales-receipt":          {"counterparty.objectId", "dueDate", "fundAccount.objectId", "handler.objectId"},
	"purchase-refund":        {"counterparty.objectId", "fundAccount.objectId", "handler.objectId"},
	"other-receipt":          {"counterparty.objectId", "fundAccount.objectId", "handler.objectId", "otherCategory"},
	"sales-refund":           {"counterparty.objectId", "fundAccount.objectId", "handler.objectId"},
	"purchase-payment":       {"counterparty.objectId", "fundAccount.objectId", "handler.objectId"},
	"other-payment":          {"counterparty.objectId", "fundAccount.objectId", "handler.objectId", "otherCategory"},
	"employee-loan":          {"counterparty.objectId", "fundAccount.objectId", "handler.objectId"},
	"employee-repayment":     {"counterparty.objectId", "fundAccount.objectId", "handler.objectId"},
	"employee-loan-writeoff": {"employee.objectId"},
	"expense-reimbursement":  {"employee.objectId"},
	"expense-payment":        {"employee.objectId", "fundAccount.objectId"},
	"other-income":           {"counterparty.objectId", "fundAccount.objectId", "handler.objectId", "sourceName"},
	"asset-acquisition":      {"supplier.objectId"},
	"asset-sale":             {"counterparty.objectId"},
	"bill-receipt":           {"counterparty.objectId", "handler.objectId", "interestMode", "interestParty.objectId", "maturityType", "withRecourse"},
	"bill-payment":           {"interestMode", "interestParty.objectId", "maturityType", "supplier.objectId", "withRecourse"},
	"bill-issue":             {"interestMode", "interestParty.objectId", "maturityType", "supplier.objectId", "withRecourse"},
	"bill-discount":          {"counterparty.objectId", "handler.objectId", "interestMode", "interestParty.objectId", "maturityType", "withRecourse"},
	"bill-maturity":          {"interestMode", "interestParty.objectId", "maturityType", "withRecourse"},
	"service-acceptance":     {"counterparty.objectId", "serviceAcceptance.contractDocumentId", "serviceAcceptance.settlementDirection"},
}

var mappingCollectionFields = map[string][]string{
	"intermediarySalesPartnerPayables": {"lineId", "payee.objectId", "category", "amount"},
	"assetAcquisitionLines":            {"lineId", "assetName", "originalValue", "category.objectId", "department.objectId", "custodian.objectId"},
	"assetLiquidationLines":            {"lineId", "assetId", "salvageIncome", "disposalExpense"},
	"assetSaleLines":                   {"lineId", "assetId", "saleAmount"},
	"billCashLines":                    {"lineId", "billLineId", "fundAccount.objectId", "direction", "amount"},
	"billLines":                        {"lineId", "billId", "direction", "faceAmount", "interestAmount"},
	"expenseLines":                     {"lineId", "category", "description", "amount"},
	"inventoryCountLines":              {"lineId", "product.objectId", "baseQuantity", "bookBaseQuantity", "differenceBaseQuantity"},
	"lines":                            {"lineId", "product.objectId", "baseQuantity", "orderedBaseQuantity", "signedBaseQuantity", "rejectedBaseQuantity", "unitPrice", "lineAmount"},
	"priceLines":                       {"lineId", "product.objectId", "unitPrice"},
	"productLines":                     {"lineId", "product.objectId", "baseQuantity", "outboundBaseQuantity", "signedBaseQuantity", "rejectedBaseQuantity", "unitPrice", "lineAmount"},
	"productionLines":                  {"lineId", "product.objectId", "baseQuantity"},
	"signoffLines":                     {"lineId", "product.objectId", "signedBaseQuantity", "rejectedBaseQuantity", "unitPrice", "lineAmount"},
}

var mappingEntityCollections = map[string][]string{
	"sale-pricing": {"priceLines"}, "purchase-inquiry": {"priceLines"},
	"sale-order": {"productLines"}, "purchase-order": {"productLines"}, "purchase-inbound": {"productLines"},
	"sale-outbound": {"productLines"}, "sale-delivery": {"productLines"},
	"sale-signoff": {"signoffLines"}, "sale-return": {"lines"},
	"purchase-return":  {"lines"},
	"order-production": {"productionLines"}, "self-production": {"productionLines"},
	"inventory-count":       {"inventoryCountLines"},
	"expense-reimbursement": {"expenseLines"}, "employee-loan-writeoff": {"expenseLines"},
	"asset-acquisition": {"assetAcquisitionLines"}, "asset-sale": {"assetSaleLines"}, "asset-liquidation": {"assetLiquidationLines"},
	"bill-receipt": {"billLines", "billCashLines"}, "bill-payment": {"billLines", "billCashLines"},
	"bill-issue": {"billLines", "billCashLines"}, "bill-discount": {"billLines", "billCashLines"},
	"bill-maturity":            {"billLines", "billCashLines"},
	"intermediary-calculation": {"intermediarySalesPartnerPayables"},
}

func SupportedMappingEntities() []string {
	result := make([]string, 0, len(supportedMappingEntitySet))
	for entity := range supportedMappingEntitySet {
		result = append(result, entity)
	}
	sort.Strings(result)
	return result
}

func MappingFieldCatalog(entity string) (MappingCatalog, error) {
	entity = strings.TrimSpace(entity)
	if _, ok := supportedMappingEntitySet[entity]; !ok {
		return MappingCatalog{}, domainError(ErrorValidation, "unsupported VOU entity", nil)
	}
	entityCollections := mappingEntityCollections[entity]
	collections := make(map[string][]string, len(entityCollections))
	for _, collection := range entityCollections {
		collections[collection] = append([]string(nil), mappingCollectionFields[collection]...)
	}
	headerFields := append([]string(nil), mappingCommonHeaderFields...)
	headerFields = append(headerFields, mappingEntityHeaderFields[entity]...)
	sort.Strings(headerFields)
	return MappingCatalog{VouEntity: entity, HeaderFields: headerFields, Collections: collections}, nil
}

func mappingFieldExists(catalog MappingCatalog, field string, collection *string) bool {
	for _, candidate := range catalog.HeaderFields {
		if candidate == field {
			return true
		}
	}
	if collection != nil {
		for _, candidate := range catalog.Collections[*collection] {
			if candidate == field {
				return true
			}
		}
	}
	return false
}

func validateMapping(defaultResult string, definition MappingDefinition, catalog MappingCatalog) error {
	if defaultResult != MappingResultPost && defaultResult != MappingResultUnpost {
		return domainError(ErrorValidation, "invalid mapping default result", nil)
	}
	requiresAssetConfiguration := defaultResult == MappingResultPost
	for _, rule := range definition.Rules {
		requiresAssetConfiguration = requiresAssetConfiguration || rule.Result == MappingResultPost
	}
	if catalog.VouEntity == "asset-acquisition" && requiresAssetConfiguration && definition.AssetConfiguration == nil {
		return domainError(ErrorValidation, "asset acquisition mapping requires asset accounting configuration", nil)
	}
	if definition.AssetConfiguration != nil {
		assetCollection := "assetAcquisitionLines"
		for _, dimensions := range []map[string]string{definition.AssetConfiguration.AssetDimensions, definition.AssetConfiguration.AccumulatedDepreciationDimensions, definition.AssetConfiguration.DepreciationExpenseDimensions} {
			for _, field := range dimensions {
				if !mappingFieldExists(catalog, field, &assetCollection) {
					return domainError(ErrorValidation, "unknown asset accounting dimension field", nil)
				}
			}
		}
	}
	templates := make(map[string]PostingTemplate, len(definition.Templates))
	for _, template := range definition.Templates {
		template.ID = strings.TrimSpace(template.ID)
		if template.ID == "" || len(template.Lines) < 2 {
			return domainError(ErrorValidation, "posting template requires an id and at least two lines", nil)
		}
		if _, exists := templates[template.ID]; exists {
			return domainError(ErrorValidation, "duplicate posting template id", nil)
		}
		if template.Collection != nil {
			if _, ok := catalog.Collections[*template.Collection]; !ok {
				return domainError(ErrorValidation, "unknown posting template collection", nil)
			}
		}
		for _, line := range template.Lines {
			if line.SubjectSource != "FIXED" && line.SubjectSource != "FIELD" {
				return domainError(ErrorValidation, "invalid posting subject source", nil)
			}
			if strings.TrimSpace(line.SubjectValue) == "" || (line.SubjectSource == "FIELD" && !mappingFieldExists(catalog, line.SubjectValue, template.Collection)) {
				return domainError(ErrorValidation, "invalid posting subject value", nil)
			}
			if line.Direction != BalanceDirectionDebit && line.Direction != BalanceDirectionCredit {
				return domainError(ErrorValidation, "invalid posting direction", nil)
			}
			if !mappingFieldExists(catalog, line.AmountField, template.Collection) || !mappingFieldExists(catalog, line.CurrencyField, template.Collection) {
				return domainError(ErrorValidation, "unknown posting amount or currency field", nil)
			}
			for _, field := range line.Dimensions {
				if !mappingFieldExists(catalog, field, template.Collection) {
					return domainError(ErrorValidation, "unknown posting dimension field", nil)
				}
			}
			if line.QuantityField != nil && !mappingFieldExists(catalog, *line.QuantityField, template.Collection) {
				return domainError(ErrorValidation, "unknown posting quantity field", nil)
			}
			if line.CostCounterpartSubjectID == nil && len(line.CostCounterpartDimensions) != 0 {
				return domainError(ErrorValidation, "cost dimensions require a cost counterpart subject", nil)
			}
			for _, field := range line.CostCounterpartDimensions {
				if !mappingFieldExists(catalog, field, template.Collection) {
					return domainError(ErrorValidation, "unknown cost counterpart dimension field", nil)
				}
			}
		}
		templates[template.ID] = template
	}
	validateResult := func(result string, templateID *string) error {
		if result != MappingResultPost && result != MappingResultUnpost {
			return domainError(ErrorValidation, "invalid mapping result", nil)
		}
		if result == MappingResultPost {
			if templateID == nil {
				return domainError(ErrorValidation, "POST result requires a posting template", nil)
			}
			if _, ok := templates[*templateID]; !ok {
				return domainError(ErrorValidation, "posting template not found", nil)
			}
		} else if templateID != nil {
			return domainError(ErrorValidation, "UN_POST result cannot have a posting template", nil)
		}
		return nil
	}
	if err := validateResult(defaultResult, definition.DefaultTemplateID); err != nil {
		return err
	}
	allowedOperators := map[string]struct{}{"EQ": {}, "NE": {}, "IN": {}, "NOT_IN": {}, "IS_EMPTY": {}, "IS_NOT_EMPTY": {}}
	for index, rule := range definition.Rules {
		if len(rule.Conditions) == 0 {
			return domainError(ErrorValidation, "mapping rule requires conditions", nil)
		}
		if err := validateResult(rule.Result, rule.TemplateID); err != nil {
			return err
		}
		for _, condition := range rule.Conditions {
			if !mappingFieldExists(catalog, condition.Field, nil) {
				return domainError(ErrorValidation, "unknown mapping condition field", nil)
			}
			if _, ok := allowedOperators[condition.Operator]; !ok {
				return domainError(ErrorValidation, "invalid mapping condition operator", nil)
			}
			emptyOperator := condition.Operator == "IS_EMPTY" || condition.Operator == "IS_NOT_EMPTY"
			if (emptyOperator && len(condition.Values) != 0) || (!emptyOperator && len(condition.Values) == 0) {
				return domainError(ErrorValidation, "invalid mapping condition values", nil)
			}
		}
		for previous := 0; previous < index; previous++ {
			if rulesMayOverlap(definition.Rules[previous], rule) {
				return domainError(ErrorValidation, "mapping rules may match simultaneously", nil)
			}
		}
	}
	return nil
}

func rulesMayOverlap(left, right MappingRule) bool {
	leftEQ := map[string]string{}
	rightEQ := map[string]string{}
	for _, condition := range left.Conditions {
		if condition.Operator == "EQ" && len(condition.Values) == 1 {
			leftEQ[condition.Field] = condition.Values[0]
		}
	}
	for _, condition := range right.Conditions {
		if condition.Operator == "EQ" && len(condition.Values) == 1 {
			rightEQ[condition.Field] = condition.Values[0]
		}
	}
	for field, value := range leftEQ {
		if other, ok := rightEQ[field]; ok && value != other {
			return false
		}
	}
	return true
}

func encodeMappingDefinition(definition MappingDefinition) ([]byte, error) {
	if definition.Rules == nil {
		definition.Rules = []MappingRule{}
	}
	if definition.Templates == nil {
		definition.Templates = []PostingTemplate{}
	}
	encoded, err := json.Marshal(definition)
	if err != nil {
		return nil, domainError(ErrorValidation, "invalid mapping definition", err)
	}
	return encoded, nil
}

func validateMappingSubjects(ctx context.Context, q *dbsqlc.Queries, bookID string, definition MappingDefinition) error {
	for _, template := range definition.Templates {
		for _, line := range template.Lines {
			subjectIDs := []string{}
			if line.SubjectSource == "FIXED" {
				subjectIDs = append(subjectIDs, line.SubjectValue)
			}
			if line.CostCounterpartSubjectID != nil {
				subjectIDs = append(subjectIDs, *line.CostCounterpartSubjectID)
			}
			for _, subjectID := range subjectIDs {
				subject, err := loadSubject(ctx, q, bookID, subjectID)
				if err != nil {
					if IsKind(err, ErrorConflict) {
						return domainError(ErrorValidation, "mapping accounting subject not found", err)
					}
					return err
				}
				if !subject.Enabled || !subject.Leaf {
					return domainError(ErrorValidation, "mapping requires enabled leaf accounting subjects", nil)
				}
			}
			if line.CostCounterpartSubjectID != nil {
				counterpart, err := loadSubject(ctx, q, bookID, *line.CostCounterpartSubjectID)
				if err != nil {
					return err
				}
				if len(counterpart.RequiredDimensions) != len(line.CostCounterpartDimensions) {
					return domainError(ErrorValidation, "cost counterpart dimensions must match the subject", nil)
				}
				for _, dimension := range counterpart.RequiredDimensions {
					if _, ok := line.CostCounterpartDimensions[dimension]; !ok {
						return domainError(ErrorValidation, "cost counterpart dimensions must match the subject", nil)
					}
				}
			}
		}
	}
	if config := definition.AssetConfiguration; config != nil {
		for _, configured := range []struct {
			id         string
			dimensions map[string]string
		}{{config.AssetSubjectID, config.AssetDimensions}, {config.AccumulatedDepreciationSubjectID, config.AccumulatedDepreciationDimensions}, {config.DepreciationExpenseSubjectID, config.DepreciationExpenseDimensions}} {
			subject, err := loadSubject(ctx, q, bookID, configured.id)
			if err != nil || !subject.Enabled || !subject.Leaf {
				return domainError(ErrorValidation, "asset accounting subject is unavailable", err)
			}
			if len(subject.RequiredDimensions) != len(configured.dimensions) {
				return domainError(ErrorValidation, "asset accounting dimensions must match the subject", nil)
			}
			for _, dimension := range subject.RequiredDimensions {
				if _, ok := configured.dimensions[dimension]; !ok {
					return domainError(ErrorValidation, "asset accounting dimensions must match the subject", nil)
				}
			}
		}
	}
	return nil
}

func registerMappingSubjectUsages(ctx context.Context, q *dbsqlc.Queries, mappingID string, definition MappingDefinition) error {
	for _, template := range definition.Templates {
		for _, line := range template.Lines {
			subjectIDs := []string{}
			if line.SubjectSource == "FIXED" {
				subjectIDs = append(subjectIDs, line.SubjectValue)
			}
			if line.CostCounterpartSubjectID != nil {
				subjectIDs = append(subjectIDs, *line.CostCounterpartSubjectID)
			}
			for _, subjectID := range subjectIDs {
				if err := q.RegisterAccountingSubjectUsage(ctx, dbsqlc.RegisterAccountingSubjectUsageParams{SubjectID: subjectID, UsageType: "MAPPING", UsageID: mappingID}); err != nil {
					return databaseError("register mapping accounting subject", err)
				}
			}
		}
	}
	if config := definition.AssetConfiguration; config != nil {
		for _, subjectID := range []string{config.AssetSubjectID, config.AccumulatedDepreciationSubjectID, config.DepreciationExpenseSubjectID} {
			if err := q.RegisterAccountingSubjectUsage(ctx, dbsqlc.RegisterAccountingSubjectUsageParams{SubjectID: subjectID, UsageType: "MAPPING", UsageID: mappingID}); err != nil {
				return databaseError("register asset accounting subject", err)
			}
		}
	}
	return nil
}

func mappingView(bookID, entity, defaultResult string, definitionJSON []byte, entry approval.Entry) (MappingView, error) {
	definition := MappingDefinition{Rules: []MappingRule{}, Templates: []PostingTemplate{}}
	if err := json.Unmarshal(definitionJSON, &definition); err != nil {
		return MappingView{}, domainError(ErrorInternal, "invalid stored accounting mapping", err)
	}
	for templateIndex := range definition.Templates {
		for lineIndex := range definition.Templates[templateIndex].Lines {
			line := &definition.Templates[templateIndex].Lines[lineIndex]
			if line.Dimensions == nil {
				line.Dimensions = map[string]string{}
			}
			if line.CostCounterpartDimensions == nil {
				line.CostCounterpartDimensions = map[string]string{}
			}
		}
	}
	return MappingView{BookID: bookID, VouEntity: entity, Approval: approval.VersionMetaFromEntry(entry), DefaultResult: defaultResult, Definition: definition}, nil
}

func mappingApprovalEntry(id, subjectID string, versionNo *int32, status string, revision int64, createdBy string, createdAt pgtype.Timestamptz, updatedBy string, updatedAt pgtype.Timestamptz, submittedBy *string, submittedAt pgtype.Timestamptz, approvedBy *string, approvedAt pgtype.Timestamptz) approval.Entry {
	entry := approval.Entry{EntryRef: approval.EntryRef{ID: id, Domain: "acc", Entity: "mapping", SubjectID: subjectID, VersionNo: versionNo}, Status: approval.Status(status), Revision: revision, CreatedBy: createdBy, CreatedAt: createdAt.Time, UpdatedBy: updatedBy, UpdatedAt: updatedAt.Time, SubmittedBy: submittedBy, ApprovedBy: approvedBy}
	if submittedAt.Valid {
		entry.SubmittedAt = &submittedAt.Time
	}
	if approvedAt.Valid {
		entry.ApprovedAt = &approvedAt.Time
	}
	return entry
}

func mappingPayload(bookID, mappingID, entity, entryID string) accapproval.Payload {
	return accapproval.Payload{BookID: bookID, MappingID: mappingID, VouEntity: entity, ApprovalEntryID: entryID}
}

func (s *Service) QueryMappings(ctx context.Context, input QueryMappingsInput, actor approval.Actor) (MappingPage, error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return MappingPage{}, domainError(ErrorValidation, "invalid accounting mapping query", nil)
	}
	if err := s.mappingApproval.Authorize(ctx, actor, "query"); err != nil {
		return MappingPage{}, mapApprovalError(err)
	}
	if err := s.requireApprovalAccess(ctx, s.queries, input.BookID, actor, false); err != nil {
		return MappingPage{}, err
	}
	entity := strings.TrimSpace(input.VouEntity)
	if entity != "" {
		if _, err := MappingFieldCatalog(entity); err != nil {
			return MappingPage{}, err
		}
	}
	rows, err := s.queries.ListAccountingMappings(ctx, dbsqlc.ListAccountingMappingsParams{BookID: input.BookID, VouEntity: entity, PageOffset: int32((input.Page - 1) * input.PageSize), PageSize: int32(input.PageSize)})
	if err != nil {
		return MappingPage{}, databaseError("query accounting mappings", err)
	}
	page := MappingPage{Items: []MappingView{}, Page: input.Page, PageSize: input.PageSize}
	for _, row := range rows {
		entry := mappingApprovalEntry(row.ApprovalEntryID, row.MappingID, row.VersionNo, row.Status, row.Revision, row.CreatedBy, row.CreatedAt, row.UpdatedBy, row.UpdatedAt, row.SubmittedBy, row.SubmittedAt, row.ApprovedBy, row.ApprovedAt)
		view, err := mappingView(row.BookID, row.VouEntity, row.DefaultResult, row.Definition, entry)
		if err != nil {
			return MappingPage{}, err
		}
		page.Items = append(page.Items, view)
		page.Total = row.Total
	}
	return page, nil
}

func (s *Service) GetMapping(ctx context.Context, bookID, entity, entryID string, actor approval.Actor) (MappingView, error) {
	if err := s.mappingApproval.Authorize(ctx, actor, "get"); err != nil {
		return MappingView{}, mapApprovalError(err)
	}
	if err := s.requireApprovalAccess(ctx, s.queries, bookID, actor, false); err != nil {
		return MappingView{}, err
	}
	var row dbsqlc.GetAccountingMappingVersionRow
	var err error
	if entryID == "" {
		preferred, preferredErr := s.queries.GetPreferredAccountingMappingVersion(ctx, dbsqlc.GetPreferredAccountingMappingVersionParams{BookID: bookID, VouEntity: entity})
		err = preferredErr
		row = dbsqlc.GetAccountingMappingVersionRow(preferred)
	} else {
		row, err = s.queries.GetAccountingMappingVersion(ctx, dbsqlc.GetAccountingMappingVersionParams{BookID: bookID, VouEntity: entity, ApprovalEntryID: entryID})
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return MappingView{}, domainError(ErrorConflict, "accounting mapping not found", err)
	}
	if err != nil {
		return MappingView{}, databaseError("get accounting mapping", err)
	}
	entry, err := readACCApprovalEntry(ctx, s.pool, "mapping", row.MappingID, row.ApprovalEntryID)
	if err != nil {
		return MappingView{}, databaseError("get accounting mapping approval", err)
	}
	return mappingView(row.BookID, row.VouEntity, row.DefaultResult, row.Definition, entry)
}

func (s *Service) CreateMapping(ctx context.Context, input CreateMappingInput, actor approval.Actor) (MappingView, error) {
	catalog, err := MappingFieldCatalog(input.VouEntity)
	if err != nil {
		return MappingView{}, err
	}
	if err = validateMapping(input.DefaultResult, input.Definition, catalog); err != nil {
		return MappingView{}, err
	}
	encoded, err := encodeMappingDefinition(input.Definition)
	if err != nil {
		return MappingView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MappingView{}, databaseError("begin accounting mapping creation", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.requireApprovalAccess(ctx, qtx, input.BookID, actor, true); err != nil {
		return MappingView{}, err
	}
	if err = validateMappingSubjects(ctx, qtx, input.BookID, input.Definition); err != nil {
		return MappingView{}, err
	}
	mappingID := ulid.Make().String()
	if err = qtx.CreateAccountingMappingSubject(ctx, dbsqlc.CreateAccountingMappingSubjectParams{ID: mappingID, BookID: input.BookID, VouEntity: input.VouEntity, ActorID: actor.ID()}); err != nil {
		return MappingView{}, databaseError("accounting mapping cannot be created", err)
	}
	entry, err := s.mappingApproval.CreateFirstVersion(ctx, tx, mappingID, actor, mappingPayload(input.BookID, mappingID, input.VouEntity, ""))
	if err != nil {
		return MappingView{}, mapApprovalError(err)
	}
	if err = qtx.CreateAccountingMappingVersion(ctx, dbsqlc.CreateAccountingMappingVersionParams{ApprovalEntryID: entry.ID, MappingID: mappingID, DefaultResult: input.DefaultResult, Definition: encoded, ActorID: actor.ID()}); err != nil {
		return MappingView{}, databaseError("accounting mapping version cannot be created", err)
	}
	result, err := mappingView(input.BookID, input.VouEntity, input.DefaultResult, encoded, entry)
	if err != nil {
		return MappingView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MappingView{}, databaseError("commit accounting mapping creation", err)
	}
	return result, nil
}

func (s *Service) SaveMapping(ctx context.Context, input SaveMappingInput, actor approval.Actor) (MappingView, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MappingView{}, databaseError("begin accounting mapping save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.requireApprovalAccess(ctx, qtx, input.BookID, actor, true); err != nil {
		return MappingView{}, err
	}
	row, err := qtx.GetAccountingMappingVersion(ctx, dbsqlc.GetAccountingMappingVersionParams{BookID: input.BookID, VouEntity: input.VouEntity, ApprovalEntryID: input.ApprovalEntryID})
	if errors.Is(err, pgx.ErrNoRows) {
		return MappingView{}, domainError(ErrorConflict, "accounting mapping not found", err)
	}
	if err != nil {
		return MappingView{}, databaseError("get accounting mapping state", err)
	}
	prepared, err := s.mappingApproval.Prepare(ctx, tx, approval.ActionSaved, input.ApprovalEntryID, input.Revision, actor, "")
	if err != nil {
		return MappingView{}, mapApprovalError(err)
	}
	if prepared.Entry().SubjectID != row.MappingID {
		return MappingView{}, domainError(ErrorConflict, "approval entry does not belong to accounting mapping", nil)
	}
	catalog, err := MappingFieldCatalog(row.VouEntity)
	if err != nil {
		return MappingView{}, err
	}
	if err = validateMapping(input.DefaultResult, input.Definition, catalog); err != nil {
		return MappingView{}, err
	}
	if err = validateMappingSubjects(ctx, qtx, input.BookID, input.Definition); err != nil {
		return MappingView{}, err
	}
	encoded, err := encodeMappingDefinition(input.Definition)
	if err != nil {
		return MappingView{}, err
	}
	if err = qtx.UpdateAccountingMappingVersion(ctx, dbsqlc.UpdateAccountingMappingVersionParams{DefaultResult: input.DefaultResult, Definition: encoded, ActorID: actor.ID(), ApprovalEntryID: input.ApprovalEntryID}); err != nil {
		return MappingView{}, databaseError("accounting mapping cannot be saved", err)
	}
	entry, err := s.mappingApproval.Commit(ctx, tx, prepared, mappingPayload(input.BookID, row.MappingID, row.VouEntity, input.ApprovalEntryID))
	if err != nil {
		return MappingView{}, mapApprovalError(err)
	}
	result, err := mappingView(input.BookID, row.VouEntity, input.DefaultResult, encoded, entry)
	if err != nil {
		return MappingView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MappingView{}, databaseError("commit accounting mapping save", err)
	}
	return result, nil
}

func (s *Service) CreateNextMappingVersion(ctx context.Context, bookID, entity string, actor approval.Actor) (MappingView, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MappingView{}, databaseError("begin accounting mapping version", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.requireApprovalAccess(ctx, qtx, bookID, actor, true); err != nil {
		return MappingView{}, err
	}
	current, err := qtx.GetCurrentApprovedAccountingMapping(ctx, dbsqlc.GetCurrentApprovedAccountingMappingParams{BookID: bookID, VouEntity: entity})
	if err != nil {
		return MappingView{}, databaseError("get latest approved accounting mapping", err)
	}
	entry, err := s.mappingApproval.CreateNextVersion(ctx, tx, current.MappingID, actor, mappingPayload(bookID, current.MappingID, entity, ""))
	if err != nil {
		return MappingView{}, mapApprovalError(err)
	}
	if err = qtx.CreateAccountingMappingVersion(ctx, dbsqlc.CreateAccountingMappingVersionParams{ApprovalEntryID: entry.ID, MappingID: current.MappingID, DefaultResult: current.DefaultResult, Definition: current.Definition, ActorID: actor.ID()}); err != nil {
		return MappingView{}, databaseError("create accounting mapping candidate", err)
	}
	result, err := mappingView(bookID, entity, current.DefaultResult, current.Definition, entry)
	if err != nil {
		return MappingView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MappingView{}, databaseError("commit accounting mapping version", err)
	}
	return result, nil
}

func (s *Service) MappingVersions(ctx context.Context, input QueryMappingsInput, actor approval.Actor) (MappingPage, error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return MappingPage{}, domainError(ErrorValidation, "invalid accounting mapping versions", nil)
	}
	if err := s.mappingApproval.Authorize(ctx, actor, "versions"); err != nil {
		return MappingPage{}, mapApprovalError(err)
	}
	if err := s.requireApprovalAccess(ctx, s.queries, input.BookID, actor, false); err != nil {
		return MappingPage{}, err
	}
	rows, err := s.queries.ListAccountingMappingVersions(ctx, dbsqlc.ListAccountingMappingVersionsParams{BookID: input.BookID, VouEntity: input.VouEntity, PageOffset: int32((input.Page - 1) * input.PageSize), PageSize: int32(input.PageSize)})
	if err != nil {
		return MappingPage{}, databaseError("list accounting mapping versions", err)
	}
	page := MappingPage{Items: []MappingView{}, Page: input.Page, PageSize: input.PageSize}
	for _, row := range rows {
		entry := mappingApprovalEntry(row.ApprovalEntryID, row.MappingID, row.VersionNo, row.Status, row.Revision, row.CreatedBy, row.CreatedAt, row.UpdatedBy, row.UpdatedAt, row.SubmittedBy, row.SubmittedAt, row.ApprovedBy, row.ApprovedAt)
		view, viewErr := mappingView(row.BookID, row.VouEntity, row.DefaultResult, row.Definition, entry)
		if viewErr != nil {
			return MappingPage{}, viewErr
		}
		page.Items = append(page.Items, view)
		page.Total = row.Total
	}
	return page, nil
}

func (s *Service) transitionMapping(ctx context.Context, input MappingVersionInput, reason string, actor approval.Actor, action approval.Action) (MappingView, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MappingView{}, databaseError("begin accounting mapping state change", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.requireApprovalAccess(ctx, qtx, input.BookID, actor, true); err != nil {
		return MappingView{}, err
	}
	row, err := qtx.GetAccountingMappingVersion(ctx, dbsqlc.GetAccountingMappingVersionParams{BookID: input.BookID, VouEntity: input.VouEntity, ApprovalEntryID: input.ApprovalEntryID})
	if errors.Is(err, pgx.ErrNoRows) {
		return MappingView{}, domainError(ErrorConflict, "accounting mapping not found", err)
	}
	if err != nil {
		return MappingView{}, databaseError("get accounting mapping state", err)
	}
	prepared, err := s.mappingApproval.Prepare(ctx, tx, action, input.ApprovalEntryID, input.Revision, actor, reason)
	if err != nil {
		return MappingView{}, mapApprovalError(err)
	}
	if prepared.Entry().SubjectID != row.MappingID {
		return MappingView{}, domainError(ErrorConflict, "approval entry does not belong to accounting mapping", nil)
	}
	if action == approval.ActionApproved {
		catalog, validationErr := MappingFieldCatalog(row.VouEntity)
		if validationErr != nil {
			return MappingView{}, validationErr
		}
		definition := MappingDefinition{}
		if jsonErr := json.Unmarshal(row.Definition, &definition); jsonErr != nil {
			return MappingView{}, domainError(ErrorInternal, "invalid stored accounting mapping", jsonErr)
		}
		if validationErr = validateMapping(row.DefaultResult, definition, catalog); validationErr != nil {
			return MappingView{}, validationErr
		}
		if validationErr = validateMappingSubjects(ctx, qtx, input.BookID, definition); validationErr != nil {
			return MappingView{}, validationErr
		}
		if validationErr = registerMappingSubjectUsages(ctx, qtx, input.ApprovalEntryID, definition); validationErr != nil {
			return MappingView{}, validationErr
		}
	} else if action == approval.ActionUnapproved {
		referenced, referenceErr := qtx.AccountingMappingVersionReferenced(ctx, &input.ApprovalEntryID)
		if referenceErr != nil {
			return MappingView{}, databaseError("check accounting mapping references", referenceErr)
		}
		if referenced {
			return MappingView{}, domainError(ErrorConflict, "referenced accounting mapping cannot be unapproved", nil)
		}
		if err = qtx.DeleteAccountingSubjectUsages(ctx, dbsqlc.DeleteAccountingSubjectUsagesParams{UsageType: "MAPPING", UsageID: input.ApprovalEntryID}); err != nil {
			return MappingView{}, databaseError("release mapping accounting subjects", err)
		}
	}
	entry, err := s.mappingApproval.Commit(ctx, tx, prepared, mappingPayload(input.BookID, row.MappingID, row.VouEntity, input.ApprovalEntryID))
	if err != nil {
		return MappingView{}, mapApprovalError(err)
	}
	result, err := mappingView(row.BookID, row.VouEntity, row.DefaultResult, row.Definition, entry)
	if err != nil {
		return MappingView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MappingView{}, databaseError("commit accounting mapping state change", err)
	}
	return result, nil
}

func (s *Service) SubmitMapping(ctx context.Context, input MappingVersionInput, actor approval.Actor) (MappingView, error) {
	return s.transitionMapping(ctx, input, "", actor, approval.ActionSubmitted)
}
func (s *Service) UnsubmitMapping(ctx context.Context, input MappingVersionInput, actor approval.Actor) (MappingView, error) {
	return s.transitionMapping(ctx, input, "", actor, approval.ActionUnsubmitted)
}
func (s *Service) ApproveMapping(ctx context.Context, input MappingVersionInput, actor approval.Actor) (MappingView, error) {
	return s.transitionMapping(ctx, input, "", actor, approval.ActionApproved)
}
func (s *Service) RejectMapping(ctx context.Context, input MappingReasonInput, actor approval.Actor) (MappingView, error) {
	return s.transitionMapping(ctx, input.MappingVersionInput, input.Reason, actor, approval.ActionRejected)
}
func (s *Service) UnapproveMapping(ctx context.Context, input MappingReasonInput, actor approval.Actor) (MappingView, error) {
	return s.transitionMapping(ctx, input.MappingVersionInput, input.Reason, actor, approval.ActionUnapproved)
}

func (s *Service) DeleteMappingVersion(ctx context.Context, input MappingVersionInput, actor approval.Actor) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return databaseError("begin accounting mapping delete", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.requireApprovalAccess(ctx, qtx, input.BookID, actor, true); err != nil {
		return err
	}
	row, err := qtx.GetAccountingMappingVersion(ctx, dbsqlc.GetAccountingMappingVersionParams{BookID: input.BookID, VouEntity: input.VouEntity, ApprovalEntryID: input.ApprovalEntryID})
	if err != nil {
		return databaseError("get accounting mapping version", err)
	}
	entry, err := s.mappingApproval.Lock(ctx, tx, input.ApprovalEntryID, input.Revision, actor, approval.ActionDeleted)
	if err != nil {
		return mapApprovalError(err)
	}
	if entry.SubjectID != row.MappingID || entry.Status != approval.StatusDraft {
		return domainError(ErrorConflict, "only the mapping draft version can be deleted", nil)
	}
	if err = qtx.DeleteAccountingMappingVersion(ctx, input.ApprovalEntryID); err != nil {
		return databaseError("delete accounting mapping payload", err)
	}
	if err = s.mappingApproval.DeleteDraftVersion(ctx, tx, input.ApprovalEntryID, input.Revision, actor, mappingPayload(input.BookID, row.MappingID, row.VouEntity, input.ApprovalEntryID)); err != nil {
		return mapApprovalError(err)
	}
	if err = qtx.DeleteAccountingMappingSubjectIfEmpty(ctx, row.MappingID); err != nil {
		return databaseError("delete empty accounting mapping", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return databaseError("commit accounting mapping delete", err)
	}
	return nil
}
