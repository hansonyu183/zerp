package bob

import (
	"context"
	"errors"
	"fmt"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/oklog/ulid/v2"
)

// BOB payloads are keyed exclusively by the central approval entry.
func insertDetail(ctx context.Context, q *dbsqlc.Queries, entity, approvalEntryID string, data DetailView) error {
	var err error
	switch entity {
	case EntityCustomer:
		return q.InsertBobCustomerRelationshipPayload(ctx, approvalEntryID)
	case EntityCustomerAccount:
		err = q.InsertBobCustomerPayload(ctx, dbsqlc.InsertBobCustomerPayloadParams{ApprovalEntryID: approvalEntryID, Name: data.Name})
	case EntitySupplier:
		err = q.InsertBobSupplierPayload(ctx, dbsqlc.InsertBobSupplierPayloadParams{ApprovalEntryID: approvalEntryID, Name: data.Name})
	case EntityProduct:
		err = q.InsertBobProductPayload(ctx, dbsqlc.InsertBobProductPayloadParams{ApprovalEntryID: approvalEntryID, Name: data.Name})
	default:
		return invalidPayloadEntity(entity)
	}
	if err != nil {
		return err
	}
	return updateDetail(ctx, q, entity, approvalEntryID, data)
}

func loadDetail(ctx context.Context, q *dbsqlc.Queries, entity, approvalEntryID string) (DetailView, error) {
	switch entity {
	case EntityCustomer:
		_, err := q.GetBobOpenCustomerRelationshipPayload(ctx, approvalEntryID)
		return DetailView{}, err
	case EntityCustomerAccount:
		r, err := q.GetBobOpenCustomerPayload(ctx, approvalEntryID)
		if err != nil {
			return DetailView{}, err
		}
		return DetailView{Name: r.Name, CustomerType: r.CustomerType, ShortName: deref(r.ShortName), TaxNumber: deref(r.TaxNumber), ContactName: deref(r.ContactName), ContactPhone: deref(r.ContactPhone), Email: deref(r.Email), Address: deref(r.Address), Remark: deref(r.Remark), OperatingEntityID: deref(r.OperatingEntityID), OperatingEntityApprovalEntryID: deref(r.OperatingEntityApprovalEntryID), OperatingEntityCode: deref(r.OperatingEntityCode), OperatingEntityName: deref(r.OperatingEntityName), SettlementMethodID: deref(r.SettlementMethodID), SettlementMethodApprovalEntryID: deref(r.SettlementMethodApprovalEntryID), SettlementMethodCode: deref(r.SettlementMethodCode), SettlementMethodName: deref(r.SettlementMethodName), TermCode: deref(r.SettlementTermCode), RuleType: deref(r.SettlementRuleType), DueDays: r.SettlementDueDays, MonthOffset: r.SettlementMonthOffset, CutoffDay: r.SettlementCutoffDay, RebateUnitPrice: fixeddecimal.Format(r.RebateUnitPriceCents, 2, false)}, nil
	case EntitySupplier:
		r, err := q.GetBobOpenSupplierPayload(ctx, approvalEntryID)
		if err != nil {
			return DetailView{}, err
		}
		return DetailView{Name: r.Name, ShortName: deref(r.ShortName), TaxNumber: deref(r.TaxNumber), ContactName: deref(r.ContactName), ContactPhone: deref(r.ContactPhone), Email: deref(r.Email), Address: deref(r.Address), Remark: deref(r.Remark), SettlementMethodID: deref(r.SettlementMethodID), SettlementMethodApprovalEntryID: deref(r.SettlementMethodApprovalEntryID), SettlementMethodCode: deref(r.SettlementMethodCode), SettlementMethodName: deref(r.SettlementMethodName), TermCode: deref(r.SettlementTermCode), RuleType: deref(r.SettlementRuleType), MonthOffset: r.SettlementMonthOffset, DayOfMonth: int32Pointer(r.SettlementDayOfMonth), DayOffset: r.SettlementDayOffset, DefaultPurchaserEmployeeID: deref(r.DefaultPurchaserEmployeeID), DefaultPurchaserApprovalEntryID: deref(r.DefaultPurchaserEmployeeApprovalEntryID)}, nil
	case EntityProduct:
		r, err := q.GetBobOpenProductPayload(ctx, approvalEntryID)
		if err != nil {
			return DetailView{}, err
		}
		data := productDetailFromRow(r)
		data.UnitConversions, err = loadProductUnitConversions(ctx, q, approvalEntryID)
		if err != nil {
			return DetailView{}, err
		}
		data.Formula, err = loadProductFormula(ctx, q, approvalEntryID)
		return data, err
	default:
		return DetailView{}, invalidPayloadEntity(entity)
	}
}

