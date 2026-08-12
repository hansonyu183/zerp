package acc

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
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
	}
	result := make(map[string]struct{}, len(entities))
	for _, entity := range entities {
		result[entity] = struct{}{}
	}
	return result
}()

var mappingHeaderFields = []string{
	"amount", "businessDate", "containerDifferenceReason", "currency", "differenceReason",
	"documentId", "documentNo", "dueDate", "entity", "fulfillmentStatus", "interestMode", "maturityType",
	"otherCategory", "parentDocumentId", "parentEntity", "remark", "returnKind", "returnReason", "revision",
	"settlementMode", "sourceName", "specialApproval", "status", "totalAmount", "withRecourse",
	"counterparty.objectId", "customer.objectId", "employee.objectId", "finishedWarehouse.objectId",
	"fundAccount.objectId", "handler.objectId", "interestParty.objectId", "materialWarehouse.objectId",
	"platform.objectId", "purchaser.objectId", "salesperson.objectId", "supplier.objectId", "vehicle.objectId",
	"warehouse.objectId",
}

var mappingCollectionFields = map[string][]string{
	"assetAcquisitionLines": {"lineId", "assetName", "originalValue", "category.objectId", "department.objectId", "custodian.objectId"},
	"assetLiquidationLines": {"lineId", "assetId", "salvageIncome", "disposalExpense"},
	"assetSaleLines":        {"lineId", "assetId", "saleAmount"},
	"billCashLines":         {"lineId", "billLineId", "fundAccount.objectId", "direction", "amount"},
	"billLines":             {"lineId", "billId", "direction", "faceAmount", "interestAmount"},
	"expenseLines":          {"lineId", "category", "description", "amount"},
	"inventoryCountLines":   {"lineId", "product.objectId", "actualQuantity", "bookQuantity", "differenceQuantity"},
	"lines":                 {"lineId", "product.objectId", "quantity", "orderedQuantity", "signedQuantity", "rejectedQuantity", "unitPrice", "lineAmount"},
	"priceLines":            {"lineId", "product.objectId", "unitPrice"},
	"productLines":          {"lineId", "product.objectId", "quantity", "orderedQuantity", "signedQuantity", "rejectedQuantity", "unitPrice", "lineAmount"},
	"productionLines":       {"lineId", "product.objectId", "outputQuantity"},
	"signoffLines":          {"lineId", "product.objectId", "signedQuantity", "rejectedQuantity", "unitPrice", "lineAmount"},
}

var mappingEntityCollections = map[string][]string{
	"sale-pricing": {"priceLines"}, "purchase-inquiry": {"priceLines"},
	"sale-order": {"productLines"}, "purchase-order": {"productLines"}, "purchase-inbound": {"productLines"},
	"sale-outbound": {"productLines", "lines"}, "sale-delivery": {"productLines", "lines"},
	"sale-signoff": {"productLines", "signoffLines", "lines"}, "sale-return": {"productLines", "lines"},
	"purchase-return":  {"productLines", "lines"},
	"order-production": {"lines", "productionLines"}, "self-production": {"lines", "productionLines"},
	"inventory-count":       {"inventoryCountLines"},
	"expense-reimbursement": {"expenseLines"}, "employee-loan-writeoff": {"expenseLines"},
	"asset-acquisition": {"assetAcquisitionLines"}, "asset-sale": {"assetSaleLines"}, "asset-liquidation": {"assetLiquidationLines"},
	"bill-receipt": {"billLines", "billCashLines"}, "bill-payment": {"billLines", "billCashLines"},
	"bill-issue": {"billLines", "billCashLines"}, "bill-discount": {"billLines", "billCashLines"},
	"bill-maturity": {"billLines", "billCashLines"},
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
	return MappingCatalog{VouEntity: entity, HeaderFields: append([]string(nil), mappingHeaderFields...), Collections: collections}, nil
}

