package rpt

import (
	"testing"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/generated"
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
		typ generated.RptResultType
		oid uint32
		ok  bool
	}{
		{generated.RptResultTypeBOOLEAN, pgtype.BoolOID, true},
		{generated.RptResultTypeINTEGER, pgtype.Int8OID, true},
		{generated.RptResultTypeDECIMAL, pgtype.NumericOID, true},
		{generated.RptResultTypeDATE, pgtype.DateOID, true},
		{generated.RptResultTypeDATETIME, pgtype.TimestamptzOID, true},
		{generated.RptResultTypeID, pgtype.VarcharOID, true},
		{generated.RptResultTypeTEXT, pgtype.TextOID, true},
		{generated.RptResultTypeINTEGER, pgtype.TextOID, false},
		{generated.RptResultTypeTEXT, pgtype.JSONBOID, false},
	}
	for _, test := range tests {
		if got := resultTypeMatchesOID(test.typ, test.oid); got != test.ok {
			t.Errorf("type=%s oid=%d got=%t want=%t", test.typ, test.oid, got, test.ok)
		}
	}
}

func TestBindParametersUsesDefaultsAndRejectsUnknownKeys(t *testing.T) {
	defaultValue := "CNY"
	parameters := []generated.RptParameter{
		{Key: "book", Type: generated.RptParameterTypeREFERENCE, Required: true},
		{Key: "currency", Type: generated.RptParameterTypeTEXT, DefaultValue: defaultValue},
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
	parameters := []generated.RptParameter{
		{Key: "integer", Type: generated.RptParameterTypeINTEGER, Required: true},
		{Key: "decimal", Type: generated.RptParameterTypeDECIMAL, Required: true},
		{Key: "date", Type: generated.RptParameterTypeDATE, Required: true},
		{Key: "range", Type: generated.RptParameterTypeDATERANGE, Required: true},
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

func TestCSVCellNeutralizesSpreadsheetFormula(t *testing.T) {
	for _, value := range []string{"=1+1", "+cmd", "-2+3", "@SUM(A1)"} {
		if got := csvCell(value, generated.RptResultTypeTEXT); got != "'"+value {
			t.Fatalf("csvCell(%q) = %q", value, got)
		}
	}
	if got := csvCell("normal", generated.RptResultTypeTEXT); got != "normal" {
		t.Fatalf("normal text changed: %q", got)
	}
}

func TestCSVCellFormatsDatabaseTypes(t *testing.T) {
	var decimal pgtype.Numeric
	if err := decimal.Scan("-12.34"); err != nil {
		t.Fatal(err)
	}
	if got := csvCell(decimal, generated.RptResultTypeDECIMAL); got != "-12.34" {
		t.Fatalf("decimal = %q", got)
	}
	if got := csvCell("-12.34", generated.RptResultTypeDECIMAL); got != "-12.34" {
		t.Fatalf("decimal string = %q", got)
	}
	date := time.Date(2026, time.August, 12, 0, 0, 0, 0, time.UTC)
	if got := csvCell(date, generated.RptResultTypeDATE); got != "2026-08-12" {
		t.Fatalf("date = %q", got)
	}
	instant := time.Date(2026, time.August, 12, 15, 4, 5, 0, time.FixedZone("CST", 8*60*60))
	if got := csvCell(instant, generated.RptResultTypeDATETIME); got != "2026-08-12T15:04:05+08:00" {
		t.Fatalf("datetime = %q", got)
	}
}

func TestValidateReadOnlySQLRejectsWritesAndMultipleStatements(t *testing.T) {
	for _, sql := range []string{"delete from app_users", "select 1; select 2", "with x as (delete from app_users returning *) select * from x", "select nextval('x')"} {
		if err := validateReadOnlySQL(sql); err == nil {
			t.Fatalf("unsafe SQL accepted: %s", sql)
		}
	}
}
