package vou

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

func isAssetEntity(entity string) bool {
	switch entity {
	case EntityAssetAcquisition, EntityAssetDepreciation, EntityAssetSale, EntityAssetLiquidation:
		return true
	default:
		return false
	}
}

type preparedAssetAcquisitionLine struct {
	input                AssetAcquisitionLineInput
	category, department bobdomain.AuxiliaryReference
	custodian            *bobdomain.EffectiveReference
	originalValue        int64
	residualRateBps      int32
}

type preparedAssetDepreciationLine struct {
	input  AssetDepreciationLineInput
	asset  dbsqlc.LedAsset
	amount int64
}

type preparedAssetSaleLine struct {
	input  AssetSaleLineInput
	asset  dbsqlc.LedAsset
	amount int64
}

type preparedAssetLiquidationLine struct {
	input            AssetLiquidationLineInput
	asset            dbsqlc.LedAsset
	salvage, expense int64
}

type preparedAssetDraft struct {
	businessDate           time.Time
	depreciationMonth      time.Time
	remark                 *string
	total                  int64
	supplier, counterparty *bobdomain.EffectiveReference
	counterpartyType       string
	acquisitions           []preparedAssetAcquisitionLine
	depreciations          []preparedAssetDepreciationLine
	sales                  []preparedAssetSaleLine
	liquidations           []preparedAssetLiquidationLine
}

func validateAssetText(value, field string, required bool, max int) (string, error) {
	value = strings.TrimSpace(value)
	if (required && value == "") || utf8.RuneCountInString(value) > max {
		return "", domainError(ErrorValidation, field+" is invalid", nil, nil)
	}
	return value, nil
}

func monthStart(value string) (time.Time, error) {
	parsed, err := time.Parse("2006-01", strings.TrimSpace(value))
	if err != nil {
		return time.Time{}, domainError(ErrorValidation, "depreciationMonth must use YYYY-MM", nil, err)
	}
	return parsed, nil
}

func monthEnd(month time.Time) time.Time { return month.AddDate(0, 1, -1) }

func sameMonth(left, right time.Time) bool {
	return left.Year() == right.Year() && left.Month() == right.Month()
}

