//go:build integration

package bob

import "testing"

func TestEmploymentAppearsInTypedQueriesIntegration(t *testing.T) {
	pool := integrationPool(t)
	service := newIntegrationService(pool)
	_, operatingEntity := createApprovedIntegration(t, service, EntityOperatingEntity, CreateDetailInput{
		Name: "Employment Query Operating Entity", TaxNumber: "TAX" + newID()[3:],
	}, "employment-query-operating")
	created, approved := createApprovedIntegration(t, service, EntityEmployee, CreateDetailInput{
		Name: "Employment Query Person", OperatingEntityID: operatingEntity.ObjectID,
	}, "employment-query-person")
	view, err := service.Get(t.Context(), EntityEmployee, GetInput{ObjectID: approved.ObjectID})
	if err != nil {
		t.Fatalf("get employment: %v", err)
	}

	page, err := service.Query(t.Context(), EntityEmployee, QueryInput{
		Page: 1, PageSize: 20, Filters: QueryFilters{Keyword: view.Code},
		Sort: []SortItem{{Field: "code", Order: "asc"}},
	})
	if err != nil {
		t.Fatalf("query employment: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ObjectID != created.ObjectID ||
		page.Items[0].Relationship == nil || page.Items[0].Relationship.PartyDisplayName != "Employment Query Person" {
		t.Fatalf("employment query result = %#v", page.Items)
	}

	references, err := service.QueryReferenceCandidates(t.Context(), ReferenceQueryInput{
		Entity: EntityEmployee, Keyword: view.Code,
	})
	if err != nil {
		t.Fatalf("query employment references: %v", err)
	}
	if len(references) != 1 || references[0].ObjectID != created.ObjectID ||
		references[0].Name != "Employment Query Person" {
		t.Fatalf("employment references = %#v", references)
	}
}
