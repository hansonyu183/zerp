package vou

import (
	"context"
	"errors"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) InitiateIntermediaryAttachment(
	ctx context.Context, stage string, input IntermediaryAttachmentInitiateInput,
	actorID, requestID string,
) (AttachmentInitiateResult, error) {
	if !validID(input.DocumentID) || !validID(input.ChildID) ||
		input.RootRevision < 1 || input.ChildRevision < 1 {
		return AttachmentInitiateResult{}, domainError(ErrorValidation, "invalid child attachment", nil, nil)
	}
	fileName, err := validateAttachmentInitiate(AttachmentInitiateInput{
		DocumentID: input.DocumentID, Revision: input.RootRevision, FileName: input.FileName,
		ContentType: input.ContentType, Size: input.Size, SHA256: input.SHA256,
	})
	if err != nil {
		return AttachmentInitiateResult{}, err
	}
	token, hash, err := randomToken()
	if err != nil {
		return AttachmentInitiateResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AttachmentInitiateResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	root, err := lockV2Root(ctx, tx, input.DocumentID)
	if err = v2RootConflict(err, root, input.RootRevision, ""); err != nil {
		return AttachmentInitiateResult{}, err
	}
	child, err := lockV2Child(ctx, tx, root.ID, stage, input.ChildID)
	if err != nil || child.Revision != input.ChildRevision || child.Status != StatusDraft {
		return AttachmentInitiateResult{}, domainError(ErrorConflict, "child document changed", nil, err)
	}
	var count int64
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM vou_intermediary_child_attachments
		WHERE child_id=$1`, child.ID).Scan(&count); err != nil {
		return AttachmentInitiateResult{}, err
	}
	if count >= maxAttachmentsPerDocument {
		return AttachmentInitiateResult{}, domainError(ErrorConflict, "attachment limit reached", nil, nil)
	}
	fileID := newID()
	expiresAt := time.Now().UTC().Add(s.uploadTTL)
	q := s.queries.WithTx(tx)
	if err = q.InsertVouFile(ctx, dbsqlc.InsertVouFileParams{
		ID: fileID, StorageKey: fileID[:2] + "/" + fileID, OriginalName: fileName,
		ContentType: input.ContentType, DeclaredSize: input.Size,
		Sha256Hex: strings.ToLower(strings.TrimSpace(input.SHA256)), UploadTokenHash: hash,
		UploadExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true}, ActorID: actorID,
	}); err != nil {
		return AttachmentInitiateResult{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO vou_intermediary_child_attachments(child_id,file_id,created_by)
		VALUES($1,$2,$3)`, child.ID, fileID, actorID); err != nil {
		return AttachmentInitiateResult{}, err
	}
	if err = tx.QueryRow(ctx, `UPDATE vou_intermediary_children SET revision=revision+1,
		updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 AND status='DRAFT'
		RETURNING revision`, actorID, child.ID, child.Revision).Scan(&child.Revision); err != nil {
		return AttachmentInitiateResult{}, domainError(ErrorConflict, "child document changed", nil, err)
	}
	rootRevision, err := touchV2Root(ctx, tx, root.ID, root.Revision, actorID)
	if err != nil {
		return AttachmentInitiateResult{}, err
	}
	if err = insertV2Audit(ctx, tx, root.ID, stage+"_ATTACHMENT_INITIATED",
		stringPtr(StatusDraft), StatusDraft, actorID, requestID, stage, child.ID, child.ChildNo,
		StatusDraft, nil, map[string]any{"fileId": fileID, "fileName": fileName, "size": input.Size}); err != nil {
		return AttachmentInitiateResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return AttachmentInitiateResult{}, err
	}
	return AttachmentInitiateResult{FileID: fileID, UploadURL: "/files/attachments/upload/" + token,
		ExpiresAt: expiresAt, Revision: rootRevision, RootRevision: rootRevision,
		ChildRevision: child.Revision}, nil
}

