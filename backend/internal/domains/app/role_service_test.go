package app

import "testing"

func TestValidateRoleQueryIsFixedToCodeAscendingTwenty(t *testing.T) {
	valid := PageRequest{Page: 1, PageSize: 20, Sort: []SortItem{{Field: "code", Order: "asc"}}, Filters: map[string]string{"status": StatusEnabled, "search": "ROL"}}
	if _, _, _, err := validateRoleQuery(valid); err != nil {
		t.Fatalf("valid strict role query: %v", err)
	}
	for _, request := range []PageRequest{
		{Page: 1, PageSize: 10, Sort: []SortItem{{Field: "code", Order: "asc"}}},
		{Page: 1, PageSize: 20, Sort: []SortItem{{Field: "name", Order: "asc"}}},
		{Page: 1, PageSize: 20, Sort: []SortItem{{Field: "code", Order: "desc"}}},
		{Page: 1, PageSize: 20, Sort: []SortItem{{Field: "code", Order: "asc"}}, Filters: map[string]string{"status": "ARCHIVED"}},
	} {
		if _, _, _, err := validateRoleQuery(request); !errorIsKind(err, ErrorValidation) {
			t.Fatalf("query %#v error = %v, want validation", request, err)
		}
	}
}
