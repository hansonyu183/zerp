package wfl

import (
	"errors"
	"math"
	"strings"
	"testing"
)

func TestFixedDecimalAndLineAmount(t *testing.T) {
	value, err := fixedDecimal("12.345678", 6, false)
	if err != nil || value != 12_345_678 {
		t.Fatalf("quantity = %d, err=%v", value, err)
	}
	if _, err = fixedDecimal("1.0000001", 6, false); err == nil {
		t.Fatal("seven decimal places must be rejected")
	}
	amount, err := lineAmount(1_500_000, 1_025)
	if err != nil || amount != 1_538 {
		t.Fatalf("rounded amount = %d, err=%v", amount, err)
	}
}

func TestSemanticStatusesAndReasons(t *testing.T) {
	cases := map[string]string{
		StageProcurement: "ORDERED",
		StageReceipt:     "CONFIRMED",
		StageDelivery:    "EXECUTED",
		StageSignoff:     "CONFIRMED",
	}
	for stage, want := range cases {
		if got := semanticStatus(stage, "APPROVED"); got != want {
			t.Fatalf("%s status = %s, want %s", stage, got, want)
		}
	}
	if _, err := requiredReason(""); err == nil {
		t.Fatal("empty reverse reason must be rejected")
	}
	if _, err := requiredReason("修正数量"); err != nil {
		t.Fatalf("valid reason: %v", err)
	}
}

func TestValidateQuery(t *testing.T) {
	query, err := validateQuery(QueryInput{
		Keyword:  "  PRO-001  ",
		Statuses: []string{" draft ", "checked"},
	})
	if err != nil {
		t.Fatalf("validateQuery() error = %v", err)
	}
	if query.page != 1 || query.pageSize != 20 || query.offset != 0 ||
		query.keyword != "PRO-001" || len(query.statuses) != 2 ||
		query.statuses[0] != StatusDraft || query.statuses[1] != StatusChecked {
		t.Fatalf("validated query = %+v", query)
	}

	cases := map[string]QueryInput{
		"negative page":     {Page: -1},
		"oversized page":    {Page: math.MaxInt, PageSize: 100},
		"oversized size":    {PageSize: 101},
		"oversized keyword": {Keyword: strings.Repeat("界", 201)},
		"unknown status":    {Statuses: []string{"UNKNOWN"}},
		"duplicate status":  {Statuses: []string{"draft", "DRAFT"}},
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			_, queryErr := validateQuery(input)
			var domainErr *DomainError
			if !errors.As(queryErr, &domainErr) || domainErr.Kind != ErrorValidation {
				t.Fatalf("validateQuery() error = %v, want validation error", queryErr)
			}
		})
	}
}
