package dcl

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
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/attachmentstore"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

const maxDCLCustomerAttachments = 10

type CustomerAttachmentOptions struct {
	Root        string
	UploadTTL   time.Duration
	DownloadTTL time.Duration
}
type CustomerAttachmentInitiateInput struct {
	OwnerApprovalEntryID string `json:"ownerApprovalEntryId"`
	Scope                string `json:"scope"`
	SubunitID            string `json:"subunitId,omitempty"`
	ApprovalRevision     int64  `json:"approvalRevision"`
	CategoryObjectID     string `json:"categoryObjectId"`
	FileName             string `json:"fileName"`
	ContentType          string `json:"contentType"`
	Size                 int64  `json:"size"`
	SHA256               string `json:"sha256"`
}
type CustomerAttachmentDownloadInput struct {
	OwnerApprovalEntryID string `json:"ownerApprovalEntryId"`
	Scope                string `json:"scope"`
	SubunitID            string `json:"subunitId,omitempty"`
	FileID               string `json:"fileId"`
}
type CustomerAttachmentRemoveInput struct {
	OwnerApprovalEntryID string `json:"ownerApprovalEntryId"`
	Scope                string `json:"scope"`
	SubunitID            string `json:"subunitId,omitempty"`
	ApprovalRevision     int64  `json:"approvalRevision"`
	FileID               string `json:"fileId"`
}
type CustomerAttachmentInitiateResult struct {
	FileID           string    `json:"fileId"`
	UploadURL        string    `json:"uploadUrl"`
	ExpiresAt        time.Time `json:"expiresAt"`
	ApprovalRevision int64     `json:"approvalRevision"`
}
type CustomerAttachmentDownloadResult struct {
	DownloadURL string    `json:"downloadUrl"`
	ExpiresAt   time.Time `json:"expiresAt"`
}
type CustomerAttachmentMutationResult struct {
	ApprovalRevision int64 `json:"approvalRevision"`
}
type CustomerAttachmentDownloadFile struct {
	Reader      *os.File
	FileName    string
	ContentType string
	Size        int64
}
type CustomerAttachmentService struct {
	pool                   *pgxpool.Pool
	queries                *dbsqlc.Queries
	storage                *attachmentstore.Store
	uploadTTL, downloadTTL time.Duration
	customer               *approval.Coordinator[dclapproval.CustomerPayload]
}

func NewCustomerAttachmentService(pool *pgxpool.Pool, options CustomerAttachmentOptions, authorizer approval.Authorizer, bus *txevent.Bus) (*CustomerAttachmentService, error) {
	if pool == nil || authorizer == nil || bus == nil {
		return nil, errors.New("dcl customer attachment dependencies are required")
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
	customer, err := approval.NewCoordinator("dcl", EntityCustomer, authorizer, bus, dclapproval.CustomerTopic)
	if err != nil {
		return nil, err
	}
	return &CustomerAttachmentService{pool: pool, queries: dbsqlc.New(pool), storage: storage, uploadTTL: options.UploadTTL, downloadTTL: options.DownloadTTL, customer: customer}, nil
}
func customerAttachmentToken() (string, string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(token))
	return token, hex.EncodeToString(sum[:]), nil
}
func validateDCLCustomerAttachment(in CustomerAttachmentInitiateInput) (string, error) {
	name := strings.TrimSpace(in.FileName)
	validType := in.ContentType == "application/pdf" || in.ContentType == "image/jpeg" || in.ContentType == "image/png"
	if !validCustomerAttachmentScope(in.Scope, in.SubunitID) || !validID(in.OwnerApprovalEntryID) || (in.SubunitID != "" && !validID(in.SubunitID)) || in.ApprovalRevision < 1 || !validID(in.CategoryObjectID) || name == "" || len(name) > 255 || filepath.Base(name) != name || strings.ContainsAny(name, "/\\") || !validType || in.Size < 1 || in.Size > attachmentstore.MaxFileBytes || len(in.SHA256) != 64 || in.SHA256 != strings.ToLower(in.SHA256) {
		return "", newError(ErrorValidation, "validation_failed", "invalid customer attachment", nil, nil)
	}
	if _, err := hex.DecodeString(in.SHA256); err != nil {
		return "", newError(ErrorValidation, "validation_failed", "invalid customer attachment", nil, err)
	}
	return name, nil
}