func (s *Service) prepareAssetDraft(ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, entity string, input DraftInput) (preparedAssetDraft, error) {
	var result preparedAssetDraft
	if input.Currency != "CNY" {
		return result, domainError(ErrorValidation, "fixed asset currency must be CNY", nil, nil)
	}
	result.remark = optionalText(input.Remark)
	if result.remark != nil && utf8.RuneCountInString(*result.remark) > 1000 {
		return result, domainError(ErrorValidation, "remark is too long", nil, nil)
	}
	var err error
	if entity == EntityAssetDepreciation {
		result.depreciationMonth, err = monthStart(input.DepreciationMonth)
		if err != nil {
			return result, err
		}
		result.businessDate = monthEnd(result.depreciationMonth)
		if input.BusinessDate != "" {
			provided, dateErr := time.Parse(dateLayout, input.BusinessDate)
			if dateErr != nil || !provided.Equal(result.businessDate) {
				return result, domainError(ErrorValidation, "depreciation businessDate must be month end", nil, dateErr)
			}
		}
	} else {
		result.businessDate, err = time.Parse(dateLayout, input.BusinessDate)
		if err != nil {
			return result, domainError(ErrorValidation, "invalid businessDate", nil, err)
		}
	}
	switch entity {
	case EntityAssetAcquisition:
		if err = validateReference(input.Supplier, "supplier", true); err != nil {
			return result, err
		}
		resolved, resolveErr := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntitySupplier, input.Supplier.ObjectID, input.Supplier.VersionID)
		if resolveErr != nil {
			return result, domainError(ErrorConflict, "supplier is not effective", nil, resolveErr)
		}
		result.supplier = &resolved
		if len(input.AssetAcquisitionLines) < 1 || len(input.AssetAcquisitionLines) > 200 {
			return result, domainError(ErrorValidation, "asset acquisition requires 1-200 lines", nil, nil)
		}
		for _, line := range input.AssetAcquisitionLines {
			line.AssetName, err = validateAssetText(line.AssetName, "assetName", true, 200)
			if err != nil {
				return result, err
			}
			line.Specification, err = validateAssetText(line.Specification, "specification", false, 200)
			if err != nil {
				return result, err
			}
			line.Location, err = validateAssetText(line.Location, "location", false, 200)
			if err != nil {
				return result, err
			}
			if err = validateReference(&line.Category, "category", true); err != nil {
				return result, err
			}
			if err = validateReference(&line.Department, "department", true); err != nil {
				return result, err
			}
			category, auxErr := s.auxResolver.ResolveAuxiliaryReference(ctx, tx, auxdomain.EntityAssetCategory, line.Category.ObjectID, line.Category.VersionID)
			if auxErr != nil {
				return result, domainError(ErrorConflict, "asset category is not effective", nil, auxErr)
			}
			department, auxErr := s.auxResolver.ResolveAuxiliaryReference(ctx, tx, auxdomain.EntityDepartment, line.Department.ObjectID, line.Department.VersionID)
			if auxErr != nil {
				return result, domainError(ErrorConflict, "department is not effective", nil, auxErr)
			}
			original, moneyErr := moneyCents(line.OriginalValue)
			if moneyErr != nil {
				return result, domainError(ErrorValidation, "originalValue is invalid", nil, moneyErr)
			}
			rate, rateErr := parseFixed(line.ResidualRate, 2, true)
			if rateErr != nil || rate >= 10000 || line.UsefulLifeMonths < 1 || line.UsefulLifeMonths > 1200 {
				return result, domainError(ErrorValidation, "useful life or residual rate is invalid", nil, rateErr)
			}
			var custodian *bobdomain.EffectiveReference
			if line.Custodian != nil {
				if err = validateReference(line.Custodian, "custodian", true); err != nil {
					return result, err
				}
				resolvedCustodian, resolveErr := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntityEmployee, line.Custodian.ObjectID, line.Custodian.VersionID)
				if resolveErr != nil {
					return result, domainError(ErrorConflict, "custodian is not effective", nil, resolveErr)
				}
				custodian = &resolvedCustodian
			}
			if result.total > math.MaxInt64-original {
				return result, domainError(ErrorValidation, "total amount is out of range", nil, nil)
			}
			result.total += original
			result.acquisitions = append(result.acquisitions, preparedAssetAcquisitionLine{input: line, category: category, department: department, custodian: custodian, originalValue: original, residualRateBps: int32(rate)})
		}
	case EntityAssetDepreciation:
		if len(input.AssetDepreciationLines) < 1 || len(input.AssetDepreciationLines) > 500 {
			return result, domainError(ErrorValidation, "asset depreciation requires 1-500 lines", nil, nil)
		}
		seen := map[string]bool{}
		for _, line := range input.AssetDepreciationLines {
			if !validID(line.AssetID) || seen[line.AssetID] {
				return result, domainError(ErrorValidation, "assetId is invalid or duplicated", nil, nil)
			}
			seen[line.AssetID] = true
			asset, loadErr := q.GetActiveLedAssetForVou(ctx, line.AssetID)
			if loadErr != nil {
				return result, domainError(ErrorConflict, "asset is unavailable", nil, loadErr)
			}
			if asset.Status != "ACTIVE" || asset.DepreciationStartMonth.Time.After(result.depreciationMonth) ||
				(asset.LastDepreciationMonth.Valid && !asset.LastDepreciationMonth.Time.AddDate(0, 1, 0).Equal(result.depreciationMonth)) ||
				(!asset.LastDepreciationMonth.Valid && !asset.DepreciationStartMonth.Time.Equal(result.depreciationMonth)) {
				return result, domainError(ErrorConflict, "asset is not due for this depreciation month", map[string]any{"assetId": line.AssetID}, nil)
			}
			depreciable := asset.OriginalValueCents - asset.ResidualValueCents
			remaining := depreciable - asset.AccumulatedDepreciationCents
			amount := (depreciable + int64(asset.UsefulLifeMonths)/2) / int64(asset.UsefulLifeMonths)
			if amount < 1 {
				amount = 1
			}
			if amount > remaining {
				amount = remaining
			}
			if amount <= 0 {
				return result, domainError(ErrorConflict, "asset is fully depreciated", nil, nil)
			}
			result.total += amount
			result.depreciations = append(result.depreciations, preparedAssetDepreciationLine{input: line, asset: asset, amount: amount})
		}
	case EntityAssetSale:
		if input.CounterpartyType != "customer" && input.CounterpartyType != "other-party" {
			return result, domainError(ErrorValidation, "counterpartyType must be customer or other-party", nil, nil)
		}
		if err = validateReference(input.Counterparty, "counterparty", true); err != nil {
			return result, err
		}
		resolved, resolveErr := s.resolver.ResolveEffectiveReference(ctx, tx, input.CounterpartyType, input.Counterparty.ObjectID, input.Counterparty.VersionID)
		if resolveErr != nil {
			return result, domainError(ErrorConflict, "counterparty is not effective", nil, resolveErr)
		}
		result.counterparty, result.counterpartyType = &resolved, input.CounterpartyType
		if len(input.AssetSaleLines) < 1 || len(input.AssetSaleLines) > 200 {
			return result, domainError(ErrorValidation, "asset sale requires 1-200 lines", nil, nil)
		}
		seen := map[string]bool{}
		for _, line := range input.AssetSaleLines {
			if !validID(line.AssetID) || seen[line.AssetID] {
				return result, domainError(ErrorValidation, "assetId is invalid or duplicated", nil, nil)
			}
			seen[line.AssetID] = true
			asset, loadErr := q.GetActiveLedAssetForVou(ctx, line.AssetID)
			if loadErr != nil {
				return result, domainError(ErrorConflict, "asset is unavailable", nil, loadErr)
			}
			if err = validateAssetDisposal(asset, result.businessDate); err != nil {
				return result, err
			}
			amount, moneyErr := moneyCents(line.SaleAmount)
			if moneyErr != nil {
				return result, domainError(ErrorValidation, "saleAmount is invalid", nil, moneyErr)
			}
			result.total += amount
			result.sales = append(result.sales, preparedAssetSaleLine{input: line, asset: asset, amount: amount})
		}
	case EntityAssetLiquidation:
		if len(input.AssetLiquidationLines) < 1 || len(input.AssetLiquidationLines) > 200 {
			return result, domainError(ErrorValidation, "asset liquidation requires 1-200 lines", nil, nil)
		}
		seen := map[string]bool{}
		for _, line := range input.AssetLiquidationLines {
			if !validID(line.AssetID) || seen[line.AssetID] {
				return result, domainError(ErrorValidation, "assetId is invalid or duplicated", nil, nil)
			}
			seen[line.AssetID] = true
			asset, loadErr := q.GetActiveLedAssetForVou(ctx, line.AssetID)
			if loadErr != nil {
				return result, domainError(ErrorConflict, "asset is unavailable", nil, loadErr)
			}
			if err = validateAssetDisposal(asset, result.businessDate); err != nil {
				return result, err
			}
			line.Reason, err = validateAssetText(line.Reason, "reason", true, 1000)
			if err != nil {
				return result, err
			}
			salvage, moneyErr := parseFixed(line.SalvageIncome, 2, true)
			if moneyErr != nil {
				return result, domainError(ErrorValidation, "salvageIncome is invalid", nil, moneyErr)
			}
			expense, moneyErr := parseFixed(line.DisposalExpense, 2, true)
			if moneyErr != nil {
				return result, domainError(ErrorValidation, "disposalExpense is invalid", nil, moneyErr)
			}
			if result.total > math.MaxInt64-salvage-expense {
				return result, domainError(ErrorValidation, "total amount is out of range", nil, nil)
			}
			result.total += salvage + expense
			result.liquidations = append(result.liquidations, preparedAssetLiquidationLine{input: line, asset: asset, salvage: salvage, expense: expense})
		}
	default:
		return result, domainError(ErrorValidation, "invalid asset entity", nil, nil)
	}
	return result, nil
}

