package app

import (
	"strings"
	"testing"
)

func TestValidateFeedbackAcceptsUnicodeAndStrictAttachments(t *testing.T) {
	input := CreateFeedbackInput{
		Category: "bug", Title: "保存失败", Content: "点击保存后页面没有响应",
		PagePath: "/vou/sale-order", ClientVersion: "1.2.3+abc",
		RelatedRequestID: "request-123",
		AttachmentIDs:    []string{"01J00000000000000000000000"},
	}
	validated, err := validateFeedback(input)
	if err != nil {
		t.Fatalf("validateFeedback() error = %v", err)
	}
	if validated.Category != FeedbackCategoryBug || validated.PagePath == nil ||
		len(validated.AttachmentIDs) != 1 {
		t.Fatalf("validated feedback = %#v", validated)
	}
}

func TestValidateFeedbackRejectsUnsafeContextAndAttachments(t *testing.T) {
	base := CreateFeedbackInput{Category: "OTHER", Title: "反馈", Content: "内容"}
	tests := []struct {
		name   string
		mutate func(*CreateFeedbackInput)
	}{
		{name: "external path", mutate: func(input *CreateFeedbackInput) { input.PagePath = "https://example.com/path" }},
		{name: "query path", mutate: func(input *CreateFeedbackInput) { input.PagePath = "/path?token=secret" }},
		{name: "invalid version", mutate: func(input *CreateFeedbackInput) { input.ClientVersion = "version one" }},
		{name: "invalid request id", mutate: func(input *CreateFeedbackInput) { input.RelatedRequestID = "request id" }},
		{name: "title control", mutate: func(input *CreateFeedbackInput) { input.Title = "标题\n下一行" }},
		{name: "content nul", mutate: func(input *CreateFeedbackInput) { input.Content = "内容\u0000" }},
		{name: "duplicate attachment", mutate: func(input *CreateFeedbackInput) {
			input.AttachmentIDs = []string{"01J00000000000000000000000", "01J00000000000000000000000"}
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := base
			test.mutate(&input)
			if _, err := validateFeedback(input); !errorIsKind(err, ErrorValidation) {
				t.Fatalf("error = %v, want validation", err)
			}
		})
	}
}

func TestRedactFeedbackRemovesSensitiveValues(t *testing.T) {
	input := CreateFeedbackInput{
		Category: "BUG",
		Title:    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
		Content: strings.Join([]string{
			"password=super-secret",
			"Cookie: session=secret",
			"eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop",
			"github_pat_abcdefghijklmnopqrstuvwxyz123456",
			"-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
		}, "\n"),
	}
	validated, err := validateFeedback(input)
	if err != nil {
		t.Fatalf("validateFeedback() error = %v", err)
	}
	for _, secret := range []string{"super-secret", "session=secret", "eyJabcdefghijk", "github_pat_", "BEGIN PRIVATE KEY"} {
		if strings.Contains(validated.Title+"\n"+validated.Content, secret) {
			t.Fatalf("redacted feedback still contains %q: %#v", secret, validated)
		}
	}
}
