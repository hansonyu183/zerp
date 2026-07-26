package app

import (
	"strings"
	"testing"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestFeedbackIssueContainsBlockedLabelAndNoIdentity(t *testing.T) {
	feedback := dbsqlc.AppFeedback{
		ID: "01J00000000000000000000000", UserID: "01J00000000000000000000001",
		Category: FeedbackCategoryBug, Title: "保存失败", Content: "<script>alert(1)</script>",
		PagePath: stringPointer("/vou/order"), ClientVersion: stringPointer("1.2.3"),
		CreatedAt: pgtype.Timestamptz{Time: time.Date(2026, 7, 25, 1, 2, 3, 0, time.UTC), Valid: true},
	}
	attachments := []dbsqlc.AppFeedbackAttachment{{
		OriginalName: "invoice<script>.pdf", ContentType: "application/pdf",
		DeclaredSize: 123, Sha256Hex: strings.Repeat("a", 64),
	}}
	body := feedbackIssueBody(feedback, attachments, feedbackMarker(feedback.ID))
	if strings.Contains(body, feedback.UserID) || strings.Contains(body, "<script>") {
		t.Fatalf("issue body leaked identity or unsafe HTML: %s", body)
	}
	for _, required := range []string{feedback.ID, "&lt;script&gt;", "文件内容未公开", strings.Repeat("a", 64)} {
		if !strings.Contains(body, required) {
			t.Fatalf("issue body missing %q: %s", required, body)
		}
	}
	labels := feedbackIssueLabels(feedback.Category)
	if len(labels) != 2 || labels[0] != "automation:blocked" || labels[1] != "bug" {
		t.Fatalf("labels = %#v", labels)
	}
}

func TestFeedbackFailureStopsAfterTenAttempts(t *testing.T) {
	status, _, code := feedbackFailure(10, errorsStub{})
	if status != FeedbackStatusFailed || code != "network" {
		t.Fatalf("failure = status:%s code:%s", status, code)
	}
	status, next, _ := feedbackFailure(1, errorsStub{})
	if status != FeedbackStatusPending || !next.After(time.Now()) {
		t.Fatalf("retry = status:%s next:%s", status, next)
	}
}

type errorsStub struct{}

func (errorsStub) Error() string             { return "network" }
func (errorsStub) Retryable() bool           { return true }
func (errorsStub) RetryAfter() time.Duration { return 0 }
func (errorsStub) ErrorCode() string         { return "network" }