func validateAssetDisposal(asset dbsqlc.LedAsset, date time.Time) error {
	if asset.Status != "ACTIVE" {
		return domainError(ErrorConflict, "asset is not active", map[string]any{"assetId": asset.ID}, nil)
	}
	month := time.Date(date.Year(), date.Month(), 1, 0, 0, 0, 0, time.UTC)
	fullyDepreciated := asset.AccumulatedDepreciationCents >= asset.OriginalValueCents-asset.ResidualValueCents
	if !fullyDepreciated && !asset.DepreciationStartMonth.Time.After(month) && (!asset.LastDepreciationMonth.Valid || !sameMonth(asset.LastDepreciationMonth.Time, month)) {
		return domainError(ErrorConflict, "asset must be depreciated through the disposal month", map[string]any{"assetId": asset.ID}, nil)
	}
	return nil
}

func auxName(ref bobdomain.AuxiliaryReference) string {
	value, _ := ref.Data["name"].(string)
	return value
}

func (s *Service) CreateAssetDocument(ctx context.Context, entity string, input CreateInput, actorID, requestID string) (MutationResult, error) {
	if !validID(actorID) || input.ParentEntity != "" || input.ParentDocumentID != "" {
		return MutationResult{}, domainError(ErrorValidation, "invalid asset create request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin asset create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	draft, err := s.prepareAssetDraft(ctx, tx, q, entity, input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	counter, err := q.NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{Entity: entity, BusinessDate: dateValue(draft.businessDate)})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorConflict, "document number exhausted", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.writeError("allocate asset document number", err)
	}
	id := newID()
	no := fmt.Sprintf("%s-%s-%04d", entityPrefix(entity), draft.businessDate.Format("20060102"), counter)
	if err = q.InsertVouDocument(ctx, dbsqlc.InsertVouDocumentParams{ID: id, Entity: entity, DocumentNo: no, BusinessDate: dateValue(draft.businessDate), Currency: stringPtr("CNY"), TotalAmountCents: draft.total, Remark: draft.remark, ActorID: actorID}); err != nil {
		return MutationResult{}, s.writeError("insert asset document", err)
	}
	if err = s.writeAssetDraft(ctx, q, entity, id, draft, false); err != nil {
		return MutationResult{}, s.writeError("insert asset detail", err)
	}
	if err = insertAudit(ctx, q, auditInput{DocumentID: id, Entity: entity, Event: "CREATED", To: StatusDraft, ActorID: actorID, RequestID: requestID, Summary: map[string]any{"documentNo": no}}); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentCreatedEvent{Entity: entity, DocumentID: id, DocumentNo: no, Revision: 1, ActorID: actorID, RequestID: requestID}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit asset create", err)
	}
	return MutationResult{DocumentID: id, DocumentNo: no, Status: StatusDraft, Revision: 1}, nil
}

