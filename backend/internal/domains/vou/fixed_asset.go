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
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

func isAssetEntity(entity string) bool {
	switch entity {
	case EntityAssetAcquisition, EntityAssetSale, EntityAssetLiquidation:
		return true
	default:
		return false
	}
}

type preparedAssetAcquisitionLine struct {
	input                           AssetAcquisitionLineInput
	category, department            bobdomain.AuxiliaryReference
	custodian                       *bobdomain.EffectiveReference
	originalValue                   int64
	residualRateBps                 int32
	categoryDefaultUsefulLifeMonths int32
	categoryDefaultResidualRateBps  int32
}

type preparedAssetSaleLine struct {
	input  AssetSaleLineInput
	asset  dbsqlc.GetActiveAccountingAssetForVouRow
	amount int64
}

type preparedAssetLiquidationLine struct {
	input            AssetLiquidationLineInput
	asset            dbsqlc.GetActiveAccountingAssetForVouRow
	salvage, expense int64
}

type preparedAssetDraft struct {
	businessDate           time.Time
	remark                 *string
	total                  int64
	supplier, counterparty *bobdomain.EffectiveReference
	counterpartyType       string
	acquisitions           []preparedAssetAcquisitionLine
	sales                  []preparedAssetSaleLine
	liquidations           []preparedAssetLiquidationLine
}

