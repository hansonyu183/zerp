package bob

import (
	"errors"
	"strings"
)

func versionNumber(value *int32) int32 {
	if value == nil {
		return 0
	}
	return *value
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func requiredSubjectCode(value *string) (string, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return "", domainError(ErrorInternal, "subject code persistence invariant is violated", nil, errors.New("subject code is missing"))
	}
	return *value, nil
}
