package app

import (
	"strings"
	"testing"
)

func TestValidateSaveProfile(t *testing.T) {
	avatarURL := " https://images.example.com/avatar.png?size=large "
	validated, err := validateSaveProfile(SaveProfileInput{
		DisplayName: " 中文名称 ",
		AvatarURL:   &avatarURL,
	})
	if err != nil {
		t.Fatalf("validate profile: %v", err)
	}
	if validated.DisplayName != "中文名称" || validated.AvatarURL == nil ||
		*validated.AvatarURL != "https://images.example.com/avatar.png?size=large" {
		t.Fatalf("validated profile = %#v", validated)
	}
	emptyAvatar := " "
	validated, err = validateSaveProfile(SaveProfileInput{
		DisplayName: "Alice",
		AvatarURL:   &emptyAvatar,
	})
	if err != nil || validated.AvatarURL != nil {
		t.Fatalf("empty avatar profile=%#v error=%v", validated, err)
	}
}

func TestValidateSaveProfileRejectsInvalidFields(t *testing.T) {
	validAvatar := "https://images.example.com/avatar.png"
	tests := []struct {
		name  string
		input SaveProfileInput
	}{
		{name: "empty display name", input: SaveProfileInput{DisplayName: " ", AvatarURL: &validAvatar}},
		{name: "long display name", input: SaveProfileInput{DisplayName: strings.Repeat("中", 129), AvatarURL: &validAvatar}},
		{name: "http avatar", input: SaveProfileInput{DisplayName: "Alice", AvatarURL: stringPointer("http://example.com/a.png")}},
		{name: "javascript avatar", input: SaveProfileInput{DisplayName: "Alice", AvatarURL: stringPointer("javascript:alert(1)")}},
		{name: "relative avatar", input: SaveProfileInput{DisplayName: "Alice", AvatarURL: stringPointer("/a.png")}},
		{name: "avatar credentials", input: SaveProfileInput{DisplayName: "Alice", AvatarURL: stringPointer("https://user:pass@example.com/a.png")}},
		{name: "avatar fragment", input: SaveProfileInput{DisplayName: "Alice", AvatarURL: stringPointer("https://example.com/a.png#fragment")}},
		{name: "long avatar", input: SaveProfileInput{DisplayName: "Alice", AvatarURL: stringPointer("https://example.com/" + strings.Repeat("a", 500))}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := validateSaveProfile(test.input); !errorIsKind(err, ErrorValidation) {
				t.Fatalf("error=%v, want validation", err)
			}
		})
	}
}
