package app

import (
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode"
)

var (
	privateKeyPattern       = regexp.MustCompile(`(?is)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----`)
	jwtPattern              = regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b`)
	tokenPattern            = regexp.MustCompile(`\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b`)
	bearerPattern           = regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._~+/\-=]{8,}`)
	headerSecretPattern     = regexp.MustCompile(`(?im)\b(authorization|cookie|set-cookie|x-csrf-token)\s*:\s*[^\r\n]+`)
	assignmentSecretPattern = regexp.MustCompile(`(?i)\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+`)
)

type validatedFeedback struct {
	Category         string
	Title            string
	Content          string
	PagePath         *string
	ClientVersion    *string
	RelatedRequestID *string
	AttachmentIDs    []string
}

func validateFeedback(input CreateFeedbackInput) (validatedFeedback, error) {
	category := strings.ToUpper(strings.TrimSpace(input.Category))
	if !slices.Contains([]string{FeedbackCategoryBug, FeedbackCategorySuggestion, FeedbackCategoryOther}, category) {
		return validatedFeedback{}, domainError(ErrorValidation, "invalid feedback category", nil)
	}
	title := strings.TrimSpace(input.Title)
	content := strings.TrimSpace(input.Content)
	if !runeLengthBetween(title, 1, 120) || containsFeedbackControl(title, false) {
		return validatedFeedback{}, domainError(ErrorValidation, "feedback title must be between 1 and 120 characters", nil)
	}
	if !runeLengthBetween(content, 1, 4000) || containsFeedbackControl(content, true) {
		return validatedFeedback{}, domainError(ErrorValidation, "feedback content must be between 1 and 4000 characters", nil)
	}
	pagePath, err := validateFeedbackPagePath(input.PagePath)
	if err != nil {
		return validatedFeedback{}, err
	}
	clientVersion := strings.TrimSpace(input.ClientVersion)
	if clientVersion != "" && (!runeLengthBetween(clientVersion, 1, 64) || !validClientVersion(clientVersion)) {
		return validatedFeedback{}, domainError(ErrorValidation, "invalid client version", nil)
	}
	relatedRequestID := strings.TrimSpace(input.RelatedRequestID)
	if relatedRequestID != "" && !validFeedbackRequestID(relatedRequestID) {
		return validatedFeedback{}, domainError(ErrorValidation, "invalid related request id", nil)
	}
	if len(input.AttachmentIDs) > 3 {
		return validatedFeedback{}, domainError(ErrorValidation, "feedback accepts at most 3 attachments", nil)
	}
	attachmentIDs := make([]string, 0, len(input.AttachmentIDs))
	seen := make(map[string]struct{}, len(input.AttachmentIDs))
	for _, value := range input.AttachmentIDs {
		value = strings.TrimSpace(value)
		if !validID(value) {
			return validatedFeedback{}, domainError(ErrorValidation, "invalid attachment id", nil)
		}
		if _, exists := seen[value]; exists {
			return validatedFeedback{}, domainError(ErrorValidation, "duplicate attachment id", nil)
		}
		seen[value] = struct{}{}
		attachmentIDs = append(attachmentIDs, value)
	}
	title = redactFeedback(title)
	content = redactFeedback(content)
	pagePath = redactOptionalFeedback(pagePath)
	clientVersionValue := optionalTrimmed(clientVersion)
	relatedRequestIDValue := optionalTrimmed(relatedRequestID)
	clientVersionValue = redactOptionalFeedback(clientVersionValue)
	relatedRequestIDValue = redactOptionalFeedback(relatedRequestIDValue)
	return validatedFeedback{
		Category: category, Title: title, Content: content, PagePath: pagePath,
		ClientVersion: clientVersionValue, RelatedRequestID: relatedRequestIDValue,
		AttachmentIDs: attachmentIDs,
	}, nil
}

func validateFeedbackPagePath(value string) (*string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if !runeLengthBetween(value, 1, 256) || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") {
		return nil, domainError(ErrorValidation, "invalid feedback page path", nil)
	}
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Host != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != value {
		return nil, domainError(ErrorValidation, "invalid feedback page path", nil)
	}
	return &value, nil
}

func validClientVersion(value string) bool {
	for _, character := range value {
		if (character < 'a' || character > 'z') &&
			(character < 'A' || character > 'Z') &&
			(character < '0' || character > '9') &&
			character != '.' && character != '-' && character != '_' && character != '+' {
			return false
		}
	}
	return true
}

func validFeedbackRequestID(value string) bool {
	if len(value) > 128 {
		return false
	}
	for _, character := range value {
		if character > unicode.MaxASCII || unicode.IsControl(character) || unicode.IsSpace(character) {
			return false
		}
	}
	return true
}

func containsFeedbackControl(value string, allowFormatting bool) bool {
	for _, character := range value {
		if allowFormatting && (character == '\n' || character == '\r' || character == '\t') {
			continue
		}
		if unicode.IsControl(character) {
			return true
		}
	}
	return false
}

func redactFeedback(value string) string {
	value = privateKeyPattern.ReplaceAllString(value, "[REDACTED PRIVATE KEY]")
	value = jwtPattern.ReplaceAllString(value, "[REDACTED JWT]")
	value = tokenPattern.ReplaceAllString(value, "[REDACTED TOKEN]")
	value = bearerPattern.ReplaceAllString(value, "Bearer [REDACTED]")
	value = headerSecretPattern.ReplaceAllString(value, "$1: [REDACTED]")
	return assignmentSecretPattern.ReplaceAllString(value, "$1=[REDACTED]")
}

func redactOptionalFeedback(value *string) *string {
	if value == nil {
		return nil
	}
	redacted := redactFeedback(*value)
	return &redacted
}
