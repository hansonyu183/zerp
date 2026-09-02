package acc

import (
	"context"
	"errors"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"
)

var subjectCodePattern = regexp.MustCompile(`^[A-Z0-9][A-Z0-9.-]{0,31}$`)

var validSubjectDimensions = map[string]struct{}{
	DimensionCustomerSubunit: {}, DimensionSupplier: {}, DimensionOtherUnit: {},
	DimensionEmployee: {}, DimensionSalesPartner: {}, DimensionDepartment: {}, DimensionProduct: {},
	DimensionWarehouse: {}, DimensionFundAccount: {}, DimensionAsset: {}, DimensionBill: {},
}

type normalizedSubject struct {
	code, name, balanceDirection, settlementPurpose string
	parentSubjectID                                 *string
	enabled, inventoryQuantity                      bool
	dimensions                                      []string
}

func normalizeSubject(input CreateSubjectInput) (normalizedSubject, error) {
	result := normalizedSubject{
		code: strings.ToUpper(strings.TrimSpace(input.Code)), name: strings.TrimSpace(input.Name),
		balanceDirection:  strings.ToUpper(strings.TrimSpace(input.BalanceDirection)),
		settlementPurpose: strings.ToUpper(strings.TrimSpace(input.SettlementPurpose)),
		enabled:           input.Enabled, inventoryQuantity: input.InventoryQuantity,
	}
	if !subjectCodePattern.MatchString(result.code) || result.name == "" || utf8.RuneCountInString(result.name) > 200 {
		return normalizedSubject{}, domainError(ErrorValidation, "invalid accounting subject", nil)
	}
	if result.balanceDirection != BalanceDirectionDebit && result.balanceDirection != BalanceDirectionCredit {
		return normalizedSubject{}, domainError(ErrorValidation, "invalid subject balance direction", nil)
	}
	if input.ParentSubjectID != nil {
		parentID := strings.TrimSpace(*input.ParentSubjectID)
		if parentID == "" {
			return normalizedSubject{}, domainError(ErrorValidation, "invalid parent accounting subject", nil)
		}
		result.parentSubjectID = &parentID
	}
	dimensionSet := make(map[string]struct{}, len(input.RequiredDimensions))
	for _, dimension := range input.RequiredDimensions {
		dimension = strings.ToUpper(strings.TrimSpace(dimension))
		if _, ok := validSubjectDimensions[dimension]; !ok {
			return normalizedSubject{}, domainError(ErrorValidation, "invalid accounting subject dimension", nil)
		}
		dimensionSet[dimension] = struct{}{}
	}
	for dimension := range dimensionSet {
		result.dimensions = append(result.dimensions, dimension)
	}
	sort.Strings(result.dimensions)
	if err := validateSubjectAttributes(result); err != nil {
		return normalizedSubject{}, err
	}
	return result, nil
}

func validateSubjectAttributes(subject normalizedSubject) error {
	dimensions := make(map[string]struct{}, len(subject.dimensions))
	for _, dimension := range subject.dimensions {
		dimensions[dimension] = struct{}{}
	}
	has := func(dimension string) bool { _, ok := dimensions[dimension]; return ok }
	if subject.inventoryQuantity && (!has(DimensionProduct) || !has(DimensionWarehouse)) {
		return domainError(ErrorValidation, "库存数量核算科目必须要求商品和仓库辅助核算", nil)
	}
	switch subject.settlementPurpose {
	case SettlementPurposeNone:
	case SettlementPurposeReceivable, SettlementPurposeAdvanceReceipt:
		if !has(DimensionCustomerSubunit) {
			return domainError(ErrorValidation, "该往来用途必须要求客户辅助核算", nil)
		}
	case SettlementPurposePrepaid, SettlementPurposePayable:
		if !has(DimensionSupplier) {
			return domainError(ErrorValidation, "该往来用途必须要求供应商辅助核算", nil)
		}
	case SettlementPurposeOther:
		if !has(DimensionCustomerSubunit) && !has(DimensionSupplier) && !has(DimensionOtherUnit) && !has(DimensionEmployee) && !has(DimensionSalesPartner) {
			return domainError(ErrorValidation, "其他往来用途必须要求至少一个往来辅助核算", nil)
		}
	default:
		return domainError(ErrorValidation, "invalid subject settlement purpose", nil)
	}
	return nil
}