func productDetailFromRow(r dbsqlc.DclProductVersion) DetailView {
	data := DetailView{Enabled: r.Enabled, Name: r.Name, CategoryID: deref(r.CategoryID), CategoryApprovalEntryID: deref(r.CategoryApprovalEntryID), CategoryCode: deref(r.CategoryCode), CategoryName: deref(r.CategoryName), Specification: deref(r.Specification), Model: deref(r.Model), Barcode: deref(r.Barcode), Remark: deref(r.Remark), PricingUnitID: deref(r.PricingUnitID), PricingUnitApprovalEntryID: deref(r.PricingUnitApprovalEntryID), Returnable: r.Returnable, ProductTypeID: deref(r.ProductTypeID), ProductTypeApprovalEntryID: deref(r.ProductTypeApprovalEntryID), ProductTypeCode: deref(r.ProductTypeCode), ProductTypeName: deref(r.ProductTypeName), BehaviorProfile: deref(r.BehaviorProfile), DefaultInputUnitID: deref(r.DefaultInputUnitID), DefaultInputUnitApprovalEntryID: deref(r.DefaultInputUnitApprovalEntryID)}
	if r.DefaultPackagingSpecMicros != nil {
		data.DefaultPackagingSpec = formatMicros(*r.DefaultPackagingSpecMicros)
	}
	return data
}

func updateDetail(ctx context.Context, q *dbsqlc.Queries, entity, approvalEntryID string, data DetailView) error {
	rows, err := updatePayload(ctx, q, entity, approvalEntryID, data)
	if err != nil {
		return err
	}
	if rows != 1 {
		return domainError(ErrorConflict, "approval payload changed", nil, nil)
	}
	if entity != EntityProduct {
		return nil
	}
	if err = q.DeleteBobProductUnitConversions(ctx, approvalEntryID); err != nil {
		return err
	}
	if err = replaceProductUnitConversions(ctx, q, approvalEntryID, data.UnitConversions); err != nil {
		return err
	}
	if err = q.DeleteBobProductFormula(ctx, approvalEntryID); err != nil {
		return err
	}
	return insertProductFormula(ctx, q, approvalEntryID, data.Formula)
}