func (s *Service) SaveAssetDocument(ctx context.Context, entity string, input SaveInput, actorID, requestID string) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin asset save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	draft, err := s.prepareAssetDraft(ctx, tx, q, entity, input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	if err = s.writeAssetDraft(ctx, q, entity, input.DocumentID, draft, true); err != nil {
		return MutationResult{}, s.writeError("update asset detail", err)
	}
	revision, err := q.UpdateVouDraft(ctx, dbsqlc.UpdateVouDraftParams{BusinessDate: dateValue(draft.businessDate), Currency: stringPtr("CNY"), TotalAmountCents: draft.total, Remark: draft.remark, ActorID: actorID, ID: input.DocumentID, Entity: entity, Revision: input.Revision})
	if err != nil {
		return MutationResult{}, s.writeError("update asset draft", err)
	}
	if err = insertAudit(ctx, q, auditInput{DocumentID: input.DocumentID, Entity: entity, Event: "SAVED", From: stringPtr(StatusDraft), To: StatusDraft, ActorID: actorID, RequestID: requestID, Summary: map[string]any{"revision": revision}}); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentChangedEvent{Action: "SAVED", Entity: entity, DocumentID: document.ID, DocumentNo: document.DocumentNo, Status: StatusDraft, Revision: revision, ActorID: actorID, RequestID: requestID}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit asset save", err)
	}
	return MutationResult{DocumentID: input.DocumentID, DocumentNo: document.DocumentNo, Status: StatusDraft, Revision: revision}, nil
}