func copySubjectTemplate(ctx context.Context, q *dbsqlc.Queries, bookID, actorID string, lines []subjectTemplateLine) error {
	ids := make(map[string]string, len(lines))
	for _, line := range lines {
		var parentID *string
		if line.ParentCode != "" {
			id, ok := ids[line.ParentCode]
			if !ok {
				return domainError(ErrorInternal, "accounting subject template parent missing", nil)
			}
			parentID = &id
		}
		id := ulid.Make().String()
		if err := q.InsertAccountingSubject(ctx, dbsqlc.InsertAccountingSubjectParams{
			ID: id, BookID: bookID, Code: line.Code, Name: line.Name,
			ParentSubjectID: parentID, BalanceDirection: line.BalanceDirection,
			Enabled: true, InventoryQuantity: line.InventoryQuantity,
			SettlementPurpose: line.SettlementPurpose, ActorID: actorID,
		}); err != nil {
			return databaseError("copy accounting subject template", err)
		}
		for _, dimension := range line.Dimensions {
			if err := q.InsertAccountingSubjectDimension(ctx, dbsqlc.InsertAccountingSubjectDimensionParams{
				SubjectID: id, Dimension: dimension,
			}); err != nil {
				return databaseError("copy accounting subject dimensions", err)
			}
		}
		ids[line.Code] = id
	}
	return nil
}

