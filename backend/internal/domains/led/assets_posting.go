package led

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/jackc/pgx/v5"
)

func residualValue(original int64, rateBps int32) int64 {
	return (original*int64(rateBps) + 5000) / 10000
}

func nextMonth(date time.Time) time.Time {
	return time.Date(date.Year(), date.Month()+1, 1, 0, 0, 0, 0, time.UTC)
}

func (s *Service) postAssetDocument(ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, posting postingContext) error {
	doc := posting.Document
	include, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil {
		return err
	}
	switch doc.Entity {
	case voudomain.EntityAssetAcquisition:
		detail, loadErr := q.GetVouAssetAcquisitionDetail(ctx, doc.ID)
		if loadErr != nil {
			return s.internal("read asset acquisition detail", loadErr)
		}
		lines, loadErr := q.ListVouAssetAcquisitionLines(ctx, doc.ID)
		if loadErr != nil {
			return s.internal("read asset acquisition lines", loadErr)
		}
		for _, line := range lines {
			assetNo, numberErr := q.FindLedAssetNoBySourceLine(ctx, line.ID)
			if errors.Is(numberErr, pgx.ErrNoRows) {
				counter, counterErr := q.NextLedAssetNumber(ctx, doc.BusinessDate)
				if counterErr != nil {
					return s.writeError("allocate asset number", counterErr)
				}
				assetNo = fmt.Sprintf("AST-%s-%04d", doc.BusinessDate.Time.Format("20060102"), counter)
				if assignErr := q.InsertLedAssetNumberAssignment(ctx, dbsqlc.InsertLedAssetNumberAssignmentParams{SourceLineID: line.ID, AssetNo: assetNo}); assignErr != nil {
					return s.writeError("save asset number", assignErr)
				}
			} else if numberErr != nil {
				return numberErr
			}
			if err = q.InsertLedAsset(ctx, dbsqlc.InsertLedAssetParams{
				GenerationID: posting.GenerationID, ID: line.ID, AssetNo: assetNo, AssetName: line.AssetName,
				Specification: line.Specification, CategoryObjectID: line.CategoryObjectID,
				CategoryVersionID: line.CategoryVersionID, CategoryCode: line.CategoryCode, CategoryName: line.CategoryName,
				DepartmentObjectID: line.DepartmentObjectID, DepartmentVersionID: line.DepartmentVersionID,
				DepartmentCode: line.DepartmentCode, DepartmentName: line.DepartmentName,
				CustodianObjectID: line.CustodianObjectID, CustodianVersionID: line.CustodianVersionID,
				CustodianCode: line.CustodianCode, CustodianName: line.CustodianName, Location: line.Location,
				AcquisitionDate: doc.BusinessDate, DepreciationStartMonth: dateValue(nextMonth(doc.BusinessDate.Time)),
				OriginalValueCents: line.OriginalValueCents, ResidualValueCents: residualValue(line.OriginalValueCents, line.ResidualRateBps),
				UsefulLifeMonths: line.UsefulLifeMonths, SourceDocumentID: doc.ID, SourceLineID: line.ID,
				SourceRevision: posting.SourceRevision, Remark: preferredRemark(line.Remark, doc.Remark),
			}); err != nil {
				return s.writeError("create asset card", err)
			}
			summary, _ := json.Marshal(map[string]any{"assetNo": assetNo, "originalValue": line.OriginalValueCents})
			if err = q.InsertLedAssetEntry(ctx, dbsqlc.InsertLedAssetEntryParams{ID: newID(), GenerationID: posting.GenerationID, AssetID: line.ID, EntryType: "ACQUISITION", SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceDocumentNo: doc.DocumentNo, SourceLineID: line.ID, SourceRevision: posting.SourceRevision, EffectiveDate: doc.BusinessDate, OccurredAt: posting.OccurredAt, AmountCents: line.OriginalValueCents, StatusTo: "ACTIVE", ActorID: posting.ActorID, RequestID: posting.RequestID, Summary: summary}); err != nil {
				return s.writeError("post asset acquisition", err)
			}
			if include {
				if detail.PartyAccountType == "TRADE" {
					err = q.InsertLedPartyEntry(ctx, partyParams(posting, doc, line.ID, doc.BusinessDate,
						detail.SupplierObjectID, detail.SupplierVersionID, detail.SupplierCode, detail.SupplierName,
						"supplier", -line.OriginalValueCents))
				} else {
					err = q.InsertLedOtherEntry(ctx, otherPartyParams(posting, doc, line.ID, doc.BusinessDate,
						detail.SupplierObjectID, detail.SupplierVersionID, detail.SupplierCode, detail.SupplierName,
						"supplier", -line.OriginalValueCents, nil))
				}
				if err != nil {
					return s.writeError("post asset acquisition payable", err)
				}
			}
		}
	case voudomain.EntityAssetDepreciation:
		lines, loadErr := q.ListVouAssetDepreciationLines(ctx, doc.ID)
		if loadErr != nil {
			return s.internal("read asset depreciation lines", loadErr)
		}
		for _, line := range lines {
			asset, lockErr := q.LockLedAsset(ctx, dbsqlc.LockLedAssetParams{GenerationID: posting.GenerationID, AssetID: line.AssetID})
			if lockErr != nil {
				return domainError(ErrorConflict, "asset is unavailable", nil, lockErr)
			}
			if asset.Status != "ACTIVE" || asset.AccumulatedDepreciationCents != line.OpeningAccumulatedCents {
				return domainError(ErrorConflict, "asset depreciation state changed", map[string]any{"assetId": line.AssetID}, nil)
			}
			rows, applyErr := q.ApplyLedAssetDepreciation(ctx, dbsqlc.ApplyLedAssetDepreciationParams{AmountCents: line.AmountCents, DepreciationMonth: line.DepreciationMonth, GenerationID: posting.GenerationID, AssetID: line.AssetID, OpeningAccumulatedCents: line.OpeningAccumulatedCents})
			if applyErr != nil || rows != 1 {
				return s.writeError("apply asset depreciation", applyErr)
			}
			if err = q.InsertLedAssetEntry(ctx, dbsqlc.InsertLedAssetEntryParams{ID: newID(), GenerationID: posting.GenerationID, AssetID: line.AssetID, EntryType: "DEPRECIATION", SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceDocumentNo: doc.DocumentNo, SourceLineID: line.ID, SourceRevision: posting.SourceRevision, EffectiveDate: line.DepreciationMonth, OccurredAt: posting.OccurredAt, AmountCents: line.AmountCents, StatusFrom: stringPtr("ACTIVE"), StatusTo: "ACTIVE", ActorID: posting.ActorID, RequestID: posting.RequestID, Summary: []byte(`{}`)}); err != nil {
				return s.writeError("post asset depreciation", err)
			}
		}
	case voudomain.EntityAssetSale:
		detail, loadErr := q.GetVouAssetSaleDetail(ctx, doc.ID)
		if loadErr != nil {
			return s.internal("read asset sale detail", loadErr)
		}
		lines, loadErr := q.ListVouAssetSaleLines(ctx, doc.ID)
		if loadErr != nil {
			return loadErr
		}
		for _, line := range lines {
			if _, lockErr := q.LockLedAsset(ctx, dbsqlc.LockLedAssetParams{GenerationID: posting.GenerationID, AssetID: line.AssetID}); lockErr != nil {
				return domainError(ErrorConflict, "asset is unavailable", nil, lockErr)
			}
			rows, setErr := q.SetLedAssetStatus(ctx, dbsqlc.SetLedAssetStatusParams{Status: "SOLD", GenerationID: posting.GenerationID, AssetID: line.AssetID})
			if setErr != nil || rows != 1 {
				return domainError(ErrorConflict, "asset is not active", nil, setErr)
			}
			if err = q.InsertLedAssetEntry(ctx, dbsqlc.InsertLedAssetEntryParams{ID: newID(), GenerationID: posting.GenerationID, AssetID: line.AssetID, EntryType: "SALE", SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceDocumentNo: doc.DocumentNo, SourceLineID: line.ID, SourceRevision: posting.SourceRevision, EffectiveDate: doc.BusinessDate, OccurredAt: posting.OccurredAt, AmountCents: line.SaleAmountCents, StatusFrom: stringPtr("ACTIVE"), StatusTo: "SOLD", ActorID: posting.ActorID, RequestID: posting.RequestID, Summary: []byte(`{}`)}); err != nil {
				return err
			}
			if include {
				if detail.PartyAccountType == "TRADE" {
					err = q.InsertLedPartyEntry(ctx, partyParams(posting, doc, line.ID, doc.BusinessDate,
						detail.CounterpartyObjectID, detail.CounterpartyVersionID, detail.CounterpartyCode,
						detail.CounterpartyName, detail.CounterpartyEntity, line.SaleAmountCents))
				} else {
					err = q.InsertLedOtherEntry(ctx, otherPartyParams(posting, doc, line.ID, doc.BusinessDate,
						detail.CounterpartyObjectID, detail.CounterpartyVersionID, detail.CounterpartyCode,
						detail.CounterpartyName, detail.CounterpartyEntity, line.SaleAmountCents, nil))
				}
				if err != nil {
					return s.writeError("post asset sale receivable", err)
				}
			}
		}
	case voudomain.EntityAssetLiquidation:
		lines, loadErr := q.ListVouAssetLiquidationLines(ctx, doc.ID)
		if loadErr != nil {
			return loadErr
		}
		for _, line := range lines {
			if _, lockErr := q.LockLedAsset(ctx, dbsqlc.LockLedAssetParams{GenerationID: posting.GenerationID, AssetID: line.AssetID}); lockErr != nil {
				return domainError(ErrorConflict, "asset is unavailable", nil, lockErr)
			}
			rows, setErr := q.SetLedAssetStatus(ctx, dbsqlc.SetLedAssetStatusParams{Status: "RETIRED", GenerationID: posting.GenerationID, AssetID: line.AssetID})
			if setErr != nil || rows != 1 {
				return domainError(ErrorConflict, "asset is not active", nil, setErr)
			}
			summary, _ := json.Marshal(map[string]any{"reason": line.Reason, "salvageIncome": line.SalvageIncomeCents, "disposalExpense": line.DisposalExpenseCents})
			if err = q.InsertLedAssetEntry(ctx, dbsqlc.InsertLedAssetEntryParams{ID: newID(), GenerationID: posting.GenerationID, AssetID: line.AssetID, EntryType: "LIQUIDATION", SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceDocumentNo: doc.DocumentNo, SourceLineID: line.ID, SourceRevision: posting.SourceRevision, EffectiveDate: doc.BusinessDate, OccurredAt: posting.OccurredAt, AmountCents: line.SalvageIncomeCents - line.DisposalExpenseCents, StatusFrom: stringPtr("ACTIVE"), StatusTo: "RETIRED", ActorID: posting.ActorID, RequestID: posting.RequestID, Summary: summary}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) reverseAssetDocument(ctx context.Context, q *dbsqlc.Queries, generationID, entity, documentID string) error {
	var err error
	switch entity {
	case voudomain.EntityAssetAcquisition:
		lines, loadErr := q.ListVouAssetAcquisitionLines(ctx, documentID)
		if loadErr != nil {
			return loadErr
		}
		for _, line := range lines {
			later, checkErr := q.HasLaterLedAssetEntries(ctx, dbsqlc.HasLaterLedAssetEntriesParams{GenerationID: generationID, AssetID: line.ID, SourceDocumentID: documentID, EffectiveDate: dateValue(time.Time{})})
			if checkErr != nil {
				return checkErr
			}
			if later {
				return domainError(ErrorConflict, "asset has later depreciation or disposal", map[string]any{"assetId": line.ID}, nil)
			}
		}
		if err = q.DeleteLedAssetsBySource(ctx, dbsqlc.DeleteLedAssetsBySourceParams{GenerationID: generationID, SourceDocumentID: documentID}); err != nil {
			return err
		}
	case voudomain.EntityAssetDepreciation:
		lines, loadErr := q.ListVouAssetDepreciationLines(ctx, documentID)
		if loadErr != nil {
			return loadErr
		}
		for _, line := range lines {
			later, checkErr := q.HasLaterLedAssetEntries(ctx, dbsqlc.HasLaterLedAssetEntriesParams{GenerationID: generationID, AssetID: line.AssetID, SourceDocumentID: documentID, EffectiveDate: line.DepreciationMonth})
			if checkErr != nil {
				return checkErr
			}
			if later {
				return domainError(ErrorConflict, "asset has later depreciation or disposal", map[string]any{"assetId": line.AssetID}, nil)
			}
		}
		rows, reverseErr := q.ReverseLedAssetDepreciation(ctx, dbsqlc.ReverseLedAssetDepreciationParams{SourceDocumentID: documentID, GenerationID: generationID})
		if reverseErr != nil || rows != int64(len(lines)) {
			return s.writeError("reverse asset depreciation", reverseErr)
		}
	case voudomain.EntityAssetSale, voudomain.EntityAssetLiquidation:
		if _, restoreErr := q.RestoreLedAssetStatusBySource(ctx, dbsqlc.RestoreLedAssetStatusBySourceParams{GenerationID: generationID, SourceDocumentID: documentID}); restoreErr != nil {
			return restoreErr
		}
	}
	return q.DeleteLedAssetEntriesBySource(ctx, dbsqlc.DeleteLedAssetEntriesBySourceParams{GenerationID: generationID, SourceDocumentID: documentID})
}
