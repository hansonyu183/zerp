package app

import (
	"context"
	"errors"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

const maxFeedbackPerRollingDay = 20

func (s *Service) AuthorizeSession(
	ctx context.Context,
	rawToken, csrfToken, path, requestID string,
) (Principal, error) {
	principal, err := s.loadPrincipal(ctx, rawToken)
	if err != nil {
		return Principal{}, err
	}
	if csrfToken == "" || !constantTimeHashEqual(principal.CSRFHash, csrfToken) {
		s.auditAuthorizationDenied(ctx, principal, path, requestID, "csrf")
		return Principal{}, domainError(ErrorForbidden, "csrf validation failed", nil)
	}
	idleEnds := time.Now().UTC().Add(s.cfg.SessionIdleTimeout)
	if err = s.queries.TouchAppSession(ctx, dbsqlc.TouchAppSessionParams{
		ID: principal.SessionID, IdleExpiresAt: timestamptz(idleEnds),
	}); err != nil {
		return Principal{}, s.internal("touch feedback session", err)
	}
	return principal, nil
}

func (s *Service) CreateFeedback(
	ctx context.Context,
	input CreateFeedbackInput,
	actorID string,
) (FeedbackCreatedView, error) {
	validated, err := validateFeedback(input)
	if err != nil {
		return FeedbackCreatedView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return FeedbackCreatedView{}, s.internal("begin feedback submission", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	if err = q.LockAppFeedbackRateLimit(ctx, actorID); err != nil {
		return FeedbackCreatedView{}, s.internal("lock feedback rate limit", err)
	}
	feedbackID := feedbackIDForSubmission(actorID, validated.SubmissionKey)
	existing, err := q.GetAppFeedbackByOwner(ctx, dbsqlc.GetAppFeedbackByOwnerParams{
		ID: feedbackID, UserID: actorID,
	})
	if err == nil {
		matches, matchErr := feedbackSubmissionMatches(ctx, q, existing, validated)
		if matchErr != nil {
			return FeedbackCreatedView{}, s.internal("verify repeated feedback submission", matchErr)
		}
		if !matches {
			return FeedbackCreatedView{}, domainError(ErrorConflict, "feedback submission key was already used", nil)
		}
		return FeedbackCreatedView{
			FeedbackID: existing.ID, Status: FeedbackStatusPending, SubmittedAt: existing.CreatedAt.Time,
		}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return FeedbackCreatedView{}, s.internal("find repeated feedback submission", err)
	}
	count, err := q.CountRecentAppFeedback(ctx, actorID)
	if err != nil {
		return FeedbackCreatedView{}, s.internal("count recent feedback", err)
	}
	if count >= maxFeedbackPerRollingDay {
		return FeedbackCreatedView{}, domainError(ErrorValidation, "feedback daily limit reached", nil)
	}
	attachments, err := q.ListReadyAppFeedbackFilesForCreate(ctx, dbsqlc.ListReadyAppFeedbackFilesForCreateParams{
		FileIds: validated.AttachmentIDs, UserID: actorID,
	})
	if err != nil {
		return FeedbackCreatedView{}, s.internal("resolve feedback attachments", err)
	}
	attachmentsByID := make(map[string]dbsqlc.AppFeedbackFile, len(attachments))
	for _, attachment := range attachments {
		attachmentsByID[attachment.ID] = attachment
	}
	if len(attachmentsByID) != len(validated.AttachmentIDs) {
		return FeedbackCreatedView{}, domainError(ErrorValidation, "attachment not found or not ready", nil)
	}
	if err = q.InsertAppFeedback(ctx, dbsqlc.InsertAppFeedbackParams{
		ID: feedbackID, UserID: actorID, Category: validated.Category, Title: validated.Title,
		Content: validated.Content, PagePath: validated.PagePath, ClientVersion: validated.ClientVersion,
		RelatedRequestID: validated.RelatedRequestID,
	}); err != nil {
		return FeedbackCreatedView{}, s.writeError("insert feedback", err)
	}
	for index, attachmentID := range validated.AttachmentIDs {
		attachment := attachmentsByID[attachmentID]
		if err = q.InsertAppFeedbackAttachment(ctx, dbsqlc.InsertAppFeedbackAttachmentParams{
			FeedbackID: feedbackID, FileID: attachment.ID, OriginalName: redactFeedback(attachment.OriginalName),
			ContentType: attachment.ContentType, DeclaredSize: attachment.DeclaredSize,
			Sha256Hex: attachment.Sha256Hex, Position: int16(index + 1), Source: "FEEDBACK",
		}); err != nil {
			return FeedbackCreatedView{}, s.writeError("insert feedback attachment", err)
		}
	}
	createdRow, err := q.GetAppFeedbackByOwner(ctx, dbsqlc.GetAppFeedbackByOwnerParams{
		ID: feedbackID, UserID: actorID,
	})
	if err != nil {
		return FeedbackCreatedView{}, s.internal("read created feedback", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return FeedbackCreatedView{}, s.internal("commit feedback submission", err)
	}
	s.logger.Info("feedback accepted", "feedbackId", feedbackID, "status", FeedbackStatusPending)
	return FeedbackCreatedView{
		FeedbackID: feedbackID, Status: FeedbackStatusPending, SubmittedAt: createdRow.CreatedAt.Time,
	}, nil
}

func feedbackSubmissionMatches(
	ctx context.Context,
	q *dbsqlc.Queries,
	existing dbsqlc.AppFeedback,
	validated validatedFeedback,
) (bool, error) {
	if existing.Category != validated.Category || existing.Title != validated.Title ||
		existing.Content != validated.Content || !optionalStringEqual(existing.PagePath, validated.PagePath) ||
		!optionalStringEqual(existing.ClientVersion, validated.ClientVersion) ||
		!optionalStringEqual(existing.RelatedRequestID, validated.RelatedRequestID) {
		return false, nil
	}
	attachments, err := q.ListAppFeedbackAttachments(ctx, existing.ID)
	if err != nil {
		return false, err
	}
	if len(attachments) != len(validated.AttachmentIDs) {
		return false, nil
	}
	for index, attachment := range attachments {
		if attachment.FileID != validated.AttachmentIDs[index] {
			return false, nil
		}
	}
	return true, nil
}

func (s *Service) GetFeedback(ctx context.Context, feedbackID, actorID string) (FeedbackView, error) {
	if !validID(feedbackID) {
		return FeedbackView{}, domainError(ErrorValidation, "invalid feedback id", nil)
	}
	row, err := s.queries.GetAppFeedbackByOwner(ctx, dbsqlc.GetAppFeedbackByOwnerParams{
		ID: feedbackID, UserID: actorID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return FeedbackView{}, domainError(ErrorNotFound, "feedback not found", nil)
	}
	if err != nil {
		return FeedbackView{}, s.internal("get feedback", err)
	}
	status := row.Status
	if status == FeedbackStatusProcessing {
		status = FeedbackStatusPending
	}
	var publishedAt *time.Time
	if row.PublishedAt.Valid {
		value := row.PublishedAt.Time
		publishedAt = &value
	}
	return FeedbackView{
		FeedbackID: row.ID, Category: row.Category, Title: row.Title, Status: status,
		IssueURL: row.GithubIssueUrl, SubmittedAt: row.CreatedAt.Time, PublishedAt: publishedAt,
	}, nil
}
