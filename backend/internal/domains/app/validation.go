package app

import (
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/oklog/ulid/v2"
)

func validatePage(request PageRequest, allowedSort map[string]bool, defaultField, defaultOrder string) (pageSpec, error) {
	page, pageSize := request.Page, request.PageSize
	if page == 0 {
		page = 1
	}
	if pageSize == 0 {
		pageSize = 20
	}
	if page < 1 || pageSize < 1 || pageSize > 200 || len(request.Sort) > 1 {
		return pageSpec{}, domainError(ErrorValidation, "invalid pagination", nil)
	}
	field, order := defaultField, defaultOrder
	if len(request.Sort) == 1 {
		field, order = request.Sort[0].Field, strings.ToLower(request.Sort[0].Order)
	}
	if !allowedSort[field] || (order != "asc" && order != "desc") {
		return pageSpec{}, domainError(ErrorValidation, "invalid sort", nil)
	}
	pageIndex := int64(page - 1)
	if pageIndex > int64(1<<31-1)/int64(pageSize) {
		return pageSpec{}, domainError(ErrorValidation, "invalid pagination", nil)
	}
	return pageSpec{
		Page: page, PageSize: pageSize, Offset: int32(pageIndex * int64(pageSize)),
		SortField: field, SortOrder: order,
	}, nil
}

func validateFixedPage(request PageRequest, field, order string) (pageSpec, error) {
	if request.Page < 1 || request.PageSize != 20 || len(request.Sort) != 1 ||
		request.Sort[0].Field != field || request.Sort[0].Order != order {
		return pageSpec{}, domainError(ErrorValidation, "invalid fixed pagination or sort", nil)
	}
	return validatePage(request, map[string]bool{field: true}, field, order)
}

func validateFilterKeys(filters map[string]string, allowed ...string) error {
	for key := range filters {
		if !slices.Contains(allowed, key) {
			return domainError(ErrorValidation, "invalid filter", nil)
		}
	}
	return nil
}

func optionalStatus(value string) (*string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if value != StatusEnabled && value != StatusDisabled {
		return nil, domainError(ErrorValidation, "invalid status filter", nil)
	}
	return &value, nil
}

func optionalSearch(value string) (*string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if !runeLengthBetween(value, 1, 128) {
		return nil, domainError(ErrorValidation, "invalid search filter", nil)
	}
	return &value, nil
}

func optionalSegment(value string) (*string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if len(value) > 64 || !validSegment(value) {
		return nil, domainError(ErrorValidation, "invalid permission filter", nil)
	}
	return &value, nil
}

func optionalTrimmed(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func trimOptional(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func uniqueStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	slices.Sort(result)
	return result
}

func validSegment(value string) bool {
	if value == "" || strings.HasPrefix(value, "-") || strings.HasSuffix(value, "-") || strings.Contains(value, "--") {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') && (character < '0' || character > '9') && character != '-' {
			return false
		}
	}
	return true
}

func validID(value string) bool {
	parsed, err := ulid.ParseStrict(value)
	return err == nil && parsed.String() == value
}

func validRoleIDs(values []string) bool {
	return len(values) > 0 && !slices.ContainsFunc(values, func(value string) bool { return !validID(value) })
}

func validPermissionIDs(values []string) bool {
	return len(values) > 0 && !slices.ContainsFunc(values, func(value string) bool {
		return !validPermissionID(value)
	})
}

func validPermissionID(value string) bool {
	if len(value) != 26 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') &&
			(character < 'A' || character > 'Z') &&
			(character < 'a' || character > 'z') {
			return false
		}
	}
	return true
}

func runeLengthBetween(value string, minimum, maximum int) bool {
	length := utf8.RuneCountInString(value)
	return length >= minimum && length <= maximum
}
