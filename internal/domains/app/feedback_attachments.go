package app

import (
	"context"
	"encoding/hex"
	"errors"
	"io"
	"time"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	maxActiveFeedbackAttachments = 3
	maxFeedbackFileRollingDay    = 60
)

func (s *Service) InitiateFeedbackAttachment(
	ctx context.Context,
	input FeedbackAttachmentInitiateInput,
	actorID string,
) (FeedbackAttachmentInitiateResult, error) {
	if !s.cfg.FeedbackGitHubEnabled {
		return FeedbackAttachmentInitiateResult{}, domainError(ErrorInternal, "feedback service unavailable", nil)
	}
	fileName, err := validateFeedbackAttachmentInitiate(input)
	if err != nil {
		return FeedbackAttachmentInitiateResult{}, err
	}
	rawToken, err := newRawToken()
	if err != nil {
		return FeedbackAttachmentInitiateResult{}, s.internal("generate feedback upload token", err)
	}
	fileID := newID()
	expiresAt := time.Now().UTC().Add(s.cfg.AttachmentUploadTTL)
	hash := hex.EncodeToString(tokenHash(rawToken))

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return FeedbackAttachmentInitiateResult{}, s.internal("begin feedback attachment initiate", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	if err = q.LockAppFeedbackFileRateLimit(ctx, actorID); err != nil {
		return FeedbackAttachmentInitiateResult{}, s.internal("lock feedback attachment limit", err)
	}
	recent, err := q.CountRecentAppFeedbackFiles(ctx, actorID)
	if err != nil {
		return FeedbackAttachmentInitiateResult{}, s.internal("count feedback attachment initiations", err)
	}
	if recent >= maxFeedbackFileRollingDay {
		return FeedbackAttachmentInitiateResult{}, domainError(ErrorValidation, "feedback attachment daily limit reached", nil)
	}
	active, err := q.CountActiveUnsubmittedAppFeedbackFiles(ctx, actorID)
	if err != nil {
		return FeedbackAttachmentInitiateResult{}, s.internal("count active feedback attachments", err)
	}
	if active >= maxActiveFeedbackAttachments {
		return FeedbackAttachmentInitiateResult{}, domainError(ErrorConflict, "feedback attachment limit reached", nil)
	}
	if err = q.InsertAppFeedbackFile(ctx, dbsqlc.InsertAppFeedbackFileParams{
		ID: fileID, StorageKey: "feedback/" + fileID[:2] + "/" + fileID,
		OriginalName: fileName, ContentType: input.ContentType, DeclaredSize: input.Size,
		Sha256Hex: input.SHA256, UploadTokenHash: hash,
		UploadExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true}, CreatedBy: actorID,
	}); err != nil {
		return FeedbackAttachmentInitiateResult{}, s.writeError("insert feedback attachment", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return FeedbackAttachmentInitiateResult{}, s.writeError("commit feedback attachment initiate", err)
	}
	return FeedbackAttachmentInitiateResult{
		FileID: fileID, UploadURL: "/files/feedback/attachments/upload/" + rawToken, ExpiresAt: expiresAt,
	}, nil
}

func (s *Service) UploadFeedbackAttachment(
	ctx context.Context,
	rawToken string,
	body io.Reader,
	contentLength int64,
	contentType string,
) error {
	if rawToken == "" {
		return domainError(ErrorValidation, "invalid upload token", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return s.internal("begin feedback attachment upload", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	file, err := q.LockPendingAppFeedbackUpload(ctx, hex.EncodeToString(tokenHash(rawToken)))
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorValidation, "upload token is invalid or expired", nil)
	}
	if err != nil {
		return s.internal("lock feedback attachment upload", err)
	}
	if contentLength != file.DeclaredSize || contentType != file.ContentType {
		return domainError(ErrorValidation, "upload headers do not match declaration", nil)
	}
	if err = s.storage.Put(ctx, file.StorageKey, body, file.DeclaredSize, file.ContentType, file.Sha256Hex); err != nil {
		return domainError(ErrorValidation, err.Error(), err)
	}
	rows, err := q.MarkAppFeedbackFileReady(ctx, file.ID)
	if err != nil || rows != 1 {
		s.storage.Delete(file.StorageKey) //nolint:errcheck
		if err == nil {
			err = errors.New("feedback attachment state changed")
		}
		return s.writeError("mark feedback attachment ready", err)
	}
	if err = tx.Commit(ctx); err != nil {
		s.storage.Delete(file.StorageKey) //nolint:errcheck
		return s.writeError("commit feedback attachment upload", err)
	}
	return nil
}

func (s *Service) RemoveFeedbackAttachment(ctx context.Context, fileID, actorID string) error {
	if !validID(fileID) {
		return domainError(ErrorValidation, "invalid attachment id", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return s.internal("begin feedback attachment removal", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	file, err := q.LockUnsubmittedAppFeedbackFile(ctx, dbsqlc.LockUnsubmittedAppFeedbackFileParams{
		FileID: fileID, UserID: actorID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorConflict, "attachment not found or already submitted", nil)
	}
	if err != nil {
		return s.internal("lock feedback attachment removal", err)
	}
	rows, err := q.MarkAppFeedbackFileDeleted(ctx, file.ID)
	if err != nil || rows != 1 {
		if err == nil {
			err = errors.New("feedback attachment state changed")
		}
		return s.writeError("mark feedback attachment deleted", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return s.writeError("commit feedback attachment removal", err)
	}
	if err = s.storage.Delete(file.StorageKey); err != nil {
		s.logger.Warn("feedback attachment cleanup deferred", "fileId", file.ID, "error", err)
	}
	return nil
}

func (s *Service) CleanupFeedbackAttachments(ctx context.Context, batchSize int) (int, error) {
	if batchSize < 1 || batchSize > 1000 {
		batchSize = 100
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, s.internal("begin feedback attachment cleanup", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	rows, err := q.ListStaleAppFeedbackFiles(ctx, dbsqlc.ListStaleAppFeedbackFilesParams{
		OrphanBefore: pgtype.Timestamptz{
			Time: time.Now().UTC().Add(-s.cfg.FeedbackAttachmentOrphanTTL), Valid: true,
		},
		BatchSize: int32(batchSize),
	})
	if err != nil {
		return 0, s.internal("list stale feedback attachments", err)
	}
	removed := 0
	for _, file := range rows {
		if err = s.storage.Delete(file.StorageKey); err != nil {
			return removed, s.internal("delete stale feedback attachment", err)
		}
		count, deleteErr := q.DeleteAppFeedbackFile(ctx, file.ID)
		if deleteErr != nil {
			return removed, s.writeError("delete stale feedback attachment metadata", deleteErr)
		}
		if count == 1 {
			removed++
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return removed, s.writeError("commit feedback attachment cleanup", err)
	}
	return removed, nil
}