func (s *Service) writeAssetDraft(ctx context.Context, q *dbsqlc.Queries, entity, documentID string, draft preparedAssetDraft, update bool) error {
	switch entity {
	case EntityAssetAcquisition:
		params := dbsqlc.InsertVouAssetAcquisitionDetailParams{DocumentID: documentID, SupplierObjectID: draft.supplier.ObjectID, SupplierVersionID: draft.supplier.VersionID, SupplierCode: draft.supplier.Code, SupplierName: draft.supplier.Data.Name}
		if update {
			if err := oneRow(q.UpdateVouAssetAcquisitionDetail(ctx, dbsqlc.UpdateVouAssetAcquisitionDetailParams{SupplierObjectID: params.SupplierObjectID, SupplierVersionID: params.SupplierVersionID, SupplierCode: params.SupplierCode, SupplierName: params.SupplierName, DocumentID: documentID})); err != nil {
				return err
			}
		} else if err := q.InsertVouAssetAcquisitionDetail(ctx, params); err != nil {
			return err
		}
		if err := q.DeleteVouAssetAcquisitionLines(ctx, documentID); err != nil {
			return err
		}
		for i, line := range draft.acquisitions {
			var custID, custVersion, custCode, custName *string
			if line.custodian != nil {
				custID = stringPtr(line.custodian.ObjectID)
				custVersion = stringPtr(line.custodian.VersionID)
				custCode = stringPtr(line.custodian.Code)
				custName = stringPtr(line.custodian.Data.Name)
			}
			if err := q.InsertVouAssetAcquisitionLine(ctx, dbsqlc.InsertVouAssetAcquisitionLineParams{ID: newID(), DocumentID: documentID, LineNo: int32(i + 1), AssetName: line.input.AssetName, Specification: line.input.Specification, CategoryObjectID: line.category.ObjectID, CategoryVersionID: line.category.VersionID, CategoryCode: line.category.Code, CategoryName: auxName(line.category), OriginalValueCents: line.originalValue, UsefulLifeMonths: line.input.UsefulLifeMonths, ResidualRateBps: line.residualRateBps, DepartmentObjectID: line.department.ObjectID, DepartmentVersionID: line.department.VersionID, DepartmentCode: line.department.Code, DepartmentName: auxName(line.department), CustodianObjectID: custID, CustodianVersionID: custVersion, CustodianCode: custCode, CustodianName: custName, Location: line.input.Location, Remark: optionalText(line.input.Remark)}); err != nil {
				return err
			}
		}
	case EntityAssetDepreciation:
		params := dbsqlc.InsertVouAssetDepreciationDetailParams{DocumentID: documentID, DepreciationMonth: dateValue(draft.depreciationMonth)}
		if update {
			if err := oneRow(q.UpdateVouAssetDepreciationDetail(ctx, dbsqlc.UpdateVouAssetDepreciationDetailParams{DepreciationMonth: params.DepreciationMonth, DocumentID: documentID})); err != nil {
				return err
			}
		} else if err := q.InsertVouAssetDepreciationDetail(ctx, params); err != nil {
			return err
		}
		if err := q.DeleteVouAssetDepreciationLines(ctx, documentID); err != nil {
			return err
		}
		for i, line := range draft.depreciations {
			if err := q.InsertVouAssetDepreciationLine(ctx, dbsqlc.InsertVouAssetDepreciationLineParams{ID: newID(), DocumentID: documentID, LineNo: int32(i + 1), DepreciationMonth: dateValue(draft.depreciationMonth), AssetID: line.asset.ID, AssetNo: line.asset.AssetNo, AssetName: line.asset.AssetName, AmountCents: line.amount, OpeningAccumulatedCents: line.asset.AccumulatedDepreciationCents, ClosingAccumulatedCents: line.asset.AccumulatedDepreciationCents + line.amount, Remark: optionalText(line.input.Remark)}); err != nil {
				return err
			}
		}
	case EntityAssetSale:
		params := dbsqlc.InsertVouAssetSaleDetailParams{DocumentID: documentID, CounterpartyEntity: draft.counterpartyType, CounterpartyObjectID: draft.counterparty.ObjectID, CounterpartyVersionID: draft.counterparty.VersionID, CounterpartyCode: draft.counterparty.Code, CounterpartyName: draft.counterparty.Data.Name}
		if update {
			if err := oneRow(q.UpdateVouAssetSaleDetail(ctx, dbsqlc.UpdateVouAssetSaleDetailParams{CounterpartyEntity: params.CounterpartyEntity, CounterpartyObjectID: params.CounterpartyObjectID, CounterpartyVersionID: params.CounterpartyVersionID, CounterpartyCode: params.CounterpartyCode, CounterpartyName: params.CounterpartyName, DocumentID: documentID})); err != nil {
				return err
			}
		} else if err := q.InsertVouAssetSaleDetail(ctx, params); err != nil {
			return err
		}
		if err := q.DeleteVouAssetSaleLines(ctx, documentID); err != nil {
			return err
		}
		for i, line := range draft.sales {
			if err := q.InsertVouAssetSaleLine(ctx, dbsqlc.InsertVouAssetSaleLineParams{ID: newID(), DocumentID: documentID, LineNo: int32(i + 1), AssetID: line.asset.ID, AssetNo: line.asset.AssetNo, AssetName: line.asset.AssetName, SaleAmountCents: line.amount, Remark: optionalText(line.input.Remark)}); err != nil {
				return err
			}
		}
	case EntityAssetLiquidation:
		if !update {
			if err := q.InsertVouAssetLiquidationDetail(ctx, documentID); err != nil {
				return err
			}
		}
		if err := q.DeleteVouAssetLiquidationLines(ctx, documentID); err != nil {
			return err
		}
		for i, line := range draft.liquidations {
			if err := q.InsertVouAssetLiquidationLine(ctx, dbsqlc.InsertVouAssetLiquidationLineParams{ID: newID(), DocumentID: documentID, LineNo: int32(i + 1), AssetID: line.asset.ID, AssetNo: line.asset.AssetNo, AssetName: line.asset.AssetName, Reason: line.input.Reason, SalvageIncomeCents: line.salvage, DisposalExpenseCents: line.expense, Remark: optionalText(line.input.Remark)}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) AssetDepreciationPreview(ctx context.Context, input AssetDepreciationPreviewInput) (AssetDepreciationPreviewView, error) {
	month, err := monthStart(input.DepreciationMonth)
	if err != nil {
		return AssetDepreciationPreviewView{}, err
	}
	assets, err := s.queries.ListDepreciableLedAssetsForVou(ctx, dbsqlc.ListDepreciableLedAssetsForVouParams{DepreciationMonth: dateValue(month), CategoryObjectID: input.CategoryObjectID, DepartmentObjectID: input.DepartmentObjectID})
	if err != nil {
		return AssetDepreciationPreviewView{}, s.internal("preview asset depreciation", err)
	}
	view := AssetDepreciationPreviewView{DepreciationMonth: month.Format("2006-01"), Items: make([]AssetDepreciationPreviewItem, 0, len(assets))}
	var total int64
	for _, asset := range assets {
		depreciable := asset.OriginalValueCents - asset.ResidualValueCents
		remaining := depreciable - asset.AccumulatedDepreciationCents
		amount := (depreciable + int64(asset.UsefulLifeMonths)/2) / int64(asset.UsefulLifeMonths)
		if amount < 1 {
			amount = 1
		}
		if amount > remaining {
			amount = remaining
		}
		total += amount
		view.Items = append(view.Items, AssetDepreciationPreviewItem{AssetID: asset.ID, AssetNo: asset.AssetNo, AssetName: asset.AssetName, Category: *reference(asset.CategoryObjectID, asset.CategoryVersionID, auxdomain.EntityAssetCategory, asset.CategoryCode, asset.CategoryName, "", "", ""), Department: *reference(asset.DepartmentObjectID, asset.DepartmentVersionID, auxdomain.EntityDepartment, asset.DepartmentCode, asset.DepartmentName, "", "", ""), OriginalValue: formatMoney(asset.OriginalValueCents), AccumulatedDepreciation: formatMoney(asset.AccumulatedDepreciationCents), DepreciationAmount: formatMoney(amount), NetValue: formatMoney(asset.OriginalValueCents - asset.AccumulatedDepreciationCents - amount)})
	}
	view.TotalAmount = formatMoney(total)
	return view, nil
}

func (s *Service) loadAssetData(ctx context.Context, q *dbsqlc.Queries, document dbsqlc.VouDocument, data DocumentDataView) (DocumentDataView, error) {
	switch document.Entity {
	case EntityAssetAcquisition:
		detail, err := q.GetVouAssetAcquisitionDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Supplier = reference(detail.SupplierObjectID, detail.SupplierVersionID, bobdomain.EntitySupplier, detail.SupplierCode, detail.SupplierName, "", "", "")
		rows, err := q.ListVouAssetAcquisitionLines(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.AssetAcquisitionLines = make([]AssetAcquisitionLineView, 0, len(rows))
		for _, row := range rows {
			item := AssetAcquisitionLineView{LineID: row.ID, LineNo: row.LineNo, AssetName: row.AssetName, Specification: row.Specification, Category: *reference(row.CategoryObjectID, row.CategoryVersionID, auxdomain.EntityAssetCategory, row.CategoryCode, row.CategoryName, "", "", ""), OriginalValue: formatMoney(row.OriginalValueCents), UsefulLifeMonths: row.UsefulLifeMonths, ResidualRate: formatFixed(int64(row.ResidualRateBps), 2), Department: *reference(row.DepartmentObjectID, row.DepartmentVersionID, auxdomain.EntityDepartment, row.DepartmentCode, row.DepartmentName, "", "", ""), Location: row.Location, Remark: deref(row.Remark)}
			if row.CustodianObjectID != nil {
				item.Custodian = reference(deref(row.CustodianObjectID), deref(row.CustodianVersionID), bobdomain.EntityEmployee, deref(row.CustodianCode), deref(row.CustodianName), "", "", "")
			}
			data.AssetAcquisitionLines = append(data.AssetAcquisitionLines, item)
		}
	case EntityAssetDepreciation:
		detail, err := q.GetVouAssetDepreciationDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.DepreciationMonth = detail.DepreciationMonth.Time.Format("2006-01")
		rows, err := q.ListVouAssetDepreciationLines(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.AssetDepreciationLines = make([]AssetDepreciationLineView, 0, len(rows))
		for _, row := range rows {
			data.AssetDepreciationLines = append(data.AssetDepreciationLines, AssetDepreciationLineView{LineID: row.ID, LineNo: row.LineNo, AssetID: row.AssetID, AssetNo: row.AssetNo, AssetName: row.AssetName, Amount: formatMoney(row.AmountCents), OpeningAccumulated: formatMoney(row.OpeningAccumulatedCents), ClosingAccumulated: formatMoney(row.ClosingAccumulatedCents), Remark: deref(row.Remark)})
		}
	case EntityAssetSale:
		detail, err := q.GetVouAssetSaleDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Counterparty = reference(detail.CounterpartyObjectID, detail.CounterpartyVersionID, detail.CounterpartyEntity, detail.CounterpartyCode, detail.CounterpartyName, "", "", "")
		rows, err := q.ListVouAssetSaleLines(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.AssetSaleLines = make([]AssetSaleLineView, 0, len(rows))
		for _, row := range rows {
			data.AssetSaleLines = append(data.AssetSaleLines, AssetSaleLineView{LineID: row.ID, LineNo: row.LineNo, AssetID: row.AssetID, AssetNo: row.AssetNo, AssetName: row.AssetName, SaleAmount: formatMoney(row.SaleAmountCents), Remark: deref(row.Remark)})
		}
	case EntityAssetLiquidation:
		rows, err := q.ListVouAssetLiquidationLines(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.AssetLiquidationLines = make([]AssetLiquidationLineView, 0, len(rows))
		for _, row := range rows {
			data.AssetLiquidationLines = append(data.AssetLiquidationLines, AssetLiquidationLineView{LineID: row.ID, LineNo: row.LineNo, AssetID: row.AssetID, AssetNo: row.AssetNo, AssetName: row.AssetName, Reason: row.Reason, SalvageIncome: formatMoney(row.SalvageIncomeCents), DisposalExpense: formatMoney(row.DisposalExpenseCents), Remark: deref(row.Remark)})
		}
	}
	return data, nil
}
