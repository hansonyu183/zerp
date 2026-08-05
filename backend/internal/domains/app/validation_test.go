package app

import (
	"math"
	"strings"
	"testing"
)

func TestValidatePageAndFilters(t *testing.T) {
	spec, err := validatePage(PageRequest{}, map[string]bool{"createdAt": true}, "createdAt", "desc")
	if err != nil || spec.Page != 1 || spec.PageSize != 20 || spec.SortOrder != "desc" || spec.Offset != 0 {
		t.Fatalf("default page = %+v, err=%v", spec, err)
	}
	spec, err = validatePage(PageRequest{
		Page: 2, PageSize: 10, Sort: []SortItem{{Field: "createdAt", Order: "ASC"}},
	}, map[string]bool{"createdAt": true}, "createdAt", "desc")
	if err != nil || spec.Offset != 10 || spec.SortOrder != "asc" {
		t.Fatalf("explicit page = %+v, err=%v", spec, err)
	}
	if _, err = validatePage(PageRequest{Page: math.MaxInt, PageSize: 200}, map[string]bool{"createdAt": true}, "createdAt", "desc"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("overflow page error = %v", err)
	}
	if err = validateFilterKeys(map[string]string{"unknown": "value"}, "status"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("unknown filter error = %v", err)
	}
}

func TestStrictIDsAndUnicodeLengths(t *testing.T) {
	if !validID("01J00000000000000000000000") || validID("user-1") || validID(strings.ToLower("01J00000000000000000000000")) {
		t.Fatal("validID() did not enforce canonical ULID")
	}
	if !validPermissionID("01JAPP00000000000000000001") ||
		!validPermissionID("01JAUX00000000000000000001") ||
		!validPermissionID("FA0123456789abcdef01234567") ||
		!validPermissionID("WF0123456789abcdef01234567") ||
		validPermissionID("short") ||
		validPermissionID("FA0123456789abcdef012345-7") {
		t.Fatal("validPermissionID() did not accept catalog identifiers safely")
	}
	displayName := strings.Repeat("中", 128)
	if !runeLengthBetween(displayName, 1, 128) || runeLengthBetween(displayName+"文", 1, 128) {
		t.Fatal("runeLengthBetween() did not count Unicode characters")
	}
}