func (s *Service) AvailableAssets(ctx context.Context, input AvailableAssetQueryInput) (Page[AvailableAssetItem], error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return Page[AvailableAssetItem]{}, domainError(ErrorValidation, "invalid available asset query", nil, nil)
	}
	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM acc_assets WHERE state='ACTIVE'`).Scan(&total); err != nil {
		return Page[AvailableAssetItem]{}, s.internal("count available accounting assets", err)
	}
	rows, err := s.pool.Query(ctx, `SELECT asset.id,asset.asset_no,asset.name,value.original_minor,
		value.accumulated_depreciation_minor
		FROM acc_assets asset
		JOIN acc_asset_book_values value ON value.asset_id=asset.id
		JOIN acc_books book ON book.id=value.book_id AND book.control_book
		WHERE asset.state='ACTIVE'
		ORDER BY asset.asset_no,asset.id
		LIMIT $1 OFFSET $2`, input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return Page[AvailableAssetItem]{}, s.internal("list available accounting assets", err)
	}
	defer rows.Close()
	items := make([]AvailableAssetItem, 0)
	for rows.Next() {
		var item AvailableAssetItem
		var original, accumulated int64
		if err = rows.Scan(&item.AssetID, &item.AssetNo, &item.AssetName, &original, &accumulated); err != nil {
			return Page[AvailableAssetItem]{}, s.internal("scan available accounting asset", err)
		}
		item.OriginalValue = formatMoney(original)
		item.AccumulatedDepreciation = formatMoney(accumulated)
		item.NetValue = formatMoney(original - accumulated)
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return Page[AvailableAssetItem]{}, s.internal("iterate available accounting assets", err)
	}
	return Page[AvailableAssetItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func validateAssetText(value, field string, required bool, max int) (string, error) {
	value = strings.TrimSpace(value)
	if (required && value == "") || utf8.RuneCountInString(value) > max {
		return "", domainError(ErrorValidation, field+" is invalid", nil, nil)
	}
	return value, nil
}

func (s *Service) resolveSelectedAssetCategoryReference(
	ctx context.Context,
	tx pgx.Tx,
	input *ReferenceInput,
	preserved *bobdomain.EffectiveReference,
	newDocument bool,
) (bobdomain.AuxiliaryReference, error) {
	var reference bobdomain.AuxiliaryReference
	var err error
	if !newDocument && preserved != nil && input.ObjectID == preserved.ObjectID && input.ApprovalEntryID == preserved.ApprovalEntryID {
		reference, err = s.auxResolver.ValidateApprovedAuxiliarySnapshotReference(ctx, tx, auxdomain.EntityAssetCategory, input.ObjectID, input.ApprovalEntryID)
	} else {
		reference, err = s.auxResolver.ResolveLatestApprovedAuxiliaryReference(ctx, tx, auxdomain.EntityAssetCategory, input.ObjectID)
		if err == nil && input.ApprovalEntryID != "" && input.ApprovalEntryID != reference.ApprovalEntryID {
			return bobdomain.AuxiliaryReference{}, domainError(ErrorConflict, "asset category reference does not match the latest approved version", nil, nil)
		}
	}
	if err != nil {
		return bobdomain.AuxiliaryReference{}, domainError(ErrorConflict, "asset category is not effective", nil, err)
	}
	return reference, nil
}

func (s *Service) prepareAssetDraft(ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, entity string, input DraftInput, saved *DocumentDataView) (preparedAssetDraft, error) {
	var result preparedAssetDraft
	if input.Currency != "CNY" {
		return result, domainError(ErrorValidation, "fixed asset currency must be CNY", nil, nil)
	}
	result.remark = optionalText(input.Remark)
	if result.remark != nil && utf8.RuneCountInString(*result.remark) > 1000 {
		return result, domainError(ErrorValidation, "remark is too long", nil, nil)
	}
	var err error
	result.businessDate, err = time.Parse(dateLayout, input.BusinessDate)
	if err != nil {
		return result, domainError(ErrorValidation, "invalid businessDate", nil, err)
	}
	switch entity {
	case EntityAssetAcquisition:
		if err = validateReference(input.Supplier, "supplier", true); err != nil {
			return result, err
		}
		var savedSupplier *bobdomain.EffectiveReference
		if saved != nil && saved.Supplier != nil {
			savedSupplier = &bobdomain.EffectiveReference{ObjectID: saved.Supplier.ObjectID, ApprovalEntryID: saved.Supplier.ApprovalEntryID}
		}
		resolvedSupplier, resolveErr := s.resolveSelectedReference(ctx, tx, bobdomain.EntitySupplier, input.Supplier, savedSupplier, saved == nil)
		if resolveErr != nil {
			return result, domainError(ErrorConflict, "supplier is not effective", nil, resolveErr)
		}
		result.supplier = resolvedSupplier
		if len(input.AssetAcquisitionLines) < 1 || len(input.AssetAcquisitionLines) > 200 {
			return result, domainError(ErrorValidation, "asset acquisition requires 1-200 lines", nil, nil)
		}
		for lineIndex, line := range input.AssetAcquisitionLines {
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
			var savedCategory, savedDepartment, savedCustodian *bobdomain.EffectiveReference
			if saved != nil && lineIndex < len(saved.AssetAcquisitionLines) {
				stored := saved.AssetAcquisitionLines[lineIndex]
				savedCategory = &bobdomain.EffectiveReference{ObjectID: stored.Category.ObjectID, ApprovalEntryID: stored.Category.ApprovalEntryID}
				savedDepartment = &bobdomain.EffectiveReference{ObjectID: stored.Department.ObjectID, ApprovalEntryID: stored.Department.ApprovalEntryID}
				if stored.Custodian != nil {
					savedCustodian = &bobdomain.EffectiveReference{ObjectID: stored.Custodian.ObjectID, ApprovalEntryID: stored.Custodian.ApprovalEntryID}
				}
			}
			categoryRef, auxErr := s.resolveSelectedAssetCategoryReference(ctx, tx, &line.Category, savedCategory, saved == nil)
			if auxErr != nil {
				return result, auxErr
			}
			categoryDefaultUsefulLifeMonths := auxiliaryInt32(categoryRef.Data, "defaultUsefulLifeMonths")
			categoryDefaultResidualRate, categoryDefaultRateErr := parseFixed(auxiliaryString(categoryRef.Data, "defaultResidualRate"), 2, true)
			if categoryDefaultRateErr != nil || categoryDefaultUsefulLifeMonths < 1 || categoryDefaultUsefulLifeMonths > 1200 || categoryDefaultResidualRate < 0 || categoryDefaultResidualRate >= 10000 {
				return result, domainError(ErrorConflict, "asset category defaults are invalid", nil, categoryDefaultRateErr)
			}
			departmentRef, auxErr := s.resolveSelectedAuxiliaryReference(ctx, tx, auxdomain.EntityDepartment, &line.Department, savedDepartment, saved == nil)
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
				resolvedCustodian, resolveErr := s.resolveSelectedReference(ctx, tx, bobdomain.EntityEmployee, line.Custodian, savedCustodian, saved == nil)
				if resolveErr != nil {
					return result, domainError(ErrorConflict, "custodian is not effective", nil, resolveErr)
				}
				custodian = resolvedCustodian
			}
			if result.total > math.MaxInt64-original {
				return result, domainError(ErrorValidation, "total amount is out of range", nil, nil)
			}
			result.total += original
			category := bobdomain.AuxiliaryReference{ObjectID: categoryRef.ObjectID, ApprovalEntryID: categoryRef.ApprovalEntryID, Entity: categoryRef.Entity, Code: categoryRef.Code, Data: map[string]any{"name": auxiliaryString(categoryRef.Data, "name")}}
			department := bobdomain.AuxiliaryReference{ObjectID: departmentRef.ObjectID, ApprovalEntryID: departmentRef.ApprovalEntryID, Entity: departmentRef.Entity, Code: departmentRef.Code, Data: map[string]any{"name": departmentRef.Data.Name}}
			result.acquisitions = append(result.acquisitions, preparedAssetAcquisitionLine{input: line, category: category, department: department, custodian: custodian, originalValue: original, residualRateBps: int32(rate), categoryDefaultUsefulLifeMonths: categoryDefaultUsefulLifeMonths, categoryDefaultResidualRateBps: int32(categoryDefaultResidualRate)})
		}
	case EntityAssetSale:
		if input.CounterpartyType != "customer-account" && input.CounterpartyType != "other-unit" {
			return result, domainError(ErrorValidation, "counterpartyType must be customer-account or other-unit", nil, nil)
		}
		if err = validateReference(input.Counterparty, "counterparty", true); err != nil {
			return result, err
		}
		var savedCounterparty *bobdomain.EffectiveReference
		if saved != nil && saved.Counterparty != nil {
			savedCounterparty = &bobdomain.EffectiveReference{ObjectID: saved.Counterparty.ObjectID, ApprovalEntryID: saved.Counterparty.ApprovalEntryID}
		}
		resolved, resolveErr := s.resolveSelectedReference(ctx, tx, input.CounterpartyType, input.Counterparty, savedCounterparty, saved == nil)
		if resolveErr != nil {
			return result, domainError(ErrorConflict, "counterparty is not effective", nil, resolveErr)
		}
		result.counterparty, result.counterpartyType = resolved, input.CounterpartyType
		if len(input.AssetSaleLines) < 1 || len(input.AssetSaleLines) > 200 {
			return result, domainError(ErrorValidation, "asset sale requires 1-200 lines", nil, nil)
		}
		seen := map[string]bool{}
		for _, line := range input.AssetSaleLines {
			if !validID(line.AssetID) || seen[line.AssetID] {
				return result, domainError(ErrorValidation, "assetId is invalid or duplicated", nil, nil)
			}
			seen[line.AssetID] = true
			asset, loadErr := q.GetActiveAccountingAssetForVou(ctx, line.AssetID)
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
			asset, loadErr := q.GetActiveAccountingAssetForVou(ctx, line.AssetID)
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

func validateAssetDisposal(asset dbsqlc.GetActiveAccountingAssetForVouRow, date time.Time) error {
	if asset.State != "ACTIVE" {
		return domainError(ErrorConflict, "asset is not active", map[string]any{"assetId": asset.ID}, nil)
	}
	if asset.AcquiredOn.Valid && date.Before(asset.AcquiredOn.Time) {
		return domainError(ErrorConflict, "asset cannot be disposed before acquisition", map[string]any{"assetId": asset.ID}, nil)
	}
	return nil
}

func auxName(ref bobdomain.AuxiliaryReference) string {
	value, _ := ref.Data["name"].(string)
	return value
}

func (s *Service) CreateAssetDocument(ctx context.Context, entity string, input CreateInput, actor approval.Actor) (MutationResult, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
	if !validID(actorID) || input.ParentEntity != "" || input.ParentDocumentID != "" {
		return MutationResult{}, domainError(ErrorValidation, "invalid asset create request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin asset create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	draft, err := s.prepareAssetDraft(ctx, tx, q, entity, input.Data, nil)
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
	entry, err := s.createDocumentApproval(ctx, tx, entity, id, actor)
	if err != nil {
		return MutationResult{}, err
	}
	if err = q.InsertVouDocument(ctx, dbsqlc.InsertVouDocumentParams{ID: id, Entity: entity, DocumentNo: no, ApprovalEntryID: entry.ID, BusinessDate: dateValue(draft.businessDate), Currency: stringPtr("CNY"), TotalAmountCents: draft.total, Remark: draft.remark}); err != nil {
		return MutationResult{}, s.writeError("insert asset document", err)
	}
	if err = s.writeAssetDraft(ctx, q, entity, id, draft, false); err != nil {
		return MutationResult{}, s.writeError("insert asset detail", err)
	}
	if err = s.events.Publish(ctx, tx, DocumentCreatedEvent{Entity: entity, DocumentID: id, DocumentNo: no, Revision: 1, ActorID: actorID, RequestID: requestID}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit asset create", err)
	}
	return MutationResult{DocumentID: id, DocumentNo: no, Approval: approval.MetaFromEntry(entry)}, nil
}

func (s *Service) SaveAssetDocument(ctx context.Context, entity string, input SaveInput, actor approval.Actor) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin asset save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := lockDocument(ctx, tx, input.DocumentID, entity)
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	coordinator, prepared, err := s.prepareDraftSave(ctx, tx, document, input.Revision, actor)
	if err != nil {
		return MutationResult{}, err
	}
	saved, err := s.loadData(ctx, q, document)
	if err != nil {
		return MutationResult{}, err
	}
	draft, err := s.prepareAssetDraft(ctx, tx, q, entity, input.Data, &saved)
	if err != nil {
		return MutationResult{}, err
	}
	if err = s.writeAssetDraft(ctx, q, entity, input.DocumentID, draft, true); err != nil {
		return MutationResult{}, s.writeError("update asset detail", err)
	}
	_, err = q.UpdateVouDraft(ctx, dbsqlc.UpdateVouDraftParams{BusinessDate: dateValue(draft.businessDate), Currency: stringPtr("CNY"), TotalAmountCents: draft.total, Remark: draft.remark, ID: input.DocumentID, Entity: entity})
	if err != nil {
		return MutationResult{}, s.writeError("update asset draft", err)
	}
	entry, err := s.commitDraftSave(ctx, tx, q, document, coordinator, prepared)
	if err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit asset save", err)
	}
	return MutationResult{DocumentID: input.DocumentID, DocumentNo: document.DocumentNo, Approval: approval.MetaFromEntry(entry)}, nil
}

func (s *Service) writeAssetDraft(ctx context.Context, q *dbsqlc.Queries, entity, documentID string, draft preparedAssetDraft, update bool) error {
	switch entity {
	case EntityAssetAcquisition:
		params := dbsqlc.InsertVouAssetAcquisitionDetailParams{DocumentID: documentID, SupplierObjectID: draft.supplier.ObjectID, SupplierApprovalEntryID: draft.supplier.ApprovalEntryID, SupplierCode: draft.supplier.Code, SupplierName: draft.supplier.Data.Name}
		if update {
			if err := oneRow(q.UpdateVouAssetAcquisitionDetail(ctx, dbsqlc.UpdateVouAssetAcquisitionDetailParams{SupplierObjectID: params.SupplierObjectID, SupplierApprovalEntryID: params.SupplierApprovalEntryID, SupplierCode: params.SupplierCode, SupplierName: params.SupplierName, DocumentID: documentID})); err != nil {
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
				custVersion = stringPtr(line.custodian.ApprovalEntryID)
				custCode = stringPtr(line.custodian.Code)
				custName = stringPtr(line.custodian.Data.Name)
			}
			if err := q.InsertVouAssetAcquisitionLine(ctx, dbsqlc.InsertVouAssetAcquisitionLineParams{ID: newID(), DocumentID: documentID, LineNo: int32(i + 1), AssetName: line.input.AssetName, Specification: line.input.Specification, CategoryObjectID: line.category.ObjectID, CategoryApprovalEntryID: line.category.ApprovalEntryID, CategoryCode: line.category.Code, CategoryName: auxName(line.category), CategoryDefaultUsefulLifeMonths: line.categoryDefaultUsefulLifeMonths, CategoryDefaultResidualRateBps: line.categoryDefaultResidualRateBps, OriginalValueCents: line.originalValue, UsefulLifeMonths: line.input.UsefulLifeMonths, ResidualRateBps: line.residualRateBps, DepartmentObjectID: line.department.ObjectID, DepartmentApprovalEntryID: line.department.ApprovalEntryID, DepartmentCode: line.department.Code, DepartmentName: auxName(line.department), CustodianObjectID: custID, CustodianApprovalEntryID: custVersion, CustodianCode: custCode, CustodianName: custName, Location: line.input.Location, Remark: optionalText(line.input.Remark)}); err != nil {
				return err
			}
		}
	case EntityAssetSale:
		params := dbsqlc.InsertVouAssetSaleDetailParams{DocumentID: documentID, CounterpartyEntity: draft.counterpartyType, CounterpartyObjectID: draft.counterparty.ObjectID, CounterpartyApprovalEntryID: draft.counterparty.ApprovalEntryID, CounterpartyCode: draft.counterparty.Code, CounterpartyName: draft.counterparty.Data.Name}
		if update {
			if err := oneRow(q.UpdateVouAssetSaleDetail(ctx, dbsqlc.UpdateVouAssetSaleDetailParams{CounterpartyEntity: params.CounterpartyEntity, CounterpartyObjectID: params.CounterpartyObjectID, CounterpartyApprovalEntryID: params.CounterpartyApprovalEntryID, CounterpartyCode: params.CounterpartyCode, CounterpartyName: params.CounterpartyName, DocumentID: documentID})); err != nil {
				return err
			}
		} else if err := q.InsertVouAssetSaleDetail(ctx, params); err != nil {
			return err
		}
		if err := q.DeleteVouAssetSaleLines(ctx, documentID); err != nil {
			return err
		}
		for i, line := range draft.sales {
			if err := q.InsertVouAssetSaleLine(ctx, dbsqlc.InsertVouAssetSaleLineParams{ID: newID(), DocumentID: documentID, LineNo: int32(i + 1), AssetID: line.asset.ID, AssetNo: line.asset.AssetNo, AssetName: line.asset.Name, SaleAmountCents: line.amount, Remark: optionalText(line.input.Remark)}); err != nil {
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
			if err := q.InsertVouAssetLiquidationLine(ctx, dbsqlc.InsertVouAssetLiquidationLineParams{ID: newID(), DocumentID: documentID, LineNo: int32(i + 1), AssetID: line.asset.ID, AssetNo: line.asset.AssetNo, AssetName: line.asset.Name, Reason: line.input.Reason, SalvageIncomeCents: line.salvage, DisposalExpenseCents: line.expense, Remark: optionalText(line.input.Remark)}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) loadAssetData(ctx context.Context, q *dbsqlc.Queries, document documentRecord, data DocumentDataView) (DocumentDataView, error) {
	switch document.Entity {
	case EntityAssetAcquisition:
		detail, err := q.GetVouAssetAcquisitionDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Supplier = reference(detail.SupplierObjectID, detail.SupplierApprovalEntryID, bobdomain.EntitySupplier, detail.SupplierCode, detail.SupplierName, "", "", "")
		rows, err := q.ListVouAssetAcquisitionLines(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.AssetAcquisitionLines = make([]AssetAcquisitionLineView, 0, len(rows))
		for _, row := range rows {
			item := AssetAcquisitionLineView{LineID: row.ID, LineNo: row.LineNo, AssetName: row.AssetName, Specification: row.Specification, Category: *reference(row.CategoryObjectID, row.CategoryApprovalEntryID, auxdomain.EntityAssetCategory, row.CategoryCode, row.CategoryName, "", "", ""), CategoryDefaultUsefulLifeMonths: row.CategoryDefaultUsefulLifeMonths, CategoryDefaultResidualRate: formatFixed(int64(row.CategoryDefaultResidualRateBps), 2), OriginalValue: formatMoney(row.OriginalValueCents), UsefulLifeMonths: row.UsefulLifeMonths, ResidualRate: formatFixed(int64(row.ResidualRateBps), 2), Department: *reference(row.DepartmentObjectID, row.DepartmentApprovalEntryID, auxdomain.EntityDepartment, row.DepartmentCode, row.DepartmentName, "", "", ""), Location: row.Location, Remark: deref(row.Remark)}
			if row.CustodianObjectID != nil {
				item.Custodian = reference(deref(row.CustodianObjectID), deref(row.CustodianApprovalEntryID), bobdomain.EntityEmployee, deref(row.CustodianCode), deref(row.CustodianName), "", "", "")
			}
			data.AssetAcquisitionLines = append(data.AssetAcquisitionLines, item)
		}
	case EntityAssetSale:
		detail, err := q.GetVouAssetSaleDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Counterparty = reference(detail.CounterpartyObjectID, detail.CounterpartyApprovalEntryID, detail.CounterpartyEntity, detail.CounterpartyCode, detail.CounterpartyName, "", "", "")
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
