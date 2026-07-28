package wfl

import (
	"context"
	"errors"
	"strings"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/jackc/pgx/v5"
)

func attachmentStage(action string) string {
	prefix := strings.SplitN(action, "-", 2)[0]
	return map[string]string{"procurement": StageProcurement, "receipt": StageReceipt,
		"delivery": StageDelivery, "signoff": StageSignoff,
		"order": StagePurchaseOrder, "inbound": StagePurchaseInbound}[prefix]
}

func (s *Service) verifyAttachmentDocument(ctx context.Context, processID, documentID, stage string, revision int64) (string, error) {
	if !validID(processID) || !validID(documentID) || stage == "" {
		return "", validation("invalid attachment document", nil)
	}
	var entity string
	var actual int64
	err := s.pool.QueryRow(ctx, `SELECT d.entity,p.revision FROM wfl_process_instances p
		JOIN wfl_process_documents l ON l.process_id=p.id JOIN vou_documents d ON d.id=l.document_id
		WHERE p.id=$1 AND d.id=$2 AND l.stage=$3`, processID, documentID, stage).Scan(&entity, &actual)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", validation("attachment document not found", nil)
	}
	if err != nil {
		return "", internal("verify attachment document", err)
	}
	if revision > 0 && actual != revision {
		return "", conflict("process changed", map[string]any{"processRevision": actual})
	}
	return entity, nil
}

func (s *Service) InitiateAttachment(ctx context.Context, action string, input AttachmentInitiateInput,
	actorID, requestID string) (AttachmentInitiateResult, error) {
	if s.files == nil {
		return AttachmentInitiateResult{}, internal("attachment service unavailable", nil)
	}
	entity, err := s.verifyAttachmentDocument(ctx, input.ProcessID, input.DocumentID,
		attachmentStage(action), input.ProcessRevision)
	if err != nil {
		return AttachmentInitiateResult{}, err
	}
	result, err := s.files.InitiateAttachment(ctx, entity, voudomain.AttachmentInitiateInput{
		DocumentID: input.DocumentID, Revision: input.DocumentRevision, FileName: input.FileName,
		ContentType: input.ContentType, Size: input.Size, SHA256: input.SHA256,
	}, actorID, requestID)
	if err != nil {
		return AttachmentInitiateResult{}, err
	}
	return AttachmentInitiateResult{ProcessID: input.ProcessID, ProcessRevision: input.ProcessRevision,
		DocumentID: input.DocumentID, DocumentRevision: result.Revision, FileID: result.FileID,
		UploadURL: result.UploadURL, ExpiresAt: result.ExpiresAt}, nil
}

func (s *Service) DownloadAttachment(ctx context.Context, action string, input AttachmentDownloadInput,
	actorID string) (AttachmentDownloadResult, error) {
	if s.files == nil {
		return AttachmentDownloadResult{}, internal("attachment service unavailable", nil)
	}
	entity, err := s.verifyAttachmentDocument(ctx, input.ProcessID, input.DocumentID, attachmentStage(action), 0)
	if err != nil {
		return AttachmentDownloadResult{}, err
	}
	result, err := s.files.CreateDownload(ctx, entity, voudomain.AttachmentDownloadInput{
		DocumentID: input.DocumentID, FileID: input.FileID,
	}, actorID)
	return AttachmentDownloadResult(result), err
}

func (s *Service) RemoveAttachment(ctx context.Context, action string, input AttachmentRemoveInput,
	actorID, requestID string) (AttachmentRemoveResult, error) {
	if s.files == nil {
		return AttachmentRemoveResult{}, internal("attachment service unavailable", nil)
	}
	entity, err := s.verifyAttachmentDocument(ctx, input.ProcessID, input.DocumentID,
		attachmentStage(action), input.ProcessRevision)
	if err != nil {
		return AttachmentRemoveResult{}, err
	}
	result, err := s.files.RemoveAttachment(ctx, entity, voudomain.AttachmentRemoveInput{
		DocumentID: input.DocumentID, Revision: input.DocumentRevision, FileID: input.FileID,
	}, actorID, requestID)
	if err != nil {
		return AttachmentRemoveResult{}, err
	}
	return AttachmentRemoveResult{ProcessID: input.ProcessID, ProcessRevision: input.ProcessRevision,
		DocumentID: input.DocumentID, DocumentRevision: result.Revision,
		DocumentStatus: result.Status}, nil
}
