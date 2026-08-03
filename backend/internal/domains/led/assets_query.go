package led

import (
	"context"
	"errors"
	"slices"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func assetView(row dbsqlc.LedAsset) AssetView {
	view := AssetView{AssetID: row.ID, AssetNo: row.AssetNo, AssetName: row.AssetName, Specification: row.Specification,
		Category:   ReferenceView{ObjectID: row.CategoryObjectID, VersionID: row.CategoryVersionID, Entity: "asset-category", Code: row.CategoryCode, Name: row.CategoryName},
		Department: ReferenceView{ObjectID: row.DepartmentObjectID, VersionID: row.DepartmentVersionID, Entity: "department", Code: row.DepartmentCode, Name: row.DepartmentName},
		Location:   row.Location, AcquisitionDate: formatDate(row.AcquisitionDate), DepreciationStartMonth: formatDate(row.DepreciationStartMonth),
		OriginalValue: formatMoney(row.OriginalValueCents), ResidualValue: formatMoney(row.ResidualValueCents), UsefulLifeMonths: row.UsefulLifeMonths,
		AccumulatedDepreciation: formatMoney(row.AccumulatedDepreciationCents), NetValue: formatMoney(row.OriginalValueCents - row.AccumulatedDepreciationCents),
		LastDepreciationMonth: formatDate(row.LastDepreciationMonth), Status: row.Status, Remark: deref(row.Remark)}
	if row.CustodianObjectID != nil {
		view.Custodian = &ReferenceView{ObjectID: deref(row.CustodianObjectID), VersionID: deref(row.CustodianVersionID), Entity: "employee", Code: deref(row.CustodianCode), Name: deref(row.CustodianName)}
	}
	return view
}

func (s *Service) QueryAssets(ctx context.Context, input AssetQueryInput) (Page[AssetView], error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return Page[AssetView]{}, domainError(ErrorValidation, "invalid asset query", nil, nil)
	}
	for _, status := range input.Filters.Status {
		if !slices.Contains([]string{"ACTIVE", "SOLD", "RETIRED"}, status) {
			return Page[AssetView]{}, domainError(ErrorValidation, "invalid asset status", nil, nil)
		}
	}
	params := dbsqlc.CountLedAssetsParams{Keyword: strings.TrimSpace(input.Filters.Keyword), Statuses: input.Filters.Status, CategoryObjectID: input.Filters.CategoryObjectID, DepartmentObjectID: input.Filters.DepartmentObjectID, CustodianObjectID: input.Filters.CustodianObjectID}
	total, err := s.queries.CountLedAssets(ctx, params)
	if err != nil {
		return Page[AssetView]{}, s.internal("count assets", err)
	}
	rows, err := s.queries.ListLedAssets(ctx, dbsqlc.ListLedAssetsParams{Keyword: params.Keyword, Statuses: params.Statuses, CategoryObjectID: params.CategoryObjectID, DepartmentObjectID: params.DepartmentObjectID, CustodianObjectID: params.CustodianObjectID, PageSize: int32(input.PageSize), PageOffset: int32((input.Page - 1) * input.PageSize)})
	if err != nil {
		return Page[AssetView]{}, s.internal("list assets", err)
	}
	items := make([]AssetView, 0, len(rows))
	for _, row := range rows {
		items = append(items, assetView(row))
	}
	return Page[AssetView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) GetAsset(ctx context.Context, input AssetGetInput) (AssetDetailView, error) {
	if !validID(input.AssetID) {
		return AssetDetailView{}, domainError(ErrorValidation, "invalid assetId", nil, nil)
	}
	asset, err := s.queries.GetActiveLedAsset(ctx, input.AssetID)
	if errors.Is(err, pgx.ErrNoRows) {
		return AssetDetailView{}, domainError(ErrorValidation, "asset not found", nil, nil)
	}
	if err != nil {
		return AssetDetailView{}, s.internal("get asset", err)
	}
	rows, err := s.queries.ListLedAssetHistory(ctx, input.AssetID)
	if err != nil {
		return AssetDetailView{}, s.internal("list asset history", err)
	}
	history := make([]AssetHistoryView, 0, len(rows))
	for _, row := range rows {
		history = append(history, AssetHistoryView{ID: row.ID, EntryType: row.EntryType, SourceEntity: row.SourceEntity, SourceDocumentID: row.SourceDocumentID, SourceDocumentNo: row.SourceDocumentNo, EffectiveDate: formatDate(row.EffectiveDate), Amount: formatMoney(row.AmountCents), StatusFrom: deref(row.StatusFrom), StatusTo: row.StatusTo, OccurredAt: row.OccurredAt.Time, Summary: row.Summary})
	}
	return AssetDetailView{Asset: assetView(asset), History: history}, nil
}
