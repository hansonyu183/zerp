package app

import (
	"context"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"math/rand/v2"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const feedbackPollInterval = 5 * time.Second

type FeedbackIssue struct {
	Number int64
	URL    string
}

type FeedbackIssueClient interface {
	FindByMarker(context.Context, string) (FeedbackIssue, bool, error)
	Create(context.Context, string, string, []string) (FeedbackIssue, error)
}

type feedbackPublishError interface {
	error
	Retryable() bool
	RetryAfter() time.Duration
	ErrorCode() string
}

type FeedbackPublisher struct {
	queries *dbsqlc.Queries
	client  FeedbackIssueClient
	logger  *slog.Logger
}

func NewFeedbackPublisher(pool *pgxpool.Pool, client FeedbackIssueClient, logger *slog.Logger) *FeedbackPublisher {
	if logger == nil {
		logger = slog.Default()
	}
	return &FeedbackPublisher{queries: dbsqlc.New(pool), client: client, logger: logger}
}

func (p *FeedbackPublisher) Run(ctx context.Context) error {
	for {
		processed, err := p.publishOne(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return nil
			}
			return err
		}
		if processed {
			continue
		}
		timer := time.NewTimer(feedbackPollInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
}

func (p *FeedbackPublisher) publishOne(ctx context.Context) (bool, error) {
	feedback, err := p.queries.ClaimAppFeedbackForPublishing(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim feedback for publishing: %w", err)
	}
	attachments, err := p.queries.ListAppFeedbackAttachments(ctx, feedback.ID)
	if err != nil {
		return true, fmt.Errorf("list feedback attachments: %w", err)
	}
	marker := feedbackMarker(feedback.ID)
	issue, exists, err := p.client.FindByMarker(ctx, marker)
	if err == nil && !exists {
		issue, err = p.client.Create(
			ctx, feedbackIssueTitle(feedback), feedbackIssueBody(feedback, attachments, marker),
			feedbackIssueLabels(feedback.Category),
		)
	}
	if err == nil {
		rows, updateErr := p.queries.MarkAppFeedbackPublished(ctx, dbsqlc.MarkAppFeedbackPublishedParams{
			IssueNumber: &issue.Number, IssueUrl: &issue.URL, ID: feedback.ID,
		})
		if updateErr != nil {
			return true, fmt.Errorf("mark feedback published: %w", updateErr)
		}
		if rows != 1 {
			return true, errors.New("feedback publication lease was lost")
		}
		p.logger.Info("feedback published", "feedbackId", feedback.ID, "status", FeedbackStatusPublished, "attempt", feedback.AttemptCount)
		return true, nil
	}

	status, nextAttemptAt, code := feedbackFailure(feedback.AttemptCount, err)
	rows, updateErr := p.queries.RescheduleAppFeedback(ctx, dbsqlc.RescheduleAppFeedbackParams{
		Status: status, NextAttemptAt: timestamptz(nextAttemptAt), ErrorCode: &code, ID: feedback.ID,
	})
	if updateErr != nil {
		return true, fmt.Errorf("reschedule feedback publication: %w", updateErr)
	}
	if rows != 1 {
		return true, errors.New("feedback publication lease was lost")
	}
	p.logger.Warn("feedback publication failed",
		"feedbackId", feedback.ID, "status", status, "attempt", feedback.AttemptCount, "errorCode", code,
	)
	return true, nil
}

func feedbackFailure(attempt int32, err error) (string, time.Time, string) {
	status := FeedbackStatusPending
	retryable, retryAfter, code := true, time.Duration(0), "unknown"
	var publishErr feedbackPublishError
	if errors.As(err, &publishErr) {
		retryable = publishErr.Retryable()
		retryAfter = publishErr.RetryAfter()
		code = publishErr.ErrorCode()
	}
	if !retryable || attempt >= 10 {
		status = FeedbackStatusFailed
		return status, time.Now().UTC(), code
	}
	exponent := max(0, min(int(attempt-1), 6))
	delay := time.Minute << exponent
	jitterLimit := int64(delay / 4)
	if jitterLimit > 0 {
		delay += time.Duration(rand.Int64N(jitterLimit + 1))
	}
	if delay > time.Hour {
		delay = time.Hour
	}
	if retryAfter > delay {
		delay = retryAfter
	}
	return status, time.Now().UTC().Add(delay), code
}

func feedbackMarker(id string) string {
	return "<!-- zerp-feedback:" + id + " -->"
}

func feedbackIssueTitle(feedback dbsqlc.AppFeedback) string {
	return fmt.Sprintf("[用户反馈][%s] %s", feedback.Category, feedback.Title)
}

func feedbackIssueLabels(category string) []string {
	labels := []string{"automation:blocked"}
	switch category {
	case FeedbackCategoryBug:
		labels = append(labels, "bug")
	case FeedbackCategorySuggestion:
		labels = append(labels, "enhancement")
	}
	return labels
}

func feedbackIssueBody(
	feedback dbsqlc.AppFeedback,
	attachments []dbsqlc.AppFeedbackAttachment,
	marker string,
) string {
	var body strings.Builder
	body.WriteString(marker)
	body.WriteString("\n\n## 用户反馈\n\n")
	writeIssueField(&body, "反馈 ID", feedback.ID)
	writeIssueField(&body, "分类", feedback.Category)
	writeIssueField(&body, "提交时间", feedback.CreatedAt.Time.UTC().Format(time.RFC3339))
	if feedback.PagePath != nil {
		writeIssueField(&body, "页面", *feedback.PagePath)
	}
	if feedback.ClientVersion != nil {
		writeIssueField(&body, "客户端版本", *feedback.ClientVersion)
	}
	if feedback.RelatedRequestID != nil {
		writeIssueField(&body, "关联 Request ID", *feedback.RelatedRequestID)
	}
	body.WriteString("\n### 内容\n\n<pre>")
	body.WriteString(html.EscapeString(feedback.Content))
	body.WriteString("</pre>\n")
	if len(attachments) > 0 {
		body.WriteString("\n### 附件元数据\n\n")
		for _, attachment := range attachments {
			body.WriteString("- <code>")
			body.WriteString(html.EscapeString(attachment.OriginalName))
			body.WriteString("</code>；")
			body.WriteString(html.EscapeString(attachment.ContentType))
			body.WriteString("；")
			body.WriteString(fmt.Sprintf("%d bytes；SHA-256 <code>%s</code>\n",
				attachment.DeclaredSize, html.EscapeString(attachment.Sha256Hex)))
		}
		body.WriteString("\n> 文件内容未公开，以上仅为提交时的附件元数据快照。\n")
	}
	return body.String()
}

func writeIssueField(body *strings.Builder, label, value string) {
	body.WriteString("- **")
	body.WriteString(label)
	body.WriteString("**：<code>")
	body.WriteString(html.EscapeString(value))
	body.WriteString("</code>\n")
}
