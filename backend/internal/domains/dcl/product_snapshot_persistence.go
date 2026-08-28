package dcl

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
)

// DCL owns every mutable Product declaration snapshot. BOB may read these
// rows through its current projection, but it never creates or changes them.
func storeProductSnapshot(ctx context.Context, q *dbsqlc.Queries, approvalEntryID string, data bobdomain.DetailView) error {
	if err := q.InsertDCLProductSnapshot(ctx, dbsqlc.InsertDCLProductSnapshotParams{ApprovalEntryID: approvalEntryID, Name: data.Name}); err != nil {
		return err
	}
	return updateProductSnapshot(ctx, q, approvalEntryID, data)
}

func updateProductSnapshot(ctx context.Context, q *dbsqlc.Queries, approvalEntryID string, data bobdomain.DetailView) error {
	packaging, err := productPackagingSpecMicros(data)
	if err != nil {
		return err
	}
	rows, err := q.UpdateDCLProductSnapshot(ctx, dbsqlc.UpdateDCLProductSnapshotParams{
		Name: data.Name, CategoryID: nilIfEmpty(data.CategoryID), CategoryCode: nilIfEmpty(data.CategoryCode), CategoryName: nilIfEmpty(data.CategoryName),
		Specification: nilIfEmpty(data.Specification), Model: nilIfEmpty(data.Model), Barcode: nilIfEmpty(data.Barcode), Remark: nilIfEmpty(data.Remark),
		PricingUnitID: nilIfEmpty(data.PricingUnitID), DefaultPackagingSpecMicros: packaging,
		ProductTypeID: nilIfEmpty(data.ProductTypeID), ProductTypeCode: nilIfEmpty(data.ProductTypeCode), ProductTypeName: nilIfEmpty(data.ProductTypeName),
		BehaviorProfile: nilIfEmpty(data.BehaviorProfile), DefaultInputUnitID: nilIfEmpty(data.DefaultInputUnitID), Enabled: data.Enabled,
		ApprovalEntryID: approvalEntryID,
	})
	if err != nil {
		return err
	}
	if rows != 1 {
		return newError(ErrorConflict, "product_snapshot_changed", "product declaration snapshot changed", nil, nil)
	}
	if err = q.DeleteDCLProductUnitConversions(ctx, approvalEntryID); err != nil {
		return err
	}
	if err = insertProductUnitConversions(ctx, q, approvalEntryID, data.UnitConversions); err != nil {
		return err
	}
	if err = q.DeleteDCLProductFormula(ctx, approvalEntryID); err != nil {
		return err
	}
	return insertProductFormulaSnapshot(ctx, q, approvalEntryID, data.Formula)
}

func copyProductSnapshot(ctx context.Context, q *dbsqlc.Queries, newApprovalEntryID, sourceApprovalEntryID string) error {
	if err := q.CopyDCLProductSnapshot(ctx, dbsqlc.CopyDCLProductSnapshotParams{NewApprovalEntryID: newApprovalEntryID, SourceApprovalEntryID: sourceApprovalEntryID}); err != nil {
		return err
	}
	source, err := bobdomain.LoadDCLProductSnapshot(ctx, q, sourceApprovalEntryID)
	if err != nil {
		return err
	}
	if err = insertProductUnitConversions(ctx, q, newApprovalEntryID, source.UnitConversions); err != nil {
		return err
	}
	return insertProductFormulaSnapshot(ctx, q, newApprovalEntryID, source.Formula)
}

func deleteProductSnapshot(ctx context.Context, q *dbsqlc.Queries, approvalEntryID string) (int64, error) {
	if err := q.DeleteDCLProductFormula(ctx, approvalEntryID); err != nil {
		return 0, err
	}
	if err := q.DeleteDCLProductUnitConversions(ctx, approvalEntryID); err != nil {
		return 0, err
	}
	return q.DeleteDCLProductSnapshot(ctx, approvalEntryID)
}

func productPackagingSpecMicros(data bobdomain.DetailView) (*int64, error) {
	if data.BehaviorProfile == bobdomain.ProductBehaviorPackaging || data.DefaultPackagingSpec == "" {
		return nil, nil
	}
	value, err := fixeddecimal.ParsePositive(data.DefaultPackagingSpec, 6, false)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func insertProductUnitConversions(ctx context.Context, q *dbsqlc.Queries, approvalEntryID string, conversions []bobdomain.ProductUnitConversion) error {
	for _, conversion := range conversions {
		factor, err := fixeddecimal.ParsePositive(conversion.Factor, 6, false)
		if err != nil {
			return err
		}
		if err = q.InsertDCLProductUnitConversion(ctx, dbsqlc.InsertDCLProductUnitConversionParams{
			ProductApprovalEntryID: approvalEntryID, UnitObjectID: conversion.Unit.ObjectID,
			UnitCode: conversion.Unit.Code, UnitName: conversion.Unit.Name, UnitSymbol: conversion.Unit.Symbol,
			UnitQuantityScale: conversion.Unit.QuantityScale, FactorMicros: factor,
		}); err != nil {
			return err
		}
	}
	return nil
}

func insertProductFormulaSnapshot(ctx context.Context, q *dbsqlc.Queries, approvalEntryID string, formula *bobdomain.ProductFormula) error {
	if formula == nil {
		return nil
	}
	entered, err := fixeddecimal.ParsePositive(formula.Output.EnteredQuantity, 6, false)
	if err != nil {
		return err
	}
	base, err := fixeddecimal.ParsePositive(formula.Output.BaseQuantity, 6, false)
	if err != nil {
		return err
	}
	if err = q.InsertDCLProductFormula(ctx, dbsqlc.InsertDCLProductFormulaParams{
		ProductApprovalEntryID: approvalEntryID, OutputBaseQuantityMicros: base, OutputEnteredQuantityMicros: entered,
		OutputUnitObjectID: formula.Output.EnteredUnit.ObjectID, OutputUnitCode: formula.Output.EnteredUnit.Code,
		OutputUnitName: formula.Output.EnteredUnit.Name, OutputUnitSymbol: formula.Output.EnteredUnit.Symbol,
		OutputUnitQuantityScale: formula.Output.EnteredUnit.QuantityScale,
	}); err != nil {
		return err
	}
	for index, component := range formula.Components {
		entered, err = fixeddecimal.ParsePositive(component.Quantity.EnteredQuantity, 6, false)
		if err != nil {
			return err
		}
		base, err = fixeddecimal.ParsePositive(component.Quantity.BaseQuantity, 6, false)
		if err != nil {
			return err
		}
		if err = q.InsertDCLProductFormulaLine(ctx, dbsqlc.InsertDCLProductFormulaLineParams{
			ProductApprovalEntryID: approvalEntryID, LineNo: int32(index + 1),
			MaterialObjectID: component.Material.ObjectID, MaterialApprovalEntryID: component.Material.ApprovalEntryID,
			BaseQuantityMicros: base, EnteredQuantityMicros: entered,
			EnteredUnitObjectID: component.Quantity.EnteredUnit.ObjectID, EnteredUnitCode: component.Quantity.EnteredUnit.Code,
			EnteredUnitName: component.Quantity.EnteredUnit.Name, EnteredUnitSymbol: component.Quantity.EnteredUnit.Symbol,
			EnteredUnitQuantityScale: component.Quantity.EnteredUnit.QuantityScale,
			ResolutionStatus:         component.ResolutionStatus, RequiresConfirmation: component.RequiresConfirmation,
		}); err != nil {
			return err
		}
	}
	return nil
}
