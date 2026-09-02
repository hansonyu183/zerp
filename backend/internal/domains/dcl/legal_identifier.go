package dcl

import (
	"strings"
	"time"
	"unicode"
)

const mainlandUnifiedSocialCreditCharset = "0123456789ABCDEFGHJKLMNPQRTUWXY"

func normalizeCustomerLegalIdentifier(kind, value string) (string, error) {
	switch kind {
	case "MAINLAND_ENTERPRISE":
		value = strings.Map(func(r rune) rune {
			if unicode.IsSpace(r) {
				return -1
			}
			return unicode.ToUpper(r)
		}, value)
		if !validUnifiedSocialCreditCode(value) {
			return "", newError(ErrorValidation, "invalid_legal_identifier", "invalid mainland enterprise legal identifier", nil, nil)
		}
	case "MAINLAND_INDIVIDUAL":
		value = strings.ToUpper(strings.TrimSpace(value))
		if !validResidentIdentityNumber(value) {
			return "", newError(ErrorValidation, "invalid_legal_identifier", "invalid mainland individual legal identifier", nil, nil)
		}
	case "OTHER":
		value = strings.TrimSpace(value)
	default:
		return "", newError(ErrorValidation, "invalid_legal_identifier", "invalid customer identity kind", nil, nil)
	}
	return value, nil
}

func validUnifiedSocialCreditCode(value string) bool {
	if len(value) != 18 {
		return false
	}
	weights := [...]int{1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28}
	sum := 0
	for i := 0; i < 17; i++ {
		index := strings.IndexByte(mainlandUnifiedSocialCreditCharset, value[i])
		if index < 0 {
			return false
		}
		sum += index * weights[i]
	}
	return strings.IndexByte(mainlandUnifiedSocialCreditCharset, value[17]) == (31-sum%31)%31
}

func validResidentIdentityNumber(value string) bool {
	if len(value) != 18 {
		return false
	}
	for i := 0; i < 17; i++ {
		if value[i] < '0' || value[i] > '9' {
			return false
		}
	}
	date, err := time.Parse("20060102", value[6:14])
	if err != nil || date.After(time.Now()) {
		return false
	}
	weights := [...]int{7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2}
	checks := "10X98765432"
	sum := 0
	for i := 0; i < 17; i++ {
		sum += int(value[i]-'0') * weights[i]
	}
	return value[17] == checks[sum%11]
}

func archiveLegalIdentifier(kind, value string) (string, error) {
	if strings.TrimSpace(value) == "" || !runeLenAtMost(strings.TrimSpace(value), 100) {
		return "", newError(ErrorValidation, "invalid_legal_identifier", "legal identifier is required", nil, nil)
	}
	switch kind {
	case "PERSON":
		return normalizeCustomerLegalIdentifier("MAINLAND_INDIVIDUAL", value)
	case "ORGANIZATION":
		return normalizeCustomerLegalIdentifier("MAINLAND_ENTERPRISE", value)
	default:
		return "", newError(ErrorValidation, "invalid_legal_identifier", "invalid archive identity kind", nil, nil)
	}
}