func (s *Service) DownloadIntermediaryAttachment(
	ctx context.Context, stage string, input IntermediaryAttachmentDownloadInput, actorID string,
) (AttachmentDownloadResult, error) {
	if !validID(input.DocumentID) || !validID(input.ChildID) || !validID(input.FileID) {
		return AttachmentDownloadResult{}, domainError(ErrorValidation, "invalid child attachment", nil, nil)
	}
	var found bool
	err := s.pool.QueryRow(ctx, `SELECT true FROM vou_files f
		JOIN vou_intermediary_child_attachments a ON a.file_id=f.id
		JOIN vou_intermediary_children c ON c.id=a.child_id
		WHERE f.id=$1 AND f.status='READY' AND c.id=$2 AND c.document_id=$3 AND c.stage=$4`,
		input.FileID, input.ChildID, input.DocumentID, stage).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return AttachmentDownloadResult{}, domainError(ErrorValidation, "attachment not found", nil, nil)
	}
	if err != nil {
		return AttachmentDownloadResult{}, err
	}
	token, hash, err := randomToken()
	if err != nil {
		return AttachmentDownloadResult{}, err
	}
	expiresAt := time.Now().UTC().Add(s.downloadTTL)
	if err = s.queries.InsertVouDownloadToken(ctx, dbsqlc.InsertVouDownloadTokenParams{
		TokenHash: hash, FileID: input.FileID,
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true}, ActorID: actorID,
	}); err != nil {
		return AttachmentDownloadResult{}, err
	}
	return AttachmentDownloadResult{DownloadURL: "/files/attachments/download/" + token,
		ExpiresAt: expiresAt}, nil
}

func (s *Service) RemoveIntermediaryAttachment(
	ctx context.Context, stage string, input IntermediaryAttachmentRemoveInput,
	actorID, requestID string,
) (MutationResult, error) {
	if !validID(input.DocumentID) || !validID(input.ChildID) || !validID(input.FileID) ||
		input.RootRevision < 1 || input.ChildRevision < 1 {
		return MutationResult{}, domainError(ErrorValidation, "invalid child attachment", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	root, err := lockV2Root(ctx, tx, input.DocumentID)
	if err = v2RootConflict(err, root, input.RootRevision, ""); err != nil {
		return MutationResult{}, err
	}
	child, err := lockV2Child(ctx, tx, root.ID, stage, input.ChildID)
	if err != nil || child.Revision != input.ChildRevision || child.Status != StatusDraft {
		return MutationResult{}, domainError(ErrorConflict, "child document changed", nil, err)
	}
	var storageKey, originalName string
	err = tx.QueryRow(ctx, `SELECT f.storage_key,f.original_name FROM vou_files f
		JOIN vou_intermediary_child_attachments a ON a.file_id=f.id
		WHERE a.child_id=$1 AND f.id=$2 FOR UPDATE OF f`,
		child.ID, input.FileID).Scan(&storageKey, &originalName)
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorValidation, "attachment not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_intermediary_child_attachments
		WHERE child_id=$1 AND file_id=$2`, child.ID, input.FileID); err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_files WHERE id=$1`, input.FileID); err != nil {
		return MutationResult{}, err
	}
	if err = tx.QueryRow(ctx, `UPDATE vou_intermediary_children SET revision=revision+1,
		updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`,
		actorID, child.ID, child.Revision).Scan(&child.Revision); err != nil {
		return MutationResult{}, err
	}
	rootRevision, err := touchV2Root(ctx, tx, root.ID, root.Revision, actorID)
	if err != nil {
		return MutationResult{}, err
	}
	if err = insertV2Audit(ctx, tx, root.ID, stage+"_ATTACHMENT_REMOVED",
		stringPtr(StatusDraft), StatusDraft, actorID, requestID, stage, child.ID, child.ChildNo,
		StatusDraft, nil, map[string]any{"fileId": input.FileID, "fileName": originalName}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	if err = s.storage.Delete(storageKey); err != nil {
		s.logger.Warn("child attachment file cleanup deferred", "fileId", input.FileID, "error", err)
	}
	child.Status = StatusDraft
	return v2Mutation(root, rootRevision, root.Status, &child, nil), nil
}
