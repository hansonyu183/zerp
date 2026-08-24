package bob

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/attachmentstore"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	CustomerAttachmentScopeRelationship = "RELATIONSHIP"
	CustomerAttachmentScopeAccount      = "ACCOUNT"
	maxCustomerAttachments              = 10
)

type CustomerAttachmentOptions struct {
	Root        string
	UploadTTL   time.Duration
	DownloadTTL time.Duration
}

type CustomerAttachmentService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	storage     *attachmentstore.Store
	uploadTTL   time.Duration
	downloadTTL time.Duration
}

type CustomerAttachmentInitiateInput struct {
	Scope            string `json:"scope"`
	OwnerID          string `json:"ownerId"`
	Revision         int64  `json:"revision"`
	CategoryObjectID string `json:"categoryObjectId"`
	FileName         string `json:"fileName"`
	ContentType      string `json:"contentType"`
	Size             int64  `json:"size"`
	SHA256           string `json:"sha256"`
}

type CustomerAttachmentDownloadInput struct {
	Scope   string `json:"scope"`
	OwnerID string `json:"ownerId"`
	FileID  string `json:"fileId"`
}

type CustomerAttachmentRemoveInput struct {
	Scope    string `json:"scope"`
	OwnerID  string `json:"ownerId"`
	Revision int64  `json:"revision"`
	FileID   string `json:"fileId"`
}

type CustomerAttachmentView struct {
	FileID            string     `json:"fileId"`
	FileName          string     `json:"fileName"`
	ContentType       string     `json:"contentType"`
	Size              int64      `json:"size"`
	SHA256            string     `json:"sha256"`
	Status            string     `json:"status"`
	CategoryObjectID  string     `json:"categoryObjectId"`
	CategoryVersionID string     `json:"categoryVersionId"`
	CategoryCode      string     `json:"categoryCode"`
	CategoryName      string     `json:"categoryName"`
	StoredAt          *time.Time `json:"storedAt"`
	CreatedAt         time.Time  `json:"createdAt"`
	CreatedBy         string     `json:"createdBy"`
}

type CustomerAttachmentInitiateResult struct {
	FileID    string    `json:"fileId"`
	UploadURL string    `json:"uploadUrl"`
	ExpiresAt time.Time `json:"expiresAt"`
	Revision  int64     `json:"revision"`
}