func mappingFieldExists(catalog MappingCatalog, field string, allowLine bool) bool {
	for _, candidate := range catalog.HeaderFields {
		if candidate == field {
			return true
		}
	}
	if allowLine {
		for _, fields := range catalog.Collections {
			for _, candidate := range fields {
				if candidate == field {
					return true
				}
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
		for _, dimensions := range []map[string]string{definition.AssetConfiguration.AssetDimensions, definition.AssetConfiguration.AccumulatedDepreciationDimensions, definition.AssetConfiguration.DepreciationExpenseDimensions} {
			for _, field := range dimensions {
				if !mappingFieldExists(catalog, field, true) {
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
			if strings.TrimSpace(line.SubjectValue) == "" || (line.SubjectSource == "FIELD" && !mappingFieldExists(catalog, line.SubjectValue, template.Collection != nil)) {
				return domainError(ErrorValidation, "invalid posting subject value", nil)
			}
			if line.Direction != BalanceDirectionDebit && line.Direction != BalanceDirectionCredit {
				return domainError(ErrorValidation, "invalid posting direction", nil)
			}
			if !mappingFieldExists(catalog, line.AmountField, template.Collection != nil) || !mappingFieldExists(catalog, line.CurrencyField, template.Collection != nil) {
				return domainError(ErrorValidation, "unknown posting amount or currency field", nil)
			}
			for _, field := range line.Dimensions {
				if !mappingFieldExists(catalog, field, template.Collection != nil) {
					return domainError(ErrorValidation, "unknown posting dimension field", nil)
				}
			}
			if line.QuantityField != nil && !mappingFieldExists(catalog, *line.QuantityField, template.Collection != nil) {
				return domainError(ErrorValidation, "unknown posting quantity field", nil)
			}
			if line.CostCounterpartSubjectID == nil && len(line.CostCounterpartDimensions) != 0 {
				return domainError(ErrorValidation, "cost dimensions require a cost counterpart subject", nil)
			}
			for _, field := range line.CostCounterpartDimensions {
				if !mappingFieldExists(catalog, field, template.Collection != nil) {
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
			if !mappingFieldExists(catalog, condition.Field, false) {
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

func mappingView(id, bookID, entity string, version int32, state, defaultResult string, definitionJSON []byte, revision int64, approvedAt time.Time, approvedAtValid bool, approvedBy *string) (MappingView, error) {
	definition := MappingDefinition{Rules: []MappingRule{}, Templates: []PostingTemplate{}}
	if err := json.Unmarshal(definitionJSON, &definition); err != nil {
		return MappingView{}, domainError(ErrorInternal, "invalid stored accounting mapping", err)
	}
	view := MappingView{ID: id, BookID: bookID, VouEntity: entity, Version: int(version), State: state, DefaultResult: defaultResult, Definition: definition, Revision: revision, ApprovedBy: approvedBy}
	if approvedAtValid {
		value := approvedAt.Format(time.RFC3339Nano)
		view.ApprovedAt = &value
	}
	return view, nil
}

func (s *Service) QueryMappings(ctx context.Context, input QueryMappingsInput, actorID string) (MappingPage, error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return MappingPage{}, domainError(ErrorValidation, "invalid accounting mapping query", nil)
	}
	if err := s.requireAccess(ctx, s.queries, input.BookID, actorID, false); err != nil {
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
		view, err := mappingView(row.ID, row.BookID, row.VouEntity, row.Version, row.State, row.DefaultResult, row.Definition, row.Revision, row.ApprovedAt.Time, row.ApprovedAt.Valid, row.ApprovedBy)
		if err != nil {
			return MappingPage{}, err
		}
		page.Items = append(page.Items, view)
		page.Total = row.Total
	}
	return page, nil
}

func (s *Service) GetMapping(ctx context.Context, bookID, mappingID, actorID string) (MappingView, error) {
	if err := s.requireAccess(ctx, s.queries, bookID, actorID, false); err != nil {
		return MappingView{}, err
	}
	row, err := s.queries.GetAccountingMapping(ctx, dbsqlc.GetAccountingMappingParams{BookID: bookID, MappingID: mappingID})
	if errors.Is(err, pgx.ErrNoRows) {
		return MappingView{}, domainError(ErrorConflict, "accounting mapping not found", err)
	}
	if err != nil {
		return MappingView{}, databaseError("get accounting mapping", err)
	}
	return mappingView(row.ID, row.BookID, row.VouEntity, row.Version, row.State, row.DefaultResult, row.Definition, row.Revision, row.ApprovedAt.Time, row.ApprovedAt.Valid, row.ApprovedBy)
}

func (s *Service) CreateMapping(ctx context.Context, input CreateMappingInput, actorID string) (MappingView, error) {
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
	if err = s.requireAccess(ctx, qtx, input.BookID, actorID, true); err != nil {
		return MappingView{}, err
	}
	if err = validateMappingSubjects(ctx, qtx, input.BookID, input.Definition); err != nil {
		return MappingView{}, err
	}
	version, err := qtx.NextAccountingMappingVersion(ctx, dbsqlc.NextAccountingMappingVersionParams{BookID: input.BookID, VouEntity: input.VouEntity})
	if err != nil {
		return MappingView{}, databaseError("allocate accounting mapping version", err)
	}
	mappingID := ulid.Make().String()
	if err = qtx.CreateAccountingMappingVersion(ctx, dbsqlc.CreateAccountingMappingVersionParams{ID: mappingID, BookID: input.BookID, VouEntity: input.VouEntity, Version: version, DefaultResult: input.DefaultResult, Definition: encoded, ActorID: actorID}); err != nil {
		return MappingView{}, databaseError("accounting mapping cannot be created", err)
	}
	result, err := loadMapping(ctx, qtx, input.BookID, mappingID)
	if err != nil {
		return MappingView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MappingView{}, databaseError("commit accounting mapping creation", err)
	}
	return result, nil
}

func loadMapping(ctx context.Context, q *dbsqlc.Queries, bookID, mappingID string) (MappingView, error) {
	row, err := q.GetAccountingMapping(ctx, dbsqlc.GetAccountingMappingParams{BookID: bookID, MappingID: mappingID})
	if err != nil {
		return MappingView{}, databaseError("get accounting mapping", err)
	}
	return mappingView(row.ID, row.BookID, row.VouEntity, row.Version, row.State, row.DefaultResult, row.Definition, row.Revision, row.ApprovedAt.Time, row.ApprovedAt.Valid, row.ApprovedBy)
}

func (s *Service) SaveMapping(ctx context.Context, input SaveMappingInput, actorID string) (MappingView, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MappingView{}, databaseError("begin accounting mapping save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.requireAccess(ctx, qtx, input.BookID, actorID, true); err != nil {
		return MappingView{}, err
	}
	row, err := qtx.GetAccountingMappingForUpdate(ctx, dbsqlc.GetAccountingMappingForUpdateParams{BookID: input.BookID, MappingID: input.MappingID})
	if errors.Is(err, pgx.ErrNoRows) {
		return MappingView{}, domainError(ErrorConflict, "accounting mapping not found", err)
	}
	if err != nil {
		return MappingView{}, databaseError("get accounting mapping state", err)
	}
	if row.State != MappingStateDraft || row.Revision != input.Revision {
		return MappingView{}, domainError(ErrorConflict, "accounting mapping changed or is approved", nil)
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
	if _, err = qtx.UpdateAccountingMappingDraft(ctx, dbsqlc.UpdateAccountingMappingDraftParams{DefaultResult: input.DefaultResult, Definition: encoded, ActorID: actorID, BookID: input.BookID, MappingID: input.MappingID, Revision: input.Revision}); errors.Is(err, pgx.ErrNoRows) {
		return MappingView{}, domainError(ErrorConflict, "accounting mapping changed", err)
	} else if err != nil {
		return MappingView{}, databaseError("accounting mapping cannot be saved", err)
	}
	result, err := loadMapping(ctx, qtx, input.BookID, input.MappingID)
	if err != nil {
		return MappingView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MappingView{}, databaseError("commit accounting mapping save", err)
	}
	return result, nil
}

func (s *Service) ApproveMapping(ctx context.Context, bookID, mappingID string, revision int64, actorID string) (MappingView, error) {
	return s.changeMappingState(ctx, bookID, mappingID, revision, actorID, true)
}

func (s *Service) UnapproveMapping(ctx context.Context, bookID, mappingID string, revision int64, actorID string) (MappingView, error) {
	return s.changeMappingState(ctx, bookID, mappingID, revision, actorID, false)
}

func (s *Service) changeMappingState(ctx context.Context, bookID, mappingID string, revision int64, actorID string, approve bool) (MappingView, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MappingView{}, databaseError("begin accounting mapping state change", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.requireAccess(ctx, qtx, bookID, actorID, true); err != nil {
		return MappingView{}, err
	}
	row, err := qtx.GetAccountingMappingForUpdate(ctx, dbsqlc.GetAccountingMappingForUpdateParams{BookID: bookID, MappingID: mappingID})
	if errors.Is(err, pgx.ErrNoRows) {
		return MappingView{}, domainError(ErrorConflict, "accounting mapping not found", err)
	}
	if err != nil {
		return MappingView{}, databaseError("get accounting mapping state", err)
	}
	if row.Revision != revision {
		return MappingView{}, domainError(ErrorConflict, "accounting mapping changed", nil)
	}
	if approve {
		if row.State != MappingStateDraft {
			return MappingView{}, domainError(ErrorConflict, "accounting mapping is not draft", nil)
		}
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
		if validationErr = validateMappingSubjects(ctx, qtx, bookID, definition); validationErr != nil {
			return MappingView{}, validationErr
		}
		if validationErr = registerMappingSubjectUsages(ctx, qtx, mappingID, definition); validationErr != nil {
			return MappingView{}, validationErr
		}
		actor := actorID
		_, err = qtx.ApproveAccountingMapping(ctx, dbsqlc.ApproveAccountingMappingParams{ActorID: &actor, BookID: bookID, MappingID: mappingID, Revision: revision})
	} else {
		if row.State != MappingStateApproved {
			return MappingView{}, domainError(ErrorConflict, "accounting mapping is not approved", nil)
		}
		if row.Referenced {
			return MappingView{}, domainError(ErrorConflict, "referenced accounting mapping cannot be unapproved", nil)
		}
		if err = qtx.DeleteAccountingSubjectUsages(ctx, dbsqlc.DeleteAccountingSubjectUsagesParams{UsageType: "MAPPING", UsageID: mappingID}); err != nil {
			return MappingView{}, databaseError("release mapping accounting subjects", err)
		}
		_, err = qtx.UnapproveAccountingMapping(ctx, dbsqlc.UnapproveAccountingMappingParams{ActorID: actorID, BookID: bookID, MappingID: mappingID, Revision: revision})
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return MappingView{}, domainError(ErrorConflict, "accounting mapping changed", err)
	}
	if err != nil {
		return MappingView{}, databaseError("accounting mapping state cannot be changed", err)
	}
	result, err := loadMapping(ctx, qtx, bookID, mappingID)
	if err != nil {
		return MappingView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MappingView{}, databaseError("commit accounting mapping state change", err)
	}
	return result, nil
}