func validCustomerAttachmentScope(scope, subunitID string) bool {
	return (scope == "CUSTOMER" && subunitID == "") || (scope == "CUSTOMER_SUBUNIT" && validID(subunitID))
}
func (s *CustomerAttachmentService) lockDraft(ctx context.Context, q *dbsqlc.Queries, entryID string, revision int64, enforceLimit bool) (dbsqlc.ApprovalEntry, error) {
	var e dbsqlc.ApprovalEntry
	var err error
	var count int64
	e, err = q.LockDCLCustomerAttachmentOwner(ctx, entryID)
	if err == nil {
		count, err = q.CountDCLCustomerAttachments(ctx, entryID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return e, newError(ErrorValidation, "validation_failed", "customer attachment owner not found", nil, err)
	}
	if err != nil {
		return e, translateError(err)
	}
	if e.Status != string(approval.StatusDraft) || e.Revision != revision {
		return e, newError(ErrorConflict, "approval_stale_revision", "only a customer draft can change attachments", nil, nil)
	}
	if enforceLimit && count >= maxDCLCustomerAttachments {
		return e, newError(ErrorConflict, "customer_attachment_limit_reached", "customer attachment limit reached", nil, nil)
	}
	return e, nil
}
func (s *CustomerAttachmentService) touchDraft(ctx context.Context, tx pgx.Tx, e dbsqlc.ApprovalEntry, actor approval.Actor) (approval.Entry, error) {
	entry := approvalEntry(e)
	q := s.queries.WithTx(tx)
	identity, err := lockSubject(ctx, tx, EntityCustomer, entry.SubjectID)
	if err != nil {
		return approval.Entry{}, translateError(err)
	}
	stored, err := q.GetDCLCustomerVersionAggregate(ctx, entry.ID)
	if err != nil {
		return approval.Entry{}, translateError(err)
	}
	return s.customer.SaveDraft(ctx, tx, entry.ID, entry.Revision, actor, dclapproval.CustomerPayload{SubjectID: entry.SubjectID, Code: identity.Code, Enabled: stored.Enabled})
}
func (s *CustomerAttachmentService) Initiate(ctx context.Context, in CustomerAttachmentInitiateInput, actor approval.Actor) (CustomerAttachmentInitiateResult, error) {
	name, err := validateDCLCustomerAttachment(in)
	if err != nil || !validActor(actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid customer attachment", nil, nil)
		}
		return CustomerAttachmentInitiateResult{}, err
	}
	token, hash, err := customerAttachmentToken()
	if err != nil {
		return CustomerAttachmentInitiateResult{}, translateError(err)
	}
	expires := time.Now().UTC().Add(s.uploadTTL)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerAttachmentInitiateResult{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	owner, err := s.lockDraft(ctx, q, in.OwnerApprovalEntryID, in.ApprovalRevision, true)
	if err != nil {
		return CustomerAttachmentInitiateResult{}, err
	}
	if err = ensureCustomerAttachmentSubunit(ctx, q, owner.ID, in.SubunitID); err != nil {
		return CustomerAttachmentInitiateResult{}, err
	}
	category, err := q.ResolveCustomerDocumentCategory(ctx, in.CategoryObjectID)
	if err != nil {
		return CustomerAttachmentInitiateResult{}, translateError(err)
	}
	fileID := ulid.Make().String()
	if err = q.InsertCustomerFile(ctx, dbsqlc.InsertCustomerFileParams{ID: fileID, StorageKey: "customer/" + fileID, OriginalName: name, ContentType: in.ContentType, DeclaredSize: in.Size, Sha256Hex: in.SHA256, UploadTokenHash: hash, UploadExpiresAt: pgtype.Timestamptz{Time: expires, Valid: true}, ActorID: actor.ID()}); err != nil {
		return CustomerAttachmentInitiateResult{}, translateError(err)
	}
	err = q.InsertDCLCustomerAttachment(ctx, dbsqlc.InsertDCLCustomerAttachmentParams{ApprovalEntryID: owner.ID, SubunitID: nilIfEmpty(in.SubunitID), FileID: fileID, CategoryObjectID: category.ObjectID, CategoryCode: category.Code, CategoryName: category.Name, ActorID: actor.ID()})
	if err != nil {
		return CustomerAttachmentInitiateResult{}, translateError(err)
	}
	e, err := s.touchDraft(ctx, tx, owner, actor)
	if err != nil {
		return CustomerAttachmentInitiateResult{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerAttachmentInitiateResult{}, translateError(err)
	}
	return CustomerAttachmentInitiateResult{FileID: fileID, UploadURL: "/files/customer-attachments/upload/" + token, ExpiresAt: expires, ApprovalRevision: e.Revision}, nil
}

func (s *CustomerAttachmentService) Upload(ctx context.Context, token string, body io.Reader, contentLength int64, contentType string) error {
	if token == "" {
		return newError(ErrorValidation, "validation_failed", "invalid upload token", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx)
	file, err := s.queries.WithTx(tx).LockPendingDCLCustomerUpload(ctx, tokenHash(token))
	if errors.Is(err, pgx.ErrNoRows) {
		return newError(ErrorValidation, "validation_failed", "upload token is invalid or expired", nil, nil)
	}
	if err != nil {
		return translateError(err)
	}
	if file.OwnerStatus != string(approval.StatusDraft) {
		return newError(ErrorConflict, "approval_invalid_transition", "customer attachment owner is not a draft", nil, nil)
	}
	if contentLength != file.DeclaredSize || contentType != file.ContentType {
		return newError(ErrorValidation, "validation_failed", "upload headers do not match declaration", nil, nil)
	}
	if err = s.storage.Put(ctx, file.StorageKey, body, file.DeclaredSize, file.ContentType, file.Sha256Hex); err != nil {
		return newError(ErrorValidation, "validation_failed", err.Error(), nil, err)
	}
	if n, x := s.queries.WithTx(tx).MarkCustomerFileReady(ctx, file.ID); x != nil || n != 1 {
		_ = s.storage.Delete(file.StorageKey)
		return translateError(x)
	}
	if err = tx.Commit(ctx); err != nil {
		_ = s.storage.Delete(file.StorageKey)
		return translateError(err)
	}
	return nil
}
func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func (s *CustomerAttachmentService) CreateDownload(ctx context.Context, in CustomerAttachmentDownloadInput, actorID string) (CustomerAttachmentDownloadResult, error) {
	if !validCustomerAttachmentScope(in.Scope, in.SubunitID) || !validID(in.OwnerApprovalEntryID) || (in.SubunitID != "" && !validID(in.SubunitID)) || !validID(in.FileID) || !validID(actorID) {
		return CustomerAttachmentDownloadResult{}, newError(ErrorValidation, "validation_failed", "invalid customer attachment", nil, nil)
	}
	if err := ensureCustomerAttachmentFileSubunit(ctx, s.queries, in.OwnerApprovalEntryID, in.SubunitID, in.FileID); err != nil {
		return CustomerAttachmentDownloadResult{}, err
	}
	_, err := s.queries.GetReadyDCLCustomerAttachment(ctx, dbsqlc.GetReadyDCLCustomerAttachmentParams{ApprovalEntryID: in.OwnerApprovalEntryID, FileID: in.FileID})
	if err != nil {
		return CustomerAttachmentDownloadResult{}, newError(ErrorValidation, "validation_failed", "customer attachment not found", nil, err)
	}
	token, hash, err := customerAttachmentToken()
	if err != nil {
		return CustomerAttachmentDownloadResult{}, translateError(err)
	}
	expires := time.Now().UTC().Add(s.downloadTTL)
	if err = s.queries.InsertCustomerDownloadToken(ctx, dbsqlc.InsertCustomerDownloadTokenParams{TokenHash: hash, FileID: in.FileID, ExpiresAt: pgtype.Timestamptz{Time: expires, Valid: true}, ActorID: actorID}); err != nil {
		return CustomerAttachmentDownloadResult{}, translateError(err)
	}
	return CustomerAttachmentDownloadResult{DownloadURL: "/files/customer-attachments/download/" + token, ExpiresAt: expires}, nil
}
func (s *CustomerAttachmentService) OpenDownload(ctx context.Context, token string) (CustomerAttachmentDownloadFile, error) {
	if token == "" {
		return CustomerAttachmentDownloadFile{}, newError(ErrorValidation, "validation_failed", "invalid download token", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerAttachmentDownloadFile{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	row, err := s.queries.WithTx(tx).ConsumeCustomerDownloadToken(ctx, tokenHash(token))
	if err != nil {
		return CustomerAttachmentDownloadFile{}, newError(ErrorValidation, "validation_failed", "download token is invalid or expired", nil, err)
	}
	reader, err := s.storage.Open(row.StorageKey)
	if err != nil {
		return CustomerAttachmentDownloadFile{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		_ = reader.Close()
		return CustomerAttachmentDownloadFile{}, translateError(err)
	}
	return CustomerAttachmentDownloadFile{Reader: reader, FileName: row.OriginalName, ContentType: row.ContentType, Size: row.DeclaredSize}, nil
}
func (s *CustomerAttachmentService) Remove(ctx context.Context, in CustomerAttachmentRemoveInput, actor approval.Actor) (CustomerAttachmentMutationResult, error) {
	if !validCustomerAttachmentScope(in.Scope, in.SubunitID) || !validID(in.OwnerApprovalEntryID) || (in.SubunitID != "" && !validID(in.SubunitID)) || !validID(in.FileID) || in.ApprovalRevision < 1 || !validActor(actor) {
		return CustomerAttachmentMutationResult{}, newError(ErrorValidation, "validation_failed", "invalid customer attachment", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CustomerAttachmentMutationResult{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	q := s.queries.WithTx(tx)
	owner, err := s.lockDraft(ctx, q, in.OwnerApprovalEntryID, in.ApprovalRevision, false)
	if err != nil {
		return CustomerAttachmentMutationResult{}, err
	}
	if err = ensureCustomerAttachmentFileSubunit(ctx, q, owner.ID, in.SubunitID, in.FileID); err != nil {
		return CustomerAttachmentMutationResult{}, err
	}
	var n int64
	n, err = q.DeleteDCLCustomerAttachment(ctx, dbsqlc.DeleteDCLCustomerAttachmentParams{ApprovalEntryID: owner.ID, FileID: in.FileID})
	if err != nil {
		return CustomerAttachmentMutationResult{}, translateError(err)
	}
	if n != 1 {
		return CustomerAttachmentMutationResult{}, newError(ErrorValidation, "validation_failed", "customer attachment not found", nil, nil)
	}
	e, err := s.touchDraft(ctx, tx, owner, actor)
	if err != nil {
		return CustomerAttachmentMutationResult{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return CustomerAttachmentMutationResult{}, translateError(err)
	}
	return CustomerAttachmentMutationResult{ApprovalRevision: e.Revision}, nil
}

func ensureCustomerAttachmentSubunit(ctx context.Context, q *dbsqlc.Queries, entryID, subunitID string) error {
	if subunitID == "" {
		return nil
	}
	subunits, err := q.ListDCLCustomerVersionSubunits(ctx, entryID)
	if err != nil {
		return translateError(err)
	}
	for _, subunit := range subunits {
		if subunit.SubunitID == subunitID {
			return nil
		}
	}
	return newError(ErrorValidation, "validation_failed", "customer attachment subunit not found in revision", nil, nil)
}

func ensureCustomerAttachmentFileSubunit(ctx context.Context, q *dbsqlc.Queries, entryID, subunitID, fileID string) error {
	attachments, err := ListCustomerAttachments(ctx, q, entryID)
	if err != nil {
		return err
	}
	for _, attachment := range attachments {
		if attachment.FileID == fileID && attachment.SubunitID == subunitID {
			return nil
		}
	}
	return newError(ErrorValidation, "validation_failed", "customer attachment not found", nil, nil)
}

// CleanupOrphanFiles removes storage bytes that no longer have DCL metadata.
// It runs outside approval transactions.
func (s *CustomerAttachmentService) CleanupOrphanFiles(ctx context.Context) (int, error) {
	keys, err := s.queries.ListAllDCLCustomerStorageKeys(ctx)
	if err != nil {
		return 0, translateError(err)
	}
	known := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		known[key] = struct{}{}
	}
	removed, err := s.storage.RemoveNamespaceOrphans("customer", known)
	if err != nil {
		return removed, translateError(err)
	}
	return removed, nil
}

// CustomerAttachmentView belongs to one Customer approval revision and may
// optionally be scoped to one subunit line in that revision.
type CustomerAttachmentView struct {
	FileID           string     `json:"fileId"`
	SubunitID        string     `json:"subunitId,omitempty"`
	FileName         string     `json:"fileName"`
	ContentType      string     `json:"contentType"`
	Size             int64      `json:"size"`
	SHA256           string     `json:"sha256"`
	Status           string     `json:"status"`
	StoredAt         *time.Time `json:"storedAt,omitempty"`
	CategoryObjectID string     `json:"categoryObjectId"`
	CategoryCode     string     `json:"categoryCode"`
	CategoryName     string     `json:"categoryName"`
	CreatedAt        time.Time  `json:"createdAt"`
	CreatedBy        string     `json:"createdBy"`
}

func ListCustomerAttachments(ctx context.Context, q *dbsqlc.Queries, approvalEntryID string) ([]CustomerAttachmentView, error) {
	rows, err := q.ListDCLCustomerAttachments(ctx, approvalEntryID)
	if err != nil {
		return nil, translateError(err)
	}
	items := make([]CustomerAttachmentView, 0, len(rows))
	for _, row := range rows {
		items = append(items, customerAttachmentView(stringValue(row.SubunitID), row.FileID, row.OriginalName, row.ContentType, row.DeclaredSize, row.Sha256Hex, row.Status, row.StoredAt, row.CategoryObjectID, row.CategoryCode, row.CategoryName, row.CreatedAt.Time, row.CreatedBy))
	}
	return items, nil
}
func customerAttachmentView(subunitID, fileID, fileName, contentType string, size int64, sha, status string, storedAt pgtype.Timestamptz, categoryID, categoryCode, categoryName string, createdAt time.Time, createdBy string) CustomerAttachmentView {
	v := CustomerAttachmentView{SubunitID: subunitID, FileID: fileID, FileName: fileName, ContentType: contentType, Size: size, SHA256: sha, Status: status, CategoryObjectID: categoryID, CategoryCode: categoryCode, CategoryName: categoryName, CreatedAt: createdAt, CreatedBy: createdBy}
	if storedAt.Valid {
		value := storedAt.Time
		v.StoredAt = &value
	}
	return v
}