type CustomerAttachmentDownloadResult struct {
	DownloadURL string    `json:"downloadUrl"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type CustomerAttachmentMutationResult struct {
	Revision int64 `json:"revision"`
}

type CustomerAttachmentDownloadFile struct {
	Reader      *os.File
	FileName    string
	ContentType string
	Size        int64
}

func NewCustomerAttachmentService(pool *pgxpool.Pool, options CustomerAttachmentOptions) (*CustomerAttachmentService, error) {
	if pool == nil {
		return nil, errors.New("BOB customer attachment database is required")
	}
	storage, err := attachmentstore.New(options.Root)
	if err != nil {
		return nil, err
	}
	if options.UploadTTL <= 0 {
		options.UploadTTL = 15 * time.Minute
	}
	if options.DownloadTTL <= 0 {
		options.DownloadTTL = 5 * time.Minute
	}
	return &CustomerAttachmentService{
		pool: pool, queries: dbsqlc.New(pool), storage: storage,
		uploadTTL: options.UploadTTL, downloadTTL: options.DownloadTTL,
	}, nil
}

func validateCustomerAttachmentInitiate(input CustomerAttachmentInitiateInput) (string, error) {
	name := strings.TrimSpace(input.FileName)
	validType := input.ContentType == "application/pdf" || input.ContentType == "image/jpeg" || input.ContentType == "image/png"
	validHash := len(input.SHA256) == 64 && input.SHA256 == strings.ToLower(input.SHA256)
	if input.Scope != CustomerAttachmentScopeRelationship && input.Scope != CustomerAttachmentScopeAccount ||
		!validID(input.OwnerID) || input.Revision < 1 || !validID(input.CategoryObjectID) ||
		name == "" || len(name) > 255 || filepath.Base(name) != name || strings.ContainsAny(name, "/\\") ||
		!validType || input.Size < 1 || input.Size > attachmentstore.MaxFileBytes || !validHash {
		return "", domainError(ErrorValidation, "invalid customer attachment", nil, nil)
	}
	if _, err := hex.DecodeString(input.SHA256); err != nil {
		return "", domainError(ErrorValidation, "invalid customer attachment", nil, err)
	}
	return name, nil
}

func customerAttachmentToken() (string, string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	return token, customerAttachmentTokenHash(token), nil
}

func customerAttachmentTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *CustomerAttachmentService) Initiate(
	ctx context.Context, input CustomerAttachmentInitiateInput, actorID, requestID string,
) (CustomerAttachmentInitiateResult, error) {
	fileName, err := validateCustomerAttachmentInitiate(input)
	if err != nil || !validID(actorID) || strings.TrimSpace(requestID) == "" {
		if err != nil {
			return CustomerAttachmentInitiateResult{}, err
		}
		return CustomerAttachmentInitiateResult{}, domainError(ErrorValidation, "invalid customer attachment", nil, nil)
	}
	token, tokenHash, err := customerAttachmentToken()
	if err != nil {
		return CustomerAttachmentInitiateResult{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	fileID := newID()
	expiresAt := time.Now().UTC().Add(s.uploadTTL)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerAttachmentInitiateResult{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	category, err := q.ResolveCustomerDocumentCategory(ctx, input.CategoryObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return CustomerAttachmentInitiateResult{}, domainError(ErrorValidation, "customer document category is unavailable", nil, nil)
	}
	if err != nil {
		return CustomerAttachmentInitiateResult{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	categoryName := strings.TrimSpace(category.Name)
	if categoryName == "" {
		return CustomerAttachmentInitiateResult{}, domainError(ErrorInternal, "internal server error", nil, errors.New("internal server error"))
	}
	count, err := s.lockAndCount(ctx, q, input.Scope, input.OwnerID, input.Revision)
	if err != nil {
		return CustomerAttachmentInitiateResult{}, err
	}
	if count >= maxCustomerAttachments {
		return CustomerAttachmentInitiateResult{}, domainError(ErrorConflict, "customer attachment limit reached", nil, nil)
	}
	if err = q.InsertCustomerFile(ctx, dbsqlc.InsertCustomerFileParams{
		ID: fileID, StorageKey: "customer/" + fileID, OriginalName: fileName,
		ContentType: input.ContentType, DeclaredSize: input.Size, Sha256Hex: input.SHA256,
		UploadTokenHash: tokenHash, UploadExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true}, ActorID: actorID,
	}); err != nil {
		return CustomerAttachmentInitiateResult{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	link := dbsqlc.InsertCustomerRelationshipAttachmentParams{
		OwnerID: input.OwnerID, FileID: fileID, CategoryObjectID: category.ObjectID,
		CategoryVersionID: category.VersionID, CategoryCode: category.Code, CategoryName: categoryName, ActorID: actorID,
	}
	if input.Scope == CustomerAttachmentScopeRelationship {
		err = q.InsertCustomerRelationshipAttachment(ctx, link)
	} else {
		err = q.InsertCustomerVersionAttachment(ctx, dbsqlc.InsertCustomerVersionAttachmentParams(link))
	}
	if err != nil {
		return CustomerAttachmentInitiateResult{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	revision, err := s.touchAndAudit(ctx, q, input.Scope, input.OwnerID, input.Revision, fileID, "ATTACHED", actorID, requestID)
	if err != nil {
		return CustomerAttachmentInitiateResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerAttachmentInitiateResult{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	return CustomerAttachmentInitiateResult{
		FileID: fileID, UploadURL: "/files/customer-attachments/upload/" + token,
		ExpiresAt: expiresAt, Revision: revision,
	}, nil
}

func (s *CustomerAttachmentService) lockAndCount(
	ctx context.Context, q *dbsqlc.Queries, scope, ownerID string, revision int64,
) (int64, error) {
	if scope == CustomerAttachmentScopeRelationship {
		owner, err := q.LockCustomerAttachmentRelationship(ctx, ownerID)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && owner.Revision != revision {
			return 0, domainError(ErrorConflict, "customer group changed", nil, nil)
		}
		if err != nil {
			return 0, domainError(ErrorInternal, "internal server error", nil, err)
		}
		count, err := q.CountCustomerRelationshipAttachments(ctx, ownerID)
		if err != nil {
			return 0, domainError(ErrorInternal, "internal server error", nil, err)
		}
		return count, nil
	}
	owner, err := q.LockCustomerAttachmentVersion(ctx, ownerID)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && (owner.Revision != revision || owner.Status != StatusDraft) {
		return 0, domainError(ErrorConflict, "only the customer draft can change attachments", nil, nil)
	}
	if err != nil {
		return 0, domainError(ErrorInternal, "internal server error", nil, err)
	}
	count, err := q.CountCustomerVersionAttachments(ctx, ownerID)
	if err != nil {
		return 0, domainError(ErrorInternal, "internal server error", nil, err)
	}
	return count, nil
}

func (s *CustomerAttachmentService) touchAndAudit(
	ctx context.Context, q *dbsqlc.Queries, scope, ownerID string, revision int64,
	fileID, event, actorID, requestID string,
) (int64, error) {
	if scope == CustomerAttachmentScopeRelationship {
		next, err := q.TouchCustomerRelationshipAttachment(ctx, dbsqlc.TouchCustomerRelationshipAttachmentParams{
			ActorID: actorID, OwnerID: ownerID, Revision: revision,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, domainError(ErrorConflict, "customer group changed", nil, nil)
		}
		if err != nil {
			return 0, domainError(ErrorInternal, "internal server error", nil, err)
		}
		return next, nil
	}
	next, err := q.TouchCustomerVersionAttachment(ctx, dbsqlc.TouchCustomerVersionAttachmentParams{
		ActorID: actorID, OwnerID: ownerID, Revision: revision,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domainError(ErrorConflict, "customer draft changed", nil, nil)
	}
	if err != nil {
		return 0, domainError(ErrorInternal, "internal server error", nil, err)
	}
	owner, err := q.LockCustomerAttachmentVersion(ctx, ownerID)
	if err != nil {
		return 0, domainError(ErrorInternal, "internal server error", nil, err)
	}
	if err = insertAudit(ctx, q, auditInput{
		ObjectID: owner.ObjectID, VersionID: ownerID, Entity: EntityCustomer, Event: event,
		From: customerAttachmentStringPtr(StatusDraft), To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"fileId": fileID},
	}); err != nil {
		return 0, domainError(ErrorInternal, "internal server error", nil, err)
	}
	return next, nil
}

func (s *CustomerAttachmentService) Upload(
	ctx context.Context, token string, body io.Reader, contentLength int64, contentType string,
) error {
	if token == "" {
		return domainError(ErrorValidation, "invalid upload token", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domainError(ErrorInternal, "internal server error", nil, err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	file, err := q.LockPendingCustomerUpload(ctx, customerAttachmentTokenHash(token))
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorValidation, "upload token is invalid or expired", nil, nil)
	}
	if err != nil {
		return domainError(ErrorInternal, "internal server error", nil, err)
	}
	if file.Scope == CustomerAttachmentScopeAccount && (file.VersionStatus == nil || *file.VersionStatus != StatusDraft) {
		return domainError(ErrorConflict, "customer version is not a draft", nil, nil)
	}
	if contentLength != file.DeclaredSize || contentType != file.ContentType {
		return domainError(ErrorValidation, "upload headers do not match declaration", nil, nil)
	}
	if err = s.storage.Put(ctx, file.StorageKey, body, file.DeclaredSize, file.ContentType, file.Sha256Hex); err != nil {
		return domainError(ErrorValidation, err.Error(), nil, err)
	}
	rows, err := q.MarkCustomerFileReady(ctx, file.ID)
	if err != nil || rows != 1 {
		s.storage.Delete(file.StorageKey) //nolint:errcheck
		return domainError(ErrorInternal, "internal server error", nil, err)
	}
	if err = tx.Commit(ctx); err != nil {
		s.storage.Delete(file.StorageKey) //nolint:errcheck
		return domainError(ErrorInternal, "internal server error", nil, err)
	}
	return nil
}

func (s *CustomerAttachmentService) CreateDownload(
	ctx context.Context, input CustomerAttachmentDownloadInput, actorID string,
) (CustomerAttachmentDownloadResult, error) {
	if (input.Scope != CustomerAttachmentScopeRelationship && input.Scope != CustomerAttachmentScopeAccount) ||
		!validID(input.OwnerID) || !validID(input.FileID) || !validID(actorID) {
		return CustomerAttachmentDownloadResult{}, domainError(ErrorValidation, "invalid customer attachment", nil, nil)
	}
	var fileID string
	if input.Scope == CustomerAttachmentScopeRelationship {
		row, err := s.queries.GetReadyCustomerRelationshipAttachment(ctx, dbsqlc.GetReadyCustomerRelationshipAttachmentParams{OwnerID: input.OwnerID, FileID: input.FileID})
		if err != nil {
			return CustomerAttachmentDownloadResult{}, customerAttachmentNotFound(err)
		}
		fileID = row.ID
	} else {
		row, err := s.queries.GetReadyCustomerVersionAttachment(ctx, dbsqlc.GetReadyCustomerVersionAttachmentParams{OwnerID: input.OwnerID, FileID: input.FileID})
		if err != nil {
			return CustomerAttachmentDownloadResult{}, customerAttachmentNotFound(err)
		}
		fileID = row.ID
	}
	token, hash, err := customerAttachmentToken()
	if err != nil {
		return CustomerAttachmentDownloadResult{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	expiresAt := time.Now().UTC().Add(s.downloadTTL)
	if err = s.queries.InsertCustomerDownloadToken(ctx, dbsqlc.InsertCustomerDownloadTokenParams{
		TokenHash: hash, FileID: fileID, ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true}, ActorID: actorID,
	}); err != nil {
		return CustomerAttachmentDownloadResult{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	return CustomerAttachmentDownloadResult{DownloadURL: "/files/customer-attachments/download/" + token, ExpiresAt: expiresAt}, nil
}

func customerAttachmentNotFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorValidation, "customer attachment not found", nil, nil)
	}
	return domainError(ErrorInternal, "internal server error", nil, err)
}

func (s *CustomerAttachmentService) OpenDownload(ctx context.Context, token string) (CustomerAttachmentDownloadFile, error) {
	if token == "" {
		return CustomerAttachmentDownloadFile{}, domainError(ErrorValidation, "invalid download token", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerAttachmentDownloadFile{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	row, err := s.queries.WithTx(tx).ConsumeCustomerDownloadToken(ctx, customerAttachmentTokenHash(token))
	if errors.Is(err, pgx.ErrNoRows) {
		return CustomerAttachmentDownloadFile{}, domainError(ErrorValidation, "download token is invalid or expired", nil, nil)
	}
	if err != nil {
		return CustomerAttachmentDownloadFile{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	reader, err := s.storage.Open(row.StorageKey)
	if err != nil {
		return CustomerAttachmentDownloadFile{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	if err = tx.Commit(ctx); err != nil {
		reader.Close() //nolint:errcheck
		return CustomerAttachmentDownloadFile{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	return CustomerAttachmentDownloadFile{Reader: reader, FileName: row.OriginalName, ContentType: row.ContentType, Size: row.DeclaredSize}, nil
}

func (s *CustomerAttachmentService) Remove(
	ctx context.Context, input CustomerAttachmentRemoveInput, actorID, requestID string,
) (CustomerAttachmentMutationResult, error) {
	if (input.Scope != CustomerAttachmentScopeRelationship && input.Scope != CustomerAttachmentScopeAccount) ||
		!validID(input.OwnerID) || !validID(input.FileID) || input.Revision < 1 || !validID(actorID) || strings.TrimSpace(requestID) == "" {
		return CustomerAttachmentMutationResult{}, domainError(ErrorValidation, "invalid customer attachment", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerAttachmentMutationResult{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	if _, err = s.lockAndCount(ctx, q, input.Scope, input.OwnerID, input.Revision); err != nil {
		return CustomerAttachmentMutationResult{}, err
	}
	referenceCount, err := q.CustomerFileReferenceCount(ctx, input.FileID)
	if err != nil {
		return CustomerAttachmentMutationResult{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	storageKey := ""
	if referenceCount == 1 {
		storageKey, err = q.GetCustomerFileStorageKey(ctx, input.FileID)
		if err != nil {
			return CustomerAttachmentMutationResult{}, customerAttachmentNotFound(err)
		}
	}
	var rows int64
	if input.Scope == CustomerAttachmentScopeRelationship {
		rows, err = q.DeleteCustomerRelationshipAttachment(ctx, dbsqlc.DeleteCustomerRelationshipAttachmentParams{OwnerID: input.OwnerID, FileID: input.FileID})
	} else {
		rows, err = q.DeleteCustomerVersionAttachment(ctx, dbsqlc.DeleteCustomerVersionAttachmentParams{OwnerID: input.OwnerID, FileID: input.FileID})
	}
	if err != nil {
		return CustomerAttachmentMutationResult{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	if rows != 1 {
		return CustomerAttachmentMutationResult{}, domainError(ErrorValidation, "customer attachment not found", nil, nil)
	}
	revision, err := s.touchAndAudit(ctx, q, input.Scope, input.OwnerID, input.Revision, input.FileID, "DETACHED", actorID, requestID)
	if err != nil {
		return CustomerAttachmentMutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerAttachmentMutationResult{}, domainError(ErrorInternal, "internal server error", nil, err)
	}
	if storageKey != "" {
		// The relation and metadata deletion is already committed. A later orphan
		// cleanup retries byte removal if the storage operation is temporarily unavailable.
		_ = s.storage.Delete(storageKey)
	}
	return CustomerAttachmentMutationResult{Revision: revision}, nil
}

func (s *CustomerAttachmentService) EnrichDetail(ctx context.Context, detail *CustomerDetailView) error {
	groupRows, err := s.queries.ListCustomerRelationshipAttachments(ctx, detail.ObjectID)
	if err != nil {
		return domainError(ErrorInternal, "internal server error", nil, err)
	}
	detail.Attachments = make([]CustomerAttachmentView, 0, len(groupRows))
	for _, row := range groupRows {
		detail.Attachments = append(detail.Attachments, customerRelationshipAttachmentView(row))
	}
	for index := range detail.Accounts {
		for _, version := range []*CustomerVersionView{detail.Accounts[index].Effective, detail.Accounts[index].Candidate} {
			if version == nil {
				continue
			}
			rows, listErr := s.queries.ListCustomerVersionAttachments(ctx, version.Version.VersionID)
			if listErr != nil {
				return domainError(ErrorInternal, "internal server error", nil, listErr)
			}
			version.Attachments = make([]CustomerAttachmentView, 0, len(rows))
			for _, row := range rows {
				version.Attachments = append(version.Attachments, customerVersionAttachmentView(row))
			}
		}
	}
	return nil
}

func (s *CustomerAttachmentService) CleanupOrphanFiles(ctx context.Context) (int, error) {
	keys, err := s.queries.ListAllCustomerStorageKeys(ctx)
	if err != nil {
		return 0, domainError(ErrorInternal, "internal server error", nil, err)
	}
	known := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		known[key] = struct{}{}
	}
	removed, err := s.storage.RemoveNamespaceOrphans("customer", known)
	if err != nil {
		return removed, domainError(ErrorInternal, "internal server error", nil, err)
	}
	return removed, nil
}

func customerRelationshipAttachmentView(row dbsqlc.ListCustomerRelationshipAttachmentsRow) CustomerAttachmentView {
	return CustomerAttachmentView{
		FileID: row.FileID, FileName: row.FileName, ContentType: row.ContentType, Size: row.DeclaredSize,
		SHA256: row.Sha256Hex, Status: row.Status, StoredAt: nullableTime(row.StoredAt),
		CategoryObjectID: row.CategoryObjectID, CategoryVersionID: row.CategoryVersionID,
		CategoryCode: row.CategoryCode, CategoryName: row.CategoryName,
		CreatedAt: row.CreatedAt.Time, CreatedBy: row.CreatedBy,
	}
}

func customerVersionAttachmentView(row dbsqlc.ListCustomerVersionAttachmentsRow) CustomerAttachmentView {
	return CustomerAttachmentView{
		FileID: row.FileID, FileName: row.FileName, ContentType: row.ContentType, Size: row.DeclaredSize,
		SHA256: row.Sha256Hex, Status: row.Status, StoredAt: nullableTime(row.StoredAt),
		CategoryObjectID: row.CategoryObjectID, CategoryVersionID: row.CategoryVersionID,
		CategoryCode: row.CategoryCode, CategoryName: row.CategoryName,
		CreatedAt: row.CreatedAt.Time, CreatedBy: row.CreatedBy,
	}
}

func nullableTime(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	result := value.Time
	return &result
}

func customerAttachmentStringPtr(value string) *string { return &value }
