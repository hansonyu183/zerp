package led

import "testing"

func TestValidateBillQuery(t *testing.T) {
	t.Parallel()
	query, err := validateBillQuery(BillQueryInput{
		Page: 1, PageSize: 20,
		Filters: BillQueryFilters{PositionType: "asset", Availability: "held", BillType: "bank_acceptance",
			OriginatingPartyType: "supplier", OriginatingPartyObjectID: "01J00000000000000000000001"},
		Sort: []SortInput{{Field: "maturityDate", Order: "asc"}},
	})
	if err != nil {
		t.Fatalf("validate bill query: %v", err)
	}
	if query.PositionType != "ASSET" || query.Availability != "HELD" || query.BillType != "BANK_ACCEPTANCE" ||
		query.OriginatingPartyType != "supplier" {
		t.Fatalf("normalized bill query = %+v", query)
	}
	invalid := []BillQueryInput{
		{Page: 0, PageSize: 20},
		{Page: 1, PageSize: 101},
		{Page: 1, PageSize: 20, Filters: BillQueryFilters{PositionType: "OTHER"}},
		{Page: 1, PageSize: 20, Filters: BillQueryFilters{MaturityDateFrom: "2026-09-01", MaturityDateTo: "2026-08-01"}},
		{Page: 1, PageSize: 20, Filters: BillQueryFilters{OriginatingPartyType: "employee", OriginatingPartyObjectID: "01J00000000000000000000001"}},
		{Page: 1, PageSize: 20, Filters: BillQueryFilters{OriginatingPartyType: "supplier"}},
		{Page: 1, PageSize: 20, Filters: BillQueryFilters{OriginatingPartyObjectID: "01J00000000000000000000001"}},
		{Page: 1, PageSize: 20, Sort: []SortInput{{Field: "createdAt", Order: "desc"}}},
	}
	for index, input := range invalid {
		if _, validationErr := validateBillQuery(input); validationErr == nil {
			t.Fatalf("invalid bill query %d accepted: %+v", index, input)
		}
	}
}

func TestValidateBillQueryAcceptsEveryBillSource(t *testing.T) {
	for _, source := range []string{"bill-receipt", "bill-payment", "bill-issue", "bill-discount", "bill-maturity"} {
		query, err := validateBillQuery(BillQueryInput{
			Page: 1, PageSize: 20, Filters: BillQueryFilters{SourceEntity: source},
		})
		if err != nil || query.SourceEntity != source {
			t.Fatalf("source %q: query=%+v err=%v", source, query, err)
		}
	}
}