func updatePayload(ctx context.Context, q *dbsqlc.Queries, entity, approvalEntryID string, d DetailView) (int64, error) {
	switch entity {
	case EntityCustomerAccount:
		rebate, err := moneyCentsOrZero(d.RebateUnitPrice)
		if err != nil {
			return 0, err
		}
		return q.UpdateBobCustomerPayload(ctx, dbsqlc.UpdateBobCustomerPayloadParams{Name: d.Name, CustomerType: d.CustomerType, ShortName: nilIfEmpty(d.ShortName), TaxNumber: nilIfEmpty(d.TaxNumber), ContactName: nilIfEmpty(d.ContactName), ContactPhone: nilIfEmpty(d.ContactPhone), Email: nilIfEmpty(d.Email), Address: nilIfEmpty(d.Address), Remark: nilIfEmpty(d.Remark), OperatingEntityID: nilIfEmpty(d.OperatingEntityID), OperatingEntityApprovalEntryID: nilIfEmpty(d.OperatingEntityApprovalEntryID), OperatingEntityCode: nilIfEmpty(d.OperatingEntityCode), OperatingEntityName: nilIfEmpty(d.OperatingEntityName), SettlementMethodID: nilIfEmpty(d.SettlementMethodID), SettlementMethodApprovalEntryID: nilIfEmpty(d.SettlementMethodApprovalEntryID), SettlementMethodCode: nilIfEmpty(d.SettlementMethodCode), SettlementMethodName: nilIfEmpty(d.SettlementMethodName), SettlementTermCode: nilIfEmpty(d.TermCode), SettlementRuleType: nilIfEmpty(d.RuleType), SettlementDueDays: d.DueDays, SettlementMonthOffset: d.MonthOffset, SettlementCutoffDay: d.CutoffDay, SettlementSalesSurchargeCents: rebate, PricingPolicy: []byte("{}"), ApprovalEntryID: approvalEntryID})
	case EntityCustomer:
		return 1, nil
	case EntitySupplier:
		return q.UpdateBobSupplierPayload(ctx, dbsqlc.UpdateBobSupplierPayloadParams{Name: d.Name, ShortName: nilIfEmpty(d.ShortName), TaxNumber: nilIfEmpty(d.TaxNumber), ContactName: nilIfEmpty(d.ContactName), ContactPhone: nilIfEmpty(d.ContactPhone), Email: nilIfEmpty(d.Email), Address: nilIfEmpty(d.Address), Remark: nilIfEmpty(d.Remark), SettlementMethodID: nilIfEmpty(d.SettlementMethodID), SettlementMethodApprovalEntryID: nilIfEmpty(d.SettlementMethodApprovalEntryID), SettlementMethodCode: nilIfEmpty(d.SettlementMethodCode), SettlementMethodName: nilIfEmpty(d.SettlementMethodName), SettlementTermCode: nilIfEmpty(d.TermCode), SettlementRuleType: nilIfEmpty(d.RuleType), SettlementMonthOffset: d.MonthOffset, SettlementDayOfMonth: derefInt32(d.DayOfMonth), SettlementDayOffset: d.DayOffset, DefaultPurchaserEmployeeID: nilIfEmpty(d.DefaultPurchaserEmployeeID), DefaultPurchaserEmployeeApprovalEntryID: nilIfEmpty(d.DefaultPurchaserApprovalEntryID), ApprovalEntryID: approvalEntryID})
	case EntityProduct:
		packaging, err := defaultPackagingSpecMicros(d)
		if err != nil {
			return 0, err
		}
		return q.UpdateBobProductPayload(ctx, dbsqlc.UpdateBobProductPayloadParams{Name: d.Name, CategoryID: nilIfEmpty(d.CategoryID), CategoryApprovalEntryID: nilIfEmpty(d.CategoryApprovalEntryID), CategoryCode: nilIfEmpty(d.CategoryCode), CategoryName: nilIfEmpty(d.CategoryName), Specification: nilIfEmpty(d.Specification), Model: nilIfEmpty(d.Model), Barcode: nilIfEmpty(d.Barcode), Remark: nilIfEmpty(d.Remark), PricingUnitID: nilIfEmpty(d.PricingUnitID), PricingUnitApprovalEntryID: nilIfEmpty(d.PricingUnitApprovalEntryID), Returnable: d.Returnable, DefaultPackagingSpecMicros: packaging, ProductTypeID: nilIfEmpty(d.ProductTypeID), ProductTypeApprovalEntryID: nilIfEmpty(d.ProductTypeApprovalEntryID), ProductTypeCode: nilIfEmpty(d.ProductTypeCode), ProductTypeName: nilIfEmpty(d.ProductTypeName), BehaviorProfile: nilIfEmpty(d.BehaviorProfile), DefaultInputUnitID: nilIfEmpty(d.DefaultInputUnitID), DefaultInputUnitApprovalEntryID: nilIfEmpty(d.DefaultInputUnitApprovalEntryID), Enabled: d.Enabled, ApprovalEntryID: approvalEntryID})
	default:
		return 0, invalidPayloadEntity(entity)
	}
}

