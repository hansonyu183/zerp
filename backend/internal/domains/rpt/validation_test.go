package rpt

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestValidateReadOnlySQLAcceptsOneSelect(t *testing.T) {
	for _, sql := range []string{"select $1::text as value", "with x as (select 1) select * from x"} {
		if err := validateReadOnlySQL(sql); err != nil {
			t.Fatalf("valid SQL rejected: %v", err)
		}
	}
}

func TestResultColumnTypeMatchesDatabaseOID(t *testing.T) {
	tests := []struct {
		typ ResultType
		oid uint32
		ok  bool
	}{
		{ResultTypeBoolean, pgtype.BoolOID, true},
		{ResultTypeInteger, pgtype.Int8OID, true},
		{ResultTypeDecimal, pgtype.NumericOID, true},
		{ResultTypeDate, pgtype.DateOID, true},
		{ResultTypeDateTime, pgtype.TimestamptzOID, true},
		{ResultTypeID, pgtype.VarcharOID, true},
		{ResultTypeText, pgtype.TextOID, true},
		{ResultTypeInteger, pgtype.TextOID, false},
		{ResultTypeText, pgtype.JSONBOID, false},
	}
	for _, test := range tests {
		if got := resultTypeMatchesOID(test.typ, test.oid); got != test.ok {
			t.Errorf("type=%s oid=%d got=%t want=%t", test.typ, test.oid, got, test.ok)
		}
	}
}

func TestBindParametersUsesDefaultsAndRejectsUnknownKeys(t *testing.T) {
	defaultValue := "CNY"
	parameters := []Parameter{
		{Key: "book", Type: ParameterTypeReference, Required: true},
		{Key: "currency", Type: ParameterTypeText, DefaultValue: defaultValue},
	}
	values, err := bindParameters(parameters, map[string]any{"book": "book-1"})
	if err != nil || len(values) != 2 || values[1] != defaultValue {
		t.Fatalf("defaults not bound: values=%v err=%v", values, err)
	}
	if _, err = bindParameters(parameters, map[string]any{"book": "book-1", "unknown": true}); err == nil {
		t.Fatal("unknown parameter was accepted")
	}
}

func TestBindParametersConvertsClosedTypes(t *testing.T) {
	parameters := []Parameter{
		{Key: "integer", Type: ParameterTypeInteger, Required: true},
		{Key: "decimal", Type: ParameterTypeDecimal, Required: true},
		{Key: "date", Type: ParameterTypeDate, Required: true},
		{Key: "range", Type: ParameterTypeDateRange, Required: true},
	}
	values, err := bindParameters(parameters, map[string]any{
		"integer": float64(7), "decimal": "12.34", "date": "2026-08-12",
		"range": []any{"2026-08-01", "2026-08-12"},
	})
	if err != nil || len(values) != 4 {
		t.Fatalf("typed values not bound: values=%v err=%v", values, err)
	}
	if _, ok := values[0].(int64); !ok {
		t.Fatalf("integer retained JSON number: %T", values[0])
	}
	if _, err = bindParameters(parameters[:1], map[string]any{"integer": 1.5}); err == nil {
		t.Fatal("fractional integer was accepted")
	}
}

func TestAgingReportsRejectNegativeMinimumAge(t *testing.T) {
	for _, code := range []string{"customer-aging", "supplier-aging"} {
		if err := validateBuiltInParameterValues(code, map[string]any{
			"minAgeDays": float64(-1),
		}); err == nil || err.(*DomainError).Kind != ErrorValidation {
			t.Fatalf("%s negative minimum age error = %v", code, err)
		}
		if err := validateBuiltInParameterValues(code, map[string]any{
			"minAgeDays": float64(0),
		}); err != nil {
			t.Fatalf("%s zero minimum age rejected: %v", code, err)
		}
	}
}

func TestCSVCellNeutralizesSpreadsheetFormula(t *testing.T) {
	for _, value := range []string{"=1+1", "+cmd", "-2+3", "@SUM(A1)"} {
		if got := csvCell(value, ResultColumn{Type: ResultTypeText}); got != "'"+value {
			t.Fatalf("csvCell(%q) = %q", value, got)
		}
	}
	if got := csvCell("normal", ResultColumn{Type: ResultTypeText}); got != "normal" {
		t.Fatalf("normal text changed: %q", got)
	}
}

func TestCSVCellFormatsDatabaseTypes(t *testing.T) {
	var decimal pgtype.Numeric
	if err := decimal.Scan("-12.34"); err != nil {
		t.Fatal(err)
	}
	if got := csvCell(decimal, ResultColumn{Type: ResultTypeDecimal}); got != "-12.34" {
		t.Fatalf("decimal = %q", got)
	}
	if got := csvCell("-12.34", ResultColumn{Type: ResultTypeDecimal}); got != "-12.34" {
		t.Fatalf("decimal string = %q", got)
	}
	date := time.Date(2026, time.August, 12, 0, 0, 0, 0, time.UTC)
	if got := csvCell(date, ResultColumn{Type: ResultTypeDate}); got != "2026-08-12" {
		t.Fatalf("date = %q", got)
	}
	instant := time.Date(2026, time.August, 12, 15, 4, 5, 0, time.FixedZone("CST", 8*60*60))
	if got := csvCell(instant, ResultColumn{Type: ResultTypeDateTime}); got != "2026/8/12 15:04:05" {
		t.Fatalf("datetime = %q", got)
	}
}

func TestCSVCellUsesColumnFormatContract(t *testing.T) {
	money := "money"
	quantity := "quantity"
	if got := csvCell("1000", ResultColumn{Type: ResultTypeDecimal, Format: &money}); got != "1,000.00" {
		t.Fatalf("money = %q", got)
	}
	if got := csvCell("1234.560000", ResultColumn{Type: ResultTypeDecimal, Format: &quantity}); got != "1,234.56" {
		t.Fatalf("quantity = %q", got)
	}
}

func TestValidateReadOnlySQLRejectsWritesAndMultipleStatements(t *testing.T) {
	for _, sql := range []string{"delete from app_users", "select 1; select 2", "with x as (delete from app_users returning *) select * from x", "select nextval('x')"} {
		if err := validateReadOnlySQL(sql); err == nil {
			t.Fatalf("unsafe SQL accepted: %s", sql)
		}
	}
}
