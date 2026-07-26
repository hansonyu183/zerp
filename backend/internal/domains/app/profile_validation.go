package app

import (
	"net/url"
	"strings"
)

func validateSaveProfile(input SaveProfileInput) (SaveProfileInput, error) {
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	if !runeLengthBetween(input.DisplayName, 1, 128) {
		return SaveProfileInput{}, domainError(
			ErrorValidation,
			"display name must be between 1 and 128 characters",
			nil,
		)
	}
	if input.AvatarURL == nil {
		return input, nil
	}
	avatarURL := strings.TrimSpace(*input.AvatarURL)
	if avatarURL == "" {
		input.AvatarURL = nil
		return input, nil
	}
	if !runeLengthBetween(avatarURL, 1, 500) {
		return SaveProfileInput{}, domainError(ErrorValidation, "invalid avatar URL", nil)
	}
	parsed, err := url.Parse(avatarURL)
	if err != nil || !strings.EqualFold(parsed.Scheme, "https") || parsed.Hostname() == "" ||
		parsed.User != nil || parsed.Fragment != "" || parsed.Opaque != "" {
		return SaveProfileInput{}, domainError(ErrorValidation, "invalid avatar URL", nil)
	}
	input.AvatarURL = &avatarURL
	return input, nil
}

func optionalStringEqual(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}