func copyDetail(ctx context.Context, q *dbsqlc.Queries, entity, newApprovalEntryID, sourceApprovalEntryID string) error {
	switch entity {
	case EntityCustomer:
		return q.CopyBobCustomerRelationshipPayload(ctx, dbsqlc.CopyBobCustomerRelationshipPayloadParams{NewApprovalEntryID: newApprovalEntryID, SourceApprovalEntryID: sourceApprovalEntryID})
	case EntityCustomerAccount:
		if err := q.CopyBobCustomerPayload(ctx, dbsqlc.CopyBobCustomerPayloadParams{NewApprovalEntryID: newApprovalEntryID, SourceApprovalEntryID: sourceApprovalEntryID}); err != nil {
			return err
		}
		return copyCustomerPayloadExtras(ctx, q, newApprovalEntryID, sourceApprovalEntryID)
	case EntitySupplier:
		return q.CopyBobSupplierPayload(ctx, dbsqlc.CopyBobSupplierPayloadParams{NewApprovalEntryID: newApprovalEntryID, SourceApprovalEntryID: sourceApprovalEntryID})
	case EntityProduct:
		if err := q.CopyBobProductPayload(ctx, dbsqlc.CopyBobProductPayloadParams{NewApprovalEntryID: newApprovalEntryID, SourceApprovalEntryID: sourceApprovalEntryID}); err != nil {
			return err
		}
		conversions, err := loadProductUnitConversions(ctx, q, sourceApprovalEntryID)
		if err != nil {
			return err
		}
		if err := replaceProductUnitConversions(ctx, q, newApprovalEntryID, conversions); err != nil {
			return err
		}
		formula, err := loadProductFormula(ctx, q, sourceApprovalEntryID)
		if err != nil {
			return err
		}
		return insertProductFormula(ctx, q, newApprovalEntryID, formula)
	default:
		return invalidPayloadEntity(entity)
	}
}

func deleteDetail(ctx context.Context, q *dbsqlc.Queries, entity, approvalEntryID string) (int64, error) {
	switch entity {
	case EntityCustomer:
		return q.DeleteBobCustomerRelationshipPayload(ctx, approvalEntryID)
	case EntityCustomerAccount:
		if err := q.DeleteBobCustomerCreditLimits(ctx, approvalEntryID); err != nil {
			return 0, err
		}
		if err := q.DeleteBobCustomerVersionAttachments(ctx, approvalEntryID); err != nil {
			return 0, err
		}
		return q.DeleteBobCustomerPayload(ctx, approvalEntryID)
	case EntitySupplier:
		return q.DeleteBobSupplierPayload(ctx, approvalEntryID)
	case EntityProduct:
		if err := q.DeleteBobProductFormula(ctx, approvalEntryID); err != nil {
			return 0, err
		}
		if err := q.DeleteBobProductUnitConversions(ctx, approvalEntryID); err != nil {
			return 0, err
		}
		return q.DeleteBobProductPayload(ctx, approvalEntryID)
	default:
		return 0, invalidPayloadEntity(entity)
	}
}

