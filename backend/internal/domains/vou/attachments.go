package vou

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const maxAttachmentsPerDocument = 10

type DownloadFile struct {
	Reader      *os.File
	FileName    string
	ContentType string
	Size        int64
}

func (s *Service) InitiateAttachment(
	ctx context.Context,
	entity string,
	input AttachmentInitiateInput,
	actorID, requestID string,
) (AttachmentInitiateResult, error) {
	if !validEntity(entity) {
		return AttachmentInitiateResult{}, domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	fileName, err := validateAttachmentInitiate(input)
	if err != nil {
		return AttachmentInitiateResult{}, err
	}
	token, hash, err := randomToken()
	if err != nil {
		return AttachmentInitiateResult{}, s.internal("generate upload token", err)
	}
	fileID := newID()
	storageKey := fileID[:2] + "/" + fileID
	expiresAt := time.Now().UTC().Add(s.uploadTTL)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AttachmentInitiateResult{}, s.internal("begin attachment initiate", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return AttachmentInitiateResult{}, err
	}
	count, err := q.CountVouAttachments(ctx, input.DocumentID)
	if err != nil {
		return AttachmentInitiateResult{}, s.internal("count attachments", err)
	}
	if count >= maxAttachmentsPerDocument {
		return AttachmentInitiateResult{}, domainError(ErrorConflict, "attachment limit reached", nil, nil)
	}
	if err = q.InsertVouFile(ctx, dbsqlc.InsertVouFileParams{
		ID: fileID, StorageKey: storageKey, OriginalName: fileName,
		ContentType: input.ContentType, DeclaredSize: input.Size,
		Sha256Hex: strings.ToLower(strings.TrimSpace(input.SHA256)), UploadTokenHash: hash,
		UploadExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true}, ActorID: actorID,
	}); err != nil {
		return AttachmentInitiateResult{}, s.writeError("insert attachment", err)
	}
	if err = q.InsertVouDocumentAttachment(ctx, dbsqlc.InsertVouDocumentAttachmentParams{
		DocumentID: input.DocumentID, FileID: fileID, ActorID: actorID,
	}); err != nil {
		return AttachmentInitiateResult{}, s.writeError("link attachment", err)
	}
	revision, err := q.TouchVouDraftAttachment(ctx, dbsqlc.TouchVouDraftAttachmentParams{
		ActorID: actorID, ID: input.DocumentID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return AttachmentInitiateResult{}, s.writeError("touch attachment document", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: "ATTACHMENT_INITIATED",
		From: stringPtr(StatusDraft), To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"fileId": fileID, "fileName": fileName, "size": input.Size},
	}); err != nil {
		return AttachmentInitiateResult{}, s.writeError("audit attachment initiate", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return AttachmentInitiateResult{}, s.writeError("commit attachment initiate", err)
	}
	return AttachmentInitiateResult{
		FileID: fileID, UploadURL: "/files/attachments/upload/" + token,
		ExpiresAt: expiresAt, Revision: revision,
	}, nil
}

func (s *Service) Upload(
	ctx context.Context,
	token string,
	body io.Reader,
	contentLength int64,
	contentType, requestID string,
) error {
	if token == "" {
		return domainError(ErrorValidation, "invalid upload token", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return s.internal("begin upload", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	file, err := q.LockPendingVouUpload(ctx, tokenHash(token))
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorValidation, "upload token is invalid or expired", nil, nil)
	}
	if err != nil {
		return s.internal("lock upload", err)
	}
	if file.DocumentStatus != StatusDraft {
		return domainError(ErrorConflict, "document is not a draft", nil, nil)
	}
	if contentLength != file.DeclaredSize || contentType != file.ContentType {
		return domainError(ErrorValidation, "upload headers do not match declaration", nil, nil)
	}
	if err = s.storage.Put(ctx, file.StorageKey, body, file.DeclaredSize, file.ContentType, file.Sha256Hex); err != nil {
		return domainError(ErrorValidation, err.Error(), nil, err)
	}
	rows, err := q.MarkVouFileReady(ctx, file.ID)
	if err != nil || rows != 1 {
		s.storage.Delete(file.StorageKey) //nolint:errcheck
		return s.writeError("mark attachment ready", err)
	}
	err = insertAudit(ctx, q, auditInput{
		DocumentID: file.DocumentID, Entity: file.Entity, Event: "ATTACHMENT_UPLOADED",
		From: stringPtr(StatusDraft), To: StatusDraft, ActorID: file.CreatedBy, RequestID: requestID,
		Summary: map[string]any{"fileId": file.ID, "size": file.DeclaredSize},
	})
	if err != nil {
		s.storage.Delete(file.StorageKey) //nolint:errcheck
		return s.writeError("audit attachment upload", err)
	}
	if err = tx.Commit(ctx); err != nil {
		s.storage.Delete(file.StorageKey) //nolint:errcheck
		return s.writeError("commit attachment upload", err)
	}
	return nil
}

func (s *Service) CreateDownload(
	ctx context.Context,
	entity string,
	input AttachmentDownloadInput,
	actorID string,
) (AttachmentDownloadResult, error) {
	if !validEntity(entity) || !validID(input.DocumentID) || !validID(input.FileID) {
		return AttachmentDownloadResult{}, domainError(ErrorValidation, "invalid attachment", nil, nil)
	}
	file, err := s.queries.GetReadyVouAttachment(ctx, dbsqlc.GetReadyVouAttachmentParams{
		FileID: input.FileID, DocumentID: input.DocumentID,
	})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && file.Entity != entity) {
		return AttachmentDownloadResult{}, domainError(ErrorValidation, "attachment not found", nil, nil)
	}
	if err != nil {
		return AttachmentDownloadResult{}, s.internal("get attachment", err)
	}
	token, hash, err := randomToken()
	if err != nil {
		return AttachmentDownloadResult{}, s.internal("generate download token", err)
	}
	expiresAt := time.Now().UTC().Add(s.downloadTTL)
	if err = s.queries.InsertVouDownloadToken(ctx, dbsqlc.InsertVouDownloadTokenParams{
		TokenHash: hash, FileID: file.ID, ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true}, ActorID: actorID,
	}); err != nil {
		return AttachmentDownloadResult{}, s.writeError("insert download token", err)
	}
	return AttachmentDownloadResult{
		DownloadURL: "/files/attachments/download/" + token, ExpiresAt: expiresAt,
	}, nil
}