func (s *Service) QuerySubjects(ctx context.Context, input QuerySubjectsInput, actorID string) (SubjectPage, error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return SubjectPage{}, domainError(ErrorValidation, "invalid accounting subject query", nil)
	}
	if err := s.requireAccess(ctx, s.queries, input.BookID, actorID, false); err != nil {
		return SubjectPage{}, err
	}
	rows, err := s.queries.ListAccountingSubjects(ctx, dbsqlc.ListAccountingSubjectsParams{
		BookID: input.BookID, Keyword: strings.TrimSpace(input.Keyword),
		PageOffset: int32((input.Page - 1) * input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return SubjectPage{}, databaseError("query accounting subjects", err)
	}
	page := SubjectPage{Items: []SubjectView{}, Page: input.Page, PageSize: input.PageSize}
	for _, row := range rows {
		dimensions, err := s.queries.ListAccountingSubjectDimensions(ctx, row.ID)
		if err != nil {
			return SubjectPage{}, databaseError("query accounting subject dimensions", err)
		}
		page.Items = append(page.Items, SubjectView{
			ID: row.ID, BookID: row.BookID, Code: row.Code, Name: row.Name,
			ParentSubjectID: row.ParentSubjectID, BalanceDirection: row.BalanceDirection,
			Enabled: row.Enabled, Leaf: row.Leaf, RequiredDimensions: dimensions,
			InventoryQuantity: row.InventoryQuantity, SettlementPurpose: row.SettlementPurpose,
			Referenced: row.Referenced, Revision: row.Revision,
		})
		page.Total = row.Total
	}
	return page, nil
}

func (s *Service) GetSubject(ctx context.Context, bookID, subjectID, actorID string) (SubjectView, error) {
	if err := s.requireAccess(ctx, s.queries, bookID, actorID, false); err != nil {
		return SubjectView{}, err
	}
	return loadSubject(ctx, s.queries, bookID, subjectID)
}

func loadSubject(ctx context.Context, q *dbsqlc.Queries, bookID, subjectID string) (SubjectView, error) {
	row, err := q.GetAccountingSubject(ctx, dbsqlc.GetAccountingSubjectParams{BookID: bookID, SubjectID: subjectID})
	if errors.Is(err, pgx.ErrNoRows) {
		return SubjectView{}, domainError(ErrorConflict, "accounting subject not found", err)
	}
	if err != nil {
		return SubjectView{}, databaseError("get accounting subject", err)
	}
	dimensions, err := q.ListAccountingSubjectDimensions(ctx, subjectID)
	if err != nil {
		return SubjectView{}, databaseError("get accounting subject dimensions", err)
	}
	return SubjectView{
		ID: row.ID, BookID: row.BookID, Code: row.Code, Name: row.Name,
		ParentSubjectID: row.ParentSubjectID, BalanceDirection: row.BalanceDirection,
		Enabled: row.Enabled, Leaf: row.Leaf, RequiredDimensions: dimensions,
		InventoryQuantity: row.InventoryQuantity, SettlementPurpose: row.SettlementPurpose,
		Referenced: row.Referenced, Revision: row.Revision,
	}, nil
}

func (s *Service) CreateSubject(ctx context.Context, input CreateSubjectInput, actorID string) (SubjectView, error) {
	normalized, err := normalizeSubject(input)
	if err != nil {
		return SubjectView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SubjectView{}, databaseError("begin accounting subject creation", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.requireAccess(ctx, qtx, input.BookID, actorID, true); err != nil {
		return SubjectView{}, err
	}
	if normalized.parentSubjectID != nil {
		parent, err := qtx.GetAccountingSubject(ctx, dbsqlc.GetAccountingSubjectParams{BookID: input.BookID, SubjectID: *normalized.parentSubjectID})
		if errors.Is(err, pgx.ErrNoRows) {
			return SubjectView{}, domainError(ErrorValidation, "parent accounting subject not found", err)
		}
		if err != nil {
			return SubjectView{}, databaseError("validate parent accounting subject", err)
		}
		if parent.Referenced {
			return SubjectView{}, domainError(ErrorConflict, "已引用科目不能新增下级科目", nil)
		}
	}
	id := ulid.Make().String()
	if err = insertSubject(ctx, qtx, id, input.BookID, actorID, normalized); err != nil {
		return SubjectView{}, err
	}
	result, err := loadSubject(ctx, qtx, input.BookID, id)
	if err != nil {
		return SubjectView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return SubjectView{}, databaseError("commit accounting subject creation", err)
	}
	return result, nil
}

func insertSubject(ctx context.Context, q *dbsqlc.Queries, id, bookID, actorID string, subject normalizedSubject) error {
	if err := q.InsertAccountingSubject(ctx, dbsqlc.InsertAccountingSubjectParams{
		ID: id, BookID: bookID, Code: subject.code, Name: subject.name,
		ParentSubjectID: subject.parentSubjectID, BalanceDirection: subject.balanceDirection,
		Enabled: subject.enabled, InventoryQuantity: subject.inventoryQuantity,
		SettlementPurpose: subject.settlementPurpose, ActorID: actorID,
	}); err != nil {
		return databaseError("accounting subject cannot be created", err)
	}
	for _, dimension := range subject.dimensions {
		if err := q.InsertAccountingSubjectDimension(ctx, dbsqlc.InsertAccountingSubjectDimensionParams{SubjectID: id, Dimension: dimension}); err != nil {
			return databaseError("accounting subject dimension cannot be created", err)
		}
	}
	return nil
}

func (s *Service) SaveSubject(ctx context.Context, input SaveSubjectInput, actorID string) (SubjectView, error) {
	if input.Revision < 1 {
		return SubjectView{}, domainError(ErrorValidation, "invalid accounting subject", nil)
	}
	normalized, err := normalizeSubject(input.CreateSubjectInput)
	if err != nil {
		return SubjectView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SubjectView{}, databaseError("begin accounting subject save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.requireAccess(ctx, qtx, input.BookID, actorID, true); err != nil {
		return SubjectView{}, err
	}
	state, err := qtx.GetAccountingSubjectStateForUpdate(ctx, dbsqlc.GetAccountingSubjectStateForUpdateParams{BookID: input.BookID, SubjectID: input.SubjectID})
	if errors.Is(err, pgx.ErrNoRows) {
		return SubjectView{}, domainError(ErrorConflict, "accounting subject not found", err)
	}
	if err != nil {
		return SubjectView{}, databaseError("get accounting subject state", err)
	}
	if state.Revision != input.Revision {
		return SubjectView{}, domainError(ErrorConflict, "accounting subject changed", nil)
	}
	currentDimensions, err := qtx.ListAccountingSubjectDimensions(ctx, input.SubjectID)
	if err != nil {
		return SubjectView{}, databaseError("get accounting subject dimensions", err)
	}
	if state.Referenced {
		structuralChange := state.Code != normalized.code || state.Name != normalized.name ||
			!optionalStringEqual(state.ParentSubjectID, normalized.parentSubjectID) ||
			state.BalanceDirection != normalized.balanceDirection ||
			state.InventoryQuantity != normalized.inventoryQuantity || state.SettlementPurpose != normalized.settlementPurpose ||
			!stringSlicesEqual(currentDimensions, normalized.dimensions)
		if structuralChange || (!state.Enabled && normalized.enabled) {
			return SubjectView{}, domainError(ErrorConflict, "已引用科目只能停用", nil)
		}
	}
	if normalized.parentSubjectID != nil {
		if *normalized.parentSubjectID == input.SubjectID {
			return SubjectView{}, domainError(ErrorValidation, "accounting subject cannot be its own parent", nil)
		}
		wouldCycle, err := accountingSubjectWouldCycle(ctx, qtx, input.BookID, input.SubjectID, *normalized.parentSubjectID)
		if err != nil {
			return SubjectView{}, err
		}
		if wouldCycle {
			return SubjectView{}, domainError(ErrorValidation, "accounting subject hierarchy cycle", nil)
		}
		parent, err := qtx.GetAccountingSubject(ctx, dbsqlc.GetAccountingSubjectParams{BookID: input.BookID, SubjectID: *normalized.parentSubjectID})
		if errors.Is(err, pgx.ErrNoRows) {
			return SubjectView{}, domainError(ErrorValidation, "parent accounting subject not found", err)
		} else if err != nil {
			return SubjectView{}, databaseError("validate parent accounting subject", err)
		}
		if parent.Referenced {
			return SubjectView{}, domainError(ErrorConflict, "已引用科目不能新增下级科目", nil)
		}
	}
	_, err = qtx.UpdateAccountingSubject(ctx, dbsqlc.UpdateAccountingSubjectParams{
		Code: normalized.code, Name: normalized.name, ParentSubjectID: normalized.parentSubjectID,
		BalanceDirection: normalized.balanceDirection, Enabled: normalized.enabled,
		InventoryQuantity: normalized.inventoryQuantity, SettlementPurpose: normalized.settlementPurpose,
		ActorID: actorID, BookID: input.BookID, SubjectID: input.SubjectID, Revision: input.Revision,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return SubjectView{}, domainError(ErrorConflict, "accounting subject changed", err)
	}
	if err != nil {
		return SubjectView{}, databaseError("accounting subject cannot be saved", err)
	}
	if err = qtx.DeleteAccountingSubjectDimensions(ctx, input.SubjectID); err != nil {
		return SubjectView{}, databaseError("replace accounting subject dimensions", err)
	}
	for _, dimension := range normalized.dimensions {
		if err = qtx.InsertAccountingSubjectDimension(ctx, dbsqlc.InsertAccountingSubjectDimensionParams{SubjectID: input.SubjectID, Dimension: dimension}); err != nil {
			return SubjectView{}, databaseError("replace accounting subject dimensions", err)
		}
	}
	result, err := loadSubject(ctx, qtx, input.BookID, input.SubjectID)
	if err != nil {
		return SubjectView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return SubjectView{}, databaseError("commit accounting subject save", err)
	}
	return result, nil
}

func accountingSubjectWouldCycle(ctx context.Context, q *dbsqlc.Queries, bookID, subjectID, candidateParentID string) (bool, error) {
	currentID := candidateParentID
	for currentID != "" {
		if currentID == subjectID {
			return true, nil
		}
		parentID, err := q.GetAccountingSubjectParent(ctx, dbsqlc.GetAccountingSubjectParentParams{
			BookID: bookID, SubjectID: currentID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return false, domainError(ErrorValidation, "parent accounting subject not found", err)
		}
		if err != nil {
			return false, databaseError("validate accounting subject hierarchy", err)
		}
		if parentID == nil {
			return false, nil
		}
		currentID = *parentID
	}
	return false, nil
}

func optionalStringEqual(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func stringSlicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func (s *Service) DeleteSubject(ctx context.Context, bookID, subjectID string, revision int64, actorID string) error {
	if revision < 1 {
		return domainError(ErrorValidation, "invalid accounting subject", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return databaseError("begin accounting subject deletion", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = s.requireAccess(ctx, qtx, bookID, actorID, true); err != nil {
		return err
	}
	state, err := qtx.GetAccountingSubjectStateForUpdate(ctx, dbsqlc.GetAccountingSubjectStateForUpdateParams{BookID: bookID, SubjectID: subjectID})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorConflict, "accounting subject not found", err)
	}
	if err != nil {
		return databaseError("get accounting subject state", err)
	}
	if state.Revision != revision {
		return domainError(ErrorConflict, "accounting subject changed", nil)
	}
	if state.Referenced || state.HasChildren {
		return domainError(ErrorConflict, "已引用或有下级的科目不能删除", nil)
	}
	if err = qtx.DeleteAccountingSubject(ctx, dbsqlc.DeleteAccountingSubjectParams{BookID: bookID, SubjectID: subjectID}); err != nil {
		return databaseError("accounting subject cannot be deleted", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return databaseError("commit accounting subject deletion", err)
	}
	return nil
}

func (s *Service) RegisterSubjectUsage(ctx context.Context, bookID, subjectID, usageType, usageID string) error {
	usageType, usageID = strings.ToUpper(strings.TrimSpace(usageType)), strings.TrimSpace(usageID)
	if usageType == "" || usageID == "" {
		return domainError(ErrorValidation, "invalid accounting subject usage", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return databaseError("begin accounting subject usage", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	state, err := qtx.GetAccountingSubjectStateForUpdate(ctx, dbsqlc.GetAccountingSubjectStateForUpdateParams{BookID: bookID, SubjectID: subjectID})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorConflict, "accounting subject not found", err)
	}
	if err != nil {
		return databaseError("get accounting subject state", err)
	}
	if state.HasChildren || !state.Enabled {
		return domainError(ErrorConflict, "只有启用的末级科目可以承载会计事实", nil)
	}
	if err = qtx.RegisterAccountingSubjectUsage(ctx, dbsqlc.RegisterAccountingSubjectUsageParams{
		SubjectID: subjectID, UsageType: usageType, UsageID: usageID,
	}); err != nil {
		return databaseError("register accounting subject usage", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return databaseError("commit accounting subject usage", err)
	}
	return nil
}