func copyCustomerPayloadExtras(ctx context.Context, q *dbsqlc.Queries, newApprovalEntryID, sourceApprovalEntryID string) error {
	if err := q.CopyBobCustomerCreditLimits(ctx, dbsqlc.CopyBobCustomerCreditLimitsParams{NewApprovalEntryID: newApprovalEntryID, SourceApprovalEntryID: sourceApprovalEntryID}); err != nil {
		return err
	}
	return q.CopyBobCustomerVersionAttachments(ctx, dbsqlc.CopyBobCustomerVersionAttachmentsParams{NewApprovalEntryID: newApprovalEntryID, SourceApprovalEntryID: sourceApprovalEntryID})
}
func defaultPackagingSpecMicros(data DetailView) (*int64, error) {
	if data.BehaviorProfile == ProductBehaviorPackaging || data.DefaultPackagingSpec == "" {
		return nil, nil
	}
	value, err := fixedMicros(data.DefaultPackagingSpec)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func moneyCentsOrZero(value string) (int64, error) {
	if strings.TrimSpace(value) == "" {
		return 0, nil
	}
	return moneyCents(value)
}
func insertProductFormula(ctx context.Context, q *dbsqlc.Queries, approvalEntryID string, formula *ProductFormula) error {
	if formula == nil {
		return nil
	}
	entered, err := fixedMicros(formula.Output.EnteredQuantity)
	if err != nil {
		return err
	}
	base, err := fixedMicros(formula.Output.BaseQuantity)
	if err != nil {
		return err
	}
	if err = q.InsertBobProductFormula(ctx, dbsqlc.InsertBobProductFormulaParams{ProductApprovalEntryID: approvalEntryID, OutputBaseQuantityMicros: base, OutputEnteredQuantityMicros: entered, OutputUnitObjectID: formula.Output.EnteredUnit.ObjectID, OutputUnitApprovalEntryID: formula.Output.EnteredUnit.ApprovalEntryID, OutputUnitCode: formula.Output.EnteredUnit.Code, OutputUnitName: formula.Output.EnteredUnit.Name, OutputUnitSymbol: formula.Output.EnteredUnit.Symbol}); err != nil {
		return err
	}
	for i, c := range formula.Components {
		entered, err = fixedMicros(c.Quantity.EnteredQuantity)
		if err != nil {
			return err
		}
		base, err = fixedMicros(c.Quantity.BaseQuantity)
		if err != nil {
			return err
		}
		if err = q.InsertBobProductFormulaLine(ctx, dbsqlc.InsertBobProductFormulaLineParams{ProductApprovalEntryID: approvalEntryID, LineNo: int32(i + 1), MaterialObjectID: c.Material.ObjectID, MaterialApprovalEntryID: c.Material.ApprovalEntryID, BaseQuantityMicros: base, EnteredQuantityMicros: entered, EnteredUnitObjectID: c.Quantity.EnteredUnit.ObjectID, EnteredUnitApprovalEntryID: c.Quantity.EnteredUnit.ApprovalEntryID, EnteredUnitCode: c.Quantity.EnteredUnit.Code, EnteredUnitName: c.Quantity.EnteredUnit.Name, EnteredUnitSymbol: c.Quantity.EnteredUnit.Symbol, ResolutionStatus: c.ResolutionStatus, RequiresConfirmation: c.RequiresConfirmation}); err != nil {
			return err
		}
	}
	return nil
}
func loadProductFormula(ctx context.Context, q *dbsqlc.Queries, approvalEntryID string) (*ProductFormula, error) {
	f, err := q.GetBobProductFormula(ctx, approvalEntryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := q.ListBobProductFormulaLines(ctx, approvalEntryID)
	if err != nil {
		return nil, err
	}
	result := &ProductFormula{Output: QuantitySnapshot{EnteredQuantity: formatMicros(f.OutputEnteredQuantityMicros), BaseQuantity: formatMicros(f.OutputBaseQuantityMicros), EnteredUnit: MeasurementUnitSnapshot{ObjectID: f.OutputUnitObjectID, ApprovalEntryID: f.OutputUnitApprovalEntryID, Code: f.OutputUnitCode, Name: f.OutputUnitName, Symbol: f.OutputUnitSymbol}}, Components: make([]ProductFormulaComponent, 0, len(rows))}
	for _, row := range rows {
		result.Components = append(result.Components, ProductFormulaComponent{Material: FormulaMaterialReference{ObjectID: row.MaterialObjectID, ApprovalEntryID: row.MaterialApprovalEntryID, Code: row.MaterialCode, Name: row.MaterialName, BehaviorProfile: stringValue(row.MaterialBehaviorProfile)}, Quantity: QuantitySnapshot{EnteredQuantity: formatMicros(row.EnteredQuantityMicros), BaseQuantity: formatMicros(row.BaseQuantityMicros), EnteredUnit: MeasurementUnitSnapshot{ObjectID: row.EnteredUnitObjectID, ApprovalEntryID: row.EnteredUnitApprovalEntryID, Code: row.EnteredUnitCode, Name: row.EnteredUnitName, Symbol: row.EnteredUnitSymbol}}, ResolutionStatus: row.ResolutionStatus, RequiresConfirmation: row.RequiresConfirmation})
	}
	return result, nil
}
func loadProductUnitConversions(ctx context.Context, q *dbsqlc.Queries, approvalEntryID string) ([]ProductUnitConversion, error) {
	rows, err := q.ListBobProductUnitConversions(ctx, approvalEntryID)
	if err != nil {
		return nil, err
	}
	result := make([]ProductUnitConversion, 0, len(rows))
	for _, row := range rows {
		result = append(result, ProductUnitConversion{Unit: MeasurementUnitSnapshot{ObjectID: row.UnitObjectID, ApprovalEntryID: row.UnitApprovalEntryID, Code: row.UnitCode, Name: row.UnitName, Symbol: row.UnitSymbol}, Factor: formatMicros(row.FactorMicros)})
	}
	return result, nil
}
func replaceProductUnitConversions(ctx context.Context, q *dbsqlc.Queries, approvalEntryID string, conversions []ProductUnitConversion) error {
	for _, conversion := range conversions {
		factor, err := fixedMicros(conversion.Factor)
		if err != nil {
			return err
		}
		if err = q.InsertBobProductUnitConversion(ctx, dbsqlc.InsertBobProductUnitConversionParams{ProductApprovalEntryID: approvalEntryID, UnitObjectID: conversion.Unit.ObjectID, UnitApprovalEntryID: conversion.Unit.ApprovalEntryID, UnitCode: conversion.Unit.Code, UnitName: conversion.Unit.Name, UnitSymbol: conversion.Unit.Symbol, FactorMicros: factor}); err != nil {
			return err
		}
	}
	return nil
}

func derefInt32(value *int32) int32 {
	if value == nil {
		return 0
	}
	return *value
}
func int32Pointer(value int32) *int32 {
	if value == 0 {
		return nil
	}
	return &value
}
func nilIfEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
func invalidPayloadEntity(entity string) error {
	return domainError(ErrorValidation, fmt.Sprintf("invalid BOB approval payload entity %q", entity), nil, nil)
}
func dateValue(value string) pgtype.Date {
	if strings.TrimSpace(value) == "" {
		return pgtype.Date{}
	}
	var date pgtype.Date
	_ = date.Scan(value)
	return date
}
func dateString(value pgtype.Date) string {
	if !value.Valid {
		return ""
	}
	return value.Time.Format("2006-01-02")
}
func numericValue(value string) (pgtype.Numeric, error) {
	if strings.TrimSpace(value) == "" {
		return pgtype.Numeric{}, nil
	}
	var numeric pgtype.Numeric
	if err := numeric.Scan(value); err != nil {
		return pgtype.Numeric{}, err
	}
	return numeric, nil
}
func numericString(value pgtype.Numeric) string {
	if !value.Valid {
		return ""
	}
	raw, err := value.Value()
	if err != nil || raw == nil {
		return ""
	}
	return fmt.Sprint(raw)
}
func newID() string { return ulid.Make().String() }