func (s *Service) OpenDownload(ctx context.Context, token string) (DownloadFile, error) {
	if token == "" {
		return DownloadFile{}, domainError(ErrorValidation, "invalid download token", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DownloadFile{}, s.internal("begin download", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	row, err := s.queries.WithTx(tx).ConsumeVouDownloadToken(ctx, tokenHash(token))
	if errors.Is(err, pgx.ErrNoRows) {
		return DownloadFile{}, domainError(ErrorValidation, "download token is invalid or expired", nil, nil)
	}
	if err != nil {
		return DownloadFile{}, s.internal("consume download token", err)
	}
	reader, err := s.storage.Open(row.StorageKey)
	if err != nil {
		return DownloadFile{}, s.internal("open attachment", err)
	}
	if err = tx.Commit(ctx); err != nil {
		reader.Close() //nolint:errcheck
		return DownloadFile{}, s.writeError("commit download", err)
	}
	return DownloadFile{Reader: reader, FileName: row.OriginalName, ContentType: row.ContentType, Size: row.DeclaredSize}, nil
}

func (s *Service) RemoveAttachment(
	ctx context.Context,
	entity string,
	input AttachmentRemoveInput,
	actorID, requestID string,
) (MutationResult, error) {
	if !validEntity(entity) || !validID(input.FileID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid attachment", nil, nil)
	}
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin remove attachment", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	file, err := q.LockVouAttachmentForRemoval(ctx, dbsqlc.LockVouAttachmentForRemovalParams{
		DocumentID: input.DocumentID, FileID: input.FileID,
	})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && file.Entity != entity) {
		return MutationResult{}, domainError(ErrorValidation, "attachment not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock attachment", err)
	}
	if rows, deleteErr := q.DeleteVouDocumentAttachment(ctx, dbsqlc.DeleteVouDocumentAttachmentParams{
		DocumentID: input.DocumentID, FileID: input.FileID,
	}); deleteErr != nil || rows != 1 {
		return MutationResult{}, s.writeError("unlink attachment", deleteErr)
	}
	if rows, deleteErr := q.DeleteVouFile(ctx, input.FileID); deleteErr != nil || rows != 1 {
		return MutationResult{}, s.writeError("delete attachment metadata", deleteErr)
	}
	revision, err := q.TouchVouDraftAttachment(ctx, dbsqlc.TouchVouDraftAttachmentParams{
		ActorID: actorID, ID: input.DocumentID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("touch attachment document", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: "ATTACHMENT_REMOVED",
		From: stringPtr(StatusDraft), To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"fileId": file.ID, "fileName": file.OriginalName},
	}); err != nil {
		return MutationResult{}, s.writeError("audit attachment removal", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit attachment removal", err)
	}
	if err = s.storage.Delete(file.StorageKey); err != nil {
		s.logger.Warn("attachment file cleanup deferred", "fileId", file.ID, "error", err)
	}
	return mutation(document, StatusDraft, revision), nil
}

func (s *Service) CleanupAttachments(ctx context.Context, batchSize int) (int, error) {
	if batchSize < 1 || batchSize > 1000 {
		batchSize = 100
	}
	rows, err := s.queries.ListExpiredPendingVouFiles(ctx, int32(batchSize))
	if err != nil {
		return 0, s.internal("list expired attachments", err)
	}
	removed := 0
	for _, row := range rows {
		tx, beginErr := s.pool.Begin(ctx)
		if beginErr != nil {
			return removed, s.internal("begin attachment cleanup", beginErr)
		}
		q := s.queries.WithTx(tx)
		storageKey, lockErr := q.LockExpiredPendingVouFile(ctx, row.ID)
		if errors.Is(lockErr, pgx.ErrNoRows) {
			tx.Rollback(ctx) //nolint:errcheck
			continue
		}
		if lockErr != nil {
			tx.Rollback(ctx) //nolint:errcheck
			return removed, s.writeError("lock expired attachment", lockErr)
		}
		_, err = q.DeleteVouAttachmentByFileID(ctx, row.ID)
		if err == nil {
			_, err = q.DeleteVouFile(ctx, row.ID)
		}
		if err == nil {
			err = tx.Commit(ctx)
		} else {
			tx.Rollback(ctx) //nolint:errcheck
		}
		if err != nil {
			return removed, s.writeError("cleanup attachment metadata", err)
		}
		if err = s.storage.Delete(storageKey); err != nil {
			return removed, s.internal("cleanup attachment file", err)
		}
		removed++
	}
	if err = s.queries.DeleteExpiredVouDownloadTokens(ctx); err != nil {
		return removed, s.internal("cleanup download tokens", err)
	}
	keys, err := s.queries.ListAllVouStorageKeys(ctx)
	if err != nil {
		return removed, s.internal("list attachment storage keys", err)
	}
	known := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		known[key] = struct{}{}
	}
	orphaned, err := s.storage.RemoveOrphans(known, "feedback", "customer")
	if err != nil {
		return removed, s.internal("cleanup orphaned attachment files", err)
	}
	staleTemps, err := s.storage.RemoveStaleTemps(time.Now().UTC().Add(-s.uploadTTL))
	if err != nil {
		return removed + orphaned, s.internal("cleanup stale attachment temp files", err)
	}
	return removed + orphaned + staleTemps, nil
}
