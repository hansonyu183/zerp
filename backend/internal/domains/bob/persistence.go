package bob

import (
	"context"
	"errors"
	"fmt"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// DCL owns Product snapshot writes. BOB only reconstructs the immutable DCL
// snapshot selected by a current projection or an exact historical reference.
func loadDCLProductSnapshot(ctx context.Context, q *dbsqlc.Queries, approvalEntryID string) (DetailView, error) {
	r, err := q.GetDCLProductSnapshot(ctx, approvalEntryID)
	if err != nil {
		return DetailView{}, err
	}
	data := productDetailFromRow(r)
	data.UnitConversions, err = loadProductUnitConversions(ctx, q, approvalEntryID)
	if err != nil {
		return DetailView{}, err
	}
	enrichDefaultInputUnit(&data)
	data.Formula, err = loadProductFormula(ctx, q, approvalEntryID)
	return data, err
}

func enrichDefaultInputUnit(data *DetailView) {
	for _, conversion := range data.UnitConversions {
		if conversion.Unit.ObjectID == data.DefaultInputUnitID {
			data.DefaultInputUnitCode = conversion.Unit.Code
			data.DefaultInputUnitName = conversion.Unit.Name
			return
		}
	}
}

func productDetailFromRow(r dbsqlc.DclProductVersion) DetailView {
	data := DetailView{Enabled: r.Enabled, Name: r.Name, CategoryID: deref(r.CategoryID), CategoryCode: deref(r.CategoryCode), CategoryName: deref(r.CategoryName), Specification: deref(r.Specification), Model: deref(r.Model), Barcode: deref(r.Barcode), Remark: deref(r.Remark), PricingUnitID: deref(r.PricingUnitID), Returnable: r.Returnable, ProductTypeID: deref(r.ProductTypeID), ProductTypeCode: deref(r.ProductTypeCode), ProductTypeName: deref(r.ProductTypeName), BehaviorProfile: deref(r.BehaviorProfile), DefaultInputUnitID: deref(r.DefaultInputUnitID)}
	if r.DefaultPackagingSpecMicros != nil {
		data.DefaultPackagingSpec = formatMicros(*r.DefaultPackagingSpecMicros)
	}
	return data
}

func loadProductFormula(ctx context.Context, q *dbsqlc.Queries, approvalEntryID string) (*ProductFormula, error) {
	f, err := q.GetDCLProductFormula(ctx, approvalEntryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := q.ListDCLProductFormulaLines(ctx, approvalEntryID)
	if err != nil {
		return nil, err
	}
	result := &ProductFormula{Output: QuantitySnapshot{EnteredQuantity: formatMicros(f.OutputEnteredQuantityMicros), BaseQuantity: formatMicros(f.OutputBaseQuantityMicros), EnteredUnit: MeasurementUnitSnapshot{ObjectID: f.OutputUnitObjectID, Code: f.OutputUnitCode, Name: f.OutputUnitName, Symbol: f.OutputUnitSymbol, QuantityScale: f.OutputUnitQuantityScale}}, Components: make([]ProductFormulaComponent, 0, len(rows))}
	for _, row := range rows {
		result.Components = append(result.Components, ProductFormulaComponent{Material: FormulaMaterialReference{ObjectID: row.MaterialObjectID, ApprovalEntryID: row.MaterialApprovalEntryID, Code: stringValue(row.MaterialCode), Name: row.MaterialName, BehaviorProfile: stringValue(row.MaterialBehaviorProfile)}, Quantity: QuantitySnapshot{EnteredQuantity: formatMicros(row.EnteredQuantityMicros), BaseQuantity: formatMicros(row.BaseQuantityMicros), EnteredUnit: MeasurementUnitSnapshot{ObjectID: row.EnteredUnitObjectID, Code: row.EnteredUnitCode, Name: row.EnteredUnitName, Symbol: row.EnteredUnitSymbol, QuantityScale: row.EnteredUnitQuantityScale}}, ResolutionStatus: row.ResolutionStatus, RequiresConfirmation: row.RequiresConfirmation})
	}
	return result, nil
}
func loadProductUnitConversions(ctx context.Context, q *dbsqlc.Queries, approvalEntryID string) ([]ProductUnitConversion, error) {
	rows, err := q.ListDCLProductUnitConversions(ctx, approvalEntryID)
	if err != nil {
		return nil, err
	}
	result := make([]ProductUnitConversion, 0, len(rows))
	for _, row := range rows {
		result = append(result, ProductUnitConversion{Unit: MeasurementUnitSnapshot{ObjectID: row.UnitObjectID, Code: row.UnitCode, Name: row.UnitName, Symbol: row.UnitSymbol, QuantityScale: row.UnitQuantityScale}, Factor: formatMicros(row.FactorMicros)})
	}
	return result, nil
}
func dateString(value pgtype.Date) string {
	if !value.Valid {
		return ""
	}
	return value.Time.Format("2006-01-02")
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
